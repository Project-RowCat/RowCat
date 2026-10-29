import type { LegacyDraftCharacterBody } from "@rowcat/authoring";
import {
	AUTHORING_SCHEMA_VERSION,
	foldLegacyDraftBody,
} from "@rowcat/authoring";
import type { Rev } from "@rowcat/contracts/sync";
import { nextRevs } from "./hlc.ts";
import type { MobileDatabase, SqlRunner } from "./sqlite.ts";

/**
 * Local SQLite schema version. This axis is separate from the web's Dexie version (web is at v10,
 * here it is 3, as the v1 to v3 history below shows).
 *
 * It is tempting to align the two numbers, but that would make this database inherit seven
 * histories it never had: mobile never had a "v6 that added provider connection tables". This value
 * counts how many times this device's file has changed, and that history starts here.
 *
 * `CHAT_SYNC_SCHEMA_VERSION`, `AUTHORING_SCHEMA_VERSION` and `SYNC_ENVELOPE_VERSION` are also on
 * other axes. Those three are agreements between devices: bumping them affects other devices. This
 * value stays inside this file.
 */
export const MOBILE_SCHEMA_VERSION = 20;

/**
 * v1 sets up conversation, authoring and sync state in one go.
 *
 * It is not split into versions the way the web's is, because there is no history to migrate: the
 * first file already has its final shape. The web's v1 to v7 are the record of databases moved from
 * devices that already held data.
 *
 * **No foreign key constraints.** SQLite supporting them is not a reason to add them. Sync treats a
 * child arriving before its parent as normal (page boundaries are not ours to choose), and an FK
 * would turn that normal arrival into a constraint violation. Referential integrity is checked by
 * the domain layer.
 *
 * Indexes cover only the query paths that exist today:
 *
 * - `(updated_at, id)`: list ordering for rooms and drafts.
 * - `(room_id, created_at, id)`: message page cursor.
 * - `(draft_id, <order>, id)`: stable order of child lists.
 * - `(dirty, id)`: resume scan of the outbound collection.
 *
 * The last one matters most. Outbound collection cannot use `OFFSET`: if a push confirms and clears
 * `dirty` mid-scan, the offset shifts and a record is silently skipped. An index with `dirty` as
 * its leading column makes `dirty = 1 AND id > ?` a resumed index scan. Without it, every window is
 * a full table scan.
 */
