import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Input } from "@rowcat/ui-web/components/input";
import { Label } from "@rowcat/ui-web/components/label";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import {
	checkPasswordForm,
	type PasswordFormMode,
	passwordFormMessage,
} from "./password-form.ts";

/**
 * Change or set password dialog: **one component with two modes.**
 *
 * Two separate dialogs are not used, because only **one field** differs (the current password).
 * Everything else (autocomplete attributes, the confirmation field, the submit guard, clearing the
 * fields after success, not closing while pending) is the same, and two copies would let one of
 * them drift. The most dangerous item is the last one: a copy could start keeping the password in
 * screen state after success.
 *
 * **The modes do differ for real.** Drawing a "current password" field in set mode would ask for a
 * value that account does not have, and the user would think they had forgotten something. So that
 * field is not hidden; it is **not rendered**. A hidden field would still be filled in by the
 * password manager.
 *
 * ## Autocomplete is not disabled
 *
 * `autoComplete="current-password"` and `"new-password"` are written exactly. Disrupting the
 * password manager with random field names creates no security, and it pushes users toward shorter,
 * easier-to-remember passwords.
 *
 * ## Values are not normalized
 *
 * The value `onChange` receives goes into state as-is. A single `.trim()` would create a password
 * different from the one the user typed, and that account could not sign in with the password it
 * knows.
 */

export interface PasswordDialogProps {
	mode: PasswordFormMode;
	pending: boolean;
	/** Failure returned by the server or the auth layer. Its place differs from form-level problems (length, mismatch). */
	error: string | null;
	onClose: () => void;
	onSubmit: (values: { currentPassword: string; newPassword: string }) => void;
}

export function PasswordDialog({
	mode,
	pending,
	error,
	onClose,
	onSubmit,
}: PasswordDialogProps) {
	const { t } = useTranslation(["account", "common"]);
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	/**
	 * Form-level problems are shown **only after submit is pressed**. If "too short" followed the user
	 * while they typed, the form would read as scolding them; they are still typing toward eight
	 * characters.
	 */
	const [showIssue, setShowIssue] = useState(false);

	const currentId = useId();
	const newId = useId();
	const confirmId = useId();
	const errorId = useId();

	/**
	 * Guard against a second click in the same tick. `pending` (state) waits for a commit, so the
	 * second event of a fast double-click still reads the old value. The same request would go out
	 * twice, and for a change the second submit would use the already-changed password as the current
	 * one, ending in a **false** "current password is incorrect" error.
	 */
	const submitting = useRef(false);

	const issue = checkPasswordForm(mode, {
		currentPassword,
		newPassword,
		confirmPassword,
	});
	const issueMessage = showIssue && issue ? passwordFormMessage(issue) : null;

	const submit = (): void => {
		setShowIssue(true);
		if (submitting.current || pending || issue) return;
		submitting.current = true;
		onSubmit({ currentPassword, newPassword });
		submitting.current = false;
	};

	const title =
		mode === "change"
			? t("passwordDialog.changePassword")
			: t("passwordDialog.setPassword");

	return (
		<Dialog
			open
			onOpenChange={(next, details) => {
				if (!next && shouldCloseDialog(details.reason, pending)) onClose();
			}}
		>
			<DialogContent
				closeButtonDisabled={pending}
				className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-md`}
			>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>
						{mode === "change"
							? t("passwordDialog.otherDevicesStaySignedIn")
							: t("passwordDialog.settingAPasswordAlsoLets")}
					</DialogDescription>
				</DialogHeader>

				{/*
				 * **A real `<form>`.** This dialog once received Enter on each field through `onKeyDown` to
				 * imitate submission. That structure loses two things: the standard signal browsers and
				 * password managers use to recognize a "change password" form (the autocomplete attributes
				 * take their meaning inside a form), and the need to rewrite that handler every time a field
				 * is added. The email-change dialog in the same folder already has this shape.
				 *
				 * `noValidate` is used so that our own copy appears instead of the browser's default bubble.
				 * That bubble's text and how it is read aloud are not ours to control.
				 */}
				<form
					noValidate
					className="flex flex-col gap-4 text-sm"
					onSubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					{/*
					 * In set mode this field **does not exist** (it is not hidden). That account has no
					 * current password.
					 */}
					{mode === "change" && (
						<div className="flex flex-col gap-1.5">
							<Label htmlFor={currentId}>
								{t("passwordDialog.currentPassword")}
							</Label>
							<Input
								id={currentId}
								type="password"
								autoComplete="current-password"
								value={currentPassword}
								onChange={(event) => setCurrentPassword(event.target.value)}
								disabled={pending}
							/>
						</div>
					)}

					<div className="flex flex-col gap-1.5">
						<Label htmlFor={newId}>{t("passwordDialog.newPassword")}</Label>
						<Input
							id={newId}
							type="password"
							autoComplete="new-password"
							value={newPassword}
							onChange={(event) => setNewPassword(event.target.value)}
							aria-invalid={issueMessage !== null}
							aria-describedby={issueMessage ? errorId : undefined}
							disabled={pending}
						/>
					</div>

					<div className="flex flex-col gap-1.5">
						<Label htmlFor={confirmId}>
							{t("passwordDialog.confirmNewPassword")}
						</Label>
						<Input
							id={confirmId}
							type="password"
							autoComplete="new-password"
							value={confirmPassword}
							onChange={(event) => setConfirmPassword(event.target.value)}
							aria-invalid={issueMessage !== null}
							aria-describedby={issueMessage ? errorId : undefined}
							disabled={pending}
						/>
					</div>

					{/*
					 * Form problems and server failures stand in the **same place**. Drawing them elsewhere
					 * would sometimes show two errors at once (submit with a short password, get a server
					 * failure, then shorten it again), and the user would not know which one to fix. The
					 * form problem takes precedence because it describes the value on screen now, while the
					 * server failure describes the previous submission.
					 */}
					{(issueMessage ?? error) && (
						<p id={errorId} role="alert" className="text-destructive">
							{issueMessage ?? error}
						</p>
					)}
					<DialogFooter>
						{/* Non-submit buttons state their type **explicitly**; inside a form the default is submit. */}
						<Button
							type="button"
							variant="outline"
							onClick={onClose}
							disabled={pending}
						>
							{t("passwordDialog.cancel")}
						</Button>
						{/*
						 * The button is **not disabled** when the form is incomplete. A disabled button does not
						 * say why it cannot be pressed, so someone who mistyped the confirmation would think the
						 * screen is broken. Pressing it makes the reason appear as a sentence.
						 */}
						<Button type="submit" disabled={pending}>
							{pending ? t("passwordDialog.saving") : title}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
