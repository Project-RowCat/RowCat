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
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { changeEmailCheckMessage, checkNewEmail } from "./change-email.ts";

/**
 * Change email — **says what will happen first.**
 *
 * The only value this dialog takes is a new address, and pressing submit sends **one email**. If
 * the dialog did not say so up front, users would close it believing the address had changed, then
 * fail to sign in with the old one next time.
 *
 * ## Does not state which address receives the mail
 *
 * For an account whose current address is verified, the approval request goes to the **current
 * address**; for an unverified account, the ownership check goes straight to the **new address**.
 * The server decides which applies, so the copy uses a sentence that is true in both cases. If the
 * screen repeated the condition, it would go stale here alone the day the library changed its
 * rules.
 *
 * ## Does not ask for a password
 *
 * Identity for this action is the approval mail sent to the current address itself. A password
 * field here would park that value in screen state, and would be a second implementation imitating
 * a check Better Auth does not require.
 */
export function ChangeEmailDialog({
	currentEmail,
	pending,
	error,
	onClose,
	onSubmit,
}: {
	currentEmail: string;
	pending: boolean;
	/** Failure returned by the server. Format errors are judged by this dialog itself (below). */
	error: string | null;
	onClose: () => void;
	onSubmit: (newEmail: string) => void;
}) {
	const { t } = useTranslation(["account", "common"]);
	const fieldId = useId();
	const [value, setValue] = useState("");
	/**
	 * Format errors belong to the dialog, to avoid the round trip to the server. One pure function
	 * makes the decision (`checkNewEmail`); this component does not restate the condition.
	 */
	const [localError, setLocalError] = useState<string | null>(null);
	const errorId = `${fieldId}-error`;
	const shown = localError ?? error;

	const submit = (): void => {
		const check = checkNewEmail(value, currentEmail);
		if (!check.ok) {
			setLocalError(changeEmailCheckMessage(check.reason));
			return;
		}
		setLocalError(null);
		onSubmit(check.email);
	};

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
					<DialogTitle>{t("changeEmailDialog.changeEmailAddress")}</DialogTitle>
					<DialogDescription>
						{t("changeEmailDialog.weLlSendAConfirmation")}
					</DialogDescription>
				</DialogHeader>

				<form
					noValidate
					className="flex flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					{/*
					 * The current address is a **value to read**, not a form field. Drawing it as a disabled
					 * input would look editable, and the thing to change here is the field below.
					 *
					 * It is not a `<label htmlFor>` either: `for` can only point at form controls, so pointing
					 * at a paragraph means the relationship **holds nowhere** (clicking the text does nothing,
					 * and assistive tech builds no pairing). An element that already expresses name-value
					 * pairing exists.
					 */}
					<dl className="flex flex-col gap-1.5">
						<dt className="text-sm leading-none font-medium">
							{t("changeEmailDialog.currentEmail")}
						</dt>
						<dd className="rounded-lg border bg-muted/40 px-3 py-2 text-sm break-all">
							{currentEmail}
						</dd>
					</dl>

					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`${fieldId}-new`}>
							{t("changeEmailDialog.newEmail")}
						</Label>
						<Input
							id={`${fieldId}-new`}
							name="newEmail"
							type="email"
							autoComplete="email"
							// Emails are not proper nouns; mobile keyboards capitalizing the first letter would force
							// users to delete it every time.
							autoCapitalize="none"
							spellCheck={false}
							disabled={pending}
							aria-invalid={shown !== null}
							aria-describedby={shown ? errorId : undefined}
							value={value}
							onChange={(event) => {
								setValue(event.target.value);
								setLocalError(null);
							}}
						/>
					</div>

					<p className="text-sm text-muted-foreground">
						{/*
						 * A sentence true for both cases. It does not state which address receives the mail
						 * (see the header).
						 */}
						{t("changeEmailDialog.forSecurityThisGoesThrough")}
					</p>

					{shown && (
						<p id={errorId} role="alert" className="text-sm text-destructive">
							{shown}
						</p>
					)}

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={onClose}
							disabled={pending}
						>
							{t("changeEmailDialog.cancel")}
						</Button>
						<Button type="submit" disabled={pending}>
							{pending
								? t("changeEmailDialog.sending")
								: t("changeEmailDialog.sendConfirmationEmail")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
