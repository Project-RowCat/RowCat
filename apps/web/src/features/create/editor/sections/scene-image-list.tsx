import type { DraftSceneImage } from "@rowcat/authoring";
import { sceneImageToken, sceneTriggerKey } from "@rowcat/chat";
import { CHAT_SCENE_IMAGE_LIMITS, MEDIA_ACCEPT } from "@rowcat/contracts";
import { Button } from "@rowcat/ui-web/components/button";
import { Spinner } from "@rowcat/ui-web/components/spinner";
import { ImagePlus, Trash2 } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { type ChangeEvent, memo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { translator } from "#/lib/i18n/current.ts";
import { AnimatedIconSwap } from "#/lib/motion/animated-icon-swap.tsx";
import { useExitGuard } from "#/lib/motion/exit-guard.ts";
import { feedbackEnter, feedbackExit } from "#/lib/motion/feedback.ts";
import { rowExit } from "#/lib/motion/list-motion.ts";
import {
	enterTransition,
	exitTransition,
	layoutTransition,
} from "#/lib/motion/transitions.ts";
import { EditorSection, EditorSectionSkeleton, TextField } from "../fields.tsx";
import {
	RuntimeLockedSection,
	useConversationAuthoringMode,
} from "../runtime-lock.tsx";
import type { DraftActions } from "../use-actions.ts";
import type { DraftAutosave } from "../use-autosave.ts";
import {
	checkSceneImageFile,
	sceneImageErrorMessage,
	sceneImageInputHint,
	sceneImageIssueMessage,
} from "./scene-image-file.ts";

/**
 * The list does two things: it adds an image by uploading it, and it takes a trigger word that
 * refers to that image. It is not an asset manager. There is no grid of all uploaded images, no
 * picker for images used in other drafts, and no folders. The asset library is outside this slice.
 *
 * The two operations differ in kind. Picking an image is an upload: irreversible, with several
 * possible failure reasons, so it happens immediately and explicitly. Typing a trigger is ordinary
 * typing, so it autosaves with debounce.
 *
 * An image is uploaded as soon as it is picked, and a record holding its `assetId` is created then.
 * The cover uploads at publish time, but here the trigger must point at the asset while editing so
 * the draft is self-contained. Bytes missing on another device are meaningless there.
 *
 * Overlapping triggers are reported, not blocked. Blocking saves would prevent the common edit of
 * swapping two entries' names, which passes through a brief overlap. The UI instead says which
 * entry wins: the matcher takes the earlier one (`indexSceneImages` in `@rowcat/chat`), and publish
 * validation states the same fact again.
 *
 * The section locks when the runtime is on. The image attaches at the end of a conversation
 * response (`finalizeWithSceneImage`), and runtime playback never opens a chat room. Creator code
 * draws the image with `Image`. Locked images are not deleted: the bytes are already on the server
 * and the record stays, so the list reappears unchanged when the runtime is turned off.
 */

/**
 * Whether this trigger overlaps an earlier item in the list. Position decides, so the earlier item
 * wins.
 */
function duplicateIndexes(images: DraftSceneImage[]): Set<string> {
	const seen = new Map<string, string>();
	const dupes = new Set<string>();
	for (const image of images) {
		const key = sceneTriggerKey(image.trigger);
		if (!key) continue;
		const first = seen.get(key);
		if (first === undefined) seen.set(key, image.id);
		else dupes.add(image.id);
	}
	return dupes;
}

const SceneImageRow = memo(function SceneImageRow({
	image,
	index,
	duplicate,
	autosave,
	layoutDependency,
	onRemove,
}: {
	image: DraftSceneImage;
	/**
	 * Ordinal position, used only in the delete button's accessible name. If every delete button had
	 * the same name, a screen reader user could not tell which one belongs to the row being read. The
	 * trigger word is preferred when present, because it is what people call that row. The lore and
	 * start-scene cards use `#{n} …` for the same reason.
	 */
	index: number;
	duplicate: boolean;
	autosave: DraftAutosave;
	layoutDependency: unknown;
	onRemove: () => void;
}) {
	const { t } = useTranslation(["create", "common"]);
	const trigger = image.trigger.trim();
	const src = getRowCatClient().media.url(image.assetId);

	return (
		<m.article
			layout="position"
			layoutDependency={layoutDependency}
			exit={rowExit}
			transition={{ layout: layoutTransition }}
			style={useExitGuard()}
			className="flex items-start gap-3 rounded-md border p-3"
		>
			{/*
			 * Preview is a fixed square box with `object-cover`. If images had different heights, rows
			 * would look ragged. Only this preview is cropped; the stored image and the image drawn in the
			 * conversation are not.
			 */}
			<img
				src={src}
				referrerPolicy="no-referrer"
				alt=""
				loading="lazy"
				decoding="async"
				className="size-16 shrink-0 rounded-md border bg-muted object-cover"
			/>
			<div className="flex min-w-0 flex-1 flex-col gap-1.5">
				<TextField
					label={t("sceneImageList.trigger")}
					value={image.trigger}
					onChange={(value) =>
						autosave.patchSceneImage(image.id, { trigger: value })
					}
					max={CHAT_SCENE_IMAGE_LIMITS.trigger}
					placeholder={t("sceneImageList.darkHallway")}
					hint={
						trigger
							? t("sceneImage.triggerHint", {
									trigger,
									token: sceneImageToken(trigger),
								})
							: t("sceneImageList.enterTheWordThatCalls")
					}
				/>
				{/*
				 * The overlap warning should be the quietest text on this screen. It changes while typing
				 * rather than when an upload finishes, so it only fades. Moving it on every keystroke would
				 * pull the eye away from the input.
				 *
				 * It does not re-animate per letter. `initial` runs only at mount, so while overlap stays
				 * true the sentence holds still. The animation reacts only when the boolean flips.
				 */}
				<AnimatePresence initial={false}>
					{duplicate && (
						<m.p
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0, transition: exitTransition }}
							transition={enterTransition}
							className="text-xs text-destructive"
						>
							{t("sceneImageList.theSameTriggerAlreadyExists")}
						</m.p>
					)}
				</AnimatePresence>
			</div>
			<Button
				size="icon"
				variant="ghost"
				aria-label={
					trigger
						? t("sceneImage.deleteNamed", { trigger })
						: t("sceneImage.deleteNth", { n: index + 1 })
				}
				onClick={onRemove}
			>
				<Trash2 aria-hidden="true" />
			</Button>
		</m.article>
	);
});

