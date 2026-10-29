import type {
	DraftLoreEntry,
	DraftRuntimeAsset,
	DraftRuntimeFile,
	DraftRuntimeProject,
	DraftSceneImage,
	DraftStartScene,
	LegacyDraftCharacterBody,
	StoryDraft,
} from "@rowcat/authoring";
import {
	AUTHORING_SCHEMA_VERSION,
	foldLegacyDraftBody,
} from "@rowcat/authoring";
import type {
	ChatCharacter,
	ChatMemory,
	ChatMessage,
	ChatPersona,
	ChatRoom,
	ChatSummary,
} from "@rowcat/chat";
import type { Rev } from "@rowcat/contracts/sync";
import type {
	RuntimeConversationRecord,
	RuntimePersistentRecord,
	RuntimePlaythroughRecord,
} from "@rowcat/runtime-persistence";
import type { SyncRecoveryRecord } from "@rowcat/sync";
import { type HlcState, tickHlc } from "@rowcat/sync";
import Dexie, { type Table, type Transaction } from "dexie";
import type { StoredDraftCover } from "../local-authoring/draft-cover.ts";
import type { StoredGenerationPreference } from "../local-generation/record.ts";
import type { StoredProviderConnection } from "../local-provider/record.ts";
import { newDeviceId } from "./clock.ts";
import {
	createLocalSyncState,
	type LocalSyncState,
	SYNC_STATE_KEY,
} from "./sync-state.ts";

/**
 * The per-member local database and the canonical store of this app. Conversations and authoring
 * data live here, not in PostgreSQL. The server has no conversation or draft tables and will not
 * get them; even with sync, it sees only encrypted copies. Treat this as a database rather than a
 * cache: schema changes are migrations, names cannot change, and deleting it loses user work.
 *
 * The two domains share one database on purpose. Sync must write a record change and its outbox
 * metadata in one transaction, and IndexedDB transactions are atomic only within a single database.
 * Splitting by domain would make that atomicity impossible, and merging later would mean migrating
 * users' device data.
 *
 * Dexie lives in the web app, not the shared package, because storage differs per platform. Expo
 * will use SQLite. Both implementations fill the same ports (`ChatStore`, `AuthoringStore`), and
 * the rules on those ports live in the shared package.
 */

/**
 * Do not change this prefix. Users' conversations are already stored under this name. The class
 * widened from `ChatDb` to `LocalDb` when the authoring store was added, but renaming the physical
 * database would make existing data unreachable for every user. The name is an address, not a
 * schema.
 */
const DB_NAME_PREFIX = "rowcat_chat";

/**
 * Normalizes a member code for use in an IndexedDB name. More important than stripping bad
 * characters is that different members never fold into the same name. Member IDs are 32-character
 * hex strings we issue, so the replacement never matches today. If the ID format changes, this
 * function must be revisited.
 */
const dbNameSuffix = (viewerId: string): string =>
	viewerId.replace(/[^A-Za-z0-9_-]/g, "_");

const scopedDbName = (viewerId: string): string =>
	`${DB_NAME_PREFIX}_${dbNameSuffix(viewerId)}`;

/**
 * Columns the upgrade touches, deliberately not typed as record types. Migrations read rows in the
 * old shape, not today's `ChatRoom` or `StoryDraft`. Typing them with the latest types would make
 * the compiler claim fields such as `rev` exist when they do not, and that lie would only break
 * when the migration actually runs.
 */
interface UpgradableRow {
	dirty?: unknown;
	updatedAt?: unknown;
	deletedAt?: unknown;
	rev?: unknown;
	fieldRev?: unknown;
}

/**
 * Folds a boolean `dirty` to 0 or 1. Only `false` and `0` count as clean; anything else (undefined,
 * strings, corrupt values) is dirty. The direction matters: a clean record misread as dirty costs
 * one extra push, but a dirty record misread as clean is never pushed, and the user loses a
 * conversation that exists only on this device.
 */
const toDirtyFlag = (value: unknown): 0 | 1 =>
	value === false || value === 0 ? 0 : 1;

/**
 * Builds a revision for an existing record from its stored `updatedAt`. There is no per-group
 * history, so the counter starts at 0. Inventing more precision would let merge treat the record as
 * conflict-free.
 *
 * If the time cannot be parsed, use 0. `NaN` or a negative value would fall out of the total order,
 * where every comparison is false. Zero means 'oldest', so any new edit wins, which is the safe way
 * to be wrong.
 */
function backfilledRev(updatedAt: unknown, deviceId: string): Rev {
	const parsed =
		typeof updatedAt === "string" ? Date.parse(updatedAt) : Number.NaN;
	const t = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
	return { t, c: 0, d: deviceId };
}

