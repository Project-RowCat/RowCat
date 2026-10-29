import type { StoryDraft } from "@rowcat/authoring";
import { STORY_COVER_ACCEPT } from "@rowcat/contracts";
import { setStoryCoverMutationOptions } from "@rowcat/query";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Button } from "@rowcat/ui-web/components/button";
import { Label } from "@rowcat/ui-web/components/label";
import { Spinner } from "@rowcat/ui-web/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { type ChangeEvent, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { useDraftCoverScope } from "#/lib/local-authoring/draft-cover-hooks.ts";
import { feedbackEnter, feedbackExit } from "#/lib/motion/feedback.ts";
import {
	checkCoverFile,
	coverErrorMessage,
	coverInputHint,
	coverIssueMessage,
} from "./file.ts";
import { CoverPreview } from "./preview.tsx";
import { useDraftCoverUrl } from "./use-url.ts";

/**
 * - The cover slot in the editor can be set before publishing.
 * - A draft has no story row yet, so there is no address to upload to. Before publish, the chosen
 *   file stays on this device and uploads together with publishing.
 * - After publish, the file uploads immediately and is not kept on the device.
 * - Both cases look like one action to the user. They differ only in the on-screen wording.
 * - Device-held covers do not sync. They live in a table the sync protocol does not know about
 *   (lib/local-authoring/draft-cover.ts). This is deliberate, since multi-megabyte images are not
 *   carried in the sync envelope. The screen must say so, or creators read a missing cover on
 *   another device as a loss.
 * - The file is not resized on the client. The server boundary (apps/api/src/lib/cover-image.ts)
 *   is the only normalization point, so the preview before publish matches the result after it.
 */