const V1 = [
	`CREATE TABLE chat_room (
		id TEXT PRIMARY KEY NOT NULL,
		origin_story_id TEXT,
		title TEXT NOT NULL,
		adult INTEGER NOT NULL,
		prompt_protected INTEGER NOT NULL,
		seed TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		deleted_at TEXT,
		dirty INTEGER NOT NULL,
		server_version INTEGER NOT NULL,
		rev_t INTEGER NOT NULL,
		rev_c INTEGER NOT NULL,
		rev_d TEXT NOT NULL
	)`,
	`CREATE INDEX chat_room_recent ON chat_room (updated_at, id)`,
	`CREATE INDEX chat_room_dirty ON chat_room (dirty, id)`,

	`CREATE TABLE chat_message (
		id TEXT PRIMARY KEY NOT NULL,
		room_id TEXT NOT NULL,
		role TEXT NOT NULL,
		speaker TEXT NOT NULL,
		content TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		deleted_at TEXT,
		dirty INTEGER NOT NULL,
		server_version INTEGER NOT NULL,
		rev_t INTEGER NOT NULL,
		rev_c INTEGER NOT NULL,
		rev_d TEXT NOT NULL,
		model TEXT,
		input_tokens INTEGER,
		cached_input_tokens INTEGER,
		cache_write_input_tokens INTEGER,
		output_tokens INTEGER,
		incomplete INTEGER
	)`,
	`CREATE INDEX chat_message_room ON chat_message (room_id, created_at, id)`,
	`CREATE INDEX chat_message_dirty ON chat_message (dirty, id)`,

	`CREATE TABLE chat_memory (
		id TEXT PRIMARY KEY NOT NULL,
		room_id TEXT NOT NULL,
		content TEXT NOT NULL,
		pinned INTEGER NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		deleted_at TEXT,
		dirty INTEGER NOT NULL,
		server_version INTEGER NOT NULL,
		rev_t INTEGER NOT NULL,
		rev_c INTEGER NOT NULL,
		rev_d TEXT NOT NULL
	)`,
	`CREATE INDEX chat_memory_room ON chat_memory (room_id)`,
	`CREATE INDEX chat_memory_dirty ON chat_memory (dirty, id)`,

	`CREATE TABLE authoring_draft (
		id TEXT PRIMARY KEY NOT NULL,
		schema_version INTEGER NOT NULL,
		title TEXT NOT NULL,
		tagline TEXT NOT NULL,
		description TEXT NOT NULL,
		tags TEXT NOT NULL,
		orientation TEXT,
		adult INTEGER NOT NULL,
		visibility TEXT NOT NULL,
		prompt_protected INTEGER NOT NULL,
		body_mode TEXT NOT NULL,
		scenario TEXT NOT NULL,
		play_guide TEXT NOT NULL,
		prompt TEXT NOT NULL,
		suggested_persona TEXT,
		default_start_scene_id TEXT,
		published_story_id TEXT,
		field_rev TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		deleted_at TEXT,
		dirty INTEGER NOT NULL,
		server_version INTEGER NOT NULL,
		rev_t INTEGER NOT NULL,
		rev_c INTEGER NOT NULL,
		rev_d TEXT NOT NULL
	)`,
	`CREATE INDEX authoring_draft_recent ON authoring_draft (updated_at, id)`,
	`CREATE INDEX authoring_draft_published ON authoring_draft (published_story_id)`,
	`CREATE INDEX authoring_draft_dirty ON authoring_draft (dirty, id)`,

	`CREATE TABLE authoring_character (
		id TEXT PRIMARY KEY NOT NULL,
		draft_id TEXT NOT NULL,
		position INTEGER NOT NULL,
		name TEXT NOT NULL,
		mode TEXT NOT NULL,
		description TEXT NOT NULL,
		personality TEXT NOT NULL,
		speech_style TEXT NOT NULL,
		example_dialogue TEXT NOT NULL,
		prompt TEXT NOT NULL,
		library_character_id TEXT,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		deleted_at TEXT,
		dirty INTEGER NOT NULL,
		server_version INTEGER NOT NULL,
		rev_t INTEGER NOT NULL,
		rev_c INTEGER NOT NULL,
		rev_d TEXT NOT NULL
	)`,
	`CREATE INDEX authoring_character_order ON authoring_character (draft_id, position, id)`,
	`CREATE INDEX authoring_character_dirty ON authoring_character (dirty, id)`,

	`CREATE TABLE authoring_lore (
		id TEXT PRIMARY KEY NOT NULL,
		draft_id TEXT NOT NULL,
		position_index INTEGER NOT NULL,
		keys TEXT NOT NULL,
		content TEXT NOT NULL,
		constant INTEGER NOT NULL,
		position TEXT NOT NULL,
		"order" INTEGER NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		deleted_at TEXT,
		dirty INTEGER NOT NULL,
		server_version INTEGER NOT NULL,
		rev_t INTEGER NOT NULL,
		rev_c INTEGER NOT NULL,
		rev_d TEXT NOT NULL
	)`,
	`CREATE INDEX authoring_lore_order ON authoring_lore (draft_id, position_index, id)`,
	`CREATE INDEX authoring_lore_dirty ON authoring_lore (dirty, id)`,

	`CREATE TABLE authoring_scene (
		id TEXT PRIMARY KEY NOT NULL,
		draft_id TEXT NOT NULL,
		position INTEGER NOT NULL,
		title TEXT NOT NULL,
		content TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		deleted_at TEXT,
		dirty INTEGER NOT NULL,
		server_version INTEGER NOT NULL,
		rev_t INTEGER NOT NULL,
		rev_c INTEGER NOT NULL,
		rev_d TEXT NOT NULL
	)`,
	`CREATE INDEX authoring_scene_order ON authoring_scene (draft_id, position, id)`,
	`CREATE INDEX authoring_scene_dirty ON authoring_scene (dirty, id)`,

	/**
	 * The state row is the only one, so its key is a fixed string. Each member has a separate file
	 * (`database.ts`), so this row does not need to repeat the member id. Repeating it would make two
	 * places claim ownership, with no basis for deciding which is right if they disagree.
	 *
	 * The remembered DEK is **not here**. On mobile that value lives in Keychain/Keystore
	 * (`device-key.ts`). Web keeps its wrapper in this row because IndexedDB can hold a
	 * non-extractable `CryptoKey` as-is. SQLite has no such place, and putting the key here would
	 * amount to writing it to a plaintext file.
	 */
	`CREATE TABLE sync_state (
		key TEXT PRIMARY KEY NOT NULL,
		device_id TEXT NOT NULL,
		hlc_t INTEGER NOT NULL,
		hlc_c INTEGER NOT NULL,
		cursor INTEGER NOT NULL,
		protocol_epoch INTEGER NOT NULL,
		initial_sync_done INTEGER NOT NULL,
		last_synced_at TEXT,
		last_error TEXT
	)`,
] as const;

/**
 * v2 folds worldbuilding, counterpart and characters into **one prompt** (draft schema v2).
 *
 * Order is the contract. Folding has to read the character table and the old columns, so every
 * statement that drops something comes after the folding step.
 *
 * `ALTER TABLE ... DROP COLUMN` is safe here because none of these four columns is indexed (v1's
 * indexes cover only `updated_at`, `published_story_id` and `dirty`). If one were indexed, SQLite
 * would reject the drop, and the failure would leave the step unapplied. The transaction guarantees
 * that.
 */
const V2: readonly MigrationStep[] = [
	foldAuthoringBodyToPrompt,
	`DROP TABLE authoring_character`,
	`ALTER TABLE authoring_draft DROP COLUMN body_mode`,
	`ALTER TABLE authoring_draft DROP COLUMN scenario`,
	`ALTER TABLE authoring_draft DROP COLUMN play_guide`,
	`ALTER TABLE authoring_draft DROP COLUMN suggested_persona`,
];

/**
 * One step of a migration: an SQL statement or a function.
 *
 * Functions are allowed because of v2. The folding rule is `foldLegacyDraftBody` in
 * `@rowcat/authoring`, shared with the web's Dexie migration and sync decoder. Rewriting it in SQL
 * would give the same draft different text per platform, and the difference would show up as one
 * side overwriting the other in the next merge.
 *
 * The function runs inside the version's transaction and does not open its own (SQLite does not
 * support nesting). That is why it receives a `SqlRunner`, not a `MobileDatabase`.
 */
type MigrationStep = string | ((tx: SqlRunner) => Promise<void>);

/** Character row read by the folding step. Only the columns that feed the body. */
interface LegacyCharacterRow {
	draft_id: string;
	name: string;
	mode: string;
	description: string;
	personality: string;
	speech_style: string;
	example_dialogue: string;
	prompt: string;
}