export class LocalDb extends Dexie {
	rooms!: Table<ChatRoom, string>;
	messages!: Table<ChatMessage, string>;
	/**
	 * Per-room memory: a table of the same class as rooms and messages, with all sync axes. It differs
	 * from the device-preference tables below. The protocol does not know those, but memory is
	 * conversation content and must follow trusted devices. That is why it appears in both the codec
	 * registry and the sync store's type-to-table map.
	 */
	chatMemories!: Table<ChatMemory, string>;
	chatCharacters!: Table<ChatCharacter, string>;
	storyDrafts!: Table<StoryDraft, string>;
	draftLoreEntries!: Table<DraftLoreEntry, string>;
	draftStartScenes!: Table<DraftStartScene, string>;
	/**
	 * Scene images: the same class as lore and start scenes, with all sync axes. It differs from
	 * `draftCovers`. That table holds image bytes that live only until publishing, while this one
	 * holds references and words, which are part of the manuscript. A picture pinned on Mac would
	 * otherwise be missing on the phone and make the draft a different work on each device. The bytes
	 * live on the server (`media` table).
	 */
	draftSceneImages!: Table<DraftSceneImage, string>;
	/**
	 * Code project attached to a draft, with one row per draft and the primary key derived from the
	 * draft. Drafts that do not use the runtime have no row, so an empty table means exactly 'this
	 * account does not use the runtime'. A boolean column on every draft root would make all drafts
	 * carry that axis.
	 */
	draftRuntimeProjects!: Table<DraftRuntimeProject, string>;
	/**
	 * Source files of that project, an authoring original with all sync axes. Code written on Mac but
	 * missing from the phone's copy would make the draft a different work per device, and publishing
	 * in that state would leave no way to tell which version went up.
	 *
	 * Compiled output is not stored. Only what the creator typed is kept. Derived artifacts come after
	 * something derivable exists, and a cache built now would be invalidated entirely once the
	 * compiler arrives.
	 */
	draftRuntimeFiles!: Table<DraftRuntimeFile, string>;
	/**
	 * Images the project refers to by logical name, one reference each. They are kept apart from the
	 * files table because the content differs: a file holds what the creator typed, whereas this table
	 * holds the RowCat media identity. Folding both into one table would make that column binary or
	 * empty.
	 *
	 * The bytes are not here. An image uploads to the server as soon as it is picked (`POST
	 * /me/runtime-assets`), and only the reference is kept. For a draft to be self-contained, the
	 * reference must resolve on other devices too, and a local value without bytes means nothing
	 * elsewhere.
	 */
	draftRuntimeAssets!: Table<DraftRuntimeAsset, string>;
	/**
	 * Player's current progress: one slot per work, with the primary key derived from the work. The
	 * authoring tables above hold the manuscript a creator wrote; these hold progress a player made,
	 * including playthroughs of other people's works.
	 *
	 * A reset does not delete the row for this table. It advances the row to an empty snapshot.
	 * Deleting it would stop the deletion from propagating, and a device still holding the old
	 * progress would resurrect it at the next sync.
	 */
	runtimePlaythroughs!: Table<RuntimePlaythroughRecord, string>;
	/**
	 * Long-running progress for a member and work, the part a playthrough reset never touches. It is
	 * not merged into the row above, which is the quietest decision in this store. Merged, chapter
	 * progress from device A and an ending unlock from device B would share one conflict domain, and
	 * whole-record last-writer-wins would always drop one of them.
	 */
	runtimePersistentStates!: Table<RuntimePersistentRecord, string>;
	/**
	 * The playthrough's library line: product metadata (title, first-opened time, last-opened time),
	 * unlike the two save tables above, which hold progress snapshots. It is not projected from the
	 * save row, for the reasons in the header of `conversation.ts` in `@rowcat/runtime-persistence`. A
	 * first open may have no commit, some runtimes define no save state, and removing an item from the
	 * list must never delete progress.
	 *
	 * Removal from the list uses `removedAt`, not a tombstone. Nothing sets `deletedAt` on this table.
	 */
	runtimeConversations!: Table<RuntimeConversationRecord, string>;
	syncState!: Table<LocalSyncState, string>;
	/**
	 * Device preference, not synced, unlike the tables above (see the v5 comment). The type comes from
	 * `local-generation`, which gives the record its meaning. This table only decides which connection
	 * holds the value.
	 */
	generationPreferences!: Table<StoredGenerationPreference, string>;
	/**
	 * Provider connection (BYO): a non-synced table with the same nature as the preferences. Because
	 * it holds credentials, that property is stronger here (see the v6 comment).
	 */
	providerConnections!: Table<StoredProviderConnection, string>;
	/**
	 * Cover held by an unpublished draft: the third non-synced table (see the v11 comment). It sits
	 * beside `storyDrafts` but belongs to a different class. Draft bodies must follow trusted devices.
	 * This row lives only until publishing, and the protocol does not know it. Once publishing uploads
	 * the bytes to the server, the row is deleted (`local-authoring/draft-cover.ts`).
	 */
	draftCovers!: Table<StoredDraftCover, string>;
	/**
	 * Conversation summary for one room, the same class as rooms, messages and memories. Unlike the
	 * device-local tables above, a summary is derived from conversation content and must follow
	 * trusted devices. Otherwise a conversation continued on a phone would run with different context.
	 * The primary key is named `id` as in other tables, but its value is the room id (§v13).
	 */
	chatSummaries!: Table<ChatSummary, string>;
	/**
	 * A role the user saved to reuse across conversations, the same class as rooms, messages, memories
	 * and summaries. The device-local tables above are unknown to the protocol, but a persona is
	 * content the user wrote and must follow trusted devices. Otherwise a role created on Mac is
	 * missing on the phone, the user re-enters the settings there, and the two copies quickly diverge.
	 *
	 * It is not a child of a room. It has no `roomId` column and is outside the room-delete cascade. A
	 * room holds a copy of the value rather than a reference to this row (`ChatRoom.persona`), so the
	 * cascade is not skipped; it cannot apply.
	 */
	chatPersonas!: Table<ChatPersona, string>;
	/**
	 * Local copy of a version discarded in a concurrent same-group edit: the fifth table that is not
	 * synced. It sits beside `storyDrafts` but is the opposite in nature. This row has no sync axes at
	 * all (no `dirty`, `rev`, `serverVersion` or tombstone), and it is absent from the codec registry
	 * and `TABLE_ORDER`, so the protocol does not know it exists.
	 *
	 * That absence is intentional. If synced, the copy would become a second conflict domain, and the
	 * mechanism built to resolve conflicts would create them. The value means 'a version that
	 * disappeared on this device', so it only needs to exist on this device.
	 */
	syncRecoveries!: Table<SyncRecoveryRecord, string>;