/**
 * Shared with the placeholder. The list's loading skeleton (`draft-editor-page.tsx`) draws this
 * text as real copy until local storage returns the first result. If the two copies were written
 * separately, a description that grows from one line to two would be fixed in one place only. The
 * mismatch would show up as lower sections shifting when the list arrives.
 */
export const sceneImageSection = () => {
	const t = translator("create");
	return {
		title: t("sceneImageSection.title"),
		description: t("sceneImageSection.description"),
	} as const;
};

/**
 * Says the same three facts, in the same order, as the other runtime-lock sections: why the section
 * is unused, what draws its place, and that the value is kept.
 *
 * The `Image` API name is deliberately not written. The screen only needs to say that runtime code
 * draws the picture. The name belongs to the studio and the docs.
 */
export const sceneImageRuntimeLock = () => {
	const t = translator("create");
	return {
		title: t("sceneImageRuntimeLock.title"),
		body: t("sceneImageRuntimeLock.body"),
	} as const;
};

export const SceneImageList = memo(function SceneImageList({
	draftId,
	images,
	autosave,
	actions,
}: {
	/** The draft whose runtime project is read. The lock decision hook has its own subscription. */
	draftId: string;
	images: DraftSceneImage[];
	autosave: DraftAutosave;
	actions: DraftActions;
}) {
	const { t } = useTranslation(["create", "common"]);
	const mode = useConversationAuthoringMode(draftId);
	const inputRef = useRef<HTMLInputElement>(null);
	const [uploading, setUploading] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	/**
	 * Synchronous copy of the busy flag, which blocks a second submit in the same tick. Render state
	 * updates a frame late, so a double-click could pass the check.
	 */
	const busyRef = useRef(false);

	const full = images.length >= CHAT_SCENE_IMAGE_LIMITS.perStory;
	const order = images.map((image) => image.id).join("\n");
	const dupes = duplicateIndexes(images);

	const onPick = async (
		event: ChangeEvent<HTMLInputElement>,
	): Promise<void> => {
		const file = event.target.files?.[0];
		// Cancelling the picker yields no file. It is not an undo of an earlier pick.
		if (!file) return;
		if (busyRef.current) return;

		const issue = checkSceneImageFile(file);
		if (issue) {
			setFailure(sceneImageIssueMessage(issue));
			if (inputRef.current) inputRef.current.value = "";
			return;
		}

		busyRef.current = true;
		setUploading(true);
		setFailure(null);
		try {
			/**
			 * Order matters: create the record after the upload, not before. The reverse would briefly put
			 * an entry with no asset into the list, and if the upload failed, that entry would stay forever.
			 */
			const asset = await getRowCatClient().me.uploadSceneImage(file);
			await actions.addSceneImage(asset.mediaId);
		} catch (error) {
			setFailure(sceneImageErrorMessage(error));
		} finally {
			busyRef.current = false;
			setUploading(false);
			// Clear the input value so the same file can be picked again. Browsers fire no `change` event
			// when the value is unchanged.
			if (inputRef.current) inputRef.current.value = "";
		}
	};

	/**
	 * Same placeholder as the list shows before the child list arrives (`draft-editor-page.tsx`). Two
	 * things are awaited (the image lookup and the runtime lookup), but the user sees one wait.
	 *
	 * The early return must come after the hooks. The `useRef` and `useState` calls above run on every
	 * render regardless of branch.
	 */
	if (mode === "pending")
		return <EditorSectionSkeleton {...sceneImageSection()} />;

	/**
	 * While locked, neither the add button nor the file input is rendered. Uploading an image that
	 * will not be used is noise, not a promise, and the upload cannot be undone.
	 */
	if (mode === "locked")
		return (
			<RuntimeLockedSection
				section={sceneImageSection()}
				lock={sceneImageRuntimeLock()}
			/>
		);

	return (
		<EditorSection
			title={sceneImageSection().title}
			description={sceneImageSection().description}
			layoutDependency={order}
			action={
				<>
					<input
						ref={inputRef}
						type="file"
						accept={MEDIA_ACCEPT}
						className="hidden"
						onChange={(event) => void onPick(event)}
					/>
					<Button
						size="sm"
						variant="outline"
						disabled={full || uploading}
						onClick={() => inputRef.current?.click()}
					>
						<AnimatedIconSwap stateKey={uploading ? "uploading" : "idle"}>
							{uploading ? <Spinner /> : <ImagePlus aria-hidden="true" />}
						</AnimatedIconSwap>
						{t("sceneImageList.addImage")}
					</Button>
				</>
			}
		>
			{images.length === 0 && (
				<p className="text-sm text-muted-foreground">
					{t("sceneImage.empty_list", { hint: sceneImageInputHint() })}
				</p>
			)}

			{/*
			 * The upload and validation failure message uses the enter-and-exit rhythm for replies to a
			 * user action (`lib/motion/feedback.ts`). This element is not in the position that rhythm
			 * expects (the last flow child of its container). Below it sits content, not a control to
			 * press, so the list rising back when the message exits costs nothing. The message only goes
			 * away when the user picks a file again, so no pane is stuck waiting for a frame that never
			 * comes.
			 *
			 * Moving it below the list would follow the rule formally, but the answer would then appear
			 * farthest from the `Add image` button the user just pressed.
			 */}
			<AnimatePresence initial={false}>
				{failure && (
					<m.p
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						exit={feedbackExit}
						transition={feedbackEnter.transition}
						className="text-sm text-destructive"
					>
						{failure}
					</m.p>
				)}
			</AnimatePresence>

			{/*
			 * Same convention as the lore and start-scene lists: reorder and removal are animated, but
			 * there is no entrance animation.
			 */}
			<AnimatePresence initial={false}>
				{images.map((image, index) => (
					<SceneImageRow
						key={image.id}
						image={image}
						index={index}
						duplicate={dupes.has(image.id)}
						autosave={autosave}
						layoutDependency={order}
						onRemove={() => void actions.removeSceneImage(image.id)}
					/>
				))}
			</AnimatePresence>
		</EditorSection>
	);
});
