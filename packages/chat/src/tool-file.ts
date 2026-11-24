import type {
	ChatCustomToolAction,
	ChatCustomToolDto,
} from "@rowcat/contracts/chat";
import {
	type ChatUserTool,
	type CreateUserToolInput,
	checkUserToolDefinition,
} from "./user-tool.ts";

/**
 * Tool files: how a person hands a custom tool to another person. Like the story archive
 * (`docs/oss/STORY-ARCHIVE.md`), it is a file people carry: no marketplace, no server endpoint,
 * no link between instances. The same file opens in any RowCat deployment.
 *
 * ```text
 * export   the user's tools → { format, version, tools } as JSON → `<name>.rowcat-tools.json`
 * import   text → readChatToolFile (is it ours, which version, each tool on its own)
 *               → planChatToolImport (against this user's library)
 *               → chatToolImportWrites (what the store creates or replaces)
 * ```
 *
 * What the file never holds:
 * - **HTTP header values.** They are usually the author's credentials (`Authorization`), and a
 *   file is copied, posted and forwarded. Names stay so the importer knows what to fill in
 *   (`headersToFill`). There is no option to keep them: an option that leaks a key once is
 *   enough.
 * - Record identity and sync state (id, rev, timestamps), and which rooms a tool is on in. Those
 *   are facts of the author's library, not of the tool.
 *
 * What import decides for the importer:
 * - **Every imported tool starts off** (`enabledByDefault: false`). A tool someone else wrote does
 *   not join every conversation on arrival: each one costs input tokens every turn, and an `http`
 *   tool sends whatever the model passes it, read from the importer's conversation, to an address
 *   the author chose. Turning it on is the importer's act.
 * - **A name already in the library is not imported by default.** The importer may replace the
 *   existing tool instead (re-importing a newer version is the common case). Renaming on the way
 *   in is not offered: an `http` tool sends its own name to the endpoint, so a renamed copy is a
 *   different call.
 *
 * Each tool is checked on its own with the same gate the settings form uses
 * (`checkUserToolDefinition`), so one broken tool does not refuse the rest of the file, and a file
 * cannot create a tool the form could not.
 *
 * Pure: no file APIs, no clipboard, no store. The apps read and write the bytes.
 */

export const CHAT_TOOL_FILE_FORMAT = "rowcat-tools";
/**
 * Raised only when an older importer must refuse the file. Adding a field an older importer can
 * ignore is not a version (the story archive's rule).
 */
export const CHAT_TOOL_FILE_VERSION = 1;
export const CHAT_TOOL_FILE_EXTENSION = ".rowcat-tools.json";

export const CHAT_TOOL_FILE_LIMITS = {
	/**
	 * The file's size in bytes. The largest single tool is a full random table (200 rows of 2,000
	 * characters), so this fits a library of large tools and stops a file that is not one.
	 */
	bytes: 8 * 1024 * 1024,
	/** Tools in one file. Larger than a room's cap: a file carries a library, not one room's set. */
	tools: 64,
} as const;

export interface ChatToolFile {
	format: typeof CHAT_TOOL_FILE_FORMAT;
	version: typeof CHAT_TOOL_FILE_VERSION;
	tools: ChatCustomToolDto[];
}

// ─── Export ─────────────────────────────────────────────────────────────────────────────────────

/** A header whose value was left out of the file, for the export screen's sentence. */
export interface ChatToolFileStrippedHeader {
	tool: string;
	header: string;
}

export interface ChatToolFileExport {
	file: ChatToolFile;
	/** Header values the file does not carry. Empty when no `http` tool had a non-empty value. */
	strippedHeaders: ChatToolFileStrippedHeader[];
}

const withoutHeaderValues = (
	action: ChatCustomToolAction,
): ChatCustomToolAction =>
	action.kind === "http"
		? {
				...action,
				headers: action.headers.map((header) => ({
					name: header.name,
					value: "",
				})),
			}
		: action;

/**
 * Builds the file from tools the caller already chose (and already filtered for deletion). The
 * order is kept: it is the order the importer's screen lists them in.
 */
export function buildChatToolFile(
	tools: readonly ChatCustomToolDto[],
): ChatToolFileExport {
	const strippedHeaders: ChatToolFileStrippedHeader[] = [];
	for (const tool of tools) {
		if (tool.action.kind !== "http") continue;
		for (const header of tool.action.headers)
			if (header.value !== "")
				strippedHeaders.push({
					tool: tool.declaration.name,
					header: header.name,
				});
	}
	return {
		file: {
			format: CHAT_TOOL_FILE_FORMAT,
			version: CHAT_TOOL_FILE_VERSION,
			tools: tools.map((tool) => ({
				declaration: tool.declaration,
				action: withoutHeaderValues(tool.action),
			})),
		},
		strippedHeaders,
	};
}

