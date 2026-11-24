import type {
	ChatCreatorToolAction,
	ChatCreatorToolDto,
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

export type DraftToolCheck =
	| { ok: true; tool: ChatCreatorToolDto }
	| { ok: false; issues: string[] };

/**
 * Whether this tool can be published, using the contract's own schema so the editor and the server
 * cannot disagree. Issues are `path: message` lines for the editor.
 */
export function checkDraftTool(tool: DraftTool): DraftToolCheck {
	const parsed = ChatCreatorToolSchema.safeParse(toCreatorTool(tool));
	if (parsed.success) return { ok: true, tool: parsed.data };
	return {
		ok: false,
		issues: parsed.error.issues.map((issue) =>
			issue.path.length > 0
				? `${issue.path.join(".")}: ${issue.message}`
				: issue.message,
		),
	};
}

export { CHAT_CUSTOM_TOOL_LIMITS as DRAFT_TOOL_LIMITS };

/**
 * Names a creator tool cannot take: the built-in lore search wins that name in every room. Spelled
 * here rather than imported because this package does not depend on @rowcat/chat; the chat
 * package's `CHAT_RESERVED_TOOL_NAMES` holds the same value, and a test pins the two together.
 */
export const DRAFT_TOOL_RESERVED_NAMES: readonly string[] = ["lore_search"];
