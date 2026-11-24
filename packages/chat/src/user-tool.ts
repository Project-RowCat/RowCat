import {
	type ChatCreatorToolDto,
	ChatCustomToolDto,
	isChatCreatorHttpUrl,
} from "@rowcat/contracts/chat";
import type { ChatSoftDelete, ChatStamp, ChatSyncMeta } from "./model.ts";
import { freshChatSyncMeta } from "./model.ts";
import { CHAT_LORE_TOOL_NAME } from "./tool-lore.ts";

/**
 * User tools: chat tools a person writes in their own settings, and which rooms they are on in.
 *
 * A tool is a library record of the account, like a persona: it is not a child of a room, has no
 * roomId, and deleting a room never touches it. It syncs because it is something the user wrote,
 * and a tool made on one device and missing on another would be written twice and drift.
 *
 * Unlike a persona, a room does not copy the tool. It refers to it by id, and only to say whether
 * it is on (`ChatRoom.toolOverrides`). A copy is right for a persona because a persona is the
 * identity of past messages; a tool is not part of any stored message. Its result lives only inside
 * one turn (`docs/chat/TOOLS.md` §9), so editing a tool changes what the next call does and nothing
 * that was already said. A copy would also make fixing a broken endpoint a per-room chore.
 *
 * Which rooms a tool is on in has two layers:
 * - `enabledByDefault` on the tool: on in every room unless the room says otherwise.
 * - `toolOverrides` on the room: an explicit on or off for that one room.
 * The room's choice wins. Absence in the room means "follow the tool", and that is the only
 * representation of it (`applyRoomToolOverride` deletes the key).
 */

export interface ChatUserTool extends ChatSyncMeta, ChatSoftDelete {
	/** Globally stable id, created on the device. */
	id: string;
	/** The definition: what the model reads and what the device does. */
	tool: ChatCustomToolDto;
	/** On in every room that has no override for it. */
	enabledByDefault: boolean;
	/** ISO 8601. */
	createdAt: string;
	/** ISO 8601. */
	updatedAt: string;
}

/**
 * Names the user cannot take. Lore search is built in and wins the name anyway
 * (`chatConversationTools`), so a user tool with that name would be silently skipped in every room.
 * Rejecting it at save time turns that silent failure into a sentence on the form.
 */
export const CHAT_RESERVED_TOOL_NAMES: readonly string[] = [
	CHAT_LORE_TOOL_NAME,
];

export type ChatUserToolCheck =
	| { ok: true; tool: ChatCustomToolDto }
	| { ok: false; issues: string[] };

/**
 * Validates a definition with the contract's own schema, plus the reserved names. The issues are
 * `path: message` lines for the form; the form is the only reader.
 */
export function checkUserToolDefinition(input: unknown): ChatUserToolCheck {
	const parsed = ChatCustomToolDto.safeParse(input);
	if (!parsed.success)
		return {
			ok: false,
			issues: parsed.error.issues.map((issue) =>
				issue.path.length > 0
					? `${issue.path.join(".")}: ${issue.message}`
					: issue.message,
			),
		};
	if (CHAT_RESERVED_TOOL_NAMES.includes(parsed.data.declaration.name))
		return {
			ok: false,
			issues: [
				`declaration.name: '${parsed.data.declaration.name}' is reserved.`,
			],
		};
	return { ok: true, tool: parsed.data };
}

export class ChatUserToolError extends Error {
	readonly issues: readonly string[];
	constructor(issues: readonly string[]) {
		super(`Invalid tool definition: ${issues.join("; ")}`);
		this.name = "ChatUserToolError";
		this.issues = issues;
	}
}

/** The storage path's gate: the same check the form runs, thrown instead of returned. */
export function requireUserToolDefinition(input: unknown): ChatCustomToolDto {
	const checked = checkUserToolDefinition(input);
	if (!checked.ok) throw new ChatUserToolError(checked.issues);
	return checked.tool;
}

export interface CreateUserToolInput {
	tool: ChatCustomToolDto;
	/** Omitted means on everywhere: a person who writes a tool usually wants to use it. */
	enabledByDefault?: boolean;
}

export type UpdateUserToolPatch = Partial<
	Pick<ChatUserTool, "tool" | "enabledByDefault">
>;

/** Builds the record; does not save. The definition is re-checked here, like personas. */
export function createUserToolRecord(
	input: CreateUserToolInput,
	stamp: ChatStamp,
): ChatUserTool {
	return {
		id: stamp.id,
		tool: requireUserToolDefinition(input.tool),
		enabledByDefault: input.enabledByDefault ?? true,
		createdAt: stamp.now,
		updatedAt: stamp.now,
		deletedAt: null,
		...freshChatSyncMeta(stamp.rev),
	};
}

/** Most recently edited first, ties by id: the same axis as personas, rooms and drafts. */
export const sortUserTools = (tools: readonly ChatUserTool[]): ChatUserTool[] =>
	[...tools].sort((a, b) => {
		if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
		return a.id < b.id ? 1 : -1;
	});

/**
 * Whether another live tool already uses this name. Two user tools with one name would make the
 * registry keep whichever sorts first, and which one that is changes every time either is edited.
 */
export function userToolNameTaken(
	tools: readonly ChatUserTool[],
	name: string,
	exceptId?: string,
): boolean {
	return tools.some(
		(tool) =>
			tool.deletedAt === null &&
			tool.id !== exceptId &&
			tool.tool.declaration.name === name,
	);
}

