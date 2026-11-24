import type {
	DraftLoreEntry,
	DraftRuntimeAsset,
	DraftRuntimeFile,
	DraftRuntimeProject,
	DraftSceneImage,
	DraftStartScene,
	DraftTool,
	StoryDraft,
} from "@rowcat/authoring";
import type {
	ChatAttachment,
	ChatCharacter,
	ChatMemory,
	ChatMessage,
	ChatPersona,
	ChatPersonaSnapshot,
	ChatRoom,
	ChatScene,
	ChatSceneAudience,
	ChatSeed,
	ChatSummary,
	ChatUserTool,
} from "@rowcat/chat";
import {
	normalizeCharacterAliases,
	normalizeSceneAudience,
	readMemorySource,
	readNarrationSettings,
} from "@rowcat/chat";
import type { ChatLorePosition } from "@rowcat/contracts/chat";
import type { Rev } from "@rowcat/contracts/sync";
import type { Orientation, StoryVisibility } from "@rowcat/domain";
import {
	DEFAULT_RUNTIME_SAVE_SLOT,
	isRuntimeSaveSlot,
	type RuntimeConversationRecord,
	type RuntimePersistentRecord,
	type RuntimePlaythroughRecord,
} from "@rowcat/runtime-persistence";
import type { SyncRecordShape } from "@rowcat/sync";
import { fromFlag, type SqlRunner, type SqlValue, toFlag } from "./sqlite.ts";

/**
 * Record ↔ row mapping. This is the only file that knows SQLite.
 *
 * Three stores (chat, authoring, sync) share this table. If each wrote its own SQL, the same record
 * would be assembled three times, and adding a field would fix only two places. The mismatch would
 * surface not as a compile error but as a blank field on a record that arrived through sync.
 *
 * Three contracts hold here:
 *
 * 1. SQLite representation does not leak into the domain. Booleans are stored as 0|1 and turned
 *    back into booleans at the boundary. `@rowcat/chat` and `@rowcat/authoring` do not know this
 *    file exists.
 * 2. Timestamps keep the product representation: ISO 8601 strings, not epoch milliseconds, even
 *    though SQLite handles integers well. Legacy diverged between web and mobile on time
 *    representation; here there is one. String comparison is also time order, and sorting and
 *    cursors rely on that.
 * 3. Sync metadata is not stripped. `rev`, `dirty`, `serverVersion` and tombstones are invisible
 *    to screens but are the entire protocol. Dropping them either keeps the record from ever
 *    uploading, or lets it overwrite a newer copy from a peer.
 *
 * `rev` is split into three columns (`rev_t`, `rev_c`, `rev_d`) rather than one JSON blob. It is
 * three fixed values, so there is no reason to wrap it, and as columns the revision comparison in
 * `commitPush` needs no parsing.
 */

/** Sync type vocabulary. The order is the outbound order, and parents come first. */
export const TABLE_ORDER = [
	"chat.room",
	"chat.message",
	"chat.memory",
	"chat.summary",
	"authoring.draft",
	"authoring.lore",
	"authoring.scene",
	"authoring.sceneImage",
	/** Runtime: the project comes before its files and assets (draft → project → children). */
	"authoring.runtimeProject",
	"authoring.runtimeFile",
	/**
	 * Managed images are siblings of files (both are children of the project), so their relative order
	 * means nothing. Placing them here is for the reader.
	 */
	"authoring.runtimeAsset",
	/**
	 * Persona library: no parent. Only the position "end" carries meaning in this array (the safest
	 * place for an in-progress collection cursor), and room tombstone cascades do not reach it.
	 */
	"chat.persona",
	/**
	 * Player saves: no parent, and not children of authoring records. Unlike `authoring.runtime*`,
	 * which is code this member wrote and so a child of the draft, these are progress this member
	 * played, including on other people's works. Hence last, and not caught by draft tombstone
	 * cascades.
	 */
	"runtime.playthrough",
	"runtime.persistent",
	/**
	 * Library row of a runtime playthrough: product metadata, not save state. For the same reason as
	 * the two above it has no parent and sits at the end (`conversation.ts` in
	 * `@rowcat/runtime-persistence`).
	 */
	"runtime.conversation",
	/**
	 * Character: a child of the room, yet placed last. The parent (`chat.room`) is first, so the
	 * parent-before-child constraint holds wherever this sits. The remaining criterion is that
	 * inserting in the middle shifts the later types and makes them unsafe for an in-progress
	 * collection cursor (the web's same array and the codec list in `@rowcat/chat` place it here for
	 * the same reason).
	 */
	"chat.character",
	/**
	 * Scene: a room child appended at the end for the same reason as characters (the web's array and
	 * the codec list in `@rowcat/chat` place it here too).
	 */
	"chat.scene",
	/**
	 * Custom tools, appended at the end like every new type (the web's array places them the same
	 * way). `chat.tool` has no parent; `authoring.tool` is a draft child, and its parent is earlier.
	 */
	"chat.tool",
	"authoring.tool",
	/** Attachments: a room child appended at the end, like characters (the web's array matches). */
	"chat.attachment",
] as const;

export type SyncType = (typeof TABLE_ORDER)[number];

/** Child type → its order field. Used by sibling normalization (`sync-store.ts`). */
export const CHILD_ORDER_FIELD: Partial<
	Record<SyncType, "position" | "positionIndex">
> = {
	"authoring.lore": "positionIndex",
	"authoring.tool": "positionIndex",
	"authoring.scene": "position",
	"authoring.sceneImage": "position",
	/**
	 * Runtime files are deliberately absent. Normalization renumbers sibling positions, but code files
	 * have no position number: their order is the path, and the path is a value the user chose. Adding
	 * a line here would make sync start renaming files.
	 */
};

export interface RecordTable<T extends SyncRecordShape = SyncRecordShape> {
	readonly type: SyncType;
	readonly table: string;
	/** Column pointing at the parent. Top-level records (room, draft) use null. */
	readonly parent: "room_id" | "draft_id" | null;
	/**
	 * Sibling order column. Null for types with no order.
	 *
	 * `path` is the third value because of the runtime file. Other children's order is a number the
	 * creator chose, read by reordering and position assignment. A code file's order is its path, so
	 * this value is used only in `ORDER BY` and never reaches `nextPosition` or sibling normalization
	 * (the absence of this type from `CHILD_ORDER_FIELD` is the contract).
	 */
	readonly order: "position" | "position_index" | "path" | null;
	fromRow(row: SqlRow): T;
	upsert(tx: SqlRunner, record: T): Promise<void>;
}