	constructor(name: string) {
		super(name);
		/**
		 * Schema v1: the conversations-only version. It is never deleted. A device already open at v1
		 * needs this declaration for Dexie to compute its upgrade path, and removing it would leave a
		 * path that nobody can compute.
		 */
		this.version(1).stores({
			rooms: "id, updatedAt, originStoryId",
			messages: "id, roomId, [roomId+createdAt+id]",
		});

		/**
		 * Schema v2 adds the authoring stores. The two existing tables are repeated in full. Dexie treats
		 * `stores()` as a delta, and omitting them would hide their existence in this declaration,
		 * inviting a later edit to null them by mistake. Repeating an unchanged schema is harmless. No
		 * upgrade function is needed, since only tables are added.
		 *
		 * Indexes exist only for real query paths. `storyDrafts` is indexed by `updatedAt` (list order)
		 * and `publishedStoryId` (whether this work's manuscript is on the device). Child tables are
		 * indexed by `draftId` and `[draftId+position]` (editor order). Lore uses
		 * `[draftId+positionIndex]`, since its list order and injection position differ. Bodies are not
		 * indexed, because autosave writes every few hundred milliseconds and no screen queries by them.
		 * `deletedAt` is not indexed, because a person has only dozens of drafts.
		 */
		this.version(2).stores({
			rooms: "id, updatedAt, originStoryId",
			messages: "id, roomId, [roomId+createdAt+id]",
			storyDrafts: "id, updatedAt, publishedStoryId",
			draftCharacters: "id, draftId, [draftId+position]",
			draftLoreEntries: "id, draftId, [draftId+positionIndex]",
			draftStartScenes: "id, draftId, [draftId+position]",
		});

		/**
		 * Schema v3 fixes the record shape before sync is enabled. It adds a `dirty` index (booleans
		 * cannot be keys, so the value becomes 0 or 1), a `rev` on every record (and `fieldRev` on
		 * drafts), a `deletedAt` on rooms, and the `syncState` table that holds the logical clock. These
		 * must land now. If deferred until sync is on, the change becomes a migration of data that other
		 * devices have already exchanged, and their handling of partial states cannot be controlled.
		 *
		 * No index on `deletedAt` or `rev`. Deleted rows are filtered out of lists already read, and
		 * merge finds records by id and then compares them.
		 */
		this.version(3)
			.stores({
				rooms: "id, updatedAt, originStoryId, dirty",
				messages: "id, roomId, [roomId+createdAt+id], dirty",
				storyDrafts: "id, updatedAt, publishedStoryId, dirty",
				draftCharacters: "id, draftId, [draftId+position], dirty",
				draftLoreEntries: "id, draftId, [draftId+positionIndex], dirty",
				draftStartScenes: "id, draftId, [draftId+position], dirty",
				syncState: "key",
			})
			.upgrade(upgradeToV3);

		/**
		 * Schema v4 replaces the single `dirty` index with a compound `[dirty+id]` index, so the index
		 * count does not change. The leading column is still `dirty`, so equality queries keep working,
		 * and an id lower bound can be added.
		 *
		 * Outbound collection scans dirty records in windows rather than loading the whole account. A
		 * single `dirty` index cannot express 'after this id', so each window would filter from the start
		 * again, which is quadratic on large accounts. Offset paging is worse: if a push confirms and
		 * clears `dirty` mid-scan, the offset shifts and a record is silently skipped. No upgrade
		 * function, since data is unchanged; Dexie rebuilds the indexes.
		 */
		this.version(4).stores({
			rooms: "id, updatedAt, originStoryId, [dirty+id]",
			messages: "id, roomId, [roomId+createdAt+id], [dirty+id]",
			storyDrafts: "id, updatedAt, publishedStoryId, [dirty+id]",
			draftCharacters: "id, draftId, [draftId+position], [dirty+id]",
			draftLoreEntries: "id, draftId, [draftId+positionIndex], [dirty+id]",
			draftStartScenes: "id, draftId, [draftId+position], [dirty+id]",
			syncState: "key",
		});

		/**
		 * Schema v5 adds the non-synced device-preference table, the first table whose nature is opposite
		 * to the six above. Its rows carry no sync fields, and that absence is the definition: the table
		 * holds how to generate on this device, which is expected to differ between devices. It is
		 * therefore absent from the codec registry and `TABLE_ORDER`, and the protocol version does not
		 * change.
		 *
		 * It lives in the same database for lifetime reasons. Scope close must close it too, so no
		 * previous member's defaults remain after a switch. A separate database would make 'erase device
		 * data' a two-place deletion. The table is keyed by one key (a global value plus one per room),
		 * and its shape is validated at the read boundary (`local-generation/store.ts`), not treated as a
		 * bag of JSON.
		 */
		this.version(5).stores({
			rooms: "id, updatedAt, originStoryId, [dirty+id]",
			messages: "id, roomId, [roomId+createdAt+id], [dirty+id]",
			storyDrafts: "id, updatedAt, publishedStoryId, [dirty+id]",
			draftCharacters: "id, draftId, [draftId+position], [dirty+id]",
			draftLoreEntries: "id, draftId, [draftId+positionIndex], [dirty+id]",
			draftStartScenes: "id, draftId, [draftId+position], [dirty+id]",
			syncState: "key",
			generationPreferences: "key",
		});

		/**
		 * Schema v6 adds the provider connection table for BYO credentials. Like v5, it has no sync
		 * fields, and the protocol does not know it exists, so neither the protocol nor the envelope
		 * version changes. The absence is meant to be visible in the schema. If a sync field existed,
		 * someone would eventually fill it, and the user's API key would be sent to the server as
		 * ciphertext.
		 *
		 * It shares the database for lifetime reasons. A separate IndexedDB would make account withdrawal
		 * and 'erase device data' two deletions, and a missed one would leave the deleted account's API
		 * key in this browser. Here, the one line in `deleteLocalDbForViewer` removes it with everything
		 * else, and account isolation comes free because the name is per member. It is keyed by provider
		 * name, since there is one connection per provider. A second key per provider would add an axis
		 * that belongs on neither preferences nor room records. The primary key alone suffices, because
		 * every column one would index is key material.
		 */
		this.version(6).stores({
			rooms: "id, updatedAt, originStoryId, [dirty+id]",
			messages: "id, roomId, [roomId+createdAt+id], [dirty+id]",
			storyDrafts: "id, updatedAt, publishedStoryId, [dirty+id]",
			draftCharacters: "id, draftId, [draftId+position], [dirty+id]",
			draftLoreEntries: "id, draftId, [draftId+positionIndex], [dirty+id]",
			draftStartScenes: "id, draftId, [draftId+position], [dirty+id]",
			syncState: "key",
			generationPreferences: "key",
			providerConnections: "provider",
		});

		/**
		 * Schema v7 adds the memory table. Unlike v5 and v6, it carries all the sync axes of rooms and
		 * messages, because memory is conversation content. A memory written on Mac and absent on a phone
		 * would make the same conversation flow differently on the two devices.
		 *
		 * It appears in both the codec registry and `TABLE_ORDER`, yet neither the protocol nor the
		 * envelope version changes. The server has no type vocabulary, and older clients ignore records
		 * of unknown types while advancing their cursor (`unknown_type`). Adding a type to the protocol
		 * must not break compatibility, and this slice is the first to rely on that.
		 *
		 * Indexes exist only for real query paths: `roomId` (the per-room list) and `[dirty+id]`
		 * (outbound collection). `pinned` and `updatedAt` are not indexed. The list is capped at 200 per
		 * room (`CHAT_MEMORY_MAX_PER_ROOM`) and sorted in memory, since indexing the sort would make a
		 * single pin toggle rewrite two indexes.
		 */
		this.version(7).stores({
			rooms: "id, updatedAt, originStoryId, [dirty+id]",
			messages: "id, roomId, [roomId+createdAt+id], [dirty+id]",
			chatMemories: "id, roomId, [dirty+id]",
			storyDrafts: "id, updatedAt, publishedStoryId, [dirty+id]",
			draftCharacters: "id, draftId, [draftId+position], [dirty+id]",
			draftLoreEntries: "id, draftId, [draftId+positionIndex], [dirty+id]",
			draftStartScenes: "id, draftId, [draftId+position], [dirty+id]",
			syncState: "key",
			generationPreferences: "key",
			providerConnections: "provider",
		});

		/**
		 * Schema v8 backfills drafts with an authoring mode (`bodyMode`) and a free prompt (`prompt`). No
		 * table or index changes, but an upgrade function is needed because the record shape changes. An
		 * old draft's `bodyMode` would be `undefined`, which matches neither `=== "prompt"` nor `===
		 * "structured"`, so every reader would need a fallback, and one missed fallback would show an
		 * empty manuscript on that screen. Writing the value once removes the need for the fallback
		 * everywhere.
		 *
		 * `dirty` and `rev` are left alone. This records a fact that was already true (the draft was
		 * structured). Marking drafts dirty here would re-upload every draft unchanged right after
		 * migration.
		 */
		this.version(8)
			.stores({
				rooms: "id, updatedAt, originStoryId, [dirty+id]",
				messages: "id, roomId, [roomId+createdAt+id], [dirty+id]",
				chatMemories: "id, roomId, [dirty+id]",
				storyDrafts: "id, updatedAt, publishedStoryId, [dirty+id]",
				draftCharacters: "id, draftId, [draftId+position], [dirty+id]",
				draftLoreEntries: "id, draftId, [draftId+positionIndex], [dirty+id]",
				draftStartScenes: "id, draftId, [draftId+position], [dirty+id]",
				syncState: "key",
				generationPreferences: "key",
				providerConnections: "provider",
			})
			.upgrade(upgradeToV8);

		/**
		 * Schema v9 folds the world setting, counterpart and characters into a single prompt (draft
		 * schema v2). The table declaration is identical to v8. The character table is not dropped here,
		 * because Dexie applies this version's schema before calling the upgrade function. Dropping it in
		 * the same version would run the function after the material it folds is gone. Dropping happens
		 * in v10; splitting the two steps is the one ordering that matters in this migration.
		 *
		 * Unlike v8, this bumps `dirty` and `rev`, because the body really changes. Without the bump,
		 * folded text would never leave this device, and other devices would keep an empty prompt because
		 * they no longer read character records. Drafts with nothing to fold keep their body and are not
		 * touched.
		 */
		this.version(9)
			.stores({
				rooms: "id, updatedAt, originStoryId, [dirty+id]",
				messages: "id, roomId, [roomId+createdAt+id], [dirty+id]",
				chatMemories: "id, roomId, [dirty+id]",
				storyDrafts: "id, updatedAt, publishedStoryId, [dirty+id]",
				draftCharacters: "id, draftId, [draftId+position], [dirty+id]",
				draftLoreEntries: "id, draftId, [draftId+positionIndex], [dirty+id]",
				draftStartScenes: "id, draftId, [draftId+position], [dirty+id]",
				syncState: "key",
				generationPreferences: "key",
				providerConnections: "provider",
			})
			.upgrade(upgradeToV9);

		/**
		 * Schema v10 drops the character table. There is no upgrade function: v9 has already moved the
		 * content into the body, so only the leftover copies disappear. A soft delete (tombstone) is not
		 * used, because no code on this device reads such tombstones anymore. The codec dropped
		 * `authoring.character` (`packages/authoring/src/sync-codec.ts`), and a tombstone would sit
		 * forever with no reader.
		 */
		this.version(10).stores({ draftCharacters: null });

		/**
		 * Schema v11 adds the cover table for unpublished drafts. There is no upgrade function: it is
		 * new, so there is nothing to move, and an absent row exactly means 'no cover chosen yet'. The
		 * primary key alone is intentional. Every query asks for one draft's cover, and no path lists the
		 * table; a list scan would load several image byte blobs at once.
		 *
		 * It is in the same class as `generationPreferences` and `providerConnections`, and it is not
		 * added to the codec registry or `TABLE_ORDER`. Adding it would ship multi-megabyte images inside
		 * sync envelopes.
		 */
		this.version(11).stores({ draftCovers: "draftId" });

		/**
		 * Schema v12 adds the scene images table. There is no upgrade function: the table is new, so
		 * there is no data to move, and absence means 'this draft has no scene images'. Its indexes match
		 * lore and start scenes because they are read the same way: by draft in position order
		 * (`[draftId+position]`), and by `[dirty+id]` for sync collection.
		 */
		this.version(12).stores({
			draftSceneImages: "id, draftId, [draftId+position], [dirty+id]",
		});

		/**
		 * Schema v13 adds the conversation summary table and backfills the source of memories together,
		 * because both serve one feature, automatic upkeep. The summary's progress and the memories it
		 * produced must commit atomically, so both belong in the same version.
		 *
		 * `chatSummaries` uses the room id as its primary key, which enforces one summary per room in the
		 * schema. Two devices summarizing independently produce records with the same identity, which
		 * merge handles as an ordinary merge. Its indexes serve three paths: the primary key (lookup at
		 * the start of generation), `roomId` (cascade on room delete and remote tombstone, kept because
		 * the sync store's generic parent-id cascade applies to this table), and `[dirty+id]` (outbound
		 * collection).
		 *
		 * The memory backfill does not bump `dirty` or `rev`, following v8. The codec omits "user" from
		 * the payload, so ciphertext produced after the backfill is byte-identical to before. Marking the
		 * records dirty would push the room's whole memory set for no reason.
		 */
		this.version(13)
			.stores({
				chatSummaries: "id, roomId, [dirty+id]",
			})
			.upgrade(upgradeToV13);

		/**
		 * Schema v14 records the completion of the legacy RowCat local data import (`legacyImports`). v24
		 * removes it. The declaration is kept for the same reason as v1: devices still on v14 through v23
		 * need it to compute their upgrade path to v24.
		 */
		this.version(14).stores({ legacyImports: "db" });

		/**
		 * Schema v15 adds the persona library. There is no upgrade function. The table is new, and empty
		 * is exactly the correct state: saved roles did not exist before this feature, so any seeded row
		 * would be a library the user never created.
		 *
		 * `rooms` is not rewritten. A room's persona override is optional (`ChatRoom.persona`), so a
		 * missing key and `null` mean the same thing. A backfill would mark every room in the account
		 * dirty and push them all at the next sync for no reason.
		 *
		 * Indexes: `id` for point lookups (checked before applying a persona to a room), `updatedAt` for
		 * the library list in recency order (walked, not sorted in memory), and `[dirty+id]` for outbound
		 * collection.
		 */
		this.version(15).stores({
			chatPersonas: "id, updatedAt, [dirty+id]",
		});

		/**
		 * Schema v16 adds the legacy import checkpoints. v24 removes them. The declaration is kept for
		 * the same reason as v14, so older devices can compute the upgrade path.
		 */
		this.version(16).stores({
			legacyMigrations: "db",
			legacyMigrationIds: "[db+key], db",
			legacyMigrationAssets: "[db+key], db",
			legacyMigrationUnits: "[db+unit], db",
		});

		/**
		 * Schema v17 adds the local recovery copy of a version discarded by a merge. There is no upgrade
		 * function and no backfill. Earlier conflicts never stored the losing value, so there is nothing
		 * to restore, and inventing rows from diagnostic counters would fabricate drafts the user never
		 * wrote. Empty is exactly the correct state.
		 *
		 * Indexes: `recordId` for the copies of the draft that is open (used by the editor's notice), and
		 * `observedAt` for the global list in most-recent-first order.
		 *
		 * The absence of `[dirty+id]` is the key fact. That index is the outbound collection's axis, so
		 * this table can never be a push candidate.
		 */
		this.version(17).stores({
			syncRecoveries: "id, recordId, observedAt",
		});

		/**
		 * Schema v18 adds the creator runtime tables: a project per draft and its source files. There is
		 * no upgrade function. Both tables are new, so empty means 'not enabled', which is true for every
		 * draft that predates this version. Backfilling empty project rows would make every draft dirty
		 * and cost a useless round trip on other devices, as v13 also concluded.
		 *
		 * Files are indexed by `draftId`, `[draftId+path]` and `[dirty+id]`, like the other draft
		 * children, but the order axis differs. Files are read by `[draftId+path]`, not by a `position`
		 * number. In a code project the path already determines file order, and a position column would
		 * create a reorder operation that changes nothing.
		 *
		 * The project table keeps a `draftId` index because its primary key is derived from that value
		 * (`runtimeProjectIdFor`). Code that knows the derivation should not retype it on every lookup,
		 * so a prefix change cannot be missed in one place.
		 */
		this.version(18).stores({
			draftRuntimeProjects: "id, draftId, [dirty+id]",
			draftRuntimeFiles: "id, draftId, [draftId+path], [dirty+id]",
		});

		/**
		 * Schema v19 adds the player's save tables for the creator runtime. There is no upgrade function,
		 * and empty is the correct state: the runtime had no playthrough surface before this version.
		 * Backfilling empty rows would make every work in the account dirty and push them for nothing.
		 *
		 * Unlike the authoring tables, the question here is 'what is this work's save', which the derived
		 * primary key already answers. So `storyId` serves operations (viewing both lifetimes of one work
		 * together), not lookups. `[dirty+id]` on both tables marks them as synced: it is the outbound
		 * collection axis, and without it the scan would walk the whole table.
		 */
		this.version(19).stores({
			runtimePlaythroughs: "id, storyId, [dirty+id]",
			runtimePersistentStates: "id, storyId, [dirty+id]",
		});

		/**
		 * Schema v20 adds the playthrough library line (`runtime.conversation`). There is no upgrade
		 * function and no backfill. A row in `runtimePlaythroughs` does not prove the work was opened: a
		 * session may open without a commit, and some runtimes define no save state. A fabricated line
		 * would carry a `createdAt` that is not true. Works opened before this version get their line the
		 * next time they are opened, which is the first open this app observes.
		 *
		 * `updatedAt` is the list axis (`list()` walks it in reverse), `storyId` serves operations, and
		 * `[dirty+id]` marks the table as synced.
		 */
		this.version(20).stores({
			runtimeConversations: "id, storyId, updatedAt, [dirty+id]",
		});

		/**
		 * Schema v21 adds the managed image bindings for runtime projects. There is no upgrade function.
		 * The table is new with nothing to move, and empty is correct: before this version there was no
		 * surface for binding images to logical names, so older projects have no assets. Existing runtime
		 * drafts are not rewritten and do not become dirty, as v18 through v20 also concluded.
		 *
		 * Indexes follow the file table. `draftId` lists one project's assets. `[draftId+path]` answers
		 * the name-uniqueness question asked every time an asset is created; without it the check would
		 * scan every asset in the account. `[dirty+id]` marks the table as synced.
		 */
		this.version(21).stores({
			draftRuntimeAssets: "id, draftId, [draftId+path], [dirty+id]",
		});

		/**
		 * Schema v22 generalizes managed assets beyond images. No index changes, because no query filters
		 * by `kind`: lists always cover one draft's assets. Only the row shape changes. Dexie does not
		 * enforce shape, so this upgrade records a fact that was already true. Before this version, sound
		 * could not be bound to a logical name, so every existing row is an image, and `kind: "image"` is
		 * an observed fact. The mobile SQLite v16 writes the same value. Both stores must make the same
		 * judgment, or the same draft would report a different kind on each device.
		 *
		 * `dirty` is not touched. The value did not change, a field was added, and marking dirty would
		 * push every asset record unchanged on this device's next push. (Legacy folding does mark dirty,
		 * because there the body really changes.)
		 */
		this.version(22)
			.stores({})
			.upgrade((tx) =>
				tx
					.table<DraftRuntimeAsset>("draftRuntimeAssets")
					.toCollection()
					.modify((asset) => {
						if (asset.kind === undefined) asset.kind = "image";
						if (asset.durationMs === undefined) asset.durationMs = null;
					}),
			);

		/**
		 * Schema v23 adds the room's fourth child table: characters introduced in this conversation.
		 * There is no upgrade function. The table is new, and empty means no one has added a character to
		 * this room yet. There is no backfill either. Copying seed characters here would mix what the
		 * work provided with what the user added, and the work's characters could then be deleted, which
		 * would make that a policy to enforce rather than an invariant.
		 *
		 * The indexes mirror memories because the queries are the same two: the room's character list and
		 * outbound collection.
		 */
		this.version(23).stores({
			chatCharacters: "id, roomId, [dirty+id]",
		});

		/**
		 * Schema v24 removes the five tables of the legacy RowCat local data import. That import moved
		 * IndexedDB data from the old service's origin into a member database, and it only worked when
		 * the origin matched. The service has ended and the public build has no legacy origin to inherit
		 * from, so the path and its records go.
		 *
		 * Dropping the tables to `null` matters. Removing only the declarations would leave tables that
		 * nobody reads on devices that passed through v14 or v16. Only the import records are dropped:
		 * which database was imported and how far it got. Rooms, messages and drafts the import already
		 * wrote are ordinary records and remain. There is no upgrade function, since there is no data to
		 * move.
		 */
		this.version(24).stores({
			legacyImports: null,
			legacyMigrations: null,
			legacyMigrationIds: null,
			legacyMigrationAssets: null,
			legacyMigrationUnits: null,
		});

		/**
		 * A new database skips the upgrade function, so the sync state row must be created here. Dexie
		 * does not call `upgrade` for a database created from scratch, since there is nothing to migrate.
		 * If this were left empty, the first write would fail to find the clock row. Creating it lazily
		 * would make the device identifier depend on which code path issued the first revision.
		 */
		this.on("populate", (tx) => {
			void tx
				.table<LocalSyncState>("syncState")
				.put(createLocalSyncState(newDeviceId()));
		});
	}
}

