import {
	CHAT_RESERVED_TOOL_NAMES,
	type ChatToolImportStatus,
	type ChatUserTool,
	checkUserToolDefinition,
	userToolNameTaken,
} from "@rowcat/chat";
import {
	CHAT_CUSTOM_TOOL_LIMITS,
	CHAT_MAX_TOOL_DESCRIPTION_CHARS,
	CHAT_MAX_TOOL_PARAMETER_CHOICES,
	CHAT_MAX_TOOL_PARAMETERS,
	type ChatCustomToolDto,
	type ChatCustomToolKind,
	type ChatToolParameterType,
} from "@rowcat/contracts/chat";
import { translator } from "#/lib/i18n/current.ts";

/**
 * The tool editor's model: what the form holds, how it becomes a definition, and how the
 * definition's issues become sentences next to the field that caused them.
 *
 * The rules are not here. A definition is valid exactly when `checkUserToolDefinition` says so (the
 * contract's schema plus the reserved names), and the store runs the same check again. This file
 * only translates between typing and that check, so the form can never accept something the store
 * would refuse, or refuse something it would accept.
 *
 * Why a separate draft shape instead of editing the DTO directly:
 * - Numbers are typed as text. Holding `draws` as a number would turn an emptied field into 0 or
 *   NaN while the person is still typing.
 * - Rows, choices and headers are edited as lines and rows. The DTO's arrays are what they become.
 * - Switching the kind keeps the other kinds' fields. Someone who flips to "Sub-agent" to look and
 *   back to "Template" must not lose the template they wrote; only the chosen kind is saved.
 */

export interface ToolParameterDraft {
	/** A stable React key; never saved. */
	key: string;
	name: string;
	type: ChatToolParameterType;
	description: string;
	required: boolean;
	/** One allowed value per line. Saved only for text parameters. */
	choices: string;
}

export interface ToolHeaderDraft {
	key: string;
	name: string;
	value: string;
}

export interface ToolFormDraft {
	name: string;
	description: string;
	parameters: ToolParameterDraft[];
	kind: ChatCustomToolKind;
	template: string;
	/** One row per line. */
	entries: string;
	draws: string;
	system: string;
	maxOutputTokens: string;
	url: string;
	method: "GET" | "POST";
	headers: ToolHeaderDraft[];
	enabledByDefault: boolean;
}

let keySequence = 0;
/** Keys only need to be unique within one open form. */
export const nextDraftKey = (): string => `k${++keySequence}`;

export const emptyParameterDraft = (): ToolParameterDraft => ({
	key: nextDraftKey(),
	name: "",
	type: "string",
	description: "",
	required: false,
	choices: "",
});

export const emptyHeaderDraft = (): ToolHeaderDraft => ({
	key: nextDraftKey(),
	name: "",
	value: "",
});

/**
 * A new tool starts as a template, the kind with no side effects and no cost, and on by default:
 * the store's default too (`createUserToolRecord`), because a person who writes a tool usually
 * wants to use it. The numeric defaults are the contract's own defaults.
 */
export function emptyToolDraft(): ToolFormDraft {
	return {
		name: "",
		description: "",
		parameters: [],
		kind: "template",
		template: "",
		entries: "",
		draws: "1",
		system: "",
		maxOutputTokens: "1024",
		url: "",
		method: "POST",
		headers: [],
		enabledByDefault: true,
	};
}

/** The form for an existing tool: its own kind filled in, the other kinds at their defaults. */
export function toolDraftOf(tool: ChatUserTool): ToolFormDraft {
	const draft = emptyToolDraft();
	const { declaration, action } = tool.tool;
	draft.name = declaration.name;
	draft.description = declaration.description;
	draft.parameters = declaration.parameters.map((parameter) => ({
		key: nextDraftKey(),
		name: parameter.name,
		type: parameter.type,
		description: parameter.description,
		required: parameter.required,
		choices: parameter.choices.join("\n"),
	}));
	draft.kind = action.kind;
	draft.enabledByDefault = tool.enabledByDefault;
	switch (action.kind) {
		case "template":
			draft.template = action.template;
			break;
		case "table":
			draft.entries = action.entries.join("\n");
			draft.draws = String(action.draws);
			break;
		case "agent":
			draft.system = action.system;
			draft.maxOutputTokens = String(action.maxOutputTokens);
			break;
		case "http":
			draft.url = action.url;
			draft.method = action.method;
			draft.headers = action.headers.map((header) => ({
				key: nextDraftKey(),
				name: header.name,
				value: header.value,
			}));
			break;
	}
	return draft;
}

