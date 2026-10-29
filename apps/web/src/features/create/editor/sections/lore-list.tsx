import type { DraftLoreEntry } from "@rowcat/authoring";
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
import { LoreEditorCard } from "./lore-editor-card.tsx";

/**
 * The lore (world entries) list. This file owns only the section and the list: the add button, the
 * cap, the empty state, and ordering. A single entry's collapsed view lives in
 * `lore-editor-card.tsx`, and the summary rules in `lore-fields.ts`.
 *
 * An entry with neither keywords nor always-include is not warned about here; it is blocked at
 * publish. Such an entry saves but does nothing in conversation (validation in
 * `@rowcat/authoring`). The collapsed `No keywords` text only shows the fact; it does not judge.
 *
 * Runtime-enabled drafts lock this section too. Lore is inserted into the conversation prompt
 * (`buildChatGenerationRequest`), while runtime AI requests are built by the creator's
 * `useGeneration()`, which reads neither seed nor lore. In a runtime draft, lore therefore sits
 * where the prompt and starting scene sit: kept, but not included. All four sections share one
 * decision point (`useConversationAuthoringMode`).
 */

/**
 * `memo` is not decoration. Changing one character of the draft title makes autosave emit a new
 * record, and the live query pushes it into the editor, re-rendering the whole tree. This list's
 * props do not change then, but each card carries `layout`, which re-measures geometry, and that
 * cost grows with the number of cards. Props must therefore pass through only when they actually
 * change, which requires every prop to be a stable reference. The autosave handle
 * (`use-draft-autosave.ts`) and the structural-change handle (`use-draft-actions.ts`) keep that
 * promise. If any prop is recreated on each render, `memo` only adds cost.
 */
/**
 * The section title and description. They are shared with the placeholder: the list shows the
 * placeholder until the local store returns its first result (`draft-editor-page.tsx`), and that
 * skeleton draws these same words. Two copies would drift. When one changed, the difference would
 * show up only as the sections below shifting when the list arrives.
 */
export const loreSection = () => {
	const t = translator("create");
	return {
		title: t("loreSection.title"),
		description: t("loreSection.description"),
	} as const;
};

/**
 * Lock copy for the lore section when runtime is enabled. It states the same three facts, in the
 * same order, as the prompt and starting-scene lock copy: why it is not used, what replaces it, and
 * that the value is not gone. The last line is required. Without it, creators assume their lore was
 * erased, and only turning runtime off clears that belief.
 */
export const loreRuntimeLock = () => {
	const t = translator("create");
	return {
		title: t("loreRuntimeLock.title"),
		body: t("loreRuntimeLock.body"),
	} as const;
};

export const LoreList = memo(function LoreList({
	draftId,
	lore,
	autosave,
	actions,
}: {
	/** The draft whose runtime project is read. The decision hook holds its own subscription. */
	draftId: string;
	lore: DraftLoreEntry[];
	autosave: DraftAutosave;
	actions: DraftActions;
}) {
	const { t } = useTranslation(["create", "common"]);
	const mode = useConversationAuthoringMode(draftId);

	const ids = lore.map((entry) => entry.id);
	const full = lore.length >= STORY_PUBLISH_LIMITS.lore;
	/**
	 * The structure of this list: what actually rearranges the cards. It covers adds, removes, and
	 * reorders only. Expanding and collapsing a card is not here. The user just did that, so it should
	 * happen immediately. Including it would make the whole section re-measure its geometry on every
	 * collapse.
	 */
	const order = ids.join("\n");

	/**
	 * Same placeholder as before the child list arrives (`draft-editor-page.tsx`). Two waits (the lore
	 * lookup and the runtime lookup) appear to the user as one wait.
	 */
	if (mode === "pending") return <EditorSectionSkeleton {...loreSection()} />;

	/**
	 * While locked, this layer neither reads nor writes lore. The add control is omitted as well, as
	 * in `RuntimeLockedSection`.
	 */
	if (mode === "locked")
		return (
			<RuntimeLockedSection section={loreSection()} lock={loreRuntimeLock()} />
		);

	return (
		<EditorSection
			title={loreSection().title}
			layoutDependency={order}
			description={loreSection().description}
			action={
				<Button
					size="sm"
					variant="outline"
					disabled={full}
					onClick={() => void actions.addLore()}
				>
					<Plus aria-hidden="true" />
					{t("startSceneList.add")}
				</Button>
			}
		>
			{lore.length === 0 && (
				<p className="text-sm text-muted-foreground">
					{t("loreList.noLoreYetYouCan")}
				</p>
			)}

			{/*
			 * Same convention as the starting scene: no entrance animation, only relayout and exit. If a card
			 * that
			 * moves down during a reorder also ran `initial`, a card that merely changed position would look
			 * newly
			 * created. Since reordering is a real action on this screen, object permanence was chosen. Presence
			 * wraps `LoreEditorCard`, but the element that actually exits is the `m.article` inside it.
			 * Presence
			 * is passed by context, so a plain component in between still works.
			 */}
			<AnimatePresence initial={false}>
				{lore.map((entry, index) => (
					<LoreEditorCard
						key={entry.id}
						layoutDependency={order}
						entry={entry}
						index={index}
						total={lore.length}
						autosave={autosave}
						onMove={(direction) =>
							void actions.moveLore(movedOrder(ids, entry.id, direction))
						}
						onRemove={() => void actions.removeLore(entry.id)}
					/>
				))}
			</AnimatePresence>
		</EditorSection>
	);
});
