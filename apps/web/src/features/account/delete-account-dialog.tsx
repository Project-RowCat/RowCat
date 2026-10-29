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

/**
 * Account deletion confirmation — **says what disappears and what might remain, first.**
 *
 * Two lists side by side is all this dialog does. A dialog that only asks "are you sure you want to
 * delete?" assumes the user already knows, which is wrong in this product: that conversations and
 * drafts live on the device rather than the server, and that publicly published works may remain,
 * are first read here.
 *
 * **No technical terms.** DEK, key ring, IndexedDB and sync_record are all implementation
 * vocabulary. What the user must judge is "what happens to my conversations", and the answer is
 * "conversations and drafts stored on this device are deleted".
 *
 * **Does not make the user type a confirmation phrase.** Having users transcribe `DELETE MY
 * ACCOUNT` verifies no identity: someone looking over the shoulder, or someone sitting down while
 * the user is away, can transcribe it just the same. Safety here comes from the password (or recent
 * login), which the authentication layer verifies for real.
 */

export interface DeleteAccountDialogProps {
	/**
	 * Whether the account has a credential method — **decides whether to draw the password field.**
	 *
	 * The point is not drawing an empty password field on social-only accounts. That field cannot be
	 * filled (the account has no password), and its mere presence makes the user think they forgot
	 * something. For those accounts identity is confirmed by recent sign-in instead.
	 */
	hasPassword: boolean;
	pending: boolean;
	error: string | null;
	onClose: () => void;
	onConfirm: (password?: string) => void;
}

export function DeleteAccountDialog({
	hasPassword,
	pending,
	error,
	onClose,
	onConfirm,
}: DeleteAccountDialogProps) {
	const { t } = useTranslation(["account", "common"]);
	const [password, setPassword] = useState("");
	const passwordId = useId();
	const errorId = useId();

	/**
	 * Blocks a second click in the same tick. The hook has the same guard (it is the final authority),
	 * but this one also keeps the second click from creating a second **request** at all: for an
	 * irreversible action it is better that a duplicate ends before it reaches the server.
	 */
	const submitting = useRef(false);

	const submit = (): void => {
		if (submitting.current || pending) return;
		if (hasPassword && !password) return;
		submitting.current = true;
		onConfirm(hasPassword ? password : undefined);
		/*
		 * The password is not kept in screen state. On failure the user types it again; retyping before a
		 * second irreversible action is no cost.
		 */
		setPassword("");
		submitting.current = false;
	};

	return (
		<Dialog
			open
			/**
			 * Never closes for any reason while in progress (`shouldCloseDialog`). If the dialog disappeared
			 * while an irreversible request runs, the user would lose the place to see the result, and in
			 * this dialog the result is whether the account is gone.
			 */
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
						{t("deleteAccountDialog.deleteYourAccount")}
					</DialogTitle>
					<DialogDescription>
						{t("deleteAccountDialog.thisCanTBeUndone")}
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4 text-sm">
					<section className="flex flex-col gap-1.5">
						<h3 className="font-medium">
							{t("deleteAccountDialog.whatGetsDeleted")}
						</h3>
						<ul className="list-disc space-y-1 pl-5 text-muted-foreground">
							<li>{t("deleteAccountDialog.yourAccountAndSignIn")}</li>
							<li>{t("deleteAccountDialog.conversationsAndDraftsSavedOn")}</li>
							<li>{t("deleteAccountDialog.dataKeptForSyncBetween")}</li>
							<li>{t("deleteAccountDialog.favoritesFollowsAndBlocks")}</li>
						</ul>
					</section>

					<section className="flex flex-col gap-1.5">
						<h3 className="font-medium">
							{t("deleteAccountDialog.whatMayRemain")}
						</h3>
						<ul className="list-disc space-y-1 pl-5 text-muted-foreground">
							{/*
							 * "Can remain", not "remains". Even with public publishing open, this line stays as it
							 * is: what remains is only works **published publicly**, and private or archived works
							 * are deleted together. Stating it as fact would make someone who published nothing
							 * publicly believe their work remains somewhere.
							 */}
							<li>
								{t("deleteAccountDialog.publiclyPublishedStoriesTheyMay")}
							</li>
							<li>
								{t("deleteAccountDialog.conversationsAndDraftsAlreadySaved")}
							</li>
						</ul>
					</section>

					{hasPassword && (
						<div className="flex flex-col gap-1.5">
							<Label htmlFor={passwordId}>
								{t("deleteAccountDialog.currentPassword")}
							</Label>
							<Input
								id={passwordId}
								type="password"
								// Browsers and password managers need to know which value to fill in.
								autoComplete="current-password"
								value={password}
								onChange={(event) => setPassword(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										submit();
									}
								}}
								aria-invalid={error !== null}
								aria-describedby={error ? errorId : undefined}
								disabled={pending}
							/>
						</div>
					)}

					{!hasPassword && (
						<p className="text-muted-foreground">
							{/*
							 * State up front whether it works now (or why it does not). Reading "recent sign-in is
							 * required" only after a failure makes the user think it is the result of something
							 * they did wrong.
							 */}
							{t("deleteAccountDialog.forSecurityDeletionOnlyWorks")}
						</p>
					)}

					{error && (
						<p id={errorId} role="alert" className="text-destructive">
							{error}
						</p>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={pending}>
						{t("deleteAccountDialog.cancel")}
					</Button>
					<Button
						variant="destructive"
						onClick={submit}
						// Password required but empty means there is nothing to press; no reason to go get a 400.
						disabled={pending || (hasPassword && !password)}
					>
						{pending
							? t("deleteAccountDialog.deletingAccount")
							: t("deleteAccountDialog.deleteAccount")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
