import { space } from "@rowcat/design";
import type { AccountDetails } from "@rowcat/domain";
import { setPasswordMutationOptions } from "@rowcat/query";
import { Button, Text } from "@rowcat/ui-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { changeAccountPassword } from "../../lib/account-security-auth.ts";
import { getRowCatClient } from "../../lib/api.ts";
import { PasswordDialog } from "./password-dialog.tsx";
import {
	PASSWORD_ABSENT_NOTE,
	PASSWORD_ACTION_LABEL,
	PASSWORD_CHANGE_FAILED,
	PASSWORD_PRESENT_NOTE,
	PASSWORD_RESULT_NOTE,
} from "./security-copy.ts";
import {
	authSecurityErrorMessage,
	securityErrorMessage,
} from "./security-error.ts";

/**
 * Password: the operation differs by what the account has.
 *
 * ```text
 * has a password   change   verifies the current one → Better Auth receives it directly
 * no password      set      no current password to verify → a RowCat route calls it on our behalf
 * ```
 *
 * The two take different paths, which is the least visible fact here. Change goes through
 * `lib/account-security-auth.ts` to the auth client, so the current password never passes
 * `@rowcat/contracts` or `@rowcat/sdk`. Only set uses our route, because Better Auth's
 * `setPassword` is **serverOnly** and has no HTTP surface.
 *
 * Two paths mean two failure shapes; the sentences are gathered in `security-error.ts` so the same
 * reason is not worded differently per path.
 *
 * ## Other devices are not signed out
 *
 * The library offers `revokeOtherSessions` but it is not passed (the wiring is in
 * `lib/account-security-auth.ts`). Silently ending other devices reads as something the user did
 * not do; that operation has its own confirmation in the session section below. The cache agrees:
 * `setPasswordMutationOptions` seats only the account-info cell and leaves the session list alone.
 *
 * ## No last-changed time
 *
 * No response carries it (the account row's `updatedAt` also moves on token refresh), and inventing
 * it would claim "this account has not changed its password in 3 months" falsely.
 *
 * ## The result remembers the operation that just finished
 *
 * After the first set, `hasPassword` turns true and `mode` becomes `change` at that moment.
 * Choosing the result sentence from the current `mode` would tell someone who just **set** a
 * password that it was "changed". So the state holds one operation kind, and no password character
 * ever enters this component's state (`submit` takes the value but it goes only into the request).
 */
export function PasswordSection({ account }: { account: AccountDetails }) {
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
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
		/** A new attempt drops the last result; a prior success beside a failed attempt says two contradictory things. */
		setResult(null);
		setPending(true);
		void (async () => {
			try {
				if (mode === "set") {
					await setPassword.mutateAsync({ newPassword: values.newPassword });
				} else {
					const failure = await changeAccountPassword({
						currentPassword: values.currentPassword,
						newPassword: values.newPassword,
					});
					if (failure) {
						setError(authSecurityErrorMessage(failure, PASSWORD_CHANGE_FAILED));
						return;
					}
				}
				/**
				 * Fix the result before closing. The current `mode` is the last moment that knows what this
				 * operation was; once account info arrives it already says something else.
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
		<View style={password.stack}>
			<Text variant="label" tone="muted-foreground">
				{account.hasPassword ? PASSWORD_PRESENT_NOTE : PASSWORD_ABSENT_NOTE}
			</Text>

			<View style={password.actions}>
				<Button
					label={PASSWORD_ACTION_LABEL[mode]}
					variant="outline"
					size="sm"
					onPress={() => {
						setError(null);
						/** On reopening, the previous result is a stale fact. */
						setResult(null);
						setOpen(true);
					}}
				/>
			</View>

			{/**
			 * Success is said outside the dialog. The dialog closes on success and the place to say what
			 * happened goes with it; what remains is the same button as before pressing, so success and cancel
			 * look alike. The dialog is not held open either: unmounting is how plaintext leaves the fields, and
			 * stretching that time for staging sells the most expensive thing this screen protects.
			 *
			 * No timer clears the sentence: it goes away only when the user starts this operation again, and the
			 * fact stays true until then.
			 */}
			{result ? (
				<Text variant="label" tone="muted-foreground">
					{PASSWORD_RESULT_NOTE[result]}
				</Text>
			) : null}

			{open ? (
				<PasswordDialog
					mode={mode}
					open
					pending={pending}
					error={error}
					onClose={close}
					onSubmit={submit}
				/>
			) : null}
		</View>
	);
}

const password = StyleSheet.create({
	stack: { gap: space.sm },
	actions: { flexDirection: "row" },
});