/** Draft row read by the folding step: the v1 authoring columns plus the merge axis beside them. */
interface LegacyDraftRow {
	id: string;
	body_mode: string;
	scenario: string;
	play_guide: string;
	prompt: string;
	suggested_persona: string | null;
	field_rev: string;
}

/**
 * Folds the v1 authoring body into the prompt. Same rule and result as the web.
 *
 * Bumps `dirty` and `rev` because the body actually changes. Without it the folded text would never
 * leave this device, and a manuscript with characters folded in would be an empty prompt on other
 * devices (which no longer read character records). A draft with nothing to fold keeps its body and
 * is left alone. That state was already true, not something the migration caused.
 */
async function foldAuthoringBodyToPrompt(tx: SqlRunner): Promise<void> {
	const characters = await tx.all<LegacyCharacterRow>(
		`SELECT draft_id, name, mode, description, personality, speech_style,
		        example_dialogue, prompt
		 FROM authoring_character
		 WHERE deleted_at IS NULL
		 ORDER BY draft_id, position, id`,
	);
	const byDraft = new Map<string, LegacyDraftCharacterBody[]>();
	for (const row of characters) {
		const list = byDraft.get(row.draft_id) ?? [];
		list.push({
			name: row.name,
			mode: row.mode === "prompt" ? "prompt" : "structured",
			description: row.description,
			personality: row.personality,
			speechStyle: row.speech_style,
			exampleDialogue: row.example_dialogue,
			prompt: row.prompt,
		});
		byDraft.set(row.draft_id, list);
	}

	const drafts = await tx.all<LegacyDraftRow>(
		`SELECT id, body_mode, scenario, play_guide, prompt, suggested_persona,
		        field_rev
		 FROM authoring_draft`,
	);

	/** Compute every folded result first, so revisions for the changed drafts are issued in one batch. */
	const folded = drafts.map((row) => ({
		row,
		prompt: foldLegacyDraftBody({
			bodyMode: row.body_mode === "prompt" ? "prompt" : "structured",
			prompt: row.prompt,
			scenario: row.scenario,
			playGuide: row.play_guide,
			suggestedPersona: parsePersona(row.suggested_persona),
			characters: byDraft.get(row.id) ?? [],
		}),
	}));
	const changed = folded.filter((entry) => entry.prompt !== entry.row.prompt);
	const revs = await nextRevs(tx, changed.length);

	let issued = 0;
	for (const entry of folded) {
		const fieldRev = parseFieldRev(entry.row.field_rev);
		const rev = entry.prompt === entry.row.prompt ? null : revs[issued++];
		/**
		 * Only the `body` group is bumped. The folded body also contains content from the old `persona`
		 * group, but that group no longer exists in v2, and the body is the only place to hold it.
		 */
		if (rev && fieldRev) fieldRev.body = rev;
		if (fieldRev) delete fieldRev.persona;

		/**
		 * Unchanged drafts keep their original values through `COALESCE`. Writing `dirty` unconditionally
		 * would make every draft outbound, re-uploading unchanged manuscripts once per device.
		 */
		await tx.run(
			`UPDATE authoring_draft
			 SET prompt = ?, schema_version = ?, field_rev = ?,
			     dirty = COALESCE(?, dirty),
			     rev_t = COALESCE(?, rev_t), rev_c = COALESCE(?, rev_c),
			     rev_d = COALESCE(?, rev_d)
			 WHERE id = ?`,
			[
				entry.prompt,
				AUTHORING_SCHEMA_VERSION,
				JSON.stringify(fieldRev ?? {}),
				rev ? 1 : null,
				rev ? rev.t : null,
				rev ? rev.c : null,
				rev ? rev.d : null,
				entry.row.id,
			],
		);
	}
}

const parsePersona = (
	value: string | null,
): { name: string; description: string } | null => {
	if (!value) return null;
	try {
		const parsed: unknown = JSON.parse(value);
		if (!parsed || typeof parsed !== "object") return null;
		const record = parsed as { name?: unknown; description?: unknown };
		return {
			name: typeof record.name === "string" ? record.name : "",
			description:
				typeof record.description === "string" ? record.description : "",
		};
	} catch {
		return null;
	}
};

const parseFieldRev = (
	value: string,
): (Record<string, Rev> & { persona?: Rev }) | null => {
	try {
		const parsed: unknown = JSON.parse(value);
		return parsed && typeof parsed === "object"
			? (parsed as Record<string, Rev>)
			: null;
	} catch {
		return null;
	}
};

/**
 * v3 adds one device-level generation preference. **This table has no sync columns** (no `dirty`,
 * `server_version`, `rev_*` or `deleted_at`), and that absence is the point of this slice.
 *
 * The preference is tied to provider connections (BYO), which differ per device. If it were synced,
 * a value picked on a Mac with Anthropic connected would reach a phone without that connection as a
 * default it cannot use. Without the columns that state cannot be represented.
 *
 * It is not placed in `tables.ts` either. That file's contract is the mapping between sync records
 * and rows, and placing this table there would put it next to `TABLE_ORDER`, where it would
 * eventually be registered.
 *
 * No index. The only lookup is the primary-key lookup on `key`, and a member's per-room overrides
 * number in the hundreds at most. An unused index would only add write cost.
 */
const V3: readonly MigrationStep[] = [
	`CREATE TABLE generation_preference (
		key TEXT PRIMARY KEY NOT NULL,
		version INTEGER NOT NULL,
		response_length TEXT,
		target TEXT
	)`,
];