/** Row returned by the driver: column name → raw value. */
export type SqlRow = Record<string, unknown>;

/* ── common columns───────────────────────────────────────────────────────────────── */

const text = (value: unknown): string => (value as string) ?? "";
const nullableText = (value: unknown): string | null =>
	value === null || value === undefined ? null : (value as string);
const int = (value: unknown): number => Number(value ?? 0);
/**
 * Nullable integer. Deliberately not folded with `?? 0`: 0 and "absent" are different facts only in
 * columns such as audio duration or image dimensions. Folding would make the screen reserve 0 for
 * that slot, and the symptom is a mis-drawn list rather than an error.
 */
const numberOrNull = (value: unknown): number | null =>
	value === null || value === undefined ? null : Number(value);

const revOf = (row: SqlRow): Rev => ({
	t: int(row.rev_t),
	c: int(row.rev_c),
	d: text(row.rev_d),
});

const metaOf = (
	row: SqlRow,
): Pick<SyncRecordShape, "deletedAt" | "dirty" | "serverVersion" | "rev"> => ({
	deletedAt: nullableText(row.deleted_at),
	dirty: int(row.dirty) === 1 ? 1 : 0,
	serverVersion: int(row.server_version),
	rev: revOf(row),
});

/** The six trailing columns shared by every table. Their order must match the tail of the `INSERT` statement below. */
const metaValues = (record: SyncRecordShape): SqlValue[] => [
	record.deletedAt,
	record.dirty,
	record.serverVersion,
	record.rev.t,
	record.rev.c,
	record.rev.d,
];

const META_COLUMNS =
	"deleted_at, dirty, server_version, rev_t, rev_c, rev_d" as const;

/**
 * `INSERT ... ON CONFLICT DO UPDATE`, the counterpart of Dexie's `put`.
 *
 * Updates are not split into a separate `UPDATE` because callers always pass the whole record
 * (read, then rewritten by a pure function). Asking "does it already exist" first would add a round
 * trip and a new race between the two statements.
 */
function upsertSql(table: string, columns: readonly string[]): string {
	const all = ["id", ...columns, ...META_COLUMNS.split(", ")];
	const placeholders = all.map(() => "?").join(", ");
	const assignments = all
		.filter((column) => column !== "id")
		.map((column) => `${quote(column)} = excluded.${quote(column)}`)
		.join(", ");
	return `INSERT INTO ${table} (${all.map(quote).join(", ")}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${assignments}`;
}

/** `order` is an SQL reserved word. Quoting every column by rule means nobody has to remember that one. */
const quote = (column: string): string => `"${column}"`;

const json = (value: unknown): string => JSON.stringify(value);

/**
 * The room's tool overrides column: a JSON map of tool id to on/off. Anything else (missing column,
 * broken JSON, non-boolean values, an empty map) folds to `undefined`, so the key is not created.
 */
const readToolOverrides = (
	value: unknown,
): Record<string, boolean> | undefined => {
	if (typeof value !== "string" || !value) return undefined;
	try {
		const parsed: unknown = JSON.parse(value);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return undefined;
		const out: Record<string, boolean> = {};
		for (const [key, flag] of Object.entries(parsed))
			if (typeof flag === "boolean") out[key] = flag;
		return Object.keys(out).length > 0 ? out : undefined;
	} catch {
		return undefined;
	}
};
const parseJson = <T>(value: unknown, fallback: T): T => {
	if (typeof value !== "string") return fallback;
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
};

/**
 * Optional fields never create a key.
 *
 * `{ model: undefined }` and `{}` look nearly identical in JavaScript, but the codec's `encode`
 * tells them apart (`withOptional` drops `undefined`). Creating the key here keeps the value off
 * the wire either way, yet local comparisons (tests, merges) read the two records differently.
 */
const withOptional = <T extends object>(
	base: T,
	extra: Record<string, unknown>,
): T => {
	const out = { ...base } as Record<string, unknown>;
	for (const [key, value] of Object.entries(extra))
		if (value !== undefined) out[key] = value;
	return out as T;
};

const optionalInt = (value: unknown): number | undefined =>
	value === null || value === undefined ? undefined : Number(value);

/* ── chat.room ─────────────────────────────────────────────────────────────── */

const ROOM_COLUMNS = [
	"origin_story_id",
	"title",
	"adult",
	"prompt_protected",
	"seed",
	/**
	 * The member's role in this conversation: **one JSON blob** (`{ name, description }`).
	 *
	 * Not split into two columns, which is the opposite of the summary frontier. There the rule is
	 * "both present or both absent", which columns would encode in the schema. Here a role with an
	 * empty description is a complete value. Two columns would make `NULL` and `''` look like they
	 * mean different things, and both would need folding on every read. One blob expresses "no
	 * override" as a single `NULL`.
	 */
	"persona",
	/**
	 * Routing-affinity key. Rows created by older builds hold `NULL`, which is the **correct state**
	 * (not yet issued). The store fills it right before the next generation.
	 *
	 * Without this column sync would silently drop the axis: a key issued on the web arrives on this
	 * device, is stored without the column, and this device's next push uploads a version without the
	 * key (`truncated` was added for the same reason in v7).
	 */
	"routing_session_id",
	/**
	 * This conversation's narration style, **also one JSON blob** for the same reason as the role (`{
	 * scope, density, castTracking }`). The three values are present together or not at all, so one
	 * blob expresses "no pack" as a single `NULL`.
	 *
	 * Without this column sync would silently drop the axis (the routing key was added for the same
	 * reason in v11).
	 */
	"narration",
	/**
	 * User note: **a single `TEXT`** (v19).
	 *
	 * This differs from the narration blob, which is the other side of the same principle: that value
	 * has three parts that must travel together, so they are grouped; this one has a single value and
	 * there is nothing to group.
	 *
	 * Without this column sync would silently drop the axis (narration was added for the same reason
	 * in v17).
	 */
	"user_note",
	/** Tool overrides (v23): one JSON map. No overrides stores `NULL`. */
	"tool_overrides",
	"created_at",
	"updated_at",
] as const;

const ROOM_UPSERT = upsertSql("chat_room", ROOM_COLUMNS);

