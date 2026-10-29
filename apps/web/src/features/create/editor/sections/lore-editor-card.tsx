import type { DraftLoreEntry } from "@rowcat/authoring";
import type { ChatLorePosition } from "@rowcat/contracts";
import { STORY_PUBLISH_LIMITS } from "@rowcat/contracts";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@rowcat/ui-web/components/dropdown-menu";
import { Input } from "@rowcat/ui-web/components/input";
import { Label } from "@rowcat/ui-web/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@rowcat/ui-web/components/select";
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
import { SwitchField, TextAreaField } from "../fields.tsx";
import type { DraftAutosave } from "../use-autosave.ts";
import {
	isBlankLore,
	LORE_POSITION_OPTIONS,
	loreSummary,
	splitKeys,
} from "./lore-fields.ts";

/**
 * Collapsible edit card for one lore entry.
 *
 * It used to open the full field set for every entry, plus three icon buttons. Even past three
 * entries the editor became several screens tall, and scanning the list (which keywords are already
 * set) turned into scrolling work. Scanning and editing are different activities, so the card has
 * two states: collapsed to see which entries exist (keywords, one line of body, when it applies),
 * and expanded to edit one entry with the original fields.
 *
 * The save rules are unchanged. Every field still schedules through `autosave.patchLore`
 * immediately, and the keyword input remains uncontrolled (see below). Collapsing is display only.
 * It is not stored in IndexedDB or on the server, because it reflects what this tab is showing, not
 * something other devices need to know.
 */