/**
 * v4 adds situation images.
 *
 * Six columns plus five sync axes. **No bytes.** The image lives on the server, and this row
 * carries only a reference and a word (see `authoringSceneImageTable` in `tables.ts`).
 *
 * Two indexes for two read patterns: the children of one draft in position order (`draft_id,
 * position`), and the sync backlog (`dirty, id`). The shape matches lore and start scenes. That
 * symmetry is why `sync-store` handles several types with one table.
 *
 * This app has no authoring screen, but the version is bumped for the completeness of the copy.
 * Without the table this device ignores the record and advances the cursor (§19), so an image
 * attached on the Mac would never reach this device.
 */
const V4: readonly MigrationStep[] = [
	`CREATE TABLE authoring_scene_image (
		id TEXT PRIMARY KEY NOT NULL,
		draft_id TEXT NOT NULL,
		position INTEGER NOT NULL,
		trigger TEXT NOT NULL,
		asset_id TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		deleted_at TEXT,
		dirty INTEGER NOT NULL,
		server_version INTEGER NOT NULL,
		rev_t INTEGER NOT NULL,
		rev_c INTEGER NOT NULL,
		rev_d TEXT NOT NULL
	)`,
	`CREATE INDEX authoring_scene_image_draft ON authoring_scene_image (draft_id, position)`,
	`CREATE INDEX authoring_scene_image_dirty ON authoring_scene_image (dirty, id)`,
];

/**
 * v5 adds the conversation summary table and backfills the source of memories.
 *
 * Both land together because they are one feature (automatic maintenance). Where summarization
 * stopped and which memories came out of that run must commit in the same transaction, so both axes
 * must live in the same version.
 *
 * **`chat_summary`'s primary key is the room id.** The schema itself says one room has one summary.
 * Two devices that each produce a summary therefore land on the same identity and resolve in an
 * ordinary merge (see `summary.ts` in `@rowcat/chat`).
 *
 * The frontier is stored as **two columns**, which is where this differs from the web's nested
 * object. SQLite has no object shape. JSON would let a value with a time but no message id go in
 * unchecked, and every reader would need to defend against it. With two columns, the rule "both
 * NULL or both present" is enforced by the row conversion in `tables.ts`.
 *
 * The two new columns on `chat_memory` are filled **without setting `dirty`**. They record facts
 * that were already true (the only path that created memories before this axis was a form a person
 * opens). The codec does not put `"user"` in the payload, so the ciphertext after this backfill is
 * byte-identical to the one before. Marking them dirty would make every memory of the account a
 * push candidate right after migration.
 *
 * Existing rows are filled by `DEFAULT`. SQLite's `ADD COLUMN` applies the default to existing
 * rows, so no following `UPDATE` is needed. More important than saving one statement is that there
 * are not two paths: a default and a backfill that diverge would eventually get only one of them
 * fixed.
 */
const V5: readonly MigrationStep[] = [
	`CREATE TABLE chat_summary (
		id TEXT PRIMARY KEY NOT NULL,
		room_id TEXT NOT NULL,
		summary TEXT NOT NULL,
		frontier_created_at TEXT,
		frontier_message_id TEXT,
		epoch INTEGER NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		deleted_at TEXT,
		dirty INTEGER NOT NULL,
		server_version INTEGER NOT NULL,
		rev_t INTEGER NOT NULL,
		rev_c INTEGER NOT NULL,
		rev_d TEXT NOT NULL
	)`,
	`CREATE INDEX chat_summary_room ON chat_summary (room_id)`,
	`CREATE INDEX chat_summary_dirty ON chat_summary (dirty, id)`,

	`ALTER TABLE chat_memory ADD COLUMN source TEXT NOT NULL DEFAULT 'user'`,
	`ALTER TABLE chat_memory ADD COLUMN origin_at TEXT`,
];

/**
 * v6 adds the persona library and per-room role overrides.
 *
 * Both land together because they are one feature. Without the library there is nothing to pick,
 * and without the override column there is nowhere to store the pick.
 *
 * **`chat_persona` has no `room_id`.** That absence is the most important fact in this version. The
 * library is an account asset, not a child of a conversation, so the room tombstone cascade does
 * not walk this table (`parent: null` in `tables.ts` expresses the same fact).
 *
 * **`chat_room.persona` starts as `NULL`.** The column's default `NULL` is exactly the state "no
 * override". It needs no follow-up `UPDATE`, and since it does not rewrite existing rows, every
 * room of the account does not become dirty for no reason after migration (the v5 memory backfill
 * made the same call).
 *
 * Two indexes for two read paths: the library list in recent-update order, and the resume scan of
 * the outbound collection. The primary-key point lookup is the third.
 */
const V6: readonly MigrationStep[] = [
	`CREATE TABLE chat_persona (
		id TEXT PRIMARY KEY NOT NULL,
		name TEXT NOT NULL,
		description TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		deleted_at TEXT,
		dirty INTEGER NOT NULL,
		server_version INTEGER NOT NULL,
		rev_t INTEGER NOT NULL,
		rev_c INTEGER NOT NULL,
		rev_d TEXT NOT NULL
	)`,
	`CREATE INDEX chat_persona_recent ON chat_persona (updated_at, id)`,
	`CREATE INDEX chat_persona_dirty ON chat_persona (dirty, id)`,

	`ALTER TABLE chat_room ADD COLUMN persona TEXT`,
];

/**
 * v7 adds the truncation flag on messages (`truncated`).
 *
 * It marks a complete response that the output cap cut off (`continuation.ts` in `@rowcat/chat`).
 * It sits beside `incomplete` and means something different. `incomplete` says a normal end was not
 * seen. `truncated` says a normal end was received but its reason was the cap.
 *
 * No backfill is correct. Rows from before this axis have no stored finish reason, and NULL (no
 * flag) is the honest representation of that lack.
 *
 * Without this column sync silently drops the axis. A record the web marked arrives here, the
 * column is absent so the value falls off on save, and this device's next push uploads an unmarked
 * version.
 */
