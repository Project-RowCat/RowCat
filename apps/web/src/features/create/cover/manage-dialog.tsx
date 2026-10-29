import { STORY_COVER_ACCEPT } from "@rowcat/contracts";
import { type CreatorWork, isOwnWorkViewable } from "@rowcat/domain";
import {
	removeStoryCoverMutationOptions,
	setStoryCoverMutationOptions,
} from "@rowcat/query";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Label } from "@rowcat/ui-web/components/label";
import { Spinner } from "@rowcat/ui-web/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useEffect, useId, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import {
	checkCoverFile,
	coverErrorMessage,
	coverInputHint,
	coverIssueMessage,
} from "./file.ts";
import { CoverPreview } from "./preview.tsx";

/**
 * Cover management: upload, replace, and delete happen in one dialog, since the user's task is one
 * thing: decide this work's picture. Upload and replace are the same PUT request on the server, and
 * delete reverts the upload in place, so it stays in the same context as what it deletes.
 *
 * A selected file is not the work's cover. The object URL from URL.createObjectURL points at this
 * tab's memory, while the cover is the server-normalized image with a content hash in its URL. So
 * the temporary URL is not put in the TanStack Query cache, not set on the work object, and is
 * discarded after success.
 *
 * A failure does not touch the current cover. The screen draws only from work.coverUrl, and no
 * value is derived from mutation failure state. The server also normalizes before writing to the
 * database, so a failed replace never removes the cover.
 */