/** Non-empty trimmed lines. Blank lines between rows are layout, not empty rows. */
const lines = (text: string): string[] =>
	text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

/**
 * Text to number. An empty or non-numeric field becomes NaN, which the schema rejects with the
 * field's own path, rather than 0, which it would reject with a misleading "too small".
 */
const numberOf = (text: string): number =>
	text.trim() === "" ? Number.NaN : Number(text.trim());

/**
 * The candidate definition, unchecked. Names and URLs are trimmed because a stray space typed at
 * the end would otherwise fail the name pattern with no visible cause; prose (descriptions,
 * templates, instructions) is kept as written, since its whitespace can be deliberate.
 */
export function toolCandidateOf(draft: ToolFormDraft): unknown {
	const declaration = {
		name: draft.name.trim(),
		description: draft.description,
		parameters: draft.parameters.map((parameter) => ({
			name: parameter.name.trim(),
			type: parameter.type,
			description: parameter.description,
			required: parameter.required,
			choices: parameter.type === "string" ? lines(parameter.choices) : [],
		})),
	};
	switch (draft.kind) {
		case "template":
			return {
				declaration,
				action: { kind: "template", template: draft.template },
			};
		case "table":
			return {
				declaration,
				action: {
					kind: "table",
					entries: lines(draft.entries),
					draws: numberOf(draft.draws),
				},
			};
		case "agent":
			return {
				declaration,
				action: {
					kind: "agent",
					system: draft.system,
					maxOutputTokens: numberOf(draft.maxOutputTokens),
				},
			};
		case "http":
			return {
				declaration,
				action: {
					kind: "http",
					url: draft.url.trim(),
					method: draft.method,
					headers: draft.headers.map((header) => ({
						name: header.name.trim(),
						value: header.value,
					})),
				},
			};
	}
}

/**
 * Where an issue is shown. `parameter:N` and `header:N` sit under that row; `form` collects what has
 * no single field.
 */
export type ToolFormField =
	| "name"
	| "description"
	| "parameters"
	| `parameter:${number}`
	| "template"
	| "entries"
	| "draws"
	| "system"
	| "maxOutputTokens"
	| "url"
	| "headers"
	| `header:${number}`
	| "form";

export interface ToolFormIssue {
	field: ToolFormField;
	message: string;
}

export type ToolFormCheck =
	| { ok: true; tool: ChatCustomToolDto }
	| { ok: false; issues: ToolFormIssue[] };

/**
 * One contract issue (`path: message`, from `checkUserToolDefinition`) as a sentence in the render's
 * locale, placed on its field. The contract's messages are English developer text; the path is
 * what carries the meaning, so the sentence is chosen by path. A path this table does not know
 * falls back to the raw text rather than disappearing: an unexplained "can't save" is worse than an
 * English sentence.
 */