const V7: readonly MigrationStep[] = [
	`ALTER TABLE chat_message ADD COLUMN truncated INTEGER`,
];

/**
 * v8 adds one column for the automatic-sync device preference.
 *
 * It is attached to `sync_state` because the required scope matches that row exactly (member plus
 * device). No separate settings table: that would open a whole preference architecture for one
 * value. The web made the same call; there it is also a cell in its `syncState` row.
 *
 * **No sync axis.** No codec or `TABLE_ORDER` touches this column, so the protocol does not know it
 * exists. Different values per device are correct here: off on a shared device, on on my own phone.
 *
 * `NULL` is the default and means **on**. Having configured sync is itself a request to keep it
 * running, so rows made before this version are correct without a backfill.
 */
const V8: readonly MigrationStep[] = [
	`ALTER TABLE sync_state ADD COLUMN auto_sync_on INTEGER`,
];

/**
 * v9 adds one column: the third axis of the generation preference.
 *
 * No backfill. `NULL` means "this layer has not decided", and a preference read with `NULL` falls
 * through to the upper layers (global, then product default). Rows from before this version are
 * correct without a backfill as well. Filling a default would make every room explicitly choose a
 * step it never picked, and later changes to the product default would not reach those users.
 *
 * The row's `version` is not bumped either. That value is for when the meaning of existing fields
 * changes. Bumping it here would make readers discard the response length and target preferences
 * already stored, as an unknown version (`local-data/generation-store.ts`).
 *
 * No sync axis. This table is in neither the codec registry nor `TABLE_ORDER`, so the protocol does
 * not know it exists. The reasoning is the same as for provider connections.
 */
const V9: readonly MigrationStep[] = [
	`ALTER TABLE generation_preference ADD COLUMN reasoning_effort TEXT`,
];

/**
 * v10 adds one local recovery-copy table for values that merge discarded.
 *
 * Having no sync axis is the definition of this table: no `dirty`, `server_version`, `rev_*` or
 * `deleted_at`. It is therefore absent from `TABLE_ORDER` and the codec registry, and the outbound
 * collector has no shape it could scan. "Recovery copies are not synced" is a schema fact, not a
 * comment's promise.
 *
 * Syncing the copies would make them a **second conflict domain**. A thing built to resolve a
 * conflict would create one, so the value stays on this device only.
 *
 * `losing_rev_*` is split into three columns, as in the other tables. Here it is not compared, only
 * used as identity material, so no index is added. The identity is already the primary key.
 *
 * No backfill, and there cannot be one. Past conflicts kept no copy of the losing value, so there
 * is no material to restore. Empty is the correct state.
 */
const V10: readonly MigrationStep[] = [
	`CREATE TABLE sync_recovery (
		id TEXT PRIMARY KEY NOT NULL,
		type TEXT NOT NULL,
		record_id TEXT NOT NULL,
		scope TEXT NOT NULL,
		payload TEXT NOT NULL,
		losing_rev_t INTEGER NOT NULL,
		losing_rev_c INTEGER NOT NULL,
		losing_rev_d TEXT NOT NULL,
		observed_at TEXT NOT NULL
	)`,
	/** Two read paths: copies for one open draft, and the full list in recent-observation order. */
	`CREATE INDEX sync_recovery_record ON sync_recovery (record_id)`,
	`CREATE INDEX sync_recovery_observed ON sync_recovery (observed_at, id)`,
];

/**
 * v11 adds one routing-affinity key column for the room.
 *
 * It tells managed generation that these requests continue the same conversation
 * (`ChatRoom.routingSessionId` in `@rowcat/chat`). It does not appear in the prompt or the context
 * budget. It only changes which provider endpoint a request is sent to.
 *
 * **No backfill.** The column's `NULL` default is exactly "not yet issued". Such a room receives
 * one and saves it right before its next generation (`ChatStore.ensureRoomRoutingSession`). Filling
 * it here would make every room of the account dirty right after migration, and that push would be
 * a meaningless round trip to other devices (v6 made the same call).
 *
 * Without this column sync silently drops the axis. A key issued on the web arrives here, the
 * column is absent so the value falls off on save, and this device's next push uploads the room
 * without the key. The room then loses cache locality each time it moves between devices.
 */
const V11: readonly MigrationStep[] = [
	`ALTER TABLE chat_room ADD COLUMN routing_session_id TEXT`,
];

/**
 * v12 adds the two creator-runtime tables.
 *
 * **This app has no runtime studio**, yet the version is bumped for the same reason as the
 * situation images (v4). Without the tables this device ignores those records and advances the
 * cursor (§19). Code written on a Mac would then never arrive here, and worse, this device's next
 * push would upload the draft without its code. The completeness of the copy comes first; the
 * editor comes later.
 *
 * No backfill. No draft before this version had a runtime, so empty is the correct state.
 *
 * The project table has a unique index on `draft_id`, which is where it differs from the web. The
 * web's primary key is a derived id that guarantees one project per draft. Here the database
 * enforces the same thing too. If sync brings in two projects for the same draft, for whatever
 * reason, failing the insert is better than letting both live silently.
 *
 * The second column of the file index is `path`, not `position`. Code files have no slot numbers,
 * and their order is their path.
 */
