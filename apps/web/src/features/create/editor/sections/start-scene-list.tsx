import type { DraftStartScene } from "@rowcat/authoring";
import { STORY_PUBLISH_LIMITS } from "@rowcat/contracts";
import { Button } from "@rowcat/ui-web/components/button";
import { Plus } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { translator } from "#/lib/i18n/current.ts";
import { EditorSection, EditorSectionSkeleton } from "../fields.tsx";
import {
	RuntimeLockedSection,
	useConversationAuthoringMode,
} from "../runtime-lock.tsx";
import { type DraftActions, movedOrder } from "../use-actions.ts";
import type { DraftAutosave } from "../use-autosave.ts";
import { StartSceneEditorCard } from "./start-scene-editor-card.tsx";

/**
 * The section and list for choosing one scene as the default. The default opening is stored as a
 * scene id, not an array index. An index would silently change its target when scenes are reordered
 * or one is deleted, so the opening would change without the user touching anything.
 *
 * Deleting the default scene moves the selection to the first remaining scene. The storage layer
 * does this in the same transaction (`local-authoring/store.ts`), so this screen never shows an
 * inconsistent state.
 *
 * This file owns only the section and the list. What a collapsed card shows and what the expanded
 * card edits belong to `start-scene-editor-card.tsx`.
 *
 * The section locks when the runtime is on. The opening is read when a chat room opens, but runtime
 * playback creates no room, so the scenes sit where the prompt sits: kept, never used. The lock
 * follows the prompt's reasoning. If the field were open for a frame before the project loads,
 * typing would pass through autosave into the runtime work's old scene, and nothing on screen would
 * reveal it, because the field locks right after. The decision uses `useConversationAuthoringMode`.
 */

/**
 * `memo` is not decorative. Editing one character of the draft title makes autosave emit a new
 * record. `liveQuery` pushes it into the editor, and the whole tree re-renders. The props of this
 * list do not change in that case, but each card uses `layout`, which re-measures geometry. That
 * cost grows with the card count. Props are passed through only when they really change.
 *
 * So every prop must be a stable reference. The autosave handle (`use-draft-autosave.ts`) and the
 * structural handle (`use-draft-actions.ts`) keep that promise. If even one were recreated each
 * render, this `memo` would cost time and filter nothing.
 */
/**
 * Shared with the loading skeleton (`draft-editor-page.tsx`), which draws this text as real copy
 * while the list loads. Two copies would let one change alone, and the mismatch would show up as
 * sections below shifting when the list arrives.
 */
export const startSceneSection = () => {
	const t = translator("create");
	return {
		title: t("startSceneSection.title"),
		description: t("startSceneSection.description"),
	} as const;
};

/**
 * Says the same three facts as the prompt lock (`promptRuntimeLock()`), in the same order: why the
 * section is unused, what takes its place, and that the value was not removed.
 *
 * The last point matters most. Without it, the creator reads the saved opening as deleted, and that
 * belief is only resolved by turning the runtime off. A creator who does not turn it off would
 * think the manuscript was lost for good.
 *
 * The names `useStoryState` and `Screen` are not written here. The screen only needs to say that
 * runtime code draws the screen; those names belong to the studio and the docs.
 */
export const startSceneRuntimeLock = () => {
	const t = translator("create");
	return {
		title: t("startSceneRuntimeLock.title"),
		body: t("startSceneRuntimeLock.body"),
	} as const;
};

export const StartSceneList = memo(function StartSceneList({
	draftId,
	scenes,
	defaultStartSceneId,
	autosave,
	actions,
}: {
	/**
	 * Draft from which the runtime project is read. This section holds its own subscription, like the
	 * prompt section.
	 */
	draftId: string;
	scenes: DraftStartScene[];
	defaultStartSceneId: string | null;
	autosave: DraftAutosave;
	actions: DraftActions;
}) {
	const { t } = useTranslation(["create", "common"]);
	const mode = useConversationAuthoringMode(draftId);

	const ids = scenes.map((scene) => scene.id);
	const full = scenes.length >= STORY_PUBLISH_LIMITS.startScenes;
	/**
	 * The structure of this list: what actually repositions the cards. It includes the default
	 * opening. When that moves, one card's badge and one expanded card's button appear or vanish
	 * together, changing card heights, and the cards below really move.
	 *
	 * The expanded state is not included. Expanding is something the user just did, so it should
	 * happen immediately. Including it would re-measure the whole section on every collapse.
	 */
	const order = `${ids.join("\n")}|${defaultStartSceneId ?? ""}`;

	/**
	 * Same placeholder as the list shows before the child list arrives (`draft-editor-page.tsx`). Two
	 * things are awaited (the scene lookup and the runtime lookup), but the user sees one wait. A
	 * separate message on only one of them would make two identical-looking waits read differently to
	 * assistive technology.
	 */
	if (mode === "pending")
		return <EditorSectionSkeleton {...startSceneSection()} />;

	/**
	 * While locked, this layer neither reads nor writes scenes, and it does not draw `Add` either.
	 * Adding an item to a position that will not be used is noise, not a promise.
	 */
	if (mode === "locked")
		return (
			<RuntimeLockedSection
				section={startSceneSection()}
				lock={startSceneRuntimeLock()}
			/>
		);

	return (
		<EditorSection
			title={startSceneSection().title}
			description={startSceneSection().description}
			layoutDependency={order}
			action={
				<Button
					size="sm"
					variant="outline"
					disabled={full}
					onClick={() => void actions.addStartScene()}
				>
					<Plus aria-hidden="true" />
					{t("startSceneList.add")}
				</Button>
			}
		>
			{scenes.length === 0 && (
				<p className="text-sm text-muted-foreground">
					{t("startSceneList.noOpeningScenesYetYou")}
				</p>
			)}

			{/*
			 * Same convention as the lore list: reorder and removal are animated, but there is no entrance
			 * animation.
			 */}
			<AnimatePresence initial={false}>
				{scenes.map((scene, index) => (
					<StartSceneEditorCard
						key={scene.id}
						layoutDependency={order}
						scene={scene}
						index={index}
						total={scenes.length}
						isDefault={scene.id === defaultStartSceneId}
						autosave={autosave}
						onMove={(direction) =>
							void actions.moveStartScene(movedOrder(ids, scene.id, direction))
						}
						onRemove={() => void actions.removeStartScene(scene.id)}
						onMakeDefault={() => void actions.setDefaultStartScene(scene.id)}
					/>
				))}
			</AnimatePresence>
		</EditorSection>
	);
});