export function LoreEditorCard({
	entry,
	index,
	total,
	autosave,
	layoutDependency,
	onMove,
	onRemove,
}: {
	entry: DraftLoreEntry;
	index: number;
	total: number;
	autosave: DraftAutosave;
	/**
	 * Layout dependency for the list order. It matters when a card actually moves; see `EditorSection`
	 * in `fields.tsx`.
	 */
	layoutDependency: unknown;
	onMove: (direction: -1 | 1) => void;
	onRemove: () => void;
}) {
	const { t } = useTranslation(["create", "common"]);
	const keysId = useId();
	const keysHintId = `${keysId}-hint`;
	const orderId = useId();
	const orderHintId = `${orderId}-hint`;
	const positionId = useId();
	const panelId = useId();

	/**
	 * An entry with nothing written yet starts expanded, so whoever pressed `Add` can type at once. The
	 * value is read only as the initial state, so clearing the content later does not make the card
	 * open by itself.
	 */
	const [expanded, setExpanded] = useState(() => isBlankLore(entry));

	const summary = loreSummary(entry);
	/**
	 * Keywords are edited as one comma-separated line, with no chip UI. Lore keywords are usually one
	 * or two, and chips would make each card take three layers. With several entries stacked, that
	 * would make the whole list hard to scan. The storage model is still an array.
	 */
	const keysText = entry.keys.join(", ");

	return (
		<m.article
			layout="position"
			layoutDependency={layoutDependency}
			exit={rowExit}
			transition={{ layout: layoutTransition }}
			// Not pressable while exiting. The guard is attached to presence rather than the frame (see
			// `exit-guard.ts`).
			style={useExitGuard()}
			className="rounded-md border p-3"
		>
			{/*
			 * The expand trigger and the management menu must be siblings. Nesting the menu inside the trigger
			 * creates a button inside a button; the browser then repairs the tree, and which control a press
			 * reaches becomes inconsistent.
			 */}
			<header className="flex items-start justify-between gap-2">
				<CardDisclosureButton
					expanded={expanded}
					panelId={panelId}
					onToggle={() => setExpanded((open) => !open)}
				>
					<span
						className={
							summary.hasKeys
								? "block truncate text-sm font-medium"
								: "block truncate text-sm font-medium text-muted-foreground"
						}
					>
						{summary.headline}
					</span>
					{/*
					 * The body preview is capped at two lines. A full body defeats collapsing. One line usually shows
					 * only the opening words, which makes similar entries indistinguishable. Clipping is done by CSS:
					 * clipping by character count would make that number the rule, and it would be wrong at other
					 * widths.
					 */}
					{entry.content.trim() !== "" && (
						<span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
							{entry.content}
						</span>
					)}
					<span className="mt-1 block text-xs text-muted-foreground">
						{[t("lore.nth", { n: index + 1 }), ...summary.meta].join(" · ")}
					</span>
				</CardDisclosureButton>

				{/*
				 * Up, down and delete moved into a menu. In a collapsed list, three permanent icon buttons on every
				 * card would stand out more than the summary, even though these actions are used only occasionally.
				 * The disabled edges are unchanged: the first entry's `Up` and the last entry's `Down`
				 * remain disabled.
				 */}
				<CardActionsMenu label={t("lore.manage", { n: index + 1 })}>
					<DropdownMenuItem disabled={index === 0} onClick={() => onMove(-1)}>
						<ChevronUp aria-hidden="true" />
						{t("loreEditorCard.up")}
					</DropdownMenuItem>
					<DropdownMenuItem
						disabled={index === total - 1}
						onClick={() => onMove(1)}
					>
						<ChevronDown aria-hidden="true" />
						{t("loreEditorCard.down")}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem variant="destructive" onClick={onRemove}>
						<Trash2 aria-hidden="true" />
						{t("loreEditorCard.deleteLore")}
					</DropdownMenuItem>
				</CardActionsMenu>
			</header>

			{expanded && (
				<CardDisclosurePanel id={panelId}>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={keysId}>{t("loreEditorCard.keywords")}</Label>
						<Input
							id={keysId}
							defaultValue={keysText}
							/*
							 * The field's rule (comma-separated, ignores case) exists only in the hint line below.
							 * Linking it with `aria-describedby` makes sure that focus on the field reads the hint too.
							 * Otherwise the user has no way to learn how to enter keywords.
							 */
							aria-describedby={keysHintId}
							placeholder={t("loreEditorCard.libraryLibrarian")}
							/**
							 * Only this field is uncontrolled (`defaultValue`). Writing the comma-split result back as
							 * the value would drop the trailing space typed after `library,` and make the caret jump.
							 * Uncontrolled, the DOM holds the typing, and the save model follows as an array.
							 *
							 * It still saves on every change. It used to save only on blur, so a user who typed a
							 * keyword and reloaded without leaving the field lost it. Every other field saves
							 * immediately, so this one was silently different, and the save indicator did not even
							 * switch to pending. Saving intermediate states is harmless, as with other fields (for
							 * example, `library, ` saved as `[library]`).
							 */
							onChange={(event) =>
								autosave.patchLore(entry.id, {
									keys: splitKeys(event.target.value),
								})
							}
							/** Also saves on blur, so the final value remains in normalized form. */
							onBlur={(event) =>
								autosave.patchLore(entry.id, {
									keys: splitKeys(event.target.value),
								})
							}
						/>
						<p id={keysHintId} className="text-xs text-muted-foreground">
							{t("loreEditorCard.separateWithCommasCaseDoesn")}
						</p>
					</div>

					<TextAreaField
						label={t("loreEditorCard.content")}
						value={entry.content}
						max={STORY_PUBLISH_LIMITS.loreContent}
						onChange={(content) => autosave.patchLore(entry.id, { content })}
					/>

					<SwitchField
						label={t("loreEditorCard.alwaysInclude")}
						checked={entry.constant}
						hint={t("loreEditorCard.whenOnItSSent")}
						onChange={(constant) => autosave.patchLore(entry.id, { constant })}
					/>

					<div className="flex flex-col gap-1.5">
						<Label htmlFor={orderId}>{t("loreEditorCard.priority")}</Label>
						<Input
							id={orderId}
							type="number"
							className="w-28"
							aria-describedby={orderHintId}
							defaultValue={entry.order}
							/**
							 * The order within the same injection position (higher first). It is a separate axis from
							 * list order: the list is the creator's management order, while this value controls
							 * placement within the prompt.
							 */
							onBlur={(event) => {
								const parsed = Number.parseInt(event.target.value, 10);
								autosave.patchLore(entry.id, {
									// A non-numeric value is saved as 0, since leaving the field empty is common.
									order: Number.isFinite(parsed) ? parsed : 0,
								});
							}}
						/>
						<p id={orderHintId} className="text-xs text-muted-foreground">
							{t("loreEditorCard.withinTheSamePositionHigher")}
						</p>
					</div>

					<div className="flex flex-col gap-1.5">
						{/* The label points at the trigger, so the accessible name comes from a single source. */}
						<Label htmlFor={positionId}>
							{t("loreEditorCard.insertionPosition")}
						</Label>
						<Select
							value={entry.position}
							items={LORE_POSITION_OPTIONS}
							onValueChange={(next) =>
								next !== null &&
								next !== entry.position &&
								autosave.patchLore(entry.id, {
									position: next as ChatLorePosition,
								})
							}
						>
							<SelectTrigger id={positionId} size="sm">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{LORE_POSITION_OPTIONS.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</CardDisclosurePanel>
			)}
		</m.article>
	);
}