export function CoverManageDialog({
	work,
	onClose,
}: {
	work: CreatorWork;
	onClose: () => void;
}) {
	const { t } = useTranslation(["create", "common"]);
	const inputId = useId();
	const stateId = `${inputId}-state`;
	const issueId = `${inputId}-issue`;
	const queryClient = useQueryClient();
	const client = getRowCatClient();

	const upload = useMutation(
		setStoryCoverMutationOptions(client, queryClient, work.id),
	);
	const removal = useMutation(
		removeStoryCoverMutationOptions(client, queryClient, work.id),
	);

	/**
	 * The selected file and its preview URL are one value. Keeping them separate would allow a state
	 * where only the file changes and the URL stays stale. The screen would then show a different
	 * picture from the one just chosen and upload the other file.
	 */
	const [selected, setSelected] = useState<{ file: File; url: string } | null>(
		null,
	);
	/**
	 * Holds a pre-send issue (format, size, empty file). It does not share a slot with server
	 * failures.
	 */
	const [issue, setIssue] = useState<string | null>(null);
	const [confirmingRemove, setConfirmingRemove] = useState(false);

	const fileInputRef = useRef<HTMLInputElement>(null);
	/** One press is one request. A second click in the same tick cannot see isPending yet. */
	const uploadingRef = useRef(false);
	const removingRef = useRef(false);
	/**
	 * The live preview URL. It is kept in a ref, outside state, for unmount cleanup. The cleanup
	 * closure captures the last render's state, which can differ from the value at the moment the
	 * dialog closes. A ref always holds the current value, so the URL is revoked without leaking.
	 */
	const objectUrlRef = useRef<string | null>(null);

	const pending = upload.isPending || removal.isPending;

	const replaceSelection = (next: { file: File; url: string } | null): void => {
		if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
		objectUrlRef.current = next?.url ?? null;
		setSelected(next);
	};

	/**
	 * After success or rejection, the file input is also cleared so the same file can be picked again.
	 */
	const clearSelection = (): void => {
		replaceSelection(null);
		if (fileInputRef.current) fileInputRef.current.value = "";
	};

	/**
	 * Last cleanup when the dialog unmounts. The empty dependency array is intentional. This effect
	 * only does unmount cleanup; revocation on swap is already done by replaceSelection. Adding
	 * `selected` as a dependency would run the cleanup on every pick and revoke the URL that was just
	 * created.
	 */
	useEffect(
		() => () => {
			if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
			objectUrlRef.current = null;
		},
		[],
	);

	const onPick = (event: ChangeEvent<HTMLInputElement>): void => {
		const file = event.target.files?.[0];
		// Cancelling the picker yields an empty list, which is not an undo request.
		if (!file) return;

		const found = checkCoverFile(file);
		if (found) {
			/**
			 * A rejected file gets no preview URL. Creating one would put an unuploadable picture in the
			 * preview, and the user would read the cover as already changed.
			 */
			setIssue(coverIssueMessage(found));
			clearSelection();
			return;
		}

		setIssue(null);
		replaceSelection({ file, url: URL.createObjectURL(file) });
	};

	const startUpload = (): void => {
		if (uploadingRef.current || !selected) return;
		uploadingRef.current = true;
		// There is one failure slot, so earlier failures are cleared first. Two messages on screen at
		// once would make it unclear which one belongs to the current action.
		removal.reset();
		setIssue(null);
		upload.mutate(selected.file, {
			/**
			 * On success the preview URL is discarded. By then the cache has been patched with the server's
			 * confirmed coverUrl and the parent re-renders. Keeping both would leave the screen unsure which
			 * one to draw.
			 */
			onSuccess: () => {
				clearSelection();
			},
			onSettled: () => {
				uploadingRef.current = false;
			},
		});
	};

	const startRemove = (): void => {
		if (removingRef.current) return;
		removingRef.current = true;
		upload.reset();
		setIssue(null);
		removal.mutate(undefined, {
			onSuccess: () => {
				clearSelection();
				setConfirmingRemove(false);
			},
			onSettled: () => {
				removingRef.current = false;
			},
		});
	};

	/**
	 * The dialog does not close automatically. The cover is judged from the result (cropping, colors),
	 * and closing on success would leave only the small list thumbnail to check. Closing is the user's
	 * decision.
	 */
	const failure = upload.error ?? removal.error;

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
				{/*
				 * `min-w-0` lets the child shrink below its min-content width inside the grid. The work title
				 * appears
				 * in the description below, and it is user-entered, so long unbroken strings do occur.
				 */}
				<DialogHeader className="min-w-0">
					<DialogTitle>{t("manageDialog.manageCover")}</DialogTitle>
					<DialogDescription className="break-words">
						<Trans
							t={t}
							i18nKey="manageDialog.description"
							values={{ title: work.title, hint: coverInputHint() }}
							components={{
								title: <span className="font-medium text-foreground" />,
							}}
						/>
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-3">
					<div className="flex items-start gap-3">
						{/*
						 * Same 3:4 ratio as the gallery cards. A different ratio here would crop differently from the card,
						 * so the picture confirmed and uploaded would be cropped differently in the list.
						 */}
						<div className="relative aspect-3/4 w-24 shrink-0 overflow-hidden rounded-md border bg-muted">
							{/*
							 * The preview shows the selected file if there is one, otherwise the current cover. If neither
							 * exists,
							 * or the cover failed to load, a placeholder is drawn. The last branch actually happens on this
							 * screen:
							 * the owner also gets a 404 for the cover URL of a hidden or archived work (see cover-preview.tsx).
							 */}
							<CoverPreview
								src={selected?.url ?? work.coverUrl}
								iconClassName="size-6"
							/>

							{/*
							 * The picture must say that the cover is not uploaded yet. Without this badge the screen looks the
							 * same before and after picking, and the user closes the dialog believing the change was made.
							 */}
							{selected && (
								<Badge className="absolute inset-x-1 bottom-1 justify-center">
									{t("manageDialog.selectedImage")}
								</Badge>
							)}
						</div>

						<div className="flex min-w-0 flex-1 flex-col gap-2">
							<Label htmlFor={inputId}>{t("manageDialog.coverImage")}</Label>
							{/*
							 * Uses the visible file input directly. Making the picture the only click target would leave
							 * keyboard
							 * and screen reader users no way to reach the action. Hiding the input and having a button click it
							 * would require re-linking the name and state by hand. `ui-web`'s `Input` is not used because it is
							 * a
							 * value primitive, and a file input's value can only be set to an empty string by script, so
							 * binding
							 * it would eventually diverge.
							 */}
							<input
								ref={fileInputRef}
								id={inputId}
								type="file"
								/** Only the picker's default filter, not validation. The server decides. */
								accept={STORY_COVER_ACCEPT}
								disabled={pending}
								/*
								 * The control is bound to the status line below and to the reason a selected file was
								 * rejected, so both are read together when focus lands on it. Placing them beside the
								 * control is not enough. Only a rejection sets aria-invalid, since a rejection is the only
								 * verdict on the chosen value.
								 */
								aria-invalid={issue !== null || undefined}
								aria-describedby={issue ? `${issueId} ${stateId}` : stateId}
								onChange={onPick}
								className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs outline-none file:mr-2 file:inline-flex file:h-6 file:cursor-pointer file:rounded-sm file:border-0 file:bg-secondary file:px-2 file:text-xs file:font-medium file:text-secondary-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
							/>
							{/*
							 * Says that a work cannot be viewed. For hidden or archived works the cover URL returns 404 even to
							 * the owner (reads use the same predicate as the detail page), so the preview above folds to the
							 * placeholder. Writing only 'this is the cover currently set' would contradict the screen. The
							 * cover
							 * is still there and can still be replaced, so both facts are stated together.
							 */}
							<p id={stateId} className="text-xs text-muted-foreground">
								{selected
									? t("manageDialog.notUploadedYetTheCover")
									: work.coverUrl && !isOwnWorkViewable(work)
										? t("manageDialog.theCoverIsStillThere")
										: work.coverUrl
											? t("manageDialog.thisIsTheStoryS")
											: t("manageDialog.noCoverYet")}
							</p>
						</div>
					</div>

					{issue && (
						<p id={issueId} role="alert" className="text-sm text-destructive">
							{issue}
						</p>
					)}

					{/*
					 * Deletion completes inside this dialog in two steps. Stacking a second dialog would cover the
					 * preview that shows what is being deleted, move focus between windows, and place the irreversible
					 * button at the front while focus moves. The delete control is rendered only when work.coverUrl
					 * exists. A delete button with no cover would promise an action that does nothing. The server is
					 * idempotent, but the screen would still be misleading.
					 */}
					{work.coverUrl !== null && (
						<div className="border-t pt-3">
							{confirmingRemove ? (
								<div className="flex flex-col gap-2">
									<p role="alert" className="text-sm text-muted-foreground">
										{t("manageDialog.deleteTheCoverTheStory")}
									</p>
									<div className="flex flex-wrap items-center gap-2">
										<Button
											size="sm"
											variant="destructive"
											disabled={pending}
											onClick={startRemove}
										>
											{removal.isPending ? <Spinner /> : null}
											{removal.isPending
												? t("manageDialog.deleting")
												: t("common:actions.delete")}
										</Button>
										<Button
											size="sm"
											variant="ghost"
											disabled={pending}
											onClick={() => setConfirmingRemove(false)}
										>
											{t("common:actions.cancel")}
										</Button>
									</div>
								</div>
							) : (
								<Button
									size="sm"
									variant="ghost"
									disabled={pending}
									onClick={() => setConfirmingRemove(true)}
								>
									{t("manageDialog.deleteCover")}
								</Button>
							)}
						</div>
					)}

					{failure && (
						<p role="alert" className="text-sm text-destructive">
							{coverErrorMessage(failure)}
						</p>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={pending}>
						{t("common:actions.close")}
					</Button>
					<Button disabled={pending || !selected} onClick={startUpload}>
						{upload.isPending ? <Spinner /> : null}
						{upload.isPending
							? t("manageDialog.uploading")
							: work.coverUrl === null
								? t("manageDialog.uploadCover")
								: t("manageDialog.replaceCover")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