/**
 * The v2 to v3 migration rewrites all existing rows. It is the only code in this file that touches
 * existing data. Order matters: backfill revisions into every record first, then initialize the
 * clock, starting at the maximum backfilled revision.
 *
 * The clock must not start at 0. The user's wall clock can be set backward (manual change, NTP
 * correction), so the first edit after migration could get a revision older than records already
 * stored. Nothing reads revisions yet, so this is invisible for now. When sync turns on, that
 * record would lose to its own older version, and the user would see today's text revert to
 * yesterday's.
 */
async function upgradeToV3(tx: Transaction): Promise<void> {
	/**
	 * The device identifier is issued here. The backfilled revisions' `d` and the state row's
	 * `deviceId` must match, and creating both in one transaction leaves no room for them to diverge.
	 */
	const deviceId = newDeviceId();
	let maxT = 0;

	const backfill = async (
		table: string,
		extra?: (row: UpgradableRow, rev: Rev) => void,
	): Promise<void> => {
		await tx
			.table<UpgradableRow>(table)
			.toCollection()
			.modify((row) => {
				row.dirty = toDirtyFlag(row.dirty);
				const rev = backfilledRev(row.updatedAt, deviceId);
				row.rev = rev;
				if (rev.t > maxT) maxT = rev.t;
				extra?.(row, rev);
			});
	};

	// Conversations had no deletion representation in the earlier schema, so every room is backfilled
	// as live.
	await backfill("rooms", (row) => {
		row.deletedAt = null;
	});
	await backfill("messages", (row) => {
		row.deletedAt = null;
	});

	/**
	 * A draft's six groups all start with the same value. There is no per-group history: 'the whole
	 * record was at this point' is all we know. Inventing per-group history would let merge make
	 * unfounded judgments.
	 */
	await backfill("storyDrafts", (row, rev) => {
		row.fieldRev = {
			meta: rev,
			rating: rev,
			body: rev,
			persona: rev,
			defaults: rev,
			publication: rev,
		};
	});
	await backfill("draftCharacters");
	await backfill("draftLoreEntries");
	await backfill("draftStartScenes");

	await tx
		.table<LocalSyncState>("syncState")
		.put(createLocalSyncState(deviceId, { t: maxT }));
}