export function DraftCoverField({ draft }: { draft: StoryDraft }) {
	const { t } = useTranslation(["create", "common"]);
	const inputId = useId();
	const hintId = `${inputId}-hint`;
	const errorId = `${inputId}-error`;
	const client = getRowCatClient();
	const queryClient = useQueryClient();
	const { store } = useDraftCoverScope();
	const published = draft.publishedStoryId;

	/**
	 * What counts as the current cover is answered by the same hook as the preview card
	 * (use-draft-cover-url.ts). Separate checks would let this field draw the staged file while the
	 * preview below draws the server's old cover, leaving the creator no way to tell which is true.
	 */
	const cover = useDraftCoverUrl(draft);

	const upload = useMutation(
		setStoryCoverMutationOptions(client, queryClient, published ?? ""),
	);

	const [issue, setIssue] = useState<string | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	/**
	 * Prevents a second selection in the same tick from uploading twice. isPending updates too late to
	 * guard this.
	 */
	const busyRef = useRef(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const pending = upload.isPending;

	const onPick = async (
		event: ChangeEvent<HTMLInputElement>,
	): Promise<void> => {
		const file = event.target.files?.[0];
		// Cancelling the file picker yields an empty list. That does not mean undo the current selection.
		if (!file) return;
		if (busyRef.current || !store) return;

		const found = checkCoverFile(file);
		if (found) {
			/**
			 * A rejected file is neither stored nor previewed. Leaving an unuploadable picture on display
			 * would make the user read the cover as already decided.
			 */
			setIssue(coverIssueMessage(found));
			setFailure(null);
			if (fileInputRef.current) fileInputRef.current.value = "";
			return;
		}

		busyRef.current = true;
		setIssue(null);
		setFailure(null);
		try {
			if (published === null) {
				/**
				 * Unpublished draft: there is no upload address yet, so this device keeps the file until the
				 * draft is published.
				 */
				await store.put(draft.id, file);
			} else {
				/**
				 * Already published: upload right away instead of keeping the file on the device. A local copy
				 * would diverge from the server cover, and the screen would have no basis to choose which one
				 * to draw. If the upload fails nothing is left behind, so the user simply picks again.
				 */
				await upload.mutateAsync(file);
				await store.remove(draft.id);
			}
		} catch (error) {
			setFailure(coverErrorMessage(error));
		} finally {
			busyRef.current = false;
			// The input value must be cleared so the same file can be picked again. Browsers do not fire
			// change for an unchanged value.
			if (fileInputRef.current) fileInputRef.current.value = "";
		}
	};

	const onClear = async (): Promise<void> => {
		if (busyRef.current || !store) return;
		busyRef.current = true;
		setIssue(null);
		setFailure(null);
		try {
			await store.remove(draft.id);
		} catch (error) {
			setFailure(coverErrorMessage(error));
		} finally {
			busyRef.current = false;
		}
	};

	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={inputId}>{t("field.cover")}</Label>
			<div className="flex items-start gap-3">
				{/*
				 * Same 3:4 ratio as the gallery card. A different ratio here would crop differently from the card.
				 * Without `self-start`, flex stretches the box to the row height and breaks the ratio.
				 */}
				<div className="aspect-3/4 w-20 shrink-0 self-start overflow-hidden rounded-md border bg-muted relative">
					<CoverPreview src={cover.url} iconClassName="size-5" />
					{cover.staged && published === null && (
						<Badge className="absolute inset-x-1 bottom-1 justify-center text-[10px]">
							{t("field.pendingPublish")}
						</Badge>
					)}
				</div>

				<div className="flex min-w-0 flex-1 flex-col gap-2">
					<input
						ref={fileInputRef}
						id={inputId}
						type="file"
						/**
						 * Only the picker's default filter, not validation. The server decides from the file bytes.
						 */
						accept={STORY_COVER_ACCEPT}
						disabled={pending || cover.loading || !store}
						/*
						 * Only a rejected file sets aria-invalid. `issue` means the chosen value breaks a rule
						 * (format, size, pixels). `failure` means the upload itself failed and is not a verdict on
						 * the file. Folding both into one flag would mark a valid file as invalid after a single
						 * network drop.
						 */
						aria-invalid={issue !== null || undefined}
						aria-describedby={issue || failure ? errorId : hintId}
						onChange={(event) => {
							void onPick(event);
						}}
						className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs outline-none file:mr-2 file:inline-flex file:h-6 file:cursor-pointer file:rounded-sm file:border-0 file:bg-secondary file:px-2 file:text-xs file:font-medium file:text-secondary-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
					/>

					<p id={hintId} className="text-xs text-muted-foreground">
						{pending
							? t("field.uploadingTheCover")
							: cover.staged
								? /**
									 * States here that the cover is not synced across devices. If unsaid, creators read it as their
									 * cover disappearing on another device.
									 */
									t("field.thisCoverIsUploadedWhen")
								: published !== null
									? t("field.choosingAFileUpdatesThe")
									: t("coverField.stagedHint", { hint: coverInputHint() })}
					</p>

					{cover.staged && (
						<div>
							<Button
								size="sm"
								variant="ghost"
								disabled={pending}
								onClick={() => {
									void onClear();
								}}
							>
								{pending ? <Spinner /> : null}
								{t("field.removeChosenCover")}
							</Button>
						</div>
					)}

					{/*
					 * The rejection reason for a selected file and an upload failure share one slot. This is the last
					 * flow child of the group, so its exit does not delay others. The `key` is the message text, so
					 * picking a different file that yields a different reason alternates the text (see feedback.ts).
					 */}
					<AnimatePresence initial={false} mode="wait">
						{(issue || failure) && (
							<m.p
								key={issue ?? failure}
								id={errorId}
								role="alert"
								initial={feedbackEnter.initial}
								animate={feedbackEnter.animate}
								exit={feedbackExit}
								transition={feedbackEnter.transition}
								className="text-sm text-destructive"
							>
								{issue ?? failure}
							</m.p>
						)}
					</AnimatePresence>
				</div>
			</div>
		</div>
	);
}