/** The file's text. Indented, because people open these files to see what a tool does. */
export const serializeChatToolFile = (file: ChatToolFile): string =>
	`${JSON.stringify(file, null, "\t")}\n`;

/** One tool takes its own name; several take a neutral name with the count. */
export function chatToolFileName(tools: readonly ChatCustomToolDto[]): string {
	const only = tools.length === 1 ? tools[0] : undefined;
	return only
		? `${only.declaration.name}${CHAT_TOOL_FILE_EXTENSION}`
		: `rowcat-tools-${tools.length}${CHAT_TOOL_FILE_EXTENSION}`;
}

// ─── Read ───────────────────────────────────────────────────────────────────────────────────────

export type ChatToolFileFailure =
	/** Not JSON, or JSON that is not a tool file. A story archive or a card lands here too. */
	| "not_tool_file"
	/** Written by a newer RowCat. Importing it would drop what this version does not know. */
	| "newer_version"
	| "too_large"
	/** Ours and this version, but the envelope is broken (no tools, too many, not a list). */
	| "invalid";

/** What an `http` tool will reach, shown before the importer chooses. */
export interface ChatToolFileHttpReach {
	url: string;
	/** `scheme://host[:port]`: the part a person should read before turning the tool on. */
	origin: string;
	/** Header names whose values the importer must fill in before the tool can authenticate. */
	headersToFill: string[];
}

export type ChatToolFileEntry =
	| {
			/** Position in the file, from 0. Choices are keyed by it. */
			index: number;
			ok: true;
			tool: ChatCustomToolDto;
			http: ChatToolFileHttpReach | null;
	  }
	| {
			index: number;
			ok: false;
			/** The name the entry claims, when it has a readable one, so the screen can say which. */
			name: string | null;
			issues: string[];
	  };

export type ChatToolFileRead =
	| { ok: true; entries: ChatToolFileEntry[] }
	| { ok: false; reason: ChatToolFileFailure; detail?: string };

