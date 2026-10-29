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
import { Trans, useTranslation } from "react-i18next";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import {
	checkPasskeyLabel,
	passkeyDisplayName,
	passkeyLabelMessage,
} from "./passkey-label.ts";

/**
 * Passkey dialogs: register, rename and remove.
 *
 * They share one file because all three act on the same value (the label), and the validation rule
 * for it is single. Splitting the file would import that rule three times, and one copy would
 * eventually start its own conditions.
 *
 * **`window.confirm()` is not used.** It has no place to state the outcome ("Are you sure you want
 * to delete?"). Deletion is irreversible, so the dialog has to say what disappears.
 */

/**
 * Name dialog: register and rename share **one implementation**.
 *
 * Only the title, description, button labels and initial value differ. Two copies would let the
 * validation and the `autoComplete` semantics drift apart (the login and sign-up forms already made
 * the same call).
 */
function PasskeyNameDialog({
	title,
	description,
	confirmLabel,
	pendingLabel,
	initialName,
	pending,
	error,
	onClose,
	onSubmit,
}: {
	title: string;
	description: string;
	confirmLabel: string;
	pendingLabel: string;
	initialName: string;
	pending: boolean;
	error: string | null;
	onClose: () => void;
	onSubmit: (name: string) => void;
}) {
	const { t } = useTranslation(["account", "common"]);
	const fieldId = useId();
	const [value, setValue] = useState(initialName);
	const [localError, setLocalError] = useState<string | null>(null);
	const shown = localError ?? error;
	const errorId = `${fieldId}-error`;
	const hintId = `${fieldId}-hint`;

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
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>

				<form
					noValidate
					className="flex flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						const check = checkPasskeyLabel(value);
						if (!check.ok) {
							setLocalError(passkeyLabelMessage(check.reason));
							return;
						}
						setLocalError(null);
						onSubmit(check.name);
					}}
				>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={fieldId}>{t("passkeyDialogs.name")}</Label>
						<Input
							id={fieldId}
							name="passkeyName"
							type="text"
							/*
							 * Not a value for the password manager to fill. Writing `username` or `new-password` here
							 * would make it suggest the wrong entry.
							 */
							autoComplete="off"
							disabled={pending}
							aria-invalid={shown !== null}
							/*
							 * The failure if there is one, otherwise the description. The hint below states that **no
							 * name is invented for the user**, and it is the only place that answers what to type in an
							 * empty field. Without the link, a screen reader would not announce it when focus lands
							 * here.
							 */
							aria-describedby={shown ? errorId : hintId}
							value={value}
							onChange={(event) => {
								setValue(event.target.value);
								setLocalError(null);
							}}
						/>
						<p id={hintId} className="text-xs text-muted-foreground">
							{/*
							 * Say here that no name is generated, so an empty field does not read as
							 * "why isn't this filled in automatically?"
							 */}
							{t("passkeyDialogs.giveItANameYou")}
						</p>
					</div>

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
							{t("passkeyDialogs.cancel")}
						</Button>
						<Button type="submit" disabled={pending}>
							{pending ? pendingLabel : confirmLabel}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Register: the name is asked first, then the browser ceremony starts.
 *
 * The label has to travel with the registration request. If the ceremony came first and the name
 * after, the user would see a second dialog after the fingerprint, and closing it in between would
 * leave a passkey with no name.
 */
export function RegisterPasskeyDialog(props: {
	pending: boolean;
	error: string | null;
	onClose: () => void;
	onSubmit: (name: string) => void;
}) {
	const { t } = useTranslation(["account", "common"]);
	return (
		<PasskeyNameDialog
			title={t("passkeyDialogs.addAPasskey")}
			description={t("passkeyDialogs.afterNamingItConfirmWith")}
			confirmLabel={t("passkeyDialogs.continue")}
			pendingLabel={t("passkeyDialogs.checkingTheDevice")}
			initialName=""
			{...props}
		/>
	);
}

/** Rename: only the display label changes. The credential stays the same. */
export function RenamePasskeyDialog({
	currentName,
	...props
}: {
	currentName: string | null;
	pending: boolean;
	error: string | null;
	onClose: () => void;
	onSubmit: (name: string) => void;
}) {
	const { t } = useTranslation(["account", "common"]);
	return (
		<PasskeyNameDialog
			title={t("passkeyDialogs.renamePasskey")}
			description={t("passkeyDialogs.signingInWithThisPasskey")}
			confirmLabel={t("passkeyDialogs.save")}
			pendingLabel={t("passkeyDialogs.saving")}
			/*
			 * Do not pre-fill `Passkey` for a passkey that has no label; the user would have to delete it before
			 * typing. An empty field is the honest state.
			 */
			initialName={currentName ?? ""}
			{...props}
		/>
	);
}

/**
 * Delete confirmation: states **what disappears**.
 *
 * It says four things: what (the name), where (this account), the result (that device can no longer
 * sign in), and what remains (the other sign-in methods). Without the last line the dialog does not
 * answer whether the account is lost, and a user who cannot tell will not press.
 */
export function RemovePasskeyDialog({
	name,
	pending,
	error,
	onClose,
	onConfirm,
}: {
	name: string | null;
	pending: boolean;
	error: string | null;
	onClose: () => void;
	onConfirm: () => void;
}) {
	const { t } = useTranslation(["account", "common"]);
	const errorId = useId();
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
					<DialogTitle>{t("passkeyDialogs.deleteThisPasskey")}</DialogTitle>
					<DialogDescription>
						{t("passkeyDialogs.thisCanTBeUndone")}
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-3 text-sm">
					<p>
						<Trans
							t={t}
							i18nKey="passkeyDialogs.noLongerSignIn"
							values={{ name: passkeyDisplayName(name) }}
							components={{ name: <strong className="font-medium" /> }}
						/>
					</p>
					<p className="text-muted-foreground">
						{/*
						 * Say what remains. A passkey is not a value in the sign-in method list, so
						 * deleting it leaves the password and social connections as they are. Without
						 * saying so, the user reads the action as one that loses the account.
						 *
						 * The provider names are not written here, because this sentence would go
						 * stale silently whenever a method is added.
						 */}
						{t("passkeyDialogs.otherSignInMethodsSuch")}
					</p>

					{error && (
						<p id={errorId} role="alert" className="text-destructive">
							{error}
						</p>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={pending}>
						{t("passkeyDialogs.cancel")}
					</Button>
					<Button variant="destructive" onClick={onConfirm} disabled={pending}>
						{pending
							? t("passkeyDialogs.deleting")
							: t("passkeyDialogs.deletePasskey")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