/**
 * The v7 to v8 migration fills draft rows with the authoring mode and free prompt. It leaves
 * existing values alone. Dexie runs each version once, but this function could be called again for
 * another reason, and an unconditional write would revert a mode the user chose back to structured.
 */
async function upgradeToV8(tx: Transaction): Promise<void> {
	await tx
		.table<{ bodyMode?: unknown; prompt?: unknown }>("storyDrafts")
		.toCollection()
		.modify((row) => {
			if (row.bodyMode !== "prompt" && row.bodyMode !== "structured")
				row.bodyMode = "structured";
			if (typeof row.prompt !== "string") row.prompt = "";
		});
}

/**
 * The draft row as v9 rewrites it: both the v1 authoring fields and the v2 fields layered on top
 * are visible.
 */
interface UpgradableDraftRow {
	id: string;
	schemaVersion?: unknown;
	dirty?: unknown;
	rev?: unknown;
	fieldRev?: Record<string, Rev> & { persona?: Rev };
	prompt?: unknown;
	bodyMode?: unknown;
	scenario?: unknown;
	playGuide?: unknown;
	suggestedPersona?: unknown;
}

/** The character row as v9 reads it, limited to the body fields. */
interface UpgradableCharacterRow extends Partial<LegacyDraftCharacterBody> {
	draftId?: unknown;
	position?: unknown;
	id?: unknown;
	deletedAt?: unknown;
}

