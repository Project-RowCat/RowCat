import type { DraftTool } from "@rowcat/authoring";
import { STORY_PUBLISH_LIMITS } from "@rowcat/contracts";
import { Button } from "@rowcat/ui-web/components/button";
import { Library, Plus } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { translator } from "#/lib/i18n/current.ts";
import { EditorSection, EditorSectionSkeleton } from "../fields.tsx";
import {
	RuntimeLockedSection,
	useConversationAuthoringMode,
} from "../runtime-lock.tsx";
import { type DraftActions, movedOrder } from "../use-actions.ts";
import type { DraftAutosave } from "../use-autosave.ts";
import { ToolEditorCard } from "./tool-editor-card.tsx";
import { ToolFromLibraryDialog } from "./tool-from-library-dialog.tsx";

/**
 * The creator tools list: tools the conversation's model can call in this work (`draft-tool.ts` in
 * @rowcat/authoring). Same split as lore: this file owns the section, the cap, the empty state and
 * ordering; one tool's card is `tool-editor-card.tsx`, and its rules are in `tool-fields.ts`.
 *
 * An incomplete tool saves, and its card says what is missing. Publishing is still where it is
 * blocked (`invalid_tool`), and a story test plays without it, because the contract rejects it and
 * a rejected tool would turn every turn into a 400.
 *
 * Runtime-enabled drafts lock this section, for lore's reason: tools are declared on the
 * conversation's requests (`chatConversationTools`), and runtime play creates no conversation, so
 * they would be kept but never offered. The decision goes through the same point as the other
 * conversation-material sections (`useConversationAuthoringMode`).
 *
 * `memo` for the reason written on `LoreList`: every autosave re-renders the editor, and each card
 * carries a `layout` animation that re-measures.
 */

/** Title and description, shared with the placeholder (`page.tsx`) so the two cannot drift. */
export const toolSection = () => {
	const t = translator("create");
	return {
		title: t("toolSection.title"),
		description: t("toolSection.description"),
	} as const;
};

/** Lock copy: why tools are not used, what replaces them, and that they are kept. */
export const toolRuntimeLock = () => {
	const t = translator("create");
	return {
		title: t("toolRuntimeLock.title"),
		body: t("toolRuntimeLock.body"),
	} as const;
};

export const ToolList = memo(function ToolList({
	draftId,
	tools,
	autosave,
	actions,
}: {
	draftId: string;
	tools: DraftTool[];
	autosave: DraftAutosave;
	actions: DraftActions;
}) {
	const { t } = useTranslation(["create", "common"]);
	const mode = useConversationAuthoringMode(draftId);
	const [picking, setPicking] = useState(false);

	const ids = tools.map((tool) => tool.id);
	/**
	 * The publish cap is the playback cap (`STORY_PUBLISH_LIMITS.tools`). Lore search can take one of
	 * those slots in a conversation, and the registry stops at the cap, so a work at the cap with lore
	 * loses its last tool in play. That is rare enough to leave to the registry rather than to make this
	 * button count lore.
	 */
	const full = tools.length >= STORY_PUBLISH_LIMITS.tools;
	const order = ids.join("\n");

	if (mode === "pending") return <EditorSectionSkeleton {...toolSection()} />;

	if (mode === "locked")
		return (
			<RuntimeLockedSection section={toolSection()} lock={toolRuntimeLock()} />
		);

	return (
		<EditorSection
			title={toolSection().title}
			layoutDependency={order}
			description={toolSection().description}
			action={
				<div className="flex flex-wrap gap-2">
					<Button
						size="sm"
						variant="outline"
						disabled={full}
						onClick={() => setPicking(true)}
					>
						<Library aria-hidden="true" />
						{t("toolList.fromLibrary")}
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={full}
						onClick={() => void actions.addTool()}
					>
						<Plus aria-hidden="true" />
						{t("toolList.add")}
					</Button>
				</div>
			}
		>
			<ToolFromLibraryDialog
				open={picking}
				onOpenChange={setPicking}
				disabled={full}
				draftNames={new Set(tools.map((tool) => tool.name.trim()))}
				onPick={(input) => void actions.addTool(input)}
			/>
			{tools.length === 0 && (
				<p className="text-sm text-muted-foreground">{t("toolList.empty")}</p>
			)}

			{/* Same presence convention as lore: no entrance animation, only relayout and exit. */}
			<AnimatePresence initial={false}>
				{tools.map((tool, index) => (
					<ToolEditorCard
						key={tool.id}
						layoutDependency={order}
						tool={tool}
						index={index}
						total={tools.length}
						autosave={autosave}
						onMove={(direction) =>
							void actions.moveTool(movedOrder(ids, tool.id, direction))
						}
						onRemove={() => void actions.removeTool(tool.id)}
					/>
				))}
			</AnimatePresence>
		</EditorSection>
	);
});