export const chatRoomTable: RecordTable<ChatRoom> = {
	type: "chat.room",
	table: "chat_room",
	parent: null,
	order: null,
	fromRow: (row) =>
		withOptional<ChatRoom>(
			{
				id: text(row.id),
				originStoryId: nullableText(row.origin_story_id),
				title: text(row.title),
				adult: fromFlag(row.adult),
				promptProtected: fromFlag(row.prompt_protected),
				seed: parseJson<ChatSeed>(row.seed, {} as ChatSeed),
				createdAt: text(row.created_at),
				updatedAt: text(row.updated_at),
				...metaOf(row),
			},
			{
				/**
				 * A missing column or broken JSON both fold to **no override**, and in that case the key is
				 * **not created**.
				 *
				 * Two things hinge on this. Safety: the value is read right before generation
				 * (`effectiveChatPersona`), so throwing on one corrupted row would show the user that **the
				 * conversation is broken**, not the setting. The worst result must be "falls back to the work's
				 * default role". Record shape: the web factory does not create the key, so writing `null` here
				 * would make the same room a different object on the two apps (a difference only two-device
				 * tests reveal).
				 */
				persona:
					parseJson<ChatPersonaSnapshot | null>(row.persona, null) ?? undefined,
				/* A `NULL` creates no key, matching the web factory's shape. */
				routingSessionId: nullableText(row.routing_session_id) ?? undefined,
				/**
				 * Same rule as the role: a missing column, broken JSON, or a value outside today's vocabulary
				 * all fold to **no pack**, and the key is not created.
				 *
				 * Going through `readNarrationSettings` matters. The value is read right before generation, so
				 * a range name left by an older build would pass through, the alias table would yield a key
				 * that does not exist, and the room would quietly run without a pack. Folding here makes that
				 * state explicit, and the screen draws the same answer.
				 */
				narration:
					readNarrationSettings(parseJson(row.narration, null)) ?? undefined,
				/*
				 * An empty string means "no note". If an old row or another device left `""` and it came back
				 * as a key, the room's shape would differ from one where `applyRoomUserNote` cleared the note.
				 */
				userNote: nullableText(row.user_note) || undefined,
				/*
				 * Broken JSON and an empty map both fold to no key, the shape `applyRoomToolOverride`
				 * produces. Folding is the safe side: the worst case is every tool following its default.
				 */
				toolOverrides: readToolOverrides(row.tool_overrides),
			},
		),
	upsert: (tx, record) =>
		tx.run(ROOM_UPSERT, [
			record.id,
			record.originStoryId,
			record.title,
			toFlag(record.adult),
			toFlag(record.promptProtected),
			json(record.seed),
			/* No override stores `NULL`, not the string `"null"`. */
			record.persona ? json(record.persona) : null,
			record.routingSessionId ?? null,
			/* No pack stores `NULL`, not the string `"null"`. */
			record.narration ? json(record.narration) : null,
			/* No note stores `NULL`, not an empty string. */
			record.userNote || null,
			record.toolOverrides && Object.keys(record.toolOverrides).length > 0
				? json(record.toolOverrides)
				: null,
			record.createdAt,
			record.updatedAt,
			...metaValues(record),
		]),
};

/* ── chat.message ──────────────────────────────────────────────────────────── */

const MESSAGE_COLUMNS = [
	"room_id",
	"role",
	"speaker",
	"content",
	"created_at",
	"updated_at",
	"model",
	"input_tokens",
	"cached_input_tokens",
	"cache_write_input_tokens",
	"output_tokens",
	"incomplete",
	"truncated",
] as const;

const MESSAGE_UPSERT = upsertSql("chat_message", MESSAGE_COLUMNS);

export const chatMessageTable: RecordTable<ChatMessage> = {
	type: "chat.message",
	table: "chat_message",
	parent: "room_id",
	order: null,
	fromRow: (row) =>
		withOptional<ChatMessage>(
			{
				id: text(row.id),
				roomId: text(row.room_id),
				role: text(row.role) === "assistant" ? "assistant" : "user",
				speaker: text(row.speaker),
				content: text(row.content),
				createdAt: text(row.created_at),
				updatedAt: text(row.updated_at),
				...metaOf(row),
			},
			{
				model: nullableText(row.model) ?? undefined,
				inputTokens: optionalInt(row.input_tokens),
				cachedInputTokens: optionalInt(row.cached_input_tokens),
				cacheWriteInputTokens: optionalInt(row.cache_write_input_tokens),
				outputTokens: optionalInt(row.output_tokens),
				incomplete:
					row.incomplete === null || row.incomplete === undefined
						? undefined
						: fromFlag(row.incomplete),
				truncated:
					row.truncated === null || row.truncated === undefined
						? undefined
						: fromFlag(row.truncated),
			},
		),
	upsert: (tx, record) =>
		tx.run(MESSAGE_UPSERT, [
			record.id,
			record.roomId,
			record.role,
			record.speaker,
			record.content,
			record.createdAt,
			record.updatedAt,
			record.model ?? null,
			record.inputTokens ?? null,
			record.cachedInputTokens ?? null,
			record.cacheWriteInputTokens ?? null,
			record.outputTokens ?? null,
			record.incomplete === undefined ? null : toFlag(record.incomplete),
			record.truncated === undefined ? null : toFlag(record.truncated),
			...metaValues(record),
		]),
};

/* ── chat.memory ───────────────────────────────────────────────────────────── */

const MEMORY_COLUMNS = [
	"room_id",
	"content",
	"pinned",
	"source",
	"origin_at",
	/**
	 * Who may know a human-written memory (v22), a nullable JSON blob in `chat_scene.audience`'s
	 * spelling. `NULL` is absent, which means shared.
	 */
	"audience",
	"created_at",
	"updated_at",
] as const;

const MEMORY_UPSERT = upsertSql("chat_memory", MEMORY_COLUMNS);

