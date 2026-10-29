import type { AccountDetails } from "@rowcat/domain";
import { setPasswordMutationOptions } from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AuthFailure } from "#/features/auth/auth-error.ts";
import { getRowCatClient } from "#/lib/api.ts";
import { authClient } from "#/lib/auth.ts";
import { feedbackEnter, feedbackExit } from "#/lib/motion/feedback.ts";
import { PasswordDialog } from "./password-dialog.tsx";
import {
	changePasswordErrorMessage,
	logSecurityFailure,
	securityErrorMessage,
} from "./security-error.ts";

/**
 * Password: **what the account holds decides the operation.**
 *
 * ```text
 * has a password   change   verifies the current password → Better Auth receives it directly
 * no password      set      there is no current password to verify → a RowCat route calls on its behalf
 * ```
 *
 * The least visible fact in this component is that the two operations leave by **different
 * channels**, so it is written here. Change goes out through `authClient.changePassword`, which
 * means the current password never passes through `@rowcat/contracts` or `@rowcat/sdk`. This is the
 * same decision as account deletion calling `authClient.deleteUser()` directly. Only set goes
 * through our route, because Better Auth's `setPassword` is **serverOnly**, so no endpoint exists
 * that the browser could call.
 *
 * Two channels mean two failure shapes, and the sentences are gathered in one place
 * (`security-error.ts`). If the two channels described the same reason differently, the user would
 * meet one problem in two different ways.
 *
 * ## The last change time is not drawn
 *
 * Better Auth does not expose that value (the `updatedAt` on the account row also moves on token
 * refresh), and inventing it would make the screen state a lie such as "this account has not
 * changed its password in three months".
 *
 * ## Success is said **outside the dialog**
 *
 * On success the dialog closes, and the place to say what happened closes with it. What would
 * remain is the same single button as before pressing, so success and cancellation would look
 * identical. The dialog is not kept open for this either: unmounting is what removes the plaintext
 * from the input fields, and lengthening that time for an animation would trade away the most
 * expensive thing this screen protects.
 *
 * So the result is **held by the parent**. Only which operation succeeded is stored here; the
 * password never enters this component's state. `submit` receives the values, but they go only into
 * the request and are not stored anywhere.
 */
export function PasswordSection({ account }: { account: AccountDetails }) {
	const { t } = useTranslation(["account", "common"]);
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	/**
	 * The operation that just finished. **Not re-derived from `mode`.**
	 *
	 * Setting a password for the first time makes `account.hasPassword` true, and `mode` switches to
	 * `change` at that moment. If the result sentence were chosen from the current `mode`, someone who
	 * just **set** a password would read "changed", which they did not do.
	 */
	const [result, setResult] = useState<"set" | "changed" | null>(null);

	const setPassword = useMutation(
		setPasswordMutationOptions(getRowCatClient(), queryClient),
	);

	const mode = account.hasPassword ? "change" : "set";

	const close = (): void => {
		setOpen(false);
		setError(null);
	};

	const submit = (values: {
		currentPassword: string;
		newPassword: string;
	}): void => {
		setError(null);
		// Clear the previous result when a new attempt starts. If an earlier success stayed beside a
		// failed attempt, the screen would state two contradictory facts together.
		setResult(null);
		setPending(true);
		void (async () => {
			try {
				if (mode === "set") {
					await setPassword.mutateAsync({ newPassword: values.newPassword });
				} else {
					/**
					 * A response comes back as `{ error }`, but when the server cannot be reached this **throws**.
					 * If that branch is not caught, the flow stays in progress forever and the user cannot even
					 * tell whether the password changed (the account-deletion hook had the same defect).
					 *
					 * `revokeOtherSessions` is **not** passed. The library offers that option, but if changing the
					 * password silently signed out other devices, the user would read it as something they did not
					 * do. That operation has its own confirmation dialog in the session section below.
					 */
					const failure = await authClient
						.changePassword({
							currentPassword: values.currentPassword,
							newPassword: values.newPassword,
						})
						// Named so it does not collide with the outer `result` (the operation just finished).
						.then((outcome) => outcome.error ?? null)
						.catch((): AuthFailure => ({}));
					if (failure) {
						logSecurityFailure("change-password", failure as AuthFailure);
						setError(changePasswordErrorMessage(failure as AuthFailure));
						return;
					}
				}
				/**
				 * On success, close the dialog, and the input fields go away with it. The surest way to avoid
				 * keeping the password in screen state is to unmount the component (when `open` is false,
				 * `PasswordDialog` is not rendered at all).
				 *
				 * Fix the result **before closing**. The current `mode` is the last moment that knows what this
				 * operation was; by the time the next fetch returns, that value already says something else.
				 */
				setResult(mode === "set" ? "set" : "changed");
				close();
			} catch (thrown) {
				setError(securityErrorMessage(thrown));
			} finally {
				setPending(false);
			}
		})();
	};

	return (
		<div className="flex flex-col gap-3 pt-2">
			<p className="text-sm text-muted-foreground">
				{account.hasPassword
					? t("passwordSection.youCanSignInWith")
					: /*
						 * **Do not name the provider.** For a while this sentence said "without Google", which
						 * was correct when social was the only method. For someone who signed up only with Apple,
						 * it would point to a method they never used. The list above already says which method
						 * they came in with.
						 */
						t("passwordSection.noPasswordYetSetOne")}
			</p>
			<div>
				<Button
					variant="outline"
					size="sm"
					onClick={() => {
						setError(null);
						// Reopening makes the previous result stale.
						setResult(null);
						setOpen(true);
					}}
				>
					{account.hasPassword
						? t("passwordSection.changePassword")
						: t("passwordSection.setPassword")}
				</Button>
			</div>

			{/*
			 * Result line, **directly below the button just pressed.** The rhythm comes from
			 * `lib/motion/feedback.ts`. This spot is the last child of the flow (the dialog below is a
			 * portal and does not take part in the flow), so its exit delays no one's position.
			 *
			 * `aria-live="polite"` because the sentence appears without moving focus. It is not
			 * `role="alert"` because success is not an event that should interrupt what the user is doing.
			 * A failure stays inside the dialog and speaks in its own place.
			 *
			 * Not cleared with a timer. The only condition that removes this sentence is the user starting
			 * the operation again; until then the fact remains true.
			 */}
			<output aria-live="polite" className="empty:hidden">
				<AnimatePresence initial={false}>
					{result && (
						<m.span
							key={result}
							initial={feedbackEnter.initial}
							animate={feedbackEnter.animate}
							exit={feedbackExit}
							transition={feedbackEnter.transition}
							className="flex items-center gap-1.5 text-sm text-muted-foreground"
						>
							<Check aria-hidden="true" className="size-4 shrink-0" />
							{result === "set"
								? t("passwordSection.yourPasswordWasSet")
								: t("passwordSection.yourPasswordWasChanged")}
						</m.span>
					)}
				</AnimatePresence>
			</output>

			{open && (
				<PasswordDialog
					mode={mode}
					pending={pending}
					error={error}
					onClose={close}
					onSubmit={submit}
				/>
			)}
		</div>
	);
}