const V12: readonly MigrationStep[] = [
	`CREATE TABLE authoring_runtime_project (
		id TEXT PRIMARY KEY NOT NULL,
		draft_id TEXT NOT NULL,
		enabled INTEGER NOT NULL,
		entry TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		deleted_at TEXT,
		dirty INTEGER NOT NULL,
		server_version INTEGER NOT NULL,
		rev_t INTEGER NOT NULL,
		rev_c INTEGER NOT NULL,
		rev_d TEXT NOT NULL
	)`,
	`CREATE UNIQUE INDEX authoring_runtime_project_draft ON authoring_runtime_project (draft_id)`,
	`CREATE INDEX authoring_runtime_project_dirty ON authoring_runtime_project (dirty, id)`,
	`CREATE TABLE authoring_runtime_file (
		id TEXT PRIMARY KEY NOT NULL,
		draft_id TEXT NOT NULL,
		path TEXT NOT NULL,
		content TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		deleted_at TEXT,
		dirty INTEGER NOT NULL,
		server_version INTEGER NOT NULL,
		rev_t INTEGER NOT NULL,
		rev_c INTEGER NOT NULL,
		rev_d TEXT NOT NULL
	)`,
	`CREATE INDEX authoring_runtime_file_draft ON authoring_runtime_file (draft_id, path)`,
	`CREATE INDEX authoring_runtime_file_dirty ON authoring_runtime_file (dirty, id)`,
];

/**
 * v13 adds the two **player-save** tables of creator runtime.
 *
 * This is the opposite of v12. That one is code this member **wrote**; these are progress this
 * member **played**, which can exist for other people's works too. So the axis is `story_id`, not
 * `draft_id`, and they sit outside the draft tombstone cascade.
 *
 * **This app has no playback screen yet**, yet the version is bumped for the same reasons as the
 * situation images (v4) and the authoring runtime (v12). Without the tables this device ignores the
 * records and advances the cursor (§19). Progress made on the web would never arrive here, and
 * worse, this device's next push would upload it as deleted. The completeness of the copy comes
 * first; the playback screen later.
 *
 * No backfill. No playback surface existed before this version.
 *
 * The playthrough table has a `slot` column even though V1 has only one slot. The primary key is
 * derived from it (`runtimePlaythroughIdFor`), so when slots multiply later, the identities of
 * already-synced saves do not change. Removing it now would change the id rule the day slots grow,
 * and old saves would become different records under the new rule.
 *
 * The snapshot is one JSON blob by design. Splitting it into columns would require the schema to
 * know the shape of values the creator defined, which this contract avoids from the start.
 */
const V13: readonly MigrationStep[] = [
	`CREATE TABLE runtime_playthrough (
		id TEXT PRIMARY KEY NOT NULL,
		story_id TEXT NOT NULL,
		slot TEXT NOT NULL,
		snapshot TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		deleted_at TEXT,
		dirty INTEGER NOT NULL,
		server_version INTEGER NOT NULL,
		rev_t INTEGER NOT NULL,
		rev_c INTEGER NOT NULL,
		rev_d TEXT NOT NULL
	)`,
	`CREATE UNIQUE INDEX runtime_playthrough_story ON runtime_playthrough (story_id, slot)`,
	`CREATE INDEX runtime_playthrough_dirty ON runtime_playthrough (dirty, id)`,
	`CREATE TABLE runtime_persistent (
		id TEXT PRIMARY KEY NOT NULL,
		story_id TEXT NOT NULL,
		snapshot TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		deleted_at TEXT,
		dirty INTEGER NOT NULL,
		server_version INTEGER NOT NULL,
		rev_t INTEGER NOT NULL,
		rev_c INTEGER NOT NULL,
		rev_d TEXT NOT NULL
	)`,
	`CREATE UNIQUE INDEX runtime_persistent_story ON runtime_persistent (story_id)`,
	`CREATE INDEX runtime_persistent_dirty ON runtime_persistent (dirty, id)`,
];

/**
 * v14 adds the **library row** for runtime playthroughs (`runtime.conversation`).
 *
 * No backfill. Rows are not invented from `runtime_playthrough`. The existence of a save row is not
 * evidence that the runtime was opened (a session can open without a commit, or with no state), and
 * the `created_at` of an invented row would not be a fact. Works opened before this version get
 * their row the next time they are opened.
 *
 * The `(updated_at, id)` index is the list axis. `(dirty, id)` expresses that this table syncs.
 * `removed_at` marks removal from the list. It is not a tombstone (see `tables.ts`).
 */
const V14: readonly MigrationStep[] = [
	`CREATE TABLE runtime_conversation (
		id TEXT PRIMARY KEY NOT NULL,
		story_id TEXT NOT NULL,
		slot TEXT NOT NULL,
		title TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		removed_at TEXT,
		deleted_at TEXT,
		dirty INTEGER NOT NULL,
		server_version INTEGER NOT NULL,
		rev_t INTEGER NOT NULL,
		rev_c INTEGER NOT NULL,
		rev_d TEXT NOT NULL
	)`,
	`CREATE UNIQUE INDEX runtime_conversation_story ON runtime_conversation (story_id, slot)`,
	`CREATE INDEX runtime_conversation_recent ON runtime_conversation (updated_at, id)`,
	`CREATE INDEX runtime_conversation_dirty ON runtime_conversation (dirty, id)`,
];

/**
 * v15 adds the **managed asset bindings** for runtime projects.
 *
 * It is the same class as v12's two tables: draft children, carrying all sync axes. The table
 * exists in this app without a studio for the same reason. **This device must also hold a complete
 * copy of the draft.** Otherwise an image bound on the Mac never arrives here, and this device's
 * next push uploads the draft with no images.
 *
 * No backfill. Before this version no surface bound logical names to images, so old projects have
 * no assets at all. Empty is the correct state (the web's Dexie v21 made the same call).
 *
 * No bytes here. The row carries a media identity, and the image lives in RowCat media. Situation
 * images (`authoring_scene_image`) made the same decision in the same place.
 *
 * The `(draft_id, path)` index is the list axis and the axis for name uniqueness. `(dirty, id)`
 * expresses that this table syncs.
 */