const legacyText = (value: unknown): string =>
	typeof value === "string" ? value : "";

/**
 * The folding rule itself is not here. It lives in `@rowcat/authoring` (`foldLegacyDraftBody`),
 * because the mobile SQLite migration and the sync decoder use the same rule. If three places
 * folded independently, the same draft would become a different text on each device, and the next
 * merge would let one overwrite the others.
 *
 * Order is part of the contract. Read the characters first, fold each draft, and only then delete
 * the character rows. Deleting before folding leaves nothing to fold.
 */
async function upgradeToV9(tx: Transaction): Promise<void> {
	const characters = await tx
		.table<UpgradableCharacterRow>("draftCharacters")
		.toArray();

	/**
	 * Groups each draft's living character cards in position order, because that order is the order of
	 * the folded paragraphs.
	 */
	const byDraft = new Map<string, LegacyDraftCharacterBody[]>();
	const ordered = [...characters].sort((a, b) => {
		const ap = typeof a.position === "number" ? a.position : 0;
		const bp = typeof b.position === "number" ? b.position : 0;
		if (ap !== bp) return ap - bp;
		return String(a.id) < String(b.id) ? -1 : 1;
	});
	for (const row of ordered) {
		if (row.deletedAt) continue;
		const draftId = typeof row.draftId === "string" ? row.draftId : null;
		if (!draftId) continue;
		const list = byDraft.get(draftId) ?? [];
		list.push({
			name: legacyText(row.name),
			mode: row.mode === "prompt" ? "prompt" : "structured",
			description: legacyText(row.description),
			personality: legacyText(row.personality),
			speechStyle: legacyText(row.speechStyle),
			exampleDialogue: legacyText(row.exampleDialogue),
			prompt: legacyText(row.prompt),
		});
		byDraft.set(draftId, list);
	}

	/**
	 * The clock is read once, and one revision is drawn per folded draft. Re-reading the state for
	 * each row would let the clock and the records diverge if the migration died midway. The wall
	 * clock is also read once, so one migration is not recorded as spanning many milliseconds.
	 */
	const stateTable = tx.table<LocalSyncState>("syncState");
	const state =
		(await stateTable.get(SYNC_STATE_KEY)) ??
		createLocalSyncState(newDeviceId());
	let hlc: HlcState = { t: state.hlcT, c: state.hlcC };
	const wallMs = Date.now();
	const nextRev = (): Rev => {
		const ticked = tickHlc(hlc, wallMs, state.deviceId);
		hlc = ticked.state;
		return ticked.rev;
	};

	await tx
		.table<UpgradableDraftRow>("storyDrafts")
		.toCollection()
		.modify((row) => {
			const before = legacyText(row.prompt);
			const persona = row.suggestedPersona;
			const folded = foldLegacyDraftBody({
				bodyMode: row.bodyMode === "prompt" ? "prompt" : "structured",
				prompt: before,
				scenario: legacyText(row.scenario),
				playGuide: legacyText(row.playGuide),
				suggestedPersona:
					persona && typeof persona === "object"
						? {
								name: legacyText((persona as { name?: unknown }).name),
								description: legacyText(
									(persona as { description?: unknown }).description,
								),
							}
						: null,
				characters: byDraft.get(row.id) ?? [],
			});

			row.prompt = folded;
			row.schemaVersion = AUTHORING_SCHEMA_VERSION;
			/**
			 * Deletes the key rather than assigning `undefined`. Structured cloning keeps own properties
			 * whose value is `undefined`, so an assignment would leave the v1 field name behind, and the
			 * encoder would then carry it into the payload again.
			 */
			delete row.bodyMode;
			delete row.scenario;
			delete row.playGuide;
			delete row.suggestedPersona;

			const fieldRev = row.fieldRev;
			if (fieldRev) delete fieldRev.persona;

			/**
			 * If the body is unchanged, nothing is marked. The migration did not cause this change; the
			 * state was already true, the same judgment as v8.
			 */
			if (folded === before) return;
			const rev = nextRev();
			row.rev = rev;
			row.dirty = 1;
			/**
			 * Only the `body` group is bumped. The folded body also contains the content of the old
			 * `persona` group, which has no slot in v2, so the `body` group is the only place to record that
			 * change.
			 */
			if (fieldRev) fieldRev.body = rev;
		});

	await tx.table<UpgradableCharacterRow>("draftCharacters").clear();
	await stateTable.put({ ...state, hlcT: hlc.t, hlcC: hlc.c });
}

