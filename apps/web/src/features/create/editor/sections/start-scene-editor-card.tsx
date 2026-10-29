import type { DraftStartScene } from "@rowcat/authoring";
import { STORY_PUBLISH_LIMITS } from "@rowcat/contracts";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Button } from "@rowcat/ui-web/components/button";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@rowcat/ui-web/components/dropdown-menu";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import * as m from "motion/react-m";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useExitGuard } from "#/lib/motion/exit-guard.ts";
import { rowExit } from "#/lib/motion/list-motion.ts";
import { layoutTransition } from "#/lib/motion/transitions.ts";
import {
	CardActionsMenu,
	CardDisclosureButton,
	CardDisclosurePanel,
} from "../../publishing/card-parts.tsx";
import { TextAreaField, TextField } from "../fields.tsx";
import type { DraftAutosave } from "../use-autosave.ts";
import { isBlankStartScene, startSceneSummary } from "./start-scene-fields.ts";

/**
 * Collapsible editor card for one start scene. It uses the same interaction language as the lore
 * card (same trigger, menu position, and radius) but is not merged with it. The content and actions
 * differ, and this card has one extra axis, the default opening. Merging would push that axis into
 * `type === "scene"` branches, so whoever edits lore would have to read the scene rules.
 *
 * The collapsed card deliberately does not draw the full multi-line body. With three scenes the
 * editor is two screens long, and finding which scene is the default would become scrolling work.
 * That fact must stay visible while collapsed.
 *
 * Save rules are unchanged. Title and body still schedule through `autosave.patchStartScene`
 * immediately, and the default opening is set only by `actions.setDefaultStartScene`
 * (`defaultStartSceneId` is the source of truth). Expanded state is stored nowhere; it describes
 * what this tab is showing right now.
 */
export function StartSceneEditorCard({
	scene,
	index,
	total,
	isDefault,
	autosave,
	layoutDependency,
	onMove,
	onRemove,
	onMakeDefault,
}: {
	scene: DraftStartScene;
	index: number;
	total: number;
	/**
	 * Whether this scene is the opening that gets published. The decision belongs to
	 * `defaultStartSceneId` alone.
	 */
	isDefault: boolean;
	autosave: DraftAutosave;
	/**
	 * Position in the list. This is the case where the card actually changes position (see
	 * `EditorSection` in `fields.tsx`).
	 */
	layoutDependency: unknown;
	onMove: (direction: -1 | 1) => void;
	onRemove: () => void;
	onMakeDefault: () => void;
}) {
	const { t } = useTranslation(["create", "common"]);
	const panelId = useId();
	/**
	 * A scene with no content yet starts expanded, so whoever pressed `Add` can type right away. The
	 * value is read only as the initial state, so the card does not collapse when autosave data
	 * arrives later.
	 */
	const [expanded, setExpanded] = useState(() => isBlankStartScene(scene));

	const summary = startSceneSummary(scene);

	return (
		<m.article
			layout="position"
			layoutDependency={layoutDependency}
			exit={rowExit}
			transition={{ layout: layoutTransition }}
			style={useExitGuard()}
			/*
			 * The default opening is marked with a border too, but the border does not carry the meaning;
			 * the badge below does. Color alone would hide the distinction from some users.
			 */
			className={
				isDefault
					? "rounded-md border border-primary p-3"
					: "rounded-md border p-3"
			}
		>
			{/* The expand trigger and the management menu are siblings, not nested (see `card-parts.tsx`). */}
			<header className="flex items-start justify-between gap-2">
				<CardDisclosureButton
					expanded={expanded}
					panelId={panelId}
					onToggle={() => setExpanded((open) => !open)}
				>
					<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<span
							className={
								summary.hasTitle
									? "min-w-0 truncate text-sm font-medium"
									: "min-w-0 truncate text-sm font-medium text-muted-foreground"
							}
						>
							{summary.headline}
						</span>
						{isDefault && (
							<Badge variant="secondary">
								{t("startSceneEditorCard.defaultOpening")}
							</Badge>
						)}
					</span>
					{/*
					 * The body preview is capped at two lines, enforced by CSS rather than a character count. A
					 * character count would become the rule, and it would be wrong on screens of different width.
					 */}
					{scene.content.trim() !== "" && (
						<span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
							{scene.content}
						</span>
					)}
					<span className="mt-1 block text-xs text-muted-foreground">
						{t("startScene.nth", { n: index + 1 })}
					</span>
				</CardDisclosureButton>

				{/*
				 * Up, down, and delete moved into the menu, in the same position and order as the lore card.
				 * The disabled boundaries stay (`Up` on the first scene, `Down` on the last).
				 *
				 * `Set as default opening` is not here. It is an authoring decision about which scene to use, so it
				 * belongs beside the title and body. If it were in the management menu, reordering and changing
				 * the published opening would look equally weighty.
				 */}
				<CardActionsMenu label={t("startScene.manage", { n: index + 1 })}>
					<DropdownMenuItem disabled={index === 0} onClick={() => onMove(-1)}>
						<ChevronUp aria-hidden="true" />
						{t("startSceneEditorCard.up")}
					</DropdownMenuItem>
					<DropdownMenuItem
						disabled={index === total - 1}
						onClick={() => onMove(1)}
					>
						<ChevronDown aria-hidden="true" />
						{t("startSceneEditorCard.down")}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem variant="destructive" onClick={onRemove}>
						<Trash2 aria-hidden="true" />
						{t("startSceneEditorCard.deleteScene")}
					</DropdownMenuItem>
				</CardActionsMenu>
			</header>

			{expanded && (
				<CardDisclosurePanel id={panelId}>
					<TextField
						label={t("startSceneEditorCard.sceneTitle")}
						value={scene.title}
						max={STORY_PUBLISH_LIMITS.startSceneTitle}
						placeholder={t("startSceneEditorCard.theLibraryAtDawn")}
						onChange={(title) => autosave.patchStartScene(scene.id, { title })}
					/>
					<TextAreaField
						label={t("startSceneEditorCard.body")}
						rows={6}
						value={scene.content}
						max={STORY_PUBLISH_LIMITS.startSceneContent}
						onChange={(content) =>
							autosave.patchStartScene(scene.id, { content })
						}
					/>
					{/*
					 * Not drawn on the scene that is already the default. A button that does nothing when pressed
					 * is noise, not a promise, and the badge above already says this.
					 */}
					{!isDefault && (
						<div>
							<Button size="sm" variant="outline" onClick={onMakeDefault}>
								{t("startSceneEditorCard.setAsDefaultOpening")}
							</Button>
						</div>
					)}
				</CardDisclosurePanel>
			)}
		</m.article>
	);
}