export const chatMemoryTable: RecordTable<ChatMemory> = {
	type: "chat.memory",
	table: "chat_memory",
	parent: "room_id",
	order: null,
	fromRow: (row) => {
		/**
		 * Reads the source **leniently**: an unknown value folds to human-written (`readMemorySource`).
		 * This direction is chosen because the opposite mistake costs more: reading one corrupted row as
		 * `"auto"` makes that memory a target auto-maintenance may delete, which wrongly **deletes the
		 * user's own writing**.
		 */
		const source = readMemorySource(row.source);
		return {
			id: text(row.id),
			roomId: text(row.room_id),
			content: text(row.content),
			pinned: fromFlag(row.pinned),
			source,
			/** A human-written memory's origin time is not read, even if one remains: its origin is not a conversation. */
			originAt: source === "auto" ? nullableText(row.origin_at) : null,
			...memoryAudienceOf(source, row.audience),
			createdAt: text(row.created_at),
			updatedAt: text(row.updated_at),
			...metaOf(row),
		};
	},
	upsert: (tx, record) =>
		tx.run(MEMORY_UPSERT, [
			record.id,
			record.roomId,
			record.content,
			toFlag(record.pinned),
			record.source,
			record.originAt,
			record.source === "user" && record.audience
				? json(audienceJson(record.audience))
				: null,
			record.createdAt,
			record.updatedAt,
			...metaValues(record),
		]),
};

/**
 * A memory's stored audience. `NULL` is absent (shared — every memory from before v22). A present
 * value that no longer parses or breaks the scene rules reads as `narrator`, through the same reader
 * as scenes, rather than as absent: absent would read as **shared**, and a corrupted restriction must
 * never publish the memory to every character. `narrator` withholds it from every character's turn
 * until the user shares it again, which they can see and undo; the opposite mistake they cannot.
 * An automatic memory never carries one (the codec drops it too), so a leftover value is not read.
 */
const memoryAudienceOf = (
	source: ChatMemory["source"],
	value: unknown,
): Pick<ChatMemory, "audience"> =>
	source === "user" && value !== null && value !== undefined
		? { audience: audienceOf(value) }
		: {};

/* ── chat.character ────────────────────────────────────────────────────────── */

const CHARACTER_COLUMNS = [
	"room_id",
	"name",
	"prompt",
	/**
	 * Former names (v21), a nullable JSON array. Read back through `normalizeCharacterAliases`, and
	 * an empty list creates no key: the codec decodes "none" as an absent field, and a local `[]`
	 * would read as a different record in comparisons.
	 */
	"aliases",
	"created_at",
	"updated_at",
] as const;

const CHARACTER_UPSERT = upsertSql("chat_character", CHARACTER_COLUMNS);

/**
 * A character added to this conversation. It is a child with the **same shape** as a memory.
 *
 * Splitting the fields into two columns (name and prompt) is where this differs from the role
 * (`persona`, one JSON blob). There the role is one field of the room record, so "no override" had
 * to be expressed as one `NULL`. Here the row itself exists or does not, so the problem does not
 * arise. The name is also a value that list sorting and search may later read, so having it as a
 * column is more exact.
 */
export const chatCharacterTable: RecordTable<ChatCharacter> = {
	type: "chat.character",
	table: "chat_character",
	parent: "room_id",
	order: null,
	fromRow: (row) => ({
		id: text(row.id),
		roomId: text(row.room_id),
		name: text(row.name),
		prompt: text(row.prompt),
		...aliasesOf(row.aliases, text(row.name)),
		createdAt: text(row.created_at),
		updatedAt: text(row.updated_at),
		...metaOf(row),
	}),
	upsert: (tx, record) =>
		tx.run(CHARACTER_UPSERT, [
			record.id,
			record.roomId,
			record.name,
			record.prompt,
			record.aliases && record.aliases.length > 0 ? json(record.aliases) : null,
			record.createdAt,
			record.updatedAt,
			...metaValues(record),
		]),
};

const aliasesOf = (value: unknown, name: string): { aliases?: string[] } => {
	const stored = parseJson<unknown>(value, null);
	const aliases = normalizeCharacterAliases(
		Array.isArray(stored)
			? stored.filter((alias): alias is string => typeof alias === "string")
			: [],
		name,
	);
	return aliases.length > 0 ? { aliases } : {};
};

/* ── chat.scene ────────────────────────────────────────────────────────────── */

const CHAT_SCENE_COLUMNS = [
	"room_id",
	"start_created_at",
	"start_message_id",
	"audience",
	"created_at",
	"updated_at",
] as const;

const CHAT_SCENE_UPSERT = upsertSql("chat_scene", CHAT_SCENE_COLUMNS);

/**
 * A stored audience that no longer parses or breaks the rules reads as `narrator`, the narrowest
 * audience. It does not throw (that would revert a whole sync page for one row), and it never widens:
 * reading a broken private scene as `room` would publish it to every character.
 */
const audienceOf = (value: unknown): ChatSceneAudience => {
	const stored = parseJson<unknown>(value, null);
	if (stored && typeof stored === "object" && "kind" in stored) {
		const kind = (stored as { kind: unknown }).kind;
		if (kind === "room" || kind === "narrator") return { kind };
		const members = (stored as { members?: unknown }).members;
		if (kind === "participants" && Array.isArray(members)) {
			const checked = normalizeSceneAudience({
				kind: "participants",
				members: members.filter((m): m is string => typeof m === "string"),
			});
			if (checked.ok) return checked.audience;
		}
	}
	return { kind: "narrator" };
};

/** The stored spelling of an audience (no stray keys from the in-memory value). */
const audienceJson = (audience: ChatSceneAudience): ChatSceneAudience =>
	audience.kind === "participants"
		? { kind: "participants", members: audience.members }
		: { kind: audience.kind };

/**
 * Who witnessed which part of the conversation: the room's fifth child, the same shape of child as
 * a character. The audience is one JSON column (see v21 in `migrations.ts`).
 */
export const chatSceneTable: RecordTable<ChatScene> = {
	type: "chat.scene",
	table: "chat_scene",
	parent: "room_id",
	order: null,
	fromRow: (row) => ({
		id: text(row.id),
		roomId: text(row.room_id),
		startAt: {
			createdAt: text(row.start_created_at),
			messageId: text(row.start_message_id),
		},
		audience: audienceOf(row.audience),
		createdAt: text(row.created_at),
		updatedAt: text(row.updated_at),
		...metaOf(row),
	}),
	upsert: (tx, record) =>
		tx.run(CHAT_SCENE_UPSERT, [
			record.id,
			record.roomId,
			record.startAt.createdAt,
			record.startAt.messageId,
			json(audienceJson(record.audience)),
			record.createdAt,
			record.updatedAt,
			...metaValues(record),
		]),
};

/* ── chat.attachment ───────────────────────────────────────────────────────── */

const CHAT_ATTACHMENT_COLUMNS = [
	"room_id",
	"name",
	"content",
	"created_at",
	"updated_at",
] as const;

const CHAT_ATTACHMENT_UPSERT = upsertSql(
	"chat_attachment",
	CHAT_ATTACHMENT_COLUMNS,
);