const V15: readonly MigrationStep[] = [
	`CREATE TABLE authoring_runtime_asset (
		id TEXT PRIMARY KEY NOT NULL,
		draft_id TEXT NOT NULL,
		path TEXT NOT NULL,
		asset_id TEXT NOT NULL,
		mime TEXT NOT NULL,
		width INTEGER NOT NULL,
		height INTEGER NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		deleted_at TEXT,
		dirty INTEGER NOT NULL,
		server_version INTEGER NOT NULL,
		rev_t INTEGER NOT NULL,
		rev_c INTEGER NOT NULL,
		rev_d TEXT NOT NULL
	)`,
	`CREATE INDEX authoring_runtime_asset_draft ON authoring_runtime_asset (draft_id, path)`,
	`CREATE INDEX authoring_runtime_asset_dirty ON authoring_runtime_asset (dirty, id)`,
];

/**
 * v16: managed assets are no longer images only.
 *
 * Three columns are added and two are loosened. `kind` is this version's axis. `width` and `height`
 * lose `NOT NULL` because a sound row has no value for them. Storing 0 would create a non-existent
 * state, "an image 0 wide", and that value would be drawn in the list.
 *
 * **The backfill is one statement, `kind = 'image'`.** Every row stored before this version was an
 * image, because no surface existed for binding sounds. So the value is a fact, not a guess. This
 * `UPDATE` only writes down what was already true.
 *
 * No column default. A default would also apply to new rows, which would make a write that omits
 * the kind silently an image.
 *
 * SQLite has no `ALTER ... DROP NOT NULL`, so the table is rebuilt. The order is the rule: create
 * the new table, copy the rows, drop the old table, rename, and rebuild the indexes. Indexes
 * disappear with the table, so if they are not recreated they vanish silently. List queries then
 * become full scans, and the only symptom is slowness.
 *
 * This migration does not touch `dirty`. The values did not actually change: a fact that was
 * already true gained a column. Marking the rows dirty would make this device's next push upload
 * every asset record with no change in content.
 */
const V16: readonly MigrationStep[] = [
	`CREATE TABLE authoring_runtime_asset_v16 (
		id TEXT PRIMARY KEY NOT NULL,
		draft_id TEXT NOT NULL,
		path TEXT NOT NULL,
		kind TEXT NOT NULL,
		asset_id TEXT NOT NULL,
		mime TEXT NOT NULL,
		width INTEGER,
		height INTEGER,
		duration_ms INTEGER,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		deleted_at TEXT,
		dirty INTEGER NOT NULL,
		server_version INTEGER NOT NULL,
		rev_t INTEGER NOT NULL,
		rev_c INTEGER NOT NULL,
		rev_d TEXT NOT NULL
	)`,
	`INSERT INTO authoring_runtime_asset_v16 (
		id, draft_id, path, kind, asset_id, mime, width, height, duration_ms,
		created_at, updated_at, deleted_at, dirty, server_version, rev_t, rev_c, rev_d
	) SELECT
		id, draft_id, path, 'image', asset_id, mime, width, height, NULL,
		created_at, updated_at, deleted_at, dirty, server_version, rev_t, rev_c, rev_d
	FROM authoring_runtime_asset`,
	`DROP TABLE authoring_runtime_asset`,
	`ALTER TABLE authoring_runtime_asset_v16 RENAME TO authoring_runtime_asset`,
	`CREATE INDEX authoring_runtime_asset_draft ON authoring_runtime_asset (draft_id, path)`,
	`CREATE INDEX authoring_runtime_asset_dirty ON authoring_runtime_asset (dirty, id)`,
];

/**
 * v17 adds one column for the room's narration mode.
 *
 * **The column lands before this app's settings screen fully exists.** As with the routing key
 * (v11) and the runtime tables (v12), without the column sync silently drops this axis. A room set
 * to autoplay on the web arrives here, the value falls off on save, and this device's next push
 * uploads it without the pack. The user would then see a setting turn off because of a device they
 * never touched.
 *
 * It is stored as **one JSON blob** (`{ scope, density, castTracking }`), not three columns, for
 * the same reason as `persona`. The three values are either all present or all absent, and one blob
 * makes "no pack" a single `NULL`. Three columns would allow rows with only two filled in, and
 * nobody could answer what such a row means.
 *
 * No backfill. `NULL` means "this room does not use a pack", which is the actual behavior of every
 * room before this axis existed. Filling it would make every room dirty right after migration and,
 * worse, turn on a setting the user never chose.
 */
const V17: readonly MigrationStep[] = [
	`ALTER TABLE chat_room ADD COLUMN narration TEXT`,
];

/**
 * v18 adds the room's **fourth child**: characters added to this conversation.
 *
 * No backfill. It is a new table with nothing to move, and empty is the correct state ("nobody has
 * been added to this room yet"). **Seed characters are not copied here.** Copying would mix what
 * the work provided with what I added. The work-provided characters could then be deleted, turning
 * an invariant into a policy that someone must uphold.
 *
 * The index shape matches `chat_memory` on purpose. The queries are the same two (this room's
 * characters, and the outbound collection), which are exactly the memory queries.
 *
 * Without this table sync silently drops the kind. Characters added on the Mac never arrive here.
 * The room tombstone cascade then has nothing to delete, so this device leaves the characters of
 * deleted rooms on the server. Situation images and the runtime tables came before their screens
 * for the same reason.
 */
