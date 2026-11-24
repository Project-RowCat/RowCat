import {
	type ChatUserTool,
	checkUserToolDefinition,
	userToolNameTaken,
} from "@rowcat/chat";
import {
	CHAT_CUSTOM_TOOL_LIMITS,
	type ChatCustomToolDto,
	type ChatCustomToolKind,
	type ChatToolParameterType,
} from "@rowcat/contracts/chat";
import { translator } from "../../lib/i18n/instance.ts";

/**
 * The tool editor's model: what the form holds while the user types, how it becomes a definition,
 * and which field each problem belongs to.
 *
 * The rules are not here. Whether a definition is valid is answered by `checkUserToolDefinition`
 * in `@rowcat/chat`, the same gate storage and the import path run, and whether the name is free
 * by `userToolNameTaken`. Re-judging either here would let the form accept a tool the store then
 * refuses (the save fails with no field to point at) or refuse one the store would take.
 *
 * Pure because this app's tests do not render screens: the draft ↔ definition round trip and the
 * issue mapping are the parts that fail silently (a parameter dropped on save, a choice list kept
 * for a number) and they are checked without a device.
 *
 * ## Why a draft and not the definition itself
 *
 * The form edits text. Two numbers (`draws`, `maxOutputTokens`) are typed as text, and the table's
 * lines and a parameter's choices are one line per entry. Holding the definition would mean parsing
 * on every keystroke and losing what the user typed when it does not parse yet ("1" on the way to
 * "12"). The draft keeps the text; `toolDefinitionOf` parses once, at save.
 *
 * Every kind keeps its own fields while the user switches kinds, so trying "table" and going back to
 * "template" does not erase the template. Only the chosen kind's fields are saved.
 */