/**
 * The v12 to v13 migration records a source on each memory. The value is always "user". Before this
 * axis existed, memories came only from a form a person filled in, so this is a fact, not a guess.
 * No code could infer authorship from content, since no rule about sentence shape can tell who
 * wrote it.
 *
 * It does not bump `dirty` or `rev`, as in v8, and for another reason too. The codec omits "user"
 * from the payload (absence means user), so ciphertext after this backfill is byte-identical to
 * before. Marking records dirty would push every memory in the account for no reason.
 *
 * Deleted memories are stamped too. Tombstones carry no payload, so the value never reaches the
 * wire, but a blank field left on a row that can never be revived would eventually surface as
 * `undefined` for some reader.
 */
async function upgradeToV13(tx: Transaction): Promise<void> {
	await tx
		.table<{ source?: unknown; originAt?: unknown }>("chatMemories")
		.toCollection()
		.modify((row) => {
			row.source = "user";
			/**
			 * A memory a person wrote has no conversation as its basis, so there is no `originAt` to point
			 * at.
			 */
			row.originAt = null;
		});
}

/**
 * The open scope. Only one exists at a time. A single module variable matters: per-member instances
 * in a map would keep the previous member's connection alive for the tab's whole life, and a late
 * write aimed at that connection could land in another member's database.
 */