/**
 * A text file attached to the conversation (`attachment.ts`): the room's sixth child, the same shape
 * of child as a character. This app has no screen for it yet; the table exists so a file attached on
 * the web arrives, rides this device's turns, and is not dropped by its next push.
 */
export const chatAttachmentTable: RecordTable<ChatAttachment> = {
	type: "chat.attachment",
	table: "chat_attachment",
	parent: "room_id",
	order: null,
	fromRow: (row) => ({
		id: text(row.id),
		roomId: text(row.room_id),
		name: text(row.name),
		content: text(row.content),
		createdAt: text(row.created_at),
		updatedAt: text(row.updated_at),
		...metaOf(row),
	}),
	upsert: (tx, record) =>
		tx.run(CHAT_ATTACHMENT_UPSERT, [
			record.id,
			record.roomId,
			record.name,
			record.content,
			record.createdAt,
			record.updatedAt,
			...metaValues(record),
		]),
};

/* ── chat.summary ──────────────────────────────────────────────────────────── */

const SUMMARY_COLUMNS = [
	"room_id",
	"summary",
	"frontier_created_at",
	"frontier_message_id",
	"epoch",
	"created_at",
	"updated_at",
] as const;

const SUMMARY_UPSERT = upsertSql("chat_summary", SUMMARY_COLUMNS);

export const chatSummaryTable: RecordTable<ChatSummary> = {
	type: "chat.summary",
	table: "chat_summary",
	parent: "room_id",
	order: null,
	fromRow: (row) => {
		/**
		 * The two frontier columns are read **together**: a row with only one of them is not a frontier.
		 *
		 * That state is not produced by the normal path (writes always set both), but it is possible with
		 * a corrupted row or a database edited by hand. Folding it to absent errs on the safe side: the
		 * history rewind treats a summary with text but no frontier as covering unknown history and
		 * retires it on any rewrite (`planHistoryRewind`).
		 * (A historical Memory V2 record: decoded and synced, never advanced.)
		 */
		const createdAt = nullableText(row.frontier_created_at);
		const messageId = nullableText(row.frontier_message_id);
		return {
			id: text(row.id),
			roomId: text(row.room_id),
			summary: text(row.summary),
			frontier:
				createdAt !== null && messageId !== null
					? { createdAt, messageId }
					: null,
			epoch: int(row.epoch),
			createdAt: text(row.created_at),
			updatedAt: text(row.updated_at),
			...metaOf(row),
		};
	},
	upsert: (tx, record) =>
		tx.run(SUMMARY_UPSERT, [
			record.id,
			record.roomId,
			record.summary,
			record.frontier?.createdAt ?? null,
			record.frontier?.messageId ?? null,
			record.epoch,
			record.createdAt,
			record.updatedAt,
			...metaValues(record),
		]),
};

/* ── authoring.draft ───────────────────────────────────────────────────────── */

const DRAFT_COLUMNS = [
	"schema_version",
	"title",
	"tagline",
	"description",
	"tags",
	"orientation",
	"adult",
	"visibility",
	"prompt_protected",
	"prompt",
	"default_start_scene_id",
	"published_story_id",
	"field_rev",
	"created_at",
	"updated_at",
] as const;

const DRAFT_UPSERT = upsertSql("authoring_draft", DRAFT_COLUMNS);

export const authoringDraftTable: RecordTable<StoryDraft> = {
	type: "authoring.draft",
	table: "authoring_draft",
	parent: null,
	order: null,
	fromRow: (row) => ({
		id: text(row.id),
		schemaVersion: int(row.schema_version) as StoryDraft["schemaVersion"],
		title: text(row.title),
		tagline: text(row.tagline),
		description: text(row.description),
		tags: parseJson<string[]>(row.tags, []),
		orientation: nullableText(row.orientation) as Orientation | null,
		adult: fromFlag(row.adult),
		visibility: text(row.visibility) as StoryVisibility,
		promptProtected: fromFlag(row.prompt_protected),
		prompt: text(row.prompt),
		defaultStartSceneId: nullableText(row.default_start_scene_id),
		publishedStoryId: nullableText(row.published_story_id),
		fieldRev: parseJson<StoryDraft["fieldRev"]>(
			row.field_rev,
			{} as StoryDraft["fieldRev"],
		),
		createdAt: text(row.created_at),
		updatedAt: text(row.updated_at),
		...metaOf(row),
	}),
	upsert: (tx, record) =>
		tx.run(DRAFT_UPSERT, [
			record.id,
			record.schemaVersion,
			record.title,
			record.tagline,
			record.description,
			json(record.tags),
			record.orientation,
			toFlag(record.adult),
			record.visibility,
			toFlag(record.promptProtected),
			record.prompt,
			record.defaultStartSceneId,
			record.publishedStoryId,
			json(record.fieldRev),
			record.createdAt,
			record.updatedAt,
			...metaValues(record),
		]),
};

/* ── authoring.lore ────────────────────────────────────────────────────────── */

const LORE_COLUMNS = [
	"draft_id",
	"position_index",
	"keys",
	"content",
	"constant",
	"position",
	"order",
	"created_at",
	"updated_at",
] as const;

const LORE_UPSERT = upsertSql("authoring_lore", LORE_COLUMNS);

export const authoringLoreTable: RecordTable<DraftLoreEntry> = {
	type: "authoring.lore",
	table: "authoring_lore",
	parent: "draft_id",
	order: "position_index",
	fromRow: (row) => ({
		id: text(row.id),
		draftId: text(row.draft_id),
		positionIndex: int(row.position_index),
		keys: parseJson<string[]>(row.keys, []),
		content: text(row.content),
		constant: fromFlag(row.constant),
		position: text(row.position) as ChatLorePosition,
		order: int(row.order),
		createdAt: text(row.created_at),
		updatedAt: text(row.updated_at),
		...metaOf(row),
	}),
	upsert: (tx, record) =>
		tx.run(LORE_UPSERT, [
			record.id,
			record.draftId,
			record.positionIndex,
			json(record.keys),
			record.content,
			toFlag(record.constant),
			record.position,
			record.order,
			record.createdAt,
			record.updatedAt,
			...metaValues(record),
		]),
};

/* ── authoring.scene ───────────────────────────────────────────────────────── */

const SCENE_COLUMNS = [
	"draft_id",
	"position",
	"title",
	"content",
	"created_at",
	"updated_at",
] as const;