const originOf = (url: string): string =>
	/^(https?:\/\/[^/?#\s]+)/i.exec(url)?.[1]?.toLowerCase() ?? url;

const claimedName = (input: unknown): string | null => {
	const name = (input as { declaration?: { name?: unknown } } | null)
		?.declaration?.name;
	return typeof name === "string" && name.length > 0 ? name.slice(0, 64) : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads a file someone handed us. The order of questions is the story archive's: is it ours, is it
 * from a newer version, and only then the shape, so a newer file is never reported as broken.
 *
 * The size check runs on the text before parsing. A string's length in UTF-16 units is never more
 * than its UTF-8 byte length, so a text longer than the byte cap is over it; apps that hold the
 * file's byte size should also refuse with `chatToolFileTooLarge` before reading the text at all.
 */
export function readChatToolFile(text: string): ChatToolFileRead {
	if (text.length > CHAT_TOOL_FILE_LIMITS.bytes)
		return { ok: false, reason: "too_large" };

	let input: unknown;
	try {
		input = JSON.parse(text);
	} catch {
		return { ok: false, reason: "not_tool_file" };
	}
	if (!isRecord(input) || input.format !== CHAT_TOOL_FILE_FORMAT)
		return { ok: false, reason: "not_tool_file" };

	const version = input.version;
	if (typeof version === "number" && version > CHAT_TOOL_FILE_VERSION)
		return { ok: false, reason: "newer_version", detail: `version ${version}` };
	if (version !== CHAT_TOOL_FILE_VERSION)
		return { ok: false, reason: "invalid", detail: "version" };

	const tools = input.tools;
	if (!Array.isArray(tools) || tools.length === 0)
		return { ok: false, reason: "invalid", detail: "tools: empty" };
	if (tools.length > CHAT_TOOL_FILE_LIMITS.tools)
		return {
			ok: false,
			reason: "invalid",
			detail: `tools: more than ${CHAT_TOOL_FILE_LIMITS.tools}`,
		};

	return {
		ok: true,
		entries: tools.map((raw, index): ChatToolFileEntry => {
			const checked = checkUserToolDefinition(raw);
			if (!checked.ok)
				return {
					index,
					ok: false,
					name: claimedName(raw),
					issues: checked.issues,
				};
			const action = checked.tool.action;
			return {
				index,
				ok: true,
				tool: checked.tool,
				http:
					action.kind === "http"
						? {
								url: action.url,
								origin: originOf(action.url),
								headersToFill: action.headers
									.filter((header) => header.value === "")
									.map((header) => header.name),
							}
						: null,
			};
		}),
	};
}

/** For apps that know the byte size before reading (a picked `File`, a document URI's info). */
export const chatToolFileTooLarge = (byteLength: number): boolean =>
	byteLength > CHAT_TOOL_FILE_LIMITS.bytes;

// ─── Plan against the library ───────────────────────────────────────────────────────────────────

export type ChatToolImportStatus =
	/** No live tool uses this name. Imported unless the importer skips it. */
	| "new"
	/** A live tool already uses this name. Skipped unless the importer chooses to replace it. */
	| "name_taken"
	/** An earlier entry in the same file has this name. Never imported: which one is meant is unknowable. */
	| "duplicate_in_file"
	/** The definition failed the form's check. Never imported. */
	| "invalid";

export interface ChatToolImportItem {
	entry: ChatToolFileEntry;
	status: ChatToolImportStatus;
	/** The live library tool with the same name, for `name_taken`. */
	existingId: string | null;
}

export function planChatToolImport(
	entries: readonly ChatToolFileEntry[],
	library: readonly ChatUserTool[],
): ChatToolImportItem[] {
	const live = new Map<string, string>();
	for (const tool of library)
		if (tool.deletedAt === null) live.set(tool.tool.declaration.name, tool.id);

	const seen = new Set<string>();
	return entries.map((entry) => {
		if (!entry.ok) return { entry, status: "invalid", existingId: null };
		const name = entry.tool.declaration.name;
		if (seen.has(name))
			return { entry, status: "duplicate_in_file", existingId: null };
		seen.add(name);
		const existingId = live.get(name) ?? null;
		return existingId === null
			? { entry, status: "new", existingId: null }
			: { entry, status: "name_taken", existingId };
	});
}

export type ChatToolImportChoice = "import" | "replace" | "skip";

/** What the screen preselects. `replace` is never preselected: it overwrites the importer's own tool. */
export const defaultChatToolImportChoice = (
	item: ChatToolImportItem,
): ChatToolImportChoice => (item.status === "new" ? "import" : "skip");

/** The choices an item allows, for the screen's control. */
export function chatToolImportChoices(
	item: ChatToolImportItem,
): ChatToolImportChoice[] {
	switch (item.status) {
		case "new":
			return ["import", "skip"];
		case "name_taken":
			return ["replace", "skip"];
		default:
			return ["skip"];
	}
}

export interface ChatToolImportWrites {
	create: CreateUserToolInput[];
	/** Patches for `updateUserTool`: the definition only, so the importer's on/off stays theirs. */
	replace: { id: string; tool: ChatCustomToolDto }[];
}

/**
 * Header values a replacement keeps. The file carries none, so replacing an `http` tool would wipe
 * the key the importer already typed. A value is carried over only when the existing tool calls
 * the **same URL** and has a header of the same name: a value moved to a different address is the
 * importer's credential sent somewhere they never chose to send it.
 */
function keepHeaderValues(
	incoming: ChatCustomToolDto,
	existing: ChatCustomToolDto | undefined,
): ChatCustomToolDto {
	if (incoming.action.kind !== "http" || existing?.action.kind !== "http")
		return incoming;
	if (existing.action.url !== incoming.action.url) return incoming;
	const previous = new Map(
		existing.action.headers.map((header) => [
			header.name.toLowerCase(),
			header.value,
		]),
	);
	return {
		...incoming,
		action: {
			...incoming.action,
			headers: incoming.action.headers.map((header) =>
				header.value === ""
					? {
							name: header.name,
							value: previous.get(header.name.toLowerCase()) ?? "",
						}
					: header,
			),
		},
	};
}

/**
 * Turns the plan and the importer's choices into store writes. A choice an item does not allow
 * (`chatToolImportChoices`) is treated as `skip`, so a stale or tampered choice map cannot import
 * an invalid entry or overwrite a tool by a name that is not taken.
 */
export function chatToolImportWrites(
	plan: readonly ChatToolImportItem[],
	library: readonly ChatUserTool[],
	choices: Readonly<Record<number, ChatToolImportChoice>> = {},
): ChatToolImportWrites {
	const byId = new Map(library.map((tool) => [tool.id, tool.tool]));
	const writes: ChatToolImportWrites = { create: [], replace: [] };
	for (const item of plan) {
		if (!item.entry.ok) continue;
		const choice =
			choices[item.entry.index] ?? defaultChatToolImportChoice(item);
		if (!chatToolImportChoices(item).includes(choice)) continue;
		if (choice === "import")
			writes.create.push({ tool: item.entry.tool, enabledByDefault: false });
		else if (choice === "replace" && item.existingId !== null)
			writes.replace.push({
				id: item.existingId,
				tool: keepHeaderValues(item.entry.tool, byId.get(item.existingId)),
			});
	}
	return writes;
}