let active: { viewerId: string; db: LocalDb } | null = null;

/**
 * Opens the scope. Call it only after the member identity is confirmed. It takes the RowCat member
 * (`Viewer.id`), not the Better Auth account id, because the sign-in method can change
 * (disconnecting and reconnecting a Google account), and the same person's conversations and drafts
 * must survive an account-id change.
 *
 * If the same member is already open, the existing database is returned, so re-renders do not
 * reopen it.
 */
export function activateLocalDbScope(viewerId: string): LocalDb {
	if (active?.viewerId === viewerId) return active.db;
	// Closes the currently open member first. Reversing the order would briefly keep two connections
	// open at once.
	closeActiveScope();
	const db = new LocalDb(scopedDbName(viewerId));
	active = { viewerId, db };
	return db;
}

/**
 * Closes the scope on logout or account switch. It does not delete data. Logout means 'stop viewing
 * on this browser', not 'discard my conversations and drafts'. Signing in again opens the same
 * database name, and everything returns.
 *
 * Closing aborts any unfinished transaction on that instance. That is the right call at a logout
 * boundary, because a late write aimed at the previous member's database surviving would be much
 * worse.
 */
export function resetLocalDbScope(): void {
	closeActiveScope();
}

/**
 * Deletes this member's local database. There are two callers. Account withdrawal: the account is
 * gone, so the scope is dropped and must never reopen before deletion. 'Erase this device's data':
 * the account stays, so delete and immediately reopen (`local-data/reset.ts`).
 *
 * Both delete the same set: everything under this name, including conversations, drafts, sync
 * cursors, device preferences, provider API keys and the remembered key. Because all of it shares
 * one name, a single call removes everything, and no credential can survive in a separate store.
 *
 * Only this one name is deleted. Several members' databases can legitimately coexist in one browser
 * (logout does not delete them), and deleting Alice's must never touch Bob's. For that reason this
 * code does not scan `indexedDB.databases()` for every `rowcat_chat` prefix.
 *
 * `disableAutoOpen` is the key option. Dexie reopens a closed connection automatically when a write
 * arrives, so a late auto-save right after deletion would silently recreate an empty database under
 * the deleted name. This option permanently disables that instance, so late writes fail instead of
 * quietly succeeding.
 *
 * Deleting through the open instance matters. Once the scope has been released, that instance is
 * unreachable and only the name can be used, and the guarantee above no longer holds. That is why
 * withdrawal calls this before clearing caches (`local-data/purge.ts`).
 */
export async function deleteLocalDbForViewer(viewerId: string): Promise<void> {
	if (active?.viewerId === viewerId) {
		const { db } = active;
		// Drops the reference first. Even if deletion fails, this connection is never used again.
		active = null;
		await db.delete({ disableAutoOpen: true });
	} else {
		/**
		 * If another member is open, that connection is not touched. A separate instance deletes only the
		 * name, since the deletion request is unrelated to the other member's connection.
		 */
		await new LocalDb(scopedDbName(viewerId)).delete({ disableAutoOpen: true });
	}
}

function closeActiveScope(): void {
	if (!active) return;
	const { db } = active;
	active = null;
	try {
		db.close();
	} catch {
		// The connection is already closed or failed to close. The reference was dropped, so the next
		// activation opens a new connection.
	}
}

/** For diagnostics and tests. Returns null when no scope is open. */
export const activeLocalDbScope = (): string | null => active?.viewerId ?? null;
