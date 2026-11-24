import type {
	ChatCreatorToolAction,
	ChatCreatorToolDto,
	ChatCustomToolDto,
	ChatToolParameterType,
} from "@rowcat/contracts/chat";
import {
	CHAT_CUSTOM_TOOL_LIMITS,
	ChatCreatorToolDto as ChatCreatorToolSchema,
} from "@rowcat/contracts/chat";
import type {
	AuthoringSoftDelete,
	AuthoringStamp,
	AuthoringSyncMeta,
} from "./model.ts";
import { freshSyncMeta } from "./model.ts";

/**
 * Creator tools: chat tools a creator writes into a work. Published, they travel in the seed
 * (`StoryChatSeedDto.tools`) and run in every conversation started from that work.
 *
 * A child record of the draft, like lore, for lore's reason: an unknown root key would be dropped
 * by older devices on decode and deleted by their next push, while an unknown record type is
 * ignored (docs/sync/ARCHITECTURE.md §19).
 *
 * The record is deliberately looser than the contract. A tool being written is usually invalid
 * (no description yet, an empty table), and autosave must still keep it. So the fields of every
 * action kind live side by side: switching a tool from template to agent does not throw away the
 * template text. Publishing narrows the record to the contract (`toCreatorTool`), and validation
 * names what is missing (`checkDraftTool`).
 *
 * `http` is not in the creator's vocabulary (`ChatCreatorToolDto`): a creator's endpoint would
 * receive excerpts of other people's conversations.
 */

export const DRAFT_TOOL_KINDS = ["template", "table", "agent"] as const;
export type DraftToolKind = (typeof DRAFT_TOOL_KINDS)[number];

export interface DraftToolParameter {
	name: string;
	type: ChatToolParameterType;
	description: string;
	required: boolean;
	/** Only meaningful for `string`. */
	choices: string[];
}

export interface DraftTool extends AuthoringSyncMeta, AuthoringSoftDelete {
	id: string;
	draftId: string;
	/** List order. */
	positionIndex: number;

	name: string;
	description: string;
	parameters: DraftToolParameter[];
	kind: DraftToolKind;
	/** `template` */
	template: string;
	/** `table` */
	entries: string[];
	draws: number;
	/** `agent`: the sub-agent's system prompt and output cap. */
	system: string;
	maxOutputTokens: number;

	createdAt: string;
	updatedAt: string;
}

export interface CreateDraftToolInput {
	draftId: string;
	positionIndex: number;
	name?: string;
	description?: string;
	parameters?: DraftToolParameter[];
	kind?: DraftToolKind;
	template?: string;
	entries?: string[];
	draws?: number;
	system?: string;
	maxOutputTokens?: number;
}

export type NewDraftTool = Omit<
	CreateDraftToolInput,
	"draftId" | "positionIndex"
>;

export type DraftToolPatch = Partial<
	Pick<
		DraftTool,
		| "name"
		| "description"
		| "parameters"
		| "kind"
		| "template"
		| "entries"
		| "draws"
		| "system"
		| "maxOutputTokens"
	>
>;

export const DRAFT_TOOL_DEFAULT_AGENT_OUTPUT_TOKENS = 1_024;

export function createDraftToolRecord(
	input: CreateDraftToolInput,
	stamp: AuthoringStamp,
): DraftTool {
	return {
		id: stamp.id,
		draftId: input.draftId,
		positionIndex: input.positionIndex,
		name: input.name ?? "",
		description: input.description ?? "",
		parameters: (input.parameters ?? []).map((parameter) => ({
			...parameter,
			choices: [...parameter.choices],
		})),
		kind: input.kind ?? "template",
		template: input.template ?? "",
		entries: input.entries ? [...input.entries] : [],
		draws: input.draws ?? 1,
		system: input.system ?? "",
		maxOutputTokens:
			input.maxOutputTokens ?? DRAFT_TOOL_DEFAULT_AGENT_OUTPUT_TOKENS,
		createdAt: stamp.now,
		updatedAt: stamp.now,
		deletedAt: null,
		...freshSyncMeta(stamp.rev),
	};
}

export const sortDraftTools = (items: DraftTool[]): DraftTool[] =>
	[...items].sort((a, b) =>
		a.positionIndex !== b.positionIndex
			? a.positionIndex - b.positionIndex
			: a.id < b.id
				? -1
				: 1,
	);