const V18: readonly MigrationStep[] = [
	`CREATE TABLE chat_character (
		id TEXT PRIMARY KEY NOT NULL,
		room_id TEXT NOT NULL,
		name TEXT NOT NULL,
		prompt TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		deleted_at TEXT,
		dirty INTEGER NOT NULL,
		server_version INTEGER NOT NULL,
		rev_t INTEGER NOT NULL,
		rev_c INTEGER NOT NULL,
		rev_d TEXT NOT NULL
	)`,
	`CREATE INDEX chat_character_room ON chat_character (room_id)`,
	`CREATE INDEX chat_character_dirty ON chat_character (dirty, id)`,
];

/**
 * v19 adds the room's **user note**: a directive the user attaches to this conversation.
 *
 * **This app's settings screen comes with it, and the column is still written down separately.**
 * The reason is the same as v17: without the column, sync silently drops this axis. A note written
 * on the web would lose its value the moment it reaches this device, and this device's next push
 * would upload it without the note. The user would see their own text disappear because of a device
 * they never touched.
 *
 * It is a single `TEXT`. v17 is a JSON blob because it has three values that must be present
 * together. Here there is one value, so there is nothing to group. Why there is no separate
 * `enabled` column beside the text is explained in the header of `user-note.ts` in `@rowcat/chat`.
 *
 * No backfill. `NULL` means "no note is attached to this conversation", which is the real behavior
 * of every room before this axis existed. Filling it would make every room dirty after migration
 * and, worse, put instructions into prompts that the user never wrote.
 */
const V19: readonly MigrationStep[] = [
	`ALTER TABLE chat_room ADD COLUMN user_note TEXT`,
];

/**
 * v20 holds the **cover image** of a draft that is not yet published, on this device.
 *
 * ## Why a draft needs its own cover
 *
 * The source of truth for covers is the server's `story_cover`, keyed by `story_id`. An unpublished
 * draft has no work row yet, so there is structurally nothing to attach a cover to. Until the draft
 * is published, its cover cannot go to the server, and it has to live somewhere locally.
 *
 * ```text
 * unpublished draft   here (+ file in the document directory) → PUT /stories/:id/cover on publish
 * published draft     the server holds it → "cover management" edits the server directly (not here)
 * ```
 *
 * The invariant of this table is that the two states cannot both be true at once. When publishing
 * succeeds and the bytes go up, this row and its file disappear together. If the row stayed, the
 * server's cover and the device's cover would diverge, and the screen would have no basis for
 * deciding which one to draw.
 *
 * ## No bytes and no absolute path here
 *
 * The bytes are not stored because of their size. Covers go up to 5 MiB and GIFs to 20 MiB. Inside
 * SQLite the file would grow by that much, and backups and migrations would carry that weight
 * whether or not sync knew about the table. The bytes are a file in the document directory.
 *
 * The file **name** is stored rather than the path, and this is more specific. An iOS container's
 * absolute path contains a UUID that changes on every install. After a reinstall the row would
 * point at a file that no longer exists, even though the file itself is still there
 * (`lib/draft-cover-files.ts`).
 *
 * ## No sync axis
 *
 * There is no `dirty`, `server_version`, `rev_*` or `deleted_at`. So the table is not in
 * `TABLE_ORDER` or the codec registry, and the outbound collector has no shape to scan. "Covers are
 * not synced" is a schema fact.
 *
 * The cost is stated honestly: on another device the same draft has no cover. The alternative is
 * carrying multi-megabyte images in the sync envelope, and that brings envelope size, codec version
 * bumps and transfer volume along with it. That is a different decision. Publishing uploads the
 * cover to the server, and from then on every device sees the same one (the web's
 * `lib/local-authoring/draft-cover.ts` made the same call).
 *
 * One draft has one cover, so `draft_id` is the primary key. No index is added, because the only
 * read is "this draft's cover".
 */
const V20: readonly MigrationStep[] = [
	`CREATE TABLE authoring_draft_cover (
		draft_id TEXT PRIMARY KEY NOT NULL,
		version INTEGER NOT NULL,
		file_name TEXT NOT NULL,
		mime TEXT,
		byte_size INTEGER NOT NULL,
		updated_at TEXT NOT NULL
	)`,
];

/** Migration steps per version. The array position is the target version (1-based). */
const MIGRATIONS: readonly (readonly MigrationStep[])[] = [
	V1,
	V2,
	V3,
	V4,
	V5,
	V6,
	V7,
	V8,
	V9,
	V10,
	V11,
	V12,
	V13,
	V14,
	V15,
	V16,
	V17,
	V18,
	V19,
	V20,
];

/**
 * Brings the schema up to the current version, with **one transaction per version.**
 *
 * `PRAGMA user_version` is updated inside the transaction and rolls back with it. So if any
 * statement fails, that version stays unapplied, and the next run retries it from the start. If the
 * version number were written first and the statements ran after, the failure would leave a file
 * marked as applied whose tables do not exist, and that file would never heal itself.
 *
 * `PRAGMA` cannot take bound parameters, so the number is concatenated into the string. The value
 * comes from this file's array length, so no external input reaches it.
 */
export async function migrate(db: MobileDatabase): Promise<void> {
	const row = await db.first<{ user_version: number }>("PRAGMA user_version");
	const current = row?.user_version ?? 0;
	for (let version = current + 1; version <= MIGRATIONS.length; version++) {
		const statements = MIGRATIONS[version - 1];
		await db.transaction(async (tx) => {
			for (const step of statements)
				if (typeof step === "string") await tx.exec(step);
				else await step(tx);
			await tx.exec(`PRAGMA user_version = ${version}`);
		});
	}
}