export function toolFormIssueOf(raw: string): ToolFormIssue {
	const t = translator("tools");
	const split = raw.indexOf(": ");
	const path = split === -1 ? "" : raw.slice(0, split);
	const segments = path.split(".");
	const [root, key, index, leaf] = segments;
	const position = Number(index) + 1;

	if (root === "declaration") {
		if (key === "name") return { field: "name", message: t("issue.name") };
		if (key === "description")
			return {
				field: "description",
				message: t("issue.description", {
					max: CHAT_MAX_TOOL_DESCRIPTION_CHARS,
				}),
			};
		if (key === "parameters") {
			if (index === undefined)
				return raw.includes("repeat")
					? { field: "parameters", message: t("issue.parameterNamesRepeat") }
					: {
							field: "parameters",
							message: t("issue.tooManyParameters", {
								max: CHAT_MAX_TOOL_PARAMETERS,
							}),
						};
			const field: ToolFormField = `parameter:${Number(index)}`;
			if (leaf === "description")
				return {
					field,
					message: t("issue.parameterDescription", {
						index: position,
						max: CHAT_MAX_TOOL_DESCRIPTION_CHARS,
					}),
				};
			if (leaf === "choices")
				return {
					field,
					message: t("issue.parameterChoices", {
						index: position,
						max: CHAT_MAX_TOOL_PARAMETER_CHOICES,
					}),
				};
			return { field, message: t("issue.parameterName", { index: position }) };
		}
	}
	if (root === "action") {
		const limits = CHAT_CUSTOM_TOOL_LIMITS;
		switch (key) {
			case "template":
				return {
					field: "template",
					message: t("issue.template", { max: limits.templateChars }),
				};
			case "entries":
				return {
					field: "entries",
					message: t("issue.entries", {
						max: limits.tableEntries,
						chars: limits.tableEntryChars,
					}),
				};
			case "draws":
				return {
					field: "draws",
					message: t("issue.draws", { max: limits.tableMaxDraws }),
				};
			case "system":
				return {
					field: "system",
					message: t("issue.system", { max: limits.agentSystemChars }),
				};
			case "maxOutputTokens":
				return {
					field: "maxOutputTokens",
					message: t("issue.maxOutputTokens", {
						max: limits.agentMaxOutputTokens,
					}),
				};
			case "url":
				return { field: "url", message: t("issue.url") };
			case "headers": {
				if (index === undefined)
					return {
						field: "headers",
						message: t("issue.tooManyHeaders", { max: limits.headers }),
					};
				const field: ToolFormField = `header:${Number(index)}`;
				return leaf === "value"
					? {
							field,
							message: t("issue.headerValue", {
								index: position,
								max: limits.headerValueChars,
							}),
						}
					: { field, message: t("issue.headerName", { index: position }) };
			}
		}
	}
	return { field: "form", message: t("issue.other", { detail: raw }) };
}

/**
 * The whole check the save button runs: the contract (through the shared gate), then the two rules
 * that need the library or the reserved list. Reserved names are reported as their own sentence
 * because the contract's gate reports them on the same path as a malformed name, and "use
 * lowercase letters" would be wrong advice for `lore_search`.
 */
export function checkToolDraft(
	draft: ToolFormDraft,
	library: readonly ChatUserTool[],
	exceptId?: string,
): ToolFormCheck {
	const name = draft.name.trim();
	if (CHAT_RESERVED_TOOL_NAMES.includes(name))
		return {
			ok: false,
			issues: [
				{ field: "name", message: translator("tools")("issue.nameReserved") },
			],
		};
	const checked = checkUserToolDefinition(toolCandidateOf(draft));
	const issues: ToolFormIssue[] = checked.ok
		? []
		: dedupe(checked.issues.map(toolFormIssueOf));
	if (userToolNameTaken(library, name, exceptId))
		issues.unshift({
			field: "name",
			message: translator("tools")("issue.nameTaken"),
		});
	if (issues.length > 0 || !checked.ok) return { ok: false, issues };
	return { ok: true, tool: checked.tool };
}

/** One sentence per field and message: a table with ten long rows would otherwise say it ten times. */
function dedupe(issues: ToolFormIssue[]): ToolFormIssue[] {
	const seen = new Set<string>();
	return issues.filter((issue) => {
		const key = `${issue.field}\u0000${issue.message}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** The issues for one field, for the line under it. */
export const issuesFor = (
	issues: readonly ToolFormIssue[],
	field: ToolFormField,
): string[] =>
	issues.filter((issue) => issue.field === field).map((issue) => issue.message);

// ─── Copy ───────────────────────────────────────────────────────────────────────────────────────

export const toolKindLabel = (kind: ChatCustomToolKind): string =>
	translator("tools")(`kind.label.${kind}`);

export const toolKindDescription = (kind: ChatCustomToolKind): string =>
	translator("tools")(`kind.description.${kind}`, {
		placeholder: "{{parameter}}",
	});

export const toolParameterTypeLabel = (type: ChatToolParameterType): string =>
	translator("tools")(`parameterType.${type}`);

/** `scheme://host[:port]` of an http tool, the part a person should read; null for other kinds. */
export function toolOrigin(tool: ChatCustomToolDto): string | null {
	if (tool.action.kind !== "http") return null;
	return (
		/^(https?:\/\/[^/?#\s]+)/i.exec(tool.action.url)?.[1]?.toLowerCase() ??
		tool.action.url
	);
}

export const toolImportStatusLabel = (status: ChatToolImportStatus): string =>
	translator("tools")(`importDialog.status.${status}`);