const SCENE_UPSERT = upsertSql("authoring_scene", SCENE_COLUMNS);

export const authoringSceneTable: RecordTable<DraftStartScene> = {
	type: "authoring.scene",
	table: "authoring_scene",
	parent: "draft_id",
	order: "position",
	fromRow: (row) => ({
		id: text(row.id),
		draftId: text(row.draft_id),
		position: int(row.position),
		title: text(row.title),
		content: text(row.content),
		createdAt: text(row.created_at),
		updatedAt: text(row.updated_at),
		...metaOf(row),
	}),
	upsert: (tx, record) =>
		tx.run(SCENE_UPSERT, [
			record.id,
			record.draftId,
			record.position,
			record.title,
			record.content,
			record.createdAt,
			record.updatedAt,
			...metaValues(record),
		]),
};

/* ── authoring.sceneImage ──────────────────────────────────────────────────── */

const SCENE_IMAGE_COLUMNS = [
	"draft_id",
	"position",
	"trigger",
	"asset_id",
	"created_at",
	"updated_at",
] as const;

const SCENE_IMAGE_UPSERT = upsertSql(
	"authoring_scene_image",
	SCENE_IMAGE_COLUMNS,
);

/**
 * Scene image. It holds only a reference and a name, so it has six columns.
 *
 * Having no bytes is the whole character of this table. The picture lives on the server (`media`);
 * what is stored here is the name that calls the picture and the id it points at. The row therefore
 * sizes the same as other child records when it travels in a sync envelope.
 *
 * The table exists although this app has no authoring screen, for the same reason as lore and start
 * scenes: **this device must also hold a complete copy of the draft.** Without it a picture
 * attached on the Mac would vanish on this device alone, and when this app gains an editor later
 * those drafts would already be damaged.
 */
export const authoringSceneImageTable: RecordTable<DraftSceneImage> = {
	type: "authoring.sceneImage",
	table: "authoring_scene_image",
	parent: "draft_id",
	order: "position",
	fromRow: (row) => ({
		id: text(row.id),
		draftId: text(row.draft_id),
		position: int(row.position),
		trigger: text(row.trigger),
		assetId: text(row.asset_id),
		createdAt: text(row.created_at),
		updatedAt: text(row.updated_at),
		...metaOf(row),
	}),
	upsert: (tx, record) =>
		tx.run(SCENE_IMAGE_UPSERT, [
			record.id,
			record.draftId,
			record.position,
			record.trigger,
			record.assetId,
			record.createdAt,
			record.updatedAt,
			...metaValues(record),
		]),
};

/* ── authoring.runtimeProject ──────────────────────────────────────────────── */

const RUNTIME_PROJECT_COLUMNS = [
	"draft_id",
	"enabled",
	"entry",
	"created_at",
	"updated_at",
] as const;

const RUNTIME_PROJECT_UPSERT = upsertSql(
	"authoring_runtime_project",
	RUNTIME_PROJECT_COLUMNS,
);

/**
 * Runtime project: **one row per draft.**
 *
 * `order` is null because there are no siblings (one per draft). Its `parent` is still `draft_id`:
 * draft deletion's cascade must take this row along, and that decision rests on this single value.
 *
 * The table exists although this app has no authoring screen, for the same reason as scene images:
 * **this device must also hold a complete copy of the draft.** Without it a runtime turned on on
 * the Mac would look off on this device alone, and this device's next push would record that fact
 * on the server.
 */
export const authoringRuntimeProjectTable: RecordTable<DraftRuntimeProject> = {
	type: "authoring.runtimeProject",
	table: "authoring_runtime_project",
	parent: "draft_id",
	order: null,
	fromRow: (row) => ({
		id: text(row.id),
		draftId: text(row.draft_id),
		enabled: fromFlag(row.enabled),
		entry: text(row.entry),
		createdAt: text(row.created_at),
		updatedAt: text(row.updated_at),
		...metaOf(row),
	}),
	upsert: (tx, record) =>
		tx.run(RUNTIME_PROJECT_UPSERT, [
			record.id,
			record.draftId,
			toFlag(record.enabled),
			record.entry,
			record.createdAt,
			record.updatedAt,
			...metaValues(record),
		]),
};

/* ── authoring.runtimeFile ─────────────────────────────────────────────────── */

const RUNTIME_FILE_COLUMNS = [
	"draft_id",
	"path",
	"content",
	"created_at",
	"updated_at",
] as const;

const RUNTIME_FILE_UPSERT = upsertSql(
	"authoring_runtime_file",
	RUNTIME_FILE_COLUMNS,
);

/**
 * Runtime source file: **only a path and a body.**
 *
 * Compiled output, bundles and source maps are not stored. Derived artifacts should be built once
 * there is something to derive from. Caching them now would invalidate every cache the day the
 * compiler arrives, and in the meantime the sync envelope would just double in size.
 */
export const authoringRuntimeFileTable: RecordTable<DraftRuntimeFile> = {
	type: "authoring.runtimeFile",
	table: "authoring_runtime_file",
	parent: "draft_id",
	order: "path",
	fromRow: (row) => ({
		id: text(row.id),
		draftId: text(row.draft_id),
		path: text(row.path),
		content: text(row.content),
		createdAt: text(row.created_at),
		updatedAt: text(row.updated_at),
		...metaOf(row),
	}),
	upsert: (tx, record) =>
		tx.run(RUNTIME_FILE_UPSERT, [
			record.id,
			record.draftId,
			record.path,
			record.content,
			record.createdAt,
			record.updatedAt,
			...metaValues(record),
		]),
};

/* ── authoring.runtimeAsset ────────────────────────────────────────────────── */

const RUNTIME_ASSET_COLUMNS = [
	"draft_id",
	"path",
	"kind",
	"asset_id",
	"mime",
	"width",
	"height",
	"duration_ms",
	"created_at",
	"updated_at",
] as const;

const RUNTIME_ASSET_UPSERT = upsertSql(
	"authoring_runtime_asset",
	RUNTIME_ASSET_COLUMNS,
);

