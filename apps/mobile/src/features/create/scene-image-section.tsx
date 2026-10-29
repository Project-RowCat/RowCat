import type { DraftSceneImage, DraftSceneImagePatch } from "@rowcat/authoring";
import { sceneTriggerKey } from "@rowcat/chat";
import { CHAT_SCENE_IMAGE_LIMITS } from "@rowcat/contracts";
import { space } from "@rowcat/design";
import {
	Button,
	IconButton,
	Input,
	Notice,
	Panel,
	RemoteImage,
	Text,
} from "@rowcat/ui-native";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { MotionRow } from "../../lib/motion/list-motion.tsx";
import { DISMISS_LABEL } from "./create-copy.ts";
import {
	SCENE_IMAGE,
	SCENE_IMAGE_RUNTIME_LOCK,
	SECTION,
	SECTION_SUMMARY_NOUN,
	sectionSummary,
} from "./editor-copy.ts";
import { EditorSection } from "./editor-section.tsx";
import {
	RuntimeLockedSection,
	useConversationAuthoringMode,
} from "./runtime-lock.tsx";
import { SCENE_IMAGE_INPUT_HINT } from "./scene-image-file.ts";
import type { SceneImageUpload } from "./use-scene-image-upload.ts";

/**
 * Scene images: a trigger plus a server asset reference. The draft stores only `assetId`; bytes
 * upload on pick through the media pipeline (`POST /v2/me/scene-images`). URLs are built on every
 * render through `client.media.url`, since a frozen absolute URL would break every existing
 * reference when a deployment moves the API origin.
 *
 * Duplicate triggers are not blocked at save: swapping two items' names passes through a moment of
 * overlap. The screen says which one wins (the first) and publication validation repeats it. The
 * comparison goes through `sceneTriggerKey` from `@rowcat/chat`; a second lowercase/whitespace rule
 * here would let the warned duplicates diverge from what playback actually folds.
 *
 * Removing an image from the draft does not delete it on the server: a published playback snapshot
 * may point at it, and rooms built from it may be open on other devices right now. The store's
 * `deleteSceneImage` only drops this draft's reference.
 *
 * Locked while the runtime is on: the image attaches to the end of a chat response and runtime
 * playback opens no room. The decision goes through `useConversationAuthoringMode`, shared by the
 * four conversation-material sections. Locking does not remove uploaded images; bytes stay on the
 * server and the draft record is untouched.
 */
export function SceneImageSection({
	draftId,
	images,
	onPatch,
	onRemove,
	upload,
}: {
	/** Draft whose runtime project is read; the decision hook holds its own subscription. */
	draftId: string;
	images: readonly DraftSceneImage[];
	onPatch: (id: string, patch: DraftSceneImagePatch) => void;
	onRemove: (id: string) => void;
	upload: SceneImageUpload;
}) {
	const mode = useConversationAuthoringMode(draftId);
	const client = getRowCatClient();
	const duplicates = duplicateTriggerIds(images);
	const full = images.length >= CHAT_SCENE_IMAGE_LIMITS.perStory;

	// No `Add picture` while locked: uploading an image that will not be carried is noise, and the upload
	// cannot be undone.
	if (mode !== "editable")
		return (
			<RuntimeLockedSection
				mode={mode}
				title={SECTION.sceneImages.title}
				description={`${SECTION.sceneImages.description} ${SCENE_IMAGE_INPUT_HINT}`}
				lock={SCENE_IMAGE_RUNTIME_LOCK}
			/>
		);

	return (
		<EditorSection
			title={SECTION.sceneImages.title}
			description={`${SECTION.sceneImages.description} ${SCENE_IMAGE_INPUT_HINT}`}
			/** Collapsed: each image carries a preview and trigger field, and the work stands without any. */
			summary={sectionSummary(SECTION_SUMMARY_NOUN.sceneImages, images.length)}
			/**
			 * Upload failure and duplicate triggers must show while collapsed: the first is the result of
			 * what the user just did (hidden, the image just seems not to upload), the second means only the
			 * first image appears in playback and must be read before publishing. The limit notice does not
			 * belong here; it explains the disabled `Add` button, which does not render while collapsed.
			 */
			alert={
				upload.failure ? (
					<Notice
						message={upload.failure}
						tone="destructive"
						actionLabel={DISMISS_LABEL}
						onAction={upload.dismissFailure}
					/>
				) : duplicates.size > 0 ? (
					<Notice message={SCENE_IMAGE.duplicate} />
				) : null
			}
			action={
				<Button
					label={upload.busy ? SCENE_IMAGE.adding : SCENE_IMAGE.add}
					icon="add"
					variant="outline"
					size="sm"
					busy={upload.busy}
					/** At the cap only adding is blocked; removing must stay open for an already-over list (other device, migration). */
					disabled={full}
					onPress={() => void upload.pick()}
				/>
			}
		>
			{full ? (
				<Text variant="caption" tone="muted-foreground">
					{`Up to ${CHAT_SCENE_IMAGE_LIMITS.perStory} scene images can be added.`}
				</Text>
			) : null}
			{images.length === 0 ? (
				<Text variant="label" tone="muted-foreground">
					{SCENE_IMAGE.empty}
				</Text>
			) : null}
			{/**
			 * Rows appear and disappear (pick adds one, delete removes one). With no reorder
			 * operation the entrance stays on, unlike lore and start scenes; web's
			 * `scene-image-list.tsx` made the same call.
			 */}
			{images.map((image) => (
				<MotionRow key={image.id} exit={images.length > 1}>
					<Panel style={card.root}>
						<View style={card.head}>
							<View style={card.field}>
								<Input
									label={SCENE_IMAGE.trigger}
									value={image.trigger}
									invalid={
										image.trigger.length > CHAT_SCENE_IMAGE_LIMITS.trigger
									}
									onChangeText={(trigger) => onPatch(image.id, { trigger })}
								/>
							</View>
							<IconButton
								icon="delete"
								label={`${image.trigger || SCENE_IMAGE.trigger} ${SCENE_IMAGE.remove}`}
								tone="destructive"
								onPress={() => onRemove(image.id)}
							/>
						</View>

						{duplicates.has(image.id) ? (
							<Notice message={SCENE_IMAGE.duplicate} />
						) : null}

						{image.assetId ? (
							<RemoteImage
								uri={client.media.url(image.assetId)}
								accessibilityLabel={image.trigger || undefined}
							/>
						) : (
							<Text variant="caption" tone="muted-foreground">
								{SCENE_IMAGE.missingAsset}
							</Text>
						)}
					</Panel>
				</MotionRow>
			))}
		</EditorSection>
	);
}

/**
 * Images shadowed by an earlier item. The first wins and is not marked; warning both would not say
 * which one actually appears. Order is the store's, which is also playback's matching order
 * (`prepareStoryPublication` keeps the first).
 */
function duplicateTriggerIds(
	images: readonly DraftSceneImage[],
): ReadonlySet<string> {
	const seen = new Set<string>();
	const losers = new Set<string>();
	for (const image of images) {
		const key = sceneTriggerKey(image.trigger);
		if (!key) continue;
		if (seen.has(key)) losers.add(image.id);
		else seen.add(key);
	}
	return losers;
}

const card = StyleSheet.create({
	root: { gap: space.sm, padding: space.md },
	head: { alignItems: "flex-end", flexDirection: "row", gap: space.xs },
	field: { flex: 1, minWidth: 0 },
});
