import {
	checkDraftTool,
	DRAFT_TOOL_KINDS,
	DRAFT_TOOL_LIMITS,
	type DraftTool,
	type DraftToolIssue,
	type DraftToolKind,
	type DraftToolParameter,
} from "@rowcat/authoring";
import {
	CHAT_MAX_TOOL_PARAMETERS,
	CHAT_TOOL_PARAMETER_TYPES,
	type ChatToolParameterType,
} from "@rowcat/contracts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Vocabulary and pure rules for a creator tool card: what a collapsed card says, the option tables,
 * and the conversions between the record's arrays and the text boxes that edit them. They live
 * outside the component for lore's reason (`lore-fields.ts`): each one is a judgement that fails
 * silently, and must be checkable without rendering.
 *
 * Nothing here validates. Whether a tool can be published is `checkDraftTool`, the contract's own
 * schema, so the card and the server cannot disagree.
 */

export const toolKindLabel = (kind: DraftToolKind): string =>
	translator("create")(`tool.kind.${kind}`);

/** Kinds in the order they are offered: simplest first, the one that spends tokens last. */
export const TOOL_KIND_OPTIONS = (): {
	value: DraftToolKind;
	label: string;
}[] =>
	DRAFT_TOOL_KINDS.map((value) => ({ value, label: toolKindLabel(value) }));

export const toolParameterTypeLabel = (type: ChatToolParameterType): string =>
	translator("create")(`tool.parameterType.${type}`);

export const TOOL_PARAMETER_TYPE_OPTIONS = (): {
	value: ChatToolParameterType;
	label: string;
}[] =>
	CHAT_TOOL_PARAMETER_TYPES.map((value) => ({
		value,
		label: toolParameterTypeLabel(value),
	}));

/**
 * Table rows are edited as one text box, a row per line. The split keeps empty lines: dropping them
 * while typing would eat the line break the creator just pressed, because the box is redrawn from
 * the record. `toCreatorTool` drops blank rows at publish, so a blank line costs nothing.
 *
 * `joinRows(splitRows(text)) === text` for every text, which is what lets the box be controlled.
 */
export const splitRows = (text: string): string[] => text.split("\n");
export const joinRows = (rows: readonly string[]): string => rows.join("\n");

/**
 * Choices are edited as one comma-separated line, for the same reason and with the same exactness:
 * the raw pieces are stored untrimmed, so `library, ` stays `library, ` on screen while the caret is
 * after the space. Publishing trims and drops the blanks (`toCreatorTool`).
 */
export const splitChoices = (text: string): string[] =>
	text === "" ? [] : text.split(",");
export const joinChoices = (choices: readonly string[]): string =>
	choices.join(",");

/** A parameter as `Add parameter` creates it: optional text with no constraint. */
export const blankToolParameter = (): DraftToolParameter => ({
	name: "",
	type: "string",
	description: "",
	required: false,
	choices: [],
});

/**
 * Parameters are one array on the record, so the card edits the whole array and compares by value.
 * Identity would differ on every record the live query delivers, and the edited-value rule would
 * then take each delivery as someone else's edit.
 */
export const sameParameters = (
	a: readonly DraftToolParameter[],
	b: readonly DraftToolParameter[],
): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Whether the creator has written anything yet; a blank tool starts expanded. */
export const isBlankTool = (tool: DraftTool): boolean =>
	tool.name.trim() === "" &&
	tool.description.trim() === "" &&
	tool.template.trim() === "" &&
	tool.system.trim() === "" &&
	tool.entries.every((entry) => entry.trim() === "") &&
	tool.parameters.length === 0;

export interface ToolSummary {
	/** The tool's name, or a dimmed fallback when it has none. */
	headline: string;
	hasName: boolean;
	/** Kind and parameter count: what a curator scans for. */
	meta: string[];
	/**
	 * What stops this tool from being published, as sentences (`toolIssueText`). Empty when it is ready. The
	 * card shows these while the creator writes, so the publish button is not the first place they
	 * learn a tool will be left out.
	 */
	issues: string[];
}

export function toolSummary(tool: DraftTool): ToolSummary {
	const t = translator("create");
	const name = tool.name.trim();
	const checked = checkDraftTool(tool);
	return {
		headline: name || t("tool.unnamed"),
		hasName: name !== "",
		meta: [
			toolKindLabel(tool.kind),
			...(tool.parameters.length > 0
				? [t("tool.parameterCount", { count: tool.parameters.length })]
				: []),
			...(checked.ok ? [] : [t("tool.notReady")]),
		],
		issues: checked.ok ? [] : checked.issues.map(toolIssueText),
	};
}

/**
 * Parses a number box on blur. Anything unreadable falls back to the given value rather than 0: a
 * draw count or token cap of 0 is never valid, and saving it would turn a typo into a publish issue.
 */
export function parseWholeNumber(text: string, fallback: number): number {
	const parsed = Number.parseInt(text, 10);
	return Number.isFinite(parsed) ? parsed : fallback;
}

/** The cap each code's sentence names, so the words and the contract cannot disagree. */
const ISSUE_MAX: Partial<Record<DraftToolIssue["code"], number>> = {
	too_many_parameters: CHAT_MAX_TOOL_PARAMETERS,
	template_too_long: DRAFT_TOOL_LIMITS.templateChars,
	too_many_entries: DRAFT_TOOL_LIMITS.tableEntries,
	entry_too_long: DRAFT_TOOL_LIMITS.tableEntryChars,
	draws_out_of_range: DRAFT_TOOL_LIMITS.tableMaxDraws,
	system_too_long: DRAFT_TOOL_LIMITS.agentSystemChars,
	max_output_tokens_out_of_range: DRAFT_TOOL_LIMITS.agentMaxOutputTokens,
};

/**
 * One issue as a sentence in the reader's language. The code comes from `checkDraftTool`; the
 * contract's own messages never reach the screen, since they name schema paths the creator never
 * saw.
 */
export function toolIssueText(issue: DraftToolIssue): string {
	const max = ISSUE_MAX[issue.code];
	return translator("create")(`toolIssue.${issue.code}`, {
		row: issue.parameter ?? 0,
		max: max === undefined ? "" : max.toLocaleString(),
	});
}