/**
 * Managed image binding: **a logical name and a media identity.**
 *
 * `order` is `path` for the same reason as files (the name is the position within the project). It
 * is a **sibling** of files rather than a child, so its `parent` is also `draft_id`, and draft
 * deletion's cascade takes this row along.
 *
 * **No bytes.** Only a media identity is carried; the picture lives in RowCat media. Scene images
 * make the same decision in the same place for the same reason: a draft envelope must not grow to
 * megabytes, and the same picture must not be duplicated once per draft.
 *
 * Dimensions and format live together because this device has **no way to re-derive them**: this
 * store has no media-metadata lookup, so an asset list for a draft that arrived through sync cannot
 * state its dimensions until the picture is downloaded.
 */
export const authoringRuntimeAssetTable: RecordTable<DraftRuntimeAsset> = {
	type: "authoring.runtimeAsset",
	table: "authoring_runtime_asset",
	parent: "draft_id",
	order: "path",
	fromRow: (row) => {
		/**
		 * **An absent `kind` means `image`.** The v16 backfill fills it, so the normal path always has a
		 * value, but this line does not rely on that one UPDATE. On a device whose migration died midway,
		 * without this line the app's whole asset list would fail to draw.
		 */
		const kind = text(row.kind) === "audio" ? "audio" : "image";
		return {
			id: text(row.id),
			draftId: text(row.draft_id),
			path: text(row.path),
			kind,
			assetId: text(row.asset_id),
			mime: text(row.mime),
			/**
			 * `null` rather than `?? 0`. Zero would be the state "a picture 0 wide", which does not exist,
			 * and that value would be drawn straight into the list. Absence is recorded as absence.
			 */
			width: kind === "image" ? numberOrNull(row.width) : null,
			height: kind === "image" ? numberOrNull(row.height) : null,
			durationMs: kind === "audio" ? numberOrNull(row.duration_ms) : null,
			createdAt: text(row.created_at),
			updatedAt: text(row.updated_at),
			...metaOf(row),
		};
	},
	upsert: (tx, record) =>
		tx.run(RUNTIME_ASSET_UPSERT, [
			record.id,
			record.draftId,
			record.path,
			record.kind,
			record.assetId,
			record.mime,
			record.width,
			record.height,
			record.durationMs,
			record.createdAt,
			record.updatedAt,
			...metaValues(record),
		]),
};

/* ── chat.persona ──────────────────────────────────────────────────────────── */

const PERSONA_COLUMNS = [
	"name",
	"description",
	"created_at",
	"updated_at",
] as const;

const PERSONA_UPSERT = upsertSql("chat_persona", PERSONA_COLUMNS);

/**
 * A row of the persona library.
 *
 * `parent` being `null` is the most important value in this table. It sits in the same position as
 * rooms and drafts, so a room tombstone cascade never sweeps this table. The library is an account
 * asset, not a child of a conversation.
 */
export const chatPersonaTable: RecordTable<ChatPersona> = {
	type: "chat.persona",
	table: "chat_persona",
	parent: null,
	order: null,
	fromRow: (row) => ({
		id: text(row.id),
		name: text(row.name),
		description: text(row.description),
		createdAt: text(row.created_at),
		updatedAt: text(row.updated_at),
		...metaOf(row),
	}),
	upsert: (tx, record) =>
		tx.run(PERSONA_UPSERT, [
			record.id,
			record.name,
			record.description,
			record.createdAt,
			record.updatedAt,
			...metaValues(record),
		]),
};

/* ── chat.tool ─────────────────────────────────────────────────────────────── */

const USER_TOOL_COLUMNS = [
	"tool",
	"enabled_by_default",
	"created_at",
	"updated_at",
] as const;

const USER_TOOL_UPSERT = upsertSql("chat_tool", USER_TOOL_COLUMNS);

/**
 * A row of the user's tool library. `parent: null` for the persona table's reason: room tombstones
 * never sweep it. The definition is stored as written; it was validated on the way in (storage and
 * the sync codec both run the contract).
 */
export const chatUserToolTable: RecordTable<ChatUserTool> = {
	type: "chat.tool",
	table: "chat_tool",
	parent: null,
	order: null,
	fromRow: (row) => ({
		id: text(row.id),
		tool: parseJson<ChatUserTool["tool"]>(row.tool, {} as ChatUserTool["tool"]),
		enabledByDefault: fromFlag(row.enabled_by_default),
		createdAt: text(row.created_at),
		updatedAt: text(row.updated_at),
		...metaOf(row),
	}),
	upsert: (tx, record) =>
		tx.run(USER_TOOL_UPSERT, [
			record.id,
			json(record.tool),
			toFlag(record.enabledByDefault),
			record.createdAt,
			record.updatedAt,
			...metaValues(record),
		]),
};

/* ── authoring.tool ────────────────────────────────────────────────────────── */

const DRAFT_TOOL_COLUMNS = [
	"draft_id",
	"position_index",
	"name",
	"description",
	"parameters",
	"kind",
	"template",
	"entries",
	"draws",
	"system",
	"max_output_tokens",
	"created_at",
	"updated_at",
] as const;

const DRAFT_TOOL_UPSERT = upsertSql("authoring_tool", DRAFT_TOOL_COLUMNS);

export const authoringToolTable: RecordTable<DraftTool> = {
	type: "authoring.tool",
	table: "authoring_tool",
	parent: "draft_id",
	order: "position_index",
	fromRow: (row) => ({
		id: text(row.id),
		draftId: text(row.draft_id),
		positionIndex: int(row.position_index),
		name: text(row.name),
		description: text(row.description),
		parameters: parseJson<DraftTool["parameters"]>(row.parameters, []),
		kind: text(row.kind) as DraftTool["kind"],
		template: text(row.template),
		entries: parseJson<string[]>(row.entries, []),
		draws: int(row.draws),
		system: text(row.system),
		maxOutputTokens: int(row.max_output_tokens),
		createdAt: text(row.created_at),
		updatedAt: text(row.updated_at),
		...metaOf(row),
	}),
	upsert: (tx, record) =>
		tx.run(DRAFT_TOOL_UPSERT, [
			record.id,
			record.draftId,
			record.positionIndex,
			record.name,
			record.description,
			json(record.parameters),
			record.kind,
			record.template,
			json(record.entries),
			record.draws,
			record.system,
			record.maxOutputTokens,
			record.createdAt,
			record.updatedAt,
			...metaValues(record),
		]),
};

/* ── runtime.playthrough ──────────────────────────────────────────────────── */

const RUNTIME_PLAYTHROUGH_COLUMNS = [
	"story_id",
	"slot",
	"snapshot",
	"updated_at",
] as const;

const RUNTIME_PLAYTHROUGH_UPSERT = upsertSql(
	"runtime_playthrough",
	RUNTIME_PLAYTHROUGH_COLUMNS,
);

