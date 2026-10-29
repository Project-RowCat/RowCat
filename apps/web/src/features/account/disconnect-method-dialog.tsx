import type { LoginMethod, LoginMethodProvider } from "@rowcat/domain";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { useId } from "react";
import { Trans, useTranslation } from "react-i18next";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { loginMethodLabel } from "./login-method-label.ts";

/**
 * Confirming removal of a sign-in method — **says what remains, using server state.**
 *
 * We do not build a dialog that ends with "are you sure you want to disconnect?". That sentence
 * gives no information and gets pressed without reading. What the user actually has to judge here
 * is one thing: **can I still get in after removing it?**
 *
 * The rule of this dialog is **not to invent that answer**. The list of remaining methods is
 * computed by a pure function from the account info the server returned
 * (`canDisconnectLoginMethod`), and the screen does not write "you can still sign in with email"
 * itself. Writing that would make the sentence false for an account without a credential method,
 * and whoever believed it would lose the account.
 *
 * The reason `window.confirm()` is not used is the same: that dialog has no place to hold this
 * sentence.
 */

export interface DisconnectMethodDialogProps {
	target: LoginMethodProvider;
	/** Methods that remain after removal, **a value computed from the server's account state**. */
	remaining: LoginMethod[];
	pending: boolean;
	error: string | null;
	onClose: () => void;
	onConfirm: () => void;
}

export function DisconnectMethodDialog({
	target,
	remaining,
	pending,
	error,
	onClose,
	onConfirm,
}: DisconnectMethodDialogProps) {
	const { t } = useTranslation(["account", "common"]);
	const errorId = useId();
	const label = loginMethodLabel(target);

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
					<DialogTitle>
						{t("disconnectMethodDialog.title", { label })}
					</DialogTitle>
					<DialogDescription>
						{/*
						 * State the result first: what this action makes it **impossible** to do.
						 */}
						{t("disconnectMethodDialog.noLonger", { label })}
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-3 text-sm">
					<p>
						<Trans
							t={t}
							i18nKey={
								remaining.length === 1
									? "disconnectMethodDialog.remainingOnly"
									: "disconnectMethodDialog.remaining"
							}
							values={{
								methods: remaining
									.map((method) => loginMethodLabel(method.provider))
									.join(" · "),
							}}
							components={{ strong: <strong className="font-medium" /> }}
						/>
					</p>
					{/*
					 * State that it can be reversed. Unlike account deletion, this action is undone by linking
					 * again, and users who do not know that will not do the cleanup they need.
					 */}
					<p className="text-muted-foreground">
						{t("disconnectMethodDialog.youCanLinkItAgain")}
					</p>

					{error && (
						<p id={errorId} role="alert" className="text-destructive">
							{error}
						</p>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={pending}>
						{t("disconnectMethodDialog.cancel")}
					</Button>
					{/*
					 * State the destructiveness **in words** ("disconnect"). Signaling by color alone would make it
					 * look like an ordinary confirm button to someone who cannot distinguish colors.
					 */}
					<Button variant="destructive" onClick={onConfirm} disabled={pending}>
						{pending
							? t("disconnectMethodDialog.disconnecting")
							: t("disconnectMethodDialog.disconnect")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
