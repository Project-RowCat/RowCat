import {
	DRAFT_TOOL_LIMITS,
	type DraftTool,
	type DraftToolKind,
	type DraftToolParameter,
} from "@rowcat/authoring";
import {
	CHAT_MAX_TOOL_DESCRIPTION_CHARS,
	CHAT_MAX_TOOL_PARAMETERS,
	type ChatToolParameterType,
} from "@rowcat/contracts";
import { Button } from "@rowcat/ui-web/components/button";
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
import { Switch } from "@rowcat/ui-web/components/switch";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
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
import { useEditedValue } from "../edited-value.ts";
import { TextAreaField, TextField } from "../fields.tsx";
import type { DraftAutosave } from "../use-autosave.ts";
import {
	blankToolParameter,
	isBlankTool,
	joinChoices,
	joinRows,
	parseWholeNumber,
	sameParameters,
	splitChoices,
	splitRows,
	TOOL_KIND_OPTIONS,
	TOOL_PARAMETER_TYPE_OPTIONS,
	toolSummary,
} from "./tool-fields.ts";

/**
 * Collapsible edit card for one creator tool. Same two states as a lore card: collapsed to scan
 * which tools exist (name, kind, whether it is ready), expanded to edit one.
 *
 * Every field saves through `autosave.patchTool` as it is typed, like lore. The record keeps every
 * kind's fields side by side (`draft-tool.ts`), so switching the kind hides the other kind's fields
 * without clearing them; switching back brings the text back.
 *
 * What blocks publishing is shown on the card, from `checkDraftTool` (the contract's own schema).
 * The issue lines are the contract's English messages with their field path, the same lines the
 * publish panel lists; a second, translated copy of the rules here would drift from the one the
 * server enforces.
 */
