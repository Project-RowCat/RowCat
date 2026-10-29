import type { DraftStartScene, DraftStartScenePatch } from "@rowcat/authoring";
import { STORY_PUBLISH_LIMITS } from "@rowcat/contracts";
import { space } from "@rowcat/design";
import {
	Badge,
	Button,
	IconButton,
	Input,
	Notice,
	Panel,
	Text,
	Textarea,
} from "@rowcat/ui-native";
import { StyleSheet, View } from "react-native";
import { MotionRow } from "../../lib/motion/list-motion.tsx";
import {
	SECTION,
	SECTION_SUMMARY_NOUN,
	START_SCENE,
	START_SCENE_RUNTIME_LOCK,
	sectionSummary,
	startSceneHeadline,
} from "./editor-copy.ts";
import { EditorSection } from "./editor-section.tsx";
import {
	RuntimeLockedSection,
	useConversationAuthoringMode,
} from "./runtime-lock.tsx";
import { movedOrder } from "./use-draft-actions.ts";

/**
 * Start scenes: one candidate becomes the opening. The default-opening invariants belong to the
 * store (first scene becomes the opening, deleting it moves the choice in the same transaction,
 * another draft's scene can never be this draft's opening); restating any of them here would let
 * the published opening differ from what the screen shows.
 *
 * Selection identity is the scene id. An array index would silently retarget on a reorder or
 * delete, changing the default opening with no user action.
 *
 * Having no opening does not block publishing (the assembler folds it to empty); the empty-state
 * line says so rather than posing as an error.
 *
 * Locked while the runtime is on: the opening is read when a room opens and runtime playback
 * creates none, so scenes sit exactly where the prompt does (kept, not carried). The decision goes
 * through `useConversationAuthoringMode`, shared by the four conversation-material sections. This
 * app has no runtime authoring screen, but the record arrives by sync; `pending` blocks the one
 * frame in which the section would be open and editable with no visible symptom.
 */
export function StartSceneSection({
	draftId,
	scenes,
	defaultStartSceneId,
	onPatch,
	onAdd,
	onRemove,
	onReorder,
	onSetDefault,
}: {
	/** Draft whose runtime project is read; this section holds its own subscription, like the prompt section. */
	draftId: string;
	scenes: readonly DraftStartScene[];
	defaultStartSceneId: string | null;
	onPatch: (id: string, patch: DraftStartScenePatch) => void;
	onAdd: () => void;
	onRemove: (id: string) => void;
	onReorder: (orderedIds: string[]) => void;
	onSetDefault: (id: string) => void;
}) {
	const mode = useConversationAuthoringMode(draftId);

	const ids = scenes.map((scene) => scene.id);
	const over = scenes.length > STORY_PUBLISH_LIMITS.startScenes;
	// With no pick, or a pick that vanished, the first scene is the opening: the assembler's fallback
	// rule (`resolveDefaultStartScene`). A different rule here would diverge from what is published.
	const effectiveDefault =
		scenes.find((scene) => scene.id === defaultStartSceneId)?.id ??
		scenes[0]?.id ??
		null;

	if (mode !== "editable")
		return (
			<RuntimeLockedSection
				mode={mode}
				title={SECTION.startScenes.title}
				description={SECTION.startScenes.description}
				lock={START_SCENE_RUNTIME_LOCK}
			/>
		);

	return (
		<EditorSection
			title={SECTION.startScenes.title}
			description={SECTION.startScenes.description}
			/** Collapsed: each scene adds a title and body field, and a conversation starts without any. */
			summary={sectionSummary(SECTION_SUMMARY_NOUN.startScenes, scenes.length)}
			/** Going over the cap must show while collapsed (`alert` in `editor-section.tsx`). */
			alert={
				over ? (
					<Notice
						message={`Opening scenes can't exceed ${STORY_PUBLISH_LIMITS.startScenes}.`}
						tone="destructive"
					/>
				) : null
			}
			action={
				<Button
					label={START_SCENE.add}
					icon="add"
					variant="outline"
					size="sm"
					onPress={onAdd}
				/>
			}
		>
			{scenes.length === 0 ? (
				<Text variant="label" tone="muted-foreground">
					{START_SCENE.empty}
				</Text>
			) : null}
			{/**
			 * Cards appear, disappear and move. `enter={false}` because reordering is a real
			 * operation: a card moving down would replay its entrance and look like it reappeared.
			 * Web's `lore-editor-card.tsx` and `start-scene-editor-card.tsx` made the same call
			 * (`exit` and `layout` only).
			 */}
			{scenes.map((scene, index) => (
				<MotionRow key={scene.id} enter={false} exit={scenes.length > 1}>
					<SceneCard
						scene={scene}
						isDefault={scene.id === effectiveDefault}
						first={index === 0}
						last={index === scenes.length - 1}
						onPatch={(patch) => onPatch(scene.id, patch)}
						onRemove={() => onRemove(scene.id)}
						onMove={(direction) =>
							onReorder(movedOrder(ids, scene.id, direction))
						}
						onSetDefault={() => onSetDefault(scene.id)}
					/>
				</MotionRow>
			))}
		</EditorSection>
	);
}

function SceneCard({
	scene,
	isDefault,
	first,
	last,
	onPatch,
	onRemove,
	onMove,
	onSetDefault,
}: {
	scene: DraftStartScene;
	isDefault: boolean;
	first: boolean;
	last: boolean;
	onPatch: (patch: DraftStartScenePatch) => void;
	onRemove: () => void;
	onMove: (direction: -1 | 1) => void;
	onSetDefault: () => void;
}) {
	const headline = startSceneHeadline(scene.title);
	return (
		<Panel style={card.root}>
			<View style={card.head}>
				<Text
					variant="label"
					weight="semibold"
					numberOfLines={1}
					style={card.headline}
				>
					{headline}
				</Text>
				<IconButton
					icon="chevron-up"
					label={`${headline} ${START_SCENE.moveUp}`}
					tone="muted-foreground"
					disabled={first}
					onPress={() => onMove(-1)}
				/>
				<IconButton
					icon="chevron-down"
					label={`${headline} ${START_SCENE.moveDown}`}
					tone="muted-foreground"
					disabled={last}
					onPress={() => onMove(1)}
				/>
				<IconButton
					icon="delete"
					label={`${headline} ${START_SCENE.remove}`}
					tone="destructive"
					onPress={onRemove}
				/>
			</View>

			<Input
				label={START_SCENE.title}
				value={scene.title}
				invalid={scene.title.length > STORY_PUBLISH_LIMITS.startSceneTitle}
				onChangeText={(title) => onPatch({ title })}
			/>
			<Textarea
				label={START_SCENE.content}
				value={scene.content}
				invalid={scene.content.length > STORY_PUBLISH_LIMITS.startSceneContent}
				onChangeText={(content) => onPatch({ content })}
			/>

			{/** The current opening has no action (a button that does nothing looks broken); a badge states the fact instead. */}
			{isDefault ? (
				<View style={card.footer}>
					<Badge label={START_SCENE.defaultBadge} />
				</View>
			) : (
				<View style={card.footer}>
					<Button
						label={START_SCENE.makeDefault}
						accessibilityLabel={`${headline} ${START_SCENE.makeDefault}`}
						variant="ghost"
						size="sm"
						onPress={onSetDefault}
					/>
				</View>
			)}
		</Panel>
	);
}

const card = StyleSheet.create({
	root: { gap: space.sm, padding: space.md },
	head: { alignItems: "center", flexDirection: "row", gap: space.xs },
	headline: { flex: 1, minWidth: 0 },
	footer: { alignItems: "flex-start" },
});