function actionOf(tool: DraftTool): ChatCreatorToolAction {
	switch (tool.kind) {
		case "template":
			return { kind: "template", template: tool.template.trim() };
		case "table":
			return {
				kind: "table",
				entries: tool.entries
					.map((entry) => entry.trim())
					.filter((entry) => entry.length > 0),
				draws: tool.draws,
			};
		case "agent":
			return {
				kind: "agent",
				system: tool.system.trim(),
				maxOutputTokens: tool.maxOutputTokens,
			};
	}
}

/**
 * The record narrowed to the published shape: trimmed, empty table rows removed, choices kept only
 * for string parameters. It does not validate; `checkDraftTool` does, and publishing runs both.
 */
export function toCreatorTool(tool: DraftTool): ChatCreatorToolDto {
	return {
		declaration: {
			name: tool.name.trim(),
			description: tool.description.trim(),
			parameters: tool.parameters.map((parameter) => ({
				name: parameter.name.trim(),
				type: parameter.type,
				description: parameter.description.trim(),
				required: parameter.required,
				choices:
					parameter.type === "string"
						? parameter.choices
								.map((choice) => choice.trim())
								.filter((choice) => choice.length > 0)
						: [],
			})),
		},
		action: actionOf(tool),
	};
}

/**
 * A user's library tool as a new draft tool: the bridge from Settings → Tools into a story. The
 * declaration and action are copied as values, not linked: a published work must not change when
 * its author later edits their own library, and a reader never has that library.
 *
 * `http` has no draft form (creators cannot publish one, see the header), so it returns `null` and
 * the picker says why rather than dropping the endpoint silently.
 */
export function newDraftToolOf(tool: ChatCustomToolDto): NewDraftTool | null {
	const { declaration, action } = tool;
	const base: NewDraftTool = {
		name: declaration.name,
		description: declaration.description,
		parameters: declaration.parameters.map((parameter) => ({
			name: parameter.name,
			type: parameter.type,
			description: parameter.description,
			required: parameter.required,
			choices: [...parameter.choices],
		})),
	};
	switch (action.kind) {
		case "template":
			return { ...base, kind: "template", template: action.template };
		case "table":
			return {
				...base,
				kind: "table",
				entries: [...action.entries],
				draws: action.draws,
			};
		case "agent":
			return {
				...base,
				kind: "agent",
				system: action.system,
				maxOutputTokens: action.maxOutputTokens,
			};
		case "http":
			return null;
	}
}

/**
 * Why a tool cannot be published, as a code rather than a sentence. The contract's own messages
 * (`Too small: expected string to have >=1 characters`) are schema vocabulary, and a creator reads
 * them next to a field they named differently. Each app turns a code into its own words, in its own
 * language; publication validation uses `draftToolIssueSentence` for the English issue list.
 *
 * `parameter` is the 1-based row for parameter issues, so the sentence can say which row.
 */
export const DRAFT_TOOL_ISSUE_CODES = [
	"name_invalid",
	"name_reserved",
	"name_taken",
	"description_required",
	"description_too_long",
	"too_many_parameters",
	"parameter_names_repeat",
	"parameter_name_invalid",
	"parameter_description_too_long",
	"parameter_choices_invalid",
	"template_required",
	"template_too_long",
	"entries_required",
	"too_many_entries",
	"entry_too_long",
	"draws_out_of_range",
	"system_required",
	"system_too_long",
	"max_output_tokens_out_of_range",
	"other",
] as const;
export type DraftToolIssueCode = (typeof DRAFT_TOOL_ISSUE_CODES)[number];

export interface DraftToolIssue {
	code: DraftToolIssueCode;
	/** 1-based parameter row, for `parameter_*` codes. */
	parameter?: number;
}

export type DraftToolCheck =
	| { ok: true; tool: ChatCreatorToolDto }
	| { ok: false; issues: DraftToolIssue[] };

interface SchemaIssue {
	code: string;
	path: readonly PropertyKey[];
}

const sizeCode = (
	issue: SchemaIssue,
	small: DraftToolIssueCode,
	big: DraftToolIssueCode,
): DraftToolIssueCode => (issue.code === "too_big" ? big : small);