/**
 * The current save of a playthrough: **one per work per slot.**
 *
 * `parent` being `null` is the most important value in this table. It sits in the same position as
 * drafts and rooms, so no tombstone cascade sweeps this table. Progress from playing someone else's
 * work lives here, and that work's draft is not on this device at all.
 *
 * The snapshot is one JSON blob because its shape is arbitrary, chosen by the creator. Splitting it
 * into columns would require the schema to know that shape, which this contract avoided from the
 * start.
 */
export const runtimePlaythroughTable: RecordTable<RuntimePlaythroughRecord> = {
	type: "runtime.playthrough",
	table: "runtime_playthrough",
	parent: null,
	order: null,
	fromRow: (row) => ({
		id: text(row.id),
		storyId: text(row.story_id),
		slot: isRuntimeSaveSlot(row.slot) ? row.slot : DEFAULT_RUNTIME_SAVE_SLOT,
		snapshot: parseJson(row.snapshot, EMPTY_SNAPSHOT),
		updatedAt: text(row.updated_at),
		...metaOf(row),
	}),
	upsert: (tx, record) =>
		tx.run(RUNTIME_PLAYTHROUGH_UPSERT, [
			record.id,
			record.storyId,
			record.slot,
			json(record.snapshot),
			record.updatedAt,
			...metaValues(record),
		]),
};

/* ── runtime.persistent ───────────────────────────────────────────────────── */

const RUNTIME_PERSISTENT_COLUMNS = [
	"story_id",
	"snapshot",
	"updated_at",
] as const;

const RUNTIME_PERSISTENT_UPSERT = upsertSql(
	"runtime_persistent",
	RUNTIME_PERSISTENT_COLUMNS,
);

/** Long-term progress of a member and a work. **There is no slot axis.** */
export const runtimePersistentTable: RecordTable<RuntimePersistentRecord> = {
	type: "runtime.persistent",
	table: "runtime_persistent",
	parent: null,
	order: null,
	fromRow: (row) => ({
		id: text(row.id),
		storyId: text(row.story_id),
		snapshot: parseJson(row.snapshot, EMPTY_SNAPSHOT),
		updatedAt: text(row.updated_at),
		...metaOf(row),
	}),
	upsert: (tx, record) =>
		tx.run(RUNTIME_PERSISTENT_UPSERT, [
			record.id,
			record.storyId,
			json(record.snapshot),
			record.updatedAt,
			...metaValues(record),
		]),
};

/* ── runtime.conversation ─────────────────────────────────────────────────── */

const RUNTIME_CONVERSATION_COLUMNS = [
	"story_id",
	"slot",
	"title",
	"created_at",
	"updated_at",
	"removed_at",
] as const;

const RUNTIME_CONVERSATION_UPSERT = upsertSql(
	"runtime_conversation",
	RUNTIME_CONVERSATION_COLUMNS,
);

/**
 * Library row of a runtime playthrough. It is **different** from the two save tables above.
 *
 * Those hold the player's progress (snapshots); this holds product metadata: "this work was opened
 * and can be continued". `removed_at` marks removal from the list and is not a tombstone. Reopening
 * must bring it back under the same identity, and protocol tombstones cannot be revived (see the
 * header of `conversation.ts`).
 */
export const runtimeConversationTable: RecordTable<RuntimeConversationRecord> =
	{
		type: "runtime.conversation",
		table: "runtime_conversation",
		parent: null,
		order: null,
		fromRow: (row) => ({
			id: text(row.id),
			storyId: text(row.story_id),
			slot: isRuntimeSaveSlot(row.slot) ? row.slot : DEFAULT_RUNTIME_SAVE_SLOT,
			title: text(row.title),
			createdAt: text(row.created_at),
			updatedAt: text(row.updated_at),
			removedAt: nullableText(row.removed_at),
			...metaOf(row),
		}),
		upsert: (tx, record) =>
			tx.run(RUNTIME_CONVERSATION_UPSERT, [
				record.id,
				record.storyId,
				record.slot,
				record.title,
				record.createdAt,
				record.updatedAt,
				record.removedAt,
				...metaValues(record),
			]),
	};

/**
 * The value when stored JSON is broken: an **empty snapshot**.
 *
 * It does not throw because of where this runs: in the middle of sync applying a page, and a throw
 * here would revert **the whole page** for one broken line. Whether the row can actually be used is
 * re-checked by the playback surface (`load()` in `@rowcat/runtime-persistence`, which reports the
 * corruption rather than overwriting it).
 */
const EMPTY_SNAPSHOT = { formatVersion: 1, entries: [] } as const;

/**
 * Type → table. **This one table serves every sync type.**
 *
 * Returning null for an unknown type is part of the contract. The server has no type vocabulary, so
 * a new type created by a newer device can reach this device. This device must then **ignore it and
 * advance the cursor** (blocking would stop sync forever on that one record).
 */
const BY_TYPE: Record<SyncType, RecordTable> = {
	"chat.room": chatRoomTable as RecordTable,
	"chat.message": chatMessageTable as RecordTable,
	"chat.memory": chatMemoryTable as RecordTable,
	"chat.character": chatCharacterTable as RecordTable,
	"chat.scene": chatSceneTable as RecordTable,
	"chat.attachment": chatAttachmentTable as RecordTable,
	"chat.summary": chatSummaryTable as RecordTable,
	"authoring.draft": authoringDraftTable as RecordTable,
	"authoring.lore": authoringLoreTable as RecordTable,
	"authoring.scene": authoringSceneTable as RecordTable,
	"authoring.sceneImage": authoringSceneImageTable as RecordTable,
	"authoring.runtimeProject": authoringRuntimeProjectTable as RecordTable,
	"authoring.runtimeFile": authoringRuntimeFileTable as RecordTable,
	"authoring.runtimeAsset": authoringRuntimeAssetTable as RecordTable,
	"chat.persona": chatPersonaTable as RecordTable,
	"chat.tool": chatUserToolTable as RecordTable,
	"authoring.tool": authoringToolTable as RecordTable,
	"runtime.playthrough": runtimePlaythroughTable as RecordTable,
	"runtime.persistent": runtimePersistentTable as RecordTable,
	"runtime.conversation": runtimeConversationTable as RecordTable,
};

export const tableOf = (type: string): RecordTable | null =>
	BY_TYPE[type as SyncType] ?? null;