export interface ToolParameterDraft {
	/** A stable key for the row list. Not saved; parameters have no identity of their own. */
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

export interface ToolDraft {
	name: string;
	description: string;
	parameters: ToolParameterDraft[];
	kind: ChatCustomToolKind;
	template: string;
	/** One table line per text line. */
	entries: string;
	draws: string;
	system: string;
	maxOutputTokens: string;
	url: string;
	method: "GET" | "POST";
	headers: ToolHeaderDraft[];
	enabledByDefault: boolean;
}

let keySeed = 0;
/** Row keys only need to be unique within one open form. */
export const nextDraftKey = (): string => {
	keySeed += 1;
	return `row-${keySeed}`;
};

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
 * A new tool. On in every room by default, the store's own default (`createUserToolRecord`): a
 * person who writes a tool usually wants to use it. Imported tools are the exception and start off
 * (`tool-file.ts`), which is not this path.
 */
export function emptyToolDraft(): ToolDraft {
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

/** The draft for an existing tool: its kind's fields filled, the others at their empty values. */
export function toolDraftOf(record: ChatUserTool): ToolDraft {
	const { declaration, action } = record.tool;
	const draft: ToolDraft = {
		...emptyToolDraft(),
		name: declaration.name,
		description: declaration.description,
		parameters: declaration.parameters.map((parameter) => ({
			key: nextDraftKey(),
			name: parameter.name,
			type: parameter.type,
			description: parameter.description,
			required: parameter.required,
			choices: parameter.choices.join("\n"),
		})),
		kind: action.kind,
		enabledByDefault: record.enabledByDefault,
	};
	switch (action.kind) {
		case "template":
			return { ...draft, template: action.template };
		case "table":
			return {
				...draft,
				entries: action.entries.join("\n"),
				draws: String(action.draws),
			};
		case "agent":
			return {
				...draft,
				system: action.system,
				maxOutputTokens: String(action.maxOutputTokens),
			};
		case "http":
			return {
				...draft,
				url: action.url,
				method: action.method,
				headers: action.headers.map((header) => ({
					key: nextDraftKey(),
					name: header.name,
					value: header.value,
				})),
			};
	}
}

/** Non-empty lines, each trimmed of its line ending only: a table line's own spaces are content. */
const lines = (text: string): string[] =>
	text
		.split(/\r?\n/)
		.map((line) => line.replace(/\s+$/, ""))
		.filter((line) => line.trim() !== "");

/**
 * A whole number typed as text, or `NaN`. `NaN` is passed on rather than replaced with a default, so
 * the contract rejects it and the form says so; a silent default would save a number the user
 * never typed.
 */
const integer = (text: string): number =>
	/^\s*\d+\s*$/.test(text) ? Number(text.trim()) : Number.NaN;

/**
 * The definition this draft describes, unvalidated. Text fields are trimmed at the edges except the
 * bodies the model reads verbatim (template, table lines, agent instructions), where leading
 * whitespace can be deliberate formatting; those lose only trailing blank space.
 */
export function toolDefinitionOf(draft: ToolDraft): unknown {
	const declaration = {
		name: draft.name.trim(),
		description: draft.description.trim(),
		parameters: draft.parameters.map((parameter) => ({
			name: parameter.name.trim(),
			type: parameter.type,
			description: parameter.description.trim(),
			required: parameter.required,
			/* Choices constrain text only (the contract says adapters ignore them otherwise); a list kept on a number parameter would be invisible state. */
			choices: parameter.type === "string" ? lines(parameter.choices) : [],
		})),
	};
	switch (draft.kind) {
		case "template":
			return {
				declaration,
				action: { kind: "template", template: draft.template.trimEnd() },
			};
		case "table":
			return {
				declaration,
				action: {
					kind: "table",
					entries: lines(draft.entries),
					draws: integer(draft.draws),
				},
			};
		case "agent":
			return {
				declaration,
				action: {
					kind: "agent",
					system: draft.system.trimEnd(),
					maxOutputTokens: integer(draft.maxOutputTokens),
				},
			};
		case "http":
			return {
				declaration,
				action: {
					kind: "http",
					url: draft.url.trim(),
					method: draft.method,
					/* A header row left completely empty is an unfinished row, not a header named "". */
					headers: draft.headers
						.filter(
							(header) => header.name.trim() !== "" || header.value !== "",
						)
						.map((header) => ({
							name: header.name.trim(),
							value: header.value,
						})),
				},
			};
	}
}

/** Which part of the form an issue belongs to; the editor marks that part. */
export type ToolFormField = "name" | "description" | "parameters" | "action";

export interface ToolFormIssue {
	field: ToolFormField;
	/** The sentence the form draws, already prefixed with the part it is about. */
	message: string;
}

/**
 * `checkUserToolDefinition` reports `path: message` lines. The path decides the field; the message
 * is kept as the contract wrote it, prefixed with the form's own label for that part, so "Parameter
 * 2 name" reads instead of `declaration.parameters.1.name`.
 */
export function toolFormIssueOf(issue: string): ToolFormIssue {
	const t = translator("tools");
	const split = /^([\w.]+): (.*)$/s.exec(issue);
	const path = split?.[1]?.split(".") ?? [];
	const message = split?.[2] ?? issue;
	const [root, part, index, leaf] = path;
	if (root === "declaration" && part === "name")
		return { field: "name", message: `${t("copy.fieldName")}: ${message}` };
	if (root === "declaration" && part === "description")
		return {
			field: "description",
			message: `${t("copy.fieldDescription")}: ${message}`,
		};
	if (root === "declaration" && part === "parameters") {
		const at = Number(index);
		const label = Number.isInteger(at)
			? `${t("parameterLabel", { position: at + 1 })}${leaf ? ` ${leaf}` : ""}`
			: t("copy.fieldParameters");
		return { field: "parameters", message: `${label}: ${message}` };
	}
	if (root === "action" && part === "headers") {
		const at = Number(index);
		const label = Number.isInteger(at)
			? `${t("headerLabel", { position: at + 1 })}${leaf ? ` ${leaf}` : ""}`
			: t("copy.headers");
		return { field: "action", message: `${label}: ${message}` };
	}
	if (root === "action")
		return {
			field: "action",
			message: `${part ? `${t("copy.fieldAction")} · ${part}` : t("copy.fieldAction")}: ${message}`,
		};
	return { field: "action", message };
}

export type ToolSavePlan =
	/** Cannot be saved: the issues say what and where. */
	| { kind: "invalid"; issues: ToolFormIssue[] }
	/** Nothing changed: close without writing (an edit issues a revision and a sync upload). */
	| { kind: "unchanged" }
	| { kind: "save"; tool: ChatCustomToolDto; enabledByDefault: boolean };

/**
 * What pressing save means. `existing` is the tool being edited, `null` when creating; `library`
 * is the live list, for the name check (the record being edited is excluded from it).
 */
export function planToolSave(
	draft: ToolDraft,
	library: readonly ChatUserTool[],
	existing: ChatUserTool | null,
): ToolSavePlan {
	const checked = checkUserToolDefinition(toolDefinitionOf(draft));
	const issues: ToolFormIssue[] = checked.ok
		? []
		: checked.issues.map(toolFormIssueOf);
	const name = draft.name.trim();
	if (userToolNameTaken(library, name, existing?.id))
		issues.unshift({
			field: "name",
			message: translator("tools")("copy.nameTaken"),
		});
	if (!checked.ok || issues.length > 0) return { kind: "invalid", issues };

	if (
		existing &&
		existing.enabledByDefault === draft.enabledByDefault &&
		JSON.stringify(existing.tool) === JSON.stringify(checked.tool)
	)
		return { kind: "unchanged" };
	return {
		kind: "save",
		tool: checked.tool,
		enabledByDefault: draft.enabledByDefault,
	};
}

/** The fields an issue list marks, for the editor's `invalid` props. */
export const invalidFields = (
	issues: readonly ToolFormIssue[],
): ReadonlySet<ToolFormField> => new Set(issues.map((issue) => issue.field));

/** Caps the editor shows next to the inputs; the contract owns the numbers. */
export const TOOL_FORM_LIMITS = CHAT_CUSTOM_TOOL_LIMITS;