/** One schema issue as a code. The path is the contract's (`declaration.*`, `action.*`). */
function issueOf(issue: SchemaIssue): DraftToolIssue {
	const [head, key, index, leaf] = issue.path;
	if (head === "declaration") {
		if (key === "name") return { code: "name_invalid" };
		if (key === "description")
			return {
				code: sizeCode(issue, "description_required", "description_too_long"),
			};
		if (key === "parameters") {
			if (typeof index !== "number")
				return {
					code:
						issue.code === "too_big"
							? "too_many_parameters"
							: "parameter_names_repeat",
				};
			const parameter = index + 1;
			if (leaf === "description")
				return { code: "parameter_description_too_long", parameter };
			if (leaf === "choices")
				return { code: "parameter_choices_invalid", parameter };
			return { code: "parameter_name_invalid", parameter };
		}
	}
	if (head === "action") {
		if (key === "template")
			return {
				code: sizeCode(issue, "template_required", "template_too_long"),
			};
		if (key === "entries")
			return typeof index === "number"
				? { code: "entry_too_long" }
				: { code: sizeCode(issue, "entries_required", "too_many_entries") };
		if (key === "draws") return { code: "draws_out_of_range" };
		if (key === "system")
			return { code: sizeCode(issue, "system_required", "system_too_long") };
		if (key === "maxOutputTokens")
			return { code: "max_output_tokens_out_of_range" };
	}
	return { code: "other" };
}

/** Same code twice (two rows over the cap) reads as one line. */
function dedupeIssues(issues: DraftToolIssue[]): DraftToolIssue[] {
	const seen = new Set<string>();
	return issues.filter((issue) => {
		const key = `${issue.code}:${issue.parameter ?? ""}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/**
 * Whether this tool can be published, using the contract's own schema so the editor and the server
 * cannot disagree. Issues are codes (`DraftToolIssue`); the reserved name is checked here too, so
 * the card says it before the publish button does.
 */
export function checkDraftTool(tool: DraftTool): DraftToolCheck {
	const parsed = ChatCreatorToolSchema.safeParse(toCreatorTool(tool));
	const reserved = DRAFT_TOOL_RESERVED_NAMES.includes(tool.name.trim());
	if (parsed.success && !reserved) return { ok: true, tool: parsed.data };
	const issues = parsed.success ? [] : parsed.error.issues.map(issueOf);
	if (reserved) issues.unshift({ code: "name_reserved" });
	return { ok: false, issues: dedupeIssues(issues) };
}

const limits = CHAT_CUSTOM_TOOL_LIMITS;

/**
 * The English sentence for a code: publication validation's issue list, whose other entries are
 * English product copy too (`validation.ts`). The editors word codes themselves.
 */
export function draftToolIssueSentence(issue: DraftToolIssue): string {
	const row = issue.parameter ?? 0;
	switch (issue.code) {
		case "name_invalid":
			return "The name must start with a lowercase letter and use only lowercase letters, digits and underscores (up to 48).";
		case "name_reserved":
			return "This name is built in. Choose another.";
		case "name_taken":
			return "Another tool in this story already uses this name.";
		case "description_required":
			return "Describe when the AI should use this tool.";
		case "description_too_long":
			return "The description is too long.";
		case "too_many_parameters":
			return "A tool can have up to 6 parameters.";
		case "parameter_names_repeat":
			return "Two parameters have the same name.";
		case "parameter_name_invalid":
			return `Parameter ${row} needs a name: lowercase letters, digits and underscores, starting with a letter.`;
		case "parameter_description_too_long":
			return `Parameter ${row}'s description is too long.`;
		case "parameter_choices_invalid":
			return `Parameter ${row} has too many choices or a choice that is too long.`;
		case "template_required":
			return "Write the template text.";
		case "template_too_long":
			return `The template can be up to ${limits.templateChars.toLocaleString("en-US")} characters.`;
		case "entries_required":
			return "Add at least one row to the table.";
		case "too_many_entries":
			return `The table can have up to ${limits.tableEntries} rows.`;
		case "entry_too_long":
			return `A table row can be up to ${limits.tableEntryChars.toLocaleString("en-US")} characters.`;
		case "draws_out_of_range":
			return `Draw between 1 and ${limits.tableMaxDraws} rows.`;
		case "system_required":
			return "Write the sub-agent's instructions.";
		case "system_too_long":
			return `The sub-agent's instructions can be up to ${limits.agentSystemChars.toLocaleString("en-US")} characters.`;
		case "max_output_tokens_out_of_range":
			return `The answer length must be between 1 and ${limits.agentMaxOutputTokens.toLocaleString("en-US")} tokens.`;
		case "other":
			return "Something in this tool isn't valid yet.";
	}
}

export { CHAT_CUSTOM_TOOL_LIMITS as DRAFT_TOOL_LIMITS };

/**
 * Names a creator tool cannot take: the built-in lore search wins that name in every room. Spelled
 * here rather than imported because this package does not depend on @rowcat/chat; the chat
 * package's `CHAT_RESERVED_TOOL_NAMES` holds the same value, and a test pins the two together.
 */
export const DRAFT_TOOL_RESERVED_NAMES: readonly string[] = ["lore_search"];
