import type { StoryDraft } from "@rowcat/authoring";
import { space } from "@rowcat/design";
import { Button, Notice, Text } from "@rowcat/ui-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { pickImageFromLibrary } from "../../lib/image-picker.ts";
import { useDraftCoverScope } from "../../lib/local-data/scope.tsx";
import { StoryCover } from "../story/story-cover.tsx";
import {
	COVER_INPUT_HINT,
	checkPickedCover,
	coverIssueMessage,
} from "./cover-file.ts";
import { DRAFT_COVER_FIELD } from "./editor-copy.ts";
import { useDraftCoverUrl } from "./use-draft-cover-url.ts";

/**
 * The field for choosing a cover before publication. Same role as the web `draft-cover-field.tsx`.
 *
 * ## The field does not call the server
 *
 * An unpublished draft has no work row to attach a cover to, so the picked image is kept on this
 * device (lib/local-data/draft-cover-store.ts) and sent to the server once, at publication
 * (`uploadStagedCover` in publish-draft.ts).
 *
 * The field is absent for published drafts: the server owns the cover then, and it is edited from
 * the published-works tab. Two editable places at once would leave it unclear which one wins, and
 * the symptom is the cover silently reverting.
 *
 * ## No normalization
 *
 * The picked file is passed through unchanged. Resizing and format rules belong to the server's
 * single boundary (apps/api/src/lib/media/image.ts); doing it here too would create two rules and
 * different pictures before and after publication. The pre-check (`checkPickedCover`) only warns;
 * the server, which decodes the bytes, is the final authority.
 *
 * ## Failures stay inside the field
 *
 * A failed file move belongs to the control just pressed, so a notice elsewhere could not say what
 * failed. This app has no toasts (see docs/design/FAILURE-FEEDBACK.md).
 */
export function DraftCoverField({ draft }: { draft: StoryDraft }) {
	const { store, ownsStore } = useDraftCoverScope();
	const cover = useDraftCoverUrl(draft);
	const [issue, setIssue] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	/**
	 * Published drafts have no field: the server owns the cover. Not drawn disabled, since a control
	 * that cannot be pressed reads as a promise that it will become available.
	 */
	if (draft.publishedStoryId !== null) return null;

	const run = async (task: () => Promise<void>): Promise<void> => {
		if (busy || !store) return;
		setBusy(true);
		setIssue(null);
		try {
			await task();
		} catch {
			/**
			 * The raw message is not shown: file-system text does not say what the user can do, and it
			 * carries the device's absolute path.
			 */
			setIssue(DRAFT_COVER_FIELD.stageFailed);
		} finally {
			setBusy(false);
		}
	};

	const choose = () =>
		run(async () => {
			const picked = await pickImageFromLibrary();
			/** Closing the picker without choosing is normal; nothing changes. */
			if (!picked) return;
			const problem = checkPickedCover(picked);
			if (problem) {
				setIssue(coverIssueMessage(problem));
				return;
			}
			if (!store || !ownsStore(store)) return;
			await store.stage(draft.id, picked);
		});

	const remove = () =>
		run(async () => {
			if (!store || !ownsStore(store)) return;
			await store.clear(draft.id);
		});

	return (
		<View style={field.root}>
			<View style={field.head}>
				<Text variant="body" weight="medium">
					{DRAFT_COVER_FIELD.label}
				</Text>
				<Text variant="label" tone="muted-foreground">
					{DRAFT_COVER_FIELD.description}
				</Text>
			</View>

			{/**
			 * The cover is its own preview. 3:4 matches the discover grid, so the crop shown here is the crop cards
			 * show. Half width is one card's width.
			 */}
			<View style={field.preview}>
				<StoryCover
					uri={cover.url}
					title={null}
					style={field.cover}
					placeholderSize="xl"
				/>
			</View>

			<Text variant="caption" tone="muted-foreground">
				{COVER_INPUT_HINT}
			</Text>

			<View style={field.actions}>
				<Button
					label={
						cover.staged
							? DRAFT_COVER_FIELD.replaceLabel
							: DRAFT_COVER_FIELD.chooseLabel
					}
					variant="outline"
					disabled={busy || !store}
					onPress={() => void choose()}
				/>
				{/** No button to clear a cover that is not staged. */}
				{cover.staged ? (
					<Button
						label={DRAFT_COVER_FIELD.removeLabel}
						variant="ghost"
						disabled={busy}
						onPress={() => void remove()}
					/>
				) : null}
			</View>

			{issue ? <Notice tone="destructive" message={issue} /> : null}

			{/**
			 * Says the cover is not uploaded yet. Without this, the creator would assume it is saved, and read a missing
			 * cover on another device as a defect. Both facts (uploaded at publication, kept on this device only) sit in
			 * one sentence.
			 */}
			{cover.staged ? (
				<Text variant="caption" tone="muted-foreground">
					{DRAFT_COVER_FIELD.stagedNote}
				</Text>
			) : null}
		</View>
	);
}

const field = StyleSheet.create({
	root: { gap: space.sm },
	head: { gap: space.px },
	/** One card's width, the same value as the preview block (a discover grid cell is half the screen). */
	preview: { width: "50%" },
	cover: { aspectRatio: 3 / 4, borderRadius: 12 },
	actions: { flexDirection: "row", gap: space.sm },
});