export function ToolEditorCard({
	tool,
	index,
	total,
	autosave,
	layoutDependency,
	onMove,
	onRemove,
}: {
	tool: DraftTool;
	index: number;
	total: number;
	autosave: DraftAutosave;
	/** Layout dependency for the list order (`EditorSection` in `fields.tsx`). */
	layoutDependency: unknown;
	onMove: (direction: -1 | 1) => void;
	onRemove: () => void;
}) {
	const { t } = useTranslation(["create", "common"]);
	const kindId = useId();
	const numberId = useId();
	const numberHintId = `${numberId}-hint`;
	const panelId = useId();

	/** A tool with nothing written yet starts expanded, so `Add` leads straight to typing. */
	const [expanded, setExpanded] = useState(() => isBlankTool(tool));
	const summary = toolSummary(tool);

	const patch = (next: Parameters<DraftAutosave["patchTool"]>[1]) =>
		autosave.patchTool(tool.id, next);

	return (
		<m.article
			layout="position"
			layoutDependency={layoutDependency}
			exit={rowExit}
			transition={{ layout: layoutTransition }}
			style={useExitGuard()}
			className="rounded-md border p-3"
		>
			{/* The trigger and the menu are siblings, never nested (see `LoreEditorCard`). */}
			<header className="flex items-start justify-between gap-2">
				<CardDisclosureButton
					expanded={expanded}
					panelId={panelId}
					onToggle={() => setExpanded((open) => !open)}
				>
					<span
						className={
							summary.hasName
								? "block truncate font-mono text-sm font-medium"
								: "block truncate text-sm font-medium text-muted-foreground"
						}
					>
						{summary.headline}
					</span>
					{tool.description.trim() !== "" && (
						<span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
							{tool.description}
						</span>
					)}
					<span className="mt-1 block text-xs text-muted-foreground">
						{[t("tool.nth", { n: index + 1 }), ...summary.meta].join(" · ")}
					</span>
				</CardDisclosureButton>

				<CardActionsMenu label={t("tool.manage", { n: index + 1 })}>
					<DropdownMenuItem disabled={index === 0} onClick={() => onMove(-1)}>
						<ChevronUp aria-hidden="true" />
						{t("toolEditorCard.up")}
					</DropdownMenuItem>
					<DropdownMenuItem
						disabled={index === total - 1}
						onClick={() => onMove(1)}
					>
						<ChevronDown aria-hidden="true" />
						{t("toolEditorCard.down")}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem variant="destructive" onClick={onRemove}>
						<Trash2 aria-hidden="true" />
						{t("toolEditorCard.deleteTool")}
					</DropdownMenuItem>
				</CardActionsMenu>
			</header>

			{expanded && (
				<CardDisclosurePanel id={panelId}>
					{summary.issues.length > 0 && (
						/**
						 * Not an alert: an incomplete tool is the normal state while writing, and announcing it on
						 * every keystroke would be noise. It is a plain note the creator can read when they look.
						 */
						<div className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
							<p className="font-medium">{t("toolEditorCard.issues")}</p>
							<ul className="mt-1 list-disc pl-4">
								{summary.issues.map((issue) => (
									<li key={issue}>{issue}</li>
								))}
							</ul>
						</div>
					)}

					<TextField
						label={t("toolEditorCard.name")}
						value={tool.name}
						placeholder="harbor_weather"
						hint={t("toolEditorCard.nameHint")}
						onChange={(name) => patch({ name })}
					/>
					<TextAreaField
						label={t("toolEditorCard.description")}
						value={tool.description}
						rows={2}
						max={CHAT_MAX_TOOL_DESCRIPTION_CHARS}
						hint={t("toolEditorCard.descriptionHint")}
						onChange={(description) => patch({ description })}
					/>

					<ToolParameters tool={tool} autosave={autosave} />

					<div className="flex flex-col gap-1.5">
						<Label htmlFor={kindId}>{t("toolEditorCard.kind")}</Label>
						<Select
							value={tool.kind}
							items={TOOL_KIND_OPTIONS()}
							onValueChange={(next) =>
								next !== null &&
								next !== tool.kind &&
								patch({ kind: next as DraftToolKind })
							}
						>
							<SelectTrigger id={kindId} size="sm">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{TOOL_KIND_OPTIONS().map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{tool.kind === "template" && (
						<TextAreaField
							label={t("toolEditorCard.template")}
							value={tool.template}
							max={DRAFT_TOOL_LIMITS.templateChars}
							hint={t("toolEditorCard.templateHint", { example: "{{place}}" })}
							onChange={(template) => patch({ template })}
						/>
					)}

					{tool.kind === "table" && (
						<>
							<TextAreaField
								label={t("toolEditorCard.entries")}
								value={joinRows(tool.entries)}
								rows={6}
								hint={t("toolEditorCard.entriesHint")}
								onChange={(text) => patch({ entries: splitRows(text) })}
							/>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor={numberId}>{t("toolEditorCard.draws")}</Label>
								<Input
									/**
									 * Keyed per field so the box that replaces the agent's token cap starts from this
									 * field's own value rather than keeping the other one's DOM text.
									 */
									key="draws"
									id={numberId}
									type="number"
									min={1}
									max={DRAFT_TOOL_LIMITS.tableMaxDraws}
									className="w-28"
									aria-describedby={numberHintId}
									defaultValue={tool.draws}
									/** Saved on blur like lore's priority: a half-typed number is not a value. */
									onBlur={(event) =>
										patch({
											draws: parseWholeNumber(event.target.value, tool.draws),
										})
									}
								/>
								<p id={numberHintId} className="text-xs text-muted-foreground">
									{t("toolEditorCard.drawsHint", {
										max: DRAFT_TOOL_LIMITS.tableMaxDraws,
									})}
								</p>
							</div>
						</>
					)}

					{tool.kind === "agent" && (
						<>
							<TextAreaField
								label={t("toolEditorCard.system")}
								value={tool.system}
								rows={6}
								max={DRAFT_TOOL_LIMITS.agentSystemChars}
								hint={t("toolEditorCard.systemHint")}
								onChange={(system) => patch({ system })}
							/>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor={numberId}>
									{t("toolEditorCard.maxOutputTokens")}
								</Label>
								<Input
									key="maxOutputTokens"
									id={numberId}
									type="number"
									min={1}
									max={DRAFT_TOOL_LIMITS.agentMaxOutputTokens}
									className="w-28"
									aria-describedby={numberHintId}
									defaultValue={tool.maxOutputTokens}
									onBlur={(event) =>
										patch({
											maxOutputTokens: parseWholeNumber(
												event.target.value,
												tool.maxOutputTokens,
											),
										})
									}
								/>
								<p id={numberHintId} className="text-xs text-muted-foreground">
									{t("toolEditorCard.maxOutputTokensHint", {
										max: DRAFT_TOOL_LIMITS.agentMaxOutputTokens,
									})}
								</p>
							</div>
						</>
					)}
				</CardDisclosurePanel>
			)}
		</m.article>
	);
}

/**
 * The parameter rows. The record holds them as one array, so the screen owns a copy of the whole
 * array (`useEditedValue`, compared by value) and every edit saves the whole array. Owning each
 * field separately would need a stable identity per row, which the record does not have, and a
 * removed row would hand its neighbour's text to the wrong box.
 */
function ToolParameters({
	tool,
	autosave,
}: {
	tool: DraftTool;
	autosave: DraftAutosave;
}) {
	const { t } = useTranslation(["create", "common"]);
	const hintId = useId();
	const [parameters, edit] = useEditedValue(
		tool.parameters,
		(next) => autosave.patchTool(tool.id, { parameters: next }),
		sameParameters,
	);
	const full = parameters.length >= CHAT_MAX_TOOL_PARAMETERS;

	const update = (at: number, change: Partial<DraftToolParameter>) =>
		edit(
			parameters.map((parameter, index) =>
				index === at ? { ...parameter, ...change } : parameter,
			),
		);

	return (
		/**
		 * A fieldset, so a screen reader announces "Parameters" on entering any row. The legend must be
		 * its first child, so the add button sits on the hint's row rather than the heading's.
		 */
		<fieldset className="flex flex-col gap-2" aria-describedby={hintId}>
			<legend className="text-sm font-medium">
				{t("toolEditorCard.parameters")}
			</legend>
			<div className="flex items-center justify-between gap-2">
				<p id={hintId} className="text-xs text-muted-foreground">
					{parameters.length === 0
						? t("toolEditorCard.noParameters")
						: t("toolEditorCard.parametersHint")}
				</p>
				<Button
					size="sm"
					variant="outline"
					disabled={full}
					onClick={() => edit([...parameters, blankToolParameter()])}
				>
					<Plus aria-hidden="true" />
					{t("toolEditorCard.addParameter")}
				</Button>
			</div>
			{parameters.map((parameter, index) => (
				<ToolParameterRow
					// Rows have no identity of their own; position is the only stable key there is.
					// biome-ignore lint/suspicious/noArrayIndexKey: see above.
					key={index}
					index={index}
					parameter={parameter}
					onChange={(change) => update(index, change)}
					onRemove={() =>
						edit(parameters.filter((_, position) => position !== index))
					}
				/>
			))}
		</fieldset>
	);
}

function ToolParameterRow({
	index,
	parameter,
	onChange,
	onRemove,
}: {
	index: number;
	parameter: DraftToolParameter;
	onChange: (change: Partial<DraftToolParameter>) => void;
	onRemove: () => void;
}) {
	const { t } = useTranslation(["create", "common"]);
	const id = useId();
	return (
		<div className="flex flex-col gap-2 rounded-md bg-muted/40 p-2">
			<div className="flex flex-wrap items-end gap-2">
				<div className="flex min-w-32 flex-1 flex-col gap-1">
					<Label htmlFor={`${id}-name`} className="text-xs">
						{t("toolEditorCard.parameterName")}
					</Label>
					<Input
						id={`${id}-name`}
						value={parameter.name}
						placeholder="place"
						className="font-mono"
						onChange={(event) => onChange({ name: event.target.value })}
					/>
				</div>
				<div className="flex flex-col gap-1">
					<Label htmlFor={`${id}-type`} className="text-xs">
						{t("toolEditorCard.parameterType")}
					</Label>
					<Select
						value={parameter.type}
						items={TOOL_PARAMETER_TYPE_OPTIONS()}
						onValueChange={(next) =>
							next !== null &&
							next !== parameter.type &&
							onChange({ type: next as ChatToolParameterType })
						}
					>
						<SelectTrigger id={`${id}-type`} size="sm">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{TOOL_PARAMETER_TYPE_OPTIONS().map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex items-center gap-2 pb-2">
					<Switch
						id={`${id}-required`}
						size="sm"
						checked={parameter.required}
						onCheckedChange={(required) => onChange({ required })}
					/>
					<Label htmlFor={`${id}-required`} className="text-xs">
						{t("toolEditorCard.parameterRequired")}
					</Label>
				</div>
				<Button
					size="icon-sm"
					variant="ghost"
					aria-label={t("toolEditorCard.removeParameter", { n: index + 1 })}
					onClick={onRemove}
				>
					<Trash2 aria-hidden="true" />
				</Button>
			</div>
			<div className="flex flex-col gap-1">
				<Label htmlFor={`${id}-description`} className="text-xs">
					{t("toolEditorCard.parameterDescription")}
				</Label>
				<Input
					id={`${id}-description`}
					value={parameter.description}
					maxLength={CHAT_MAX_TOOL_DESCRIPTION_CHARS}
					onChange={(event) => onChange({ description: event.target.value })}
				/>
			</div>
			{/* Choices constrain text only; the other types ignore them, so the box is not offered. */}
			{parameter.type === "string" && (
				<div className="flex flex-col gap-1">
					<Label htmlFor={`${id}-choices`} className="text-xs">
						{t("toolEditorCard.parameterChoices")}
					</Label>
					<Input
						id={`${id}-choices`}
						value={joinChoices(parameter.choices)}
						aria-describedby={`${id}-choices-hint`}
						onChange={(event) =>
							onChange({ choices: splitChoices(event.target.value) })
						}
					/>
					<p
						id={`${id}-choices-hint`}
						className="text-xs text-muted-foreground"
					>
						{t("toolEditorCard.parameterChoicesHint")}
					</p>
				</div>
			)}
		</div>
	);
}