/** The room's overrides, or an empty map. Read them only through this. */
export function roomToolOverrides(room: {
	toolOverrides?: Readonly<Record<string, boolean>>;
}): Readonly<Record<string, boolean>> {
	return room.toolOverrides ?? {};
}

/**
 * Sets or clears one tool's override in a room. `null` clears it (follow the tool's default). An
 * empty map deletes the key, so "no overrides" has one shape, the same rule as the user note.
 */
export function applyRoomToolOverride<
	T extends { toolOverrides?: Record<string, boolean> },
>(room: T, toolId: string, enabled: boolean | null): T {
	const next: Record<string, boolean> = { ...(room.toolOverrides ?? {}) };
	if (enabled === null) delete next[toolId];
	else next[toolId] = enabled;
	return applyRoomToolOverrides(room, next);
}

/** Replaces the whole map, normalizing an empty one to an absent key. The merge uses it. */
export function applyRoomToolOverrides<
	T extends { toolOverrides?: Record<string, boolean> },
>(room: T, overrides: Readonly<Record<string, boolean>> | null | undefined): T {
	if (overrides && Object.keys(overrides).length > 0)
		return { ...room, toolOverrides: { ...overrides } };
	const { toolOverrides: _cleared, ...rest } = room;
	return rest as T;
}

/**
 * The creator's tools share the room's override map with the user's, under a key a user tool id
 * can never be (ids are issued by the store and carry no colon). Keyed by **name**, not position:
 * the name is what the model calls and what a republished work keeps, so a switch follows the tool
 * across republishes, and a renamed tool is a different call and starts off again.
 */
export const creatorToolOverrideKey = (name: string): string =>
	`creator:${name}`;

/**
 * Whether a creator tool needs the reader's own switch before it runs. Only `http` does: it is the
 * one kind that reaches outside the conversation (to a service on the reader's machine,
 * `ChatCreatorHttpToolAction`), and a work must not do that because someone opened it.
 */
export const creatorToolNeedsConsent = (tool: ChatCreatorToolDto): boolean =>
	tool.action.kind === "http";

/**
 * Whether a creator tool runs in this room. Tools that need consent are on only where the reader
 * said so — there is no default-on, and absence (every room before this axis, the server's loop,
 * a work test) means off. Every other creator tool is always on; the creator decided those.
 */
export function creatorToolActiveIn(
	room: { toolOverrides?: Readonly<Record<string, boolean>> },
	tool: ChatCreatorToolDto,
): boolean {
	if (!creatorToolNeedsConsent(tool)) return true;
	/*
	 * The contract already refuses anything else, but a seed can reach this function from a stored
	 * record that was never re-parsed. Checking here too keeps the guarantee where the call is made.
	 */
	if (
		tool.action.kind === "http" &&
		(!isChatCreatorHttpUrl(tool.action.url) || tool.action.headers.length > 0)
	)
		return false;
	return (
		roomToolOverrides(room)[creatorToolOverrideKey(tool.declaration.name)] ===
		true
	);
}

/** A creator tool the reader can switch on, as room settings list it. */
export interface CreatorConsentTool {
	name: string;
	description: string;
	/** Scheme, host and port only (`http://localhost:8787`): where the call goes, without the path's noise. */
	address: string;
	/** The room's override key (`creatorToolOverrideKey`). */
	key: string;
}

/**
 * The work's tools that run only with the reader's switch, for room settings. Tools whose address
 * fails the loopback check are left out: they never run (`creatorToolActiveIn`), and a switch for
 * them would promise something that cannot happen.
 */
export function creatorConsentTools(seed: {
	tools?: readonly ChatCreatorToolDto[];
}): CreatorConsentTool[] {
	const listed: CreatorConsentTool[] = [];
	for (const tool of seed.tools ?? []) {
		const { action, declaration } = tool;
		if (action.kind !== "http") continue;
		if (!isChatCreatorHttpUrl(action.url) || action.headers.length > 0)
			continue;
		listed.push({
			name: declaration.name,
			description: declaration.description,
			address: /^https?:\/\/[^/?#]+/i.exec(action.url)?.[0] ?? action.url,
			key: creatorToolOverrideKey(declaration.name),
		});
	}
	return listed;
}

/**
 * Switches that turn on every creator tool that needs consent, for a work test: the person running
 * it is the work's author, on their own machine, calling their own localhost. There is no room to
 * hold a switch, and asking the author to consent to themselves would only be a step to forget.
 */
export function authorToolOverrides(seed: {
	tools?: readonly ChatCreatorToolDto[];
}): Record<string, boolean> {
	const overrides: Record<string, boolean> = {};
	for (const tool of seed.tools ?? [])
		if (creatorToolNeedsConsent(tool))
			overrides[creatorToolOverrideKey(tool.declaration.name)] = true;
	return overrides;
}

/** Whether a tool is on in this room: the room's choice, else the tool's default. */
export function userToolActiveIn(
	room: { toolOverrides?: Readonly<Record<string, boolean>> },
	tool: Pick<ChatUserTool, "id" | "enabledByDefault">,
): boolean {
	return roomToolOverrides(room)[tool.id] ?? tool.enabledByDefault;
}

/**
 * The definitions on in this room, in library order. Deleted tools are left out here as well as in
 * storage, so a caller holding a stale list cannot declare a tool the user removed.
 */
export function activeUserTools(
	room: { toolOverrides?: Readonly<Record<string, boolean>> },
	tools: readonly ChatUserTool[],
): ChatCustomToolDto[] {
	return sortUserTools(
		tools.filter(
			(tool) => tool.deletedAt === null && userToolActiveIn(room, tool),
		),
	).map((tool) => tool.tool);
}
