import {
	bigint,
	boolean,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { member } from "./member.ts";

/**
 * Server storage for encrypted sync. The server never interprets what is stored here: there is no
 * room, message or draft column, only `ciphertext text`. That is the point — it protects users from
 * DB dumps, stolen backups, malicious operators and legal demands on stored data (it does not stop
 * XSS or a compromised client, and does not claim to).
 *
 * The owner is always `member.id`, never the auth account (`user.id`), so unlinking and relinking a
 * Google account never makes conversations disappear.
 */

/**
 * Opaque ciphertext store. The server knows whose row it is, the id, the type string, the byte
 * count, whether it is deleted and when it changed — nothing inside. That metadata does leak
 * behaviour (`chat.message` arriving several times a minute means a live conversation; length
 * approximates message length). It is not hidden: no padding or dummy traffic by decision,
 * documented.
 */
export const sync_record = pgTable(
	"sync_record",
	{
		owner: text("owner")
			.notNull()
			.references(() => member.id, { onDelete: "cascade" }),
		/** Client-made. The local id is the sync id; there is no second `syncId` identity. */
		id: text("id").notNull(),
		/** A namespace string like `chat.room`. The server validates format only and holds no vocabulary. */
		type: text("type").notNull(),
		/** null = tombstone. An empty string is not allowed (unlike legacy). */
		ciphertext: text("ciphertext"),
		/** `EncryptedBlob.v`; used for syntax validation only, the server never opens the envelope. */
		envelope: integer("envelope").notNull(),
		/** Optimistic concurrency counter, not a schema version. */
		version: integer("version").notNull(),
		/**
		 * Per-member monotonic sequence, the cursor axis of incremental pull. Neither a global counter
		 * nor a Postgres `SEQUENCE`; the reason is in the sequence-issuing comment in
		 * `services/sync/index.ts`, and it is the hardest decision in this schema to reverse.
		 */
		seq: bigint("seq", { mode: "number" }).notNull(),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		deleted: boolean("deleted").notNull().default(false),
		/** Ciphertext length, kept on the row so quota aggregation need not count each time. */
		bytes: integer("bytes").notNull().default(0),
	},
	(t) => [
		primaryKey({ columns: [t.owner, t.id] }),
		/**
		 * The only access path of pull: `owner = ? AND seq > ? ORDER BY seq LIMIT n`. No `type` index on
		 * purpose — the server has no reason to query by type, and one invites per-type statistics, which
		 * is metadata collection.
		 */
		index("sync_record_seq_idx").on(t.owner, t.seq),
	],
);

/**
 * Per-member sequence counter and quota totals. This row is the serialization point of the push
 * transaction: one member's concurrent pushes queue here while different members do not interfere.
 * Legacy used one global row, serializing every user's writes.
 */
export const sync_state = pgTable("sync_state", {
	owner: text("owner")
		.primaryKey()
		.references(() => member.id, { onDelete: "cascade" }),
	seq: bigint("seq", { mode: "number" }).notNull().default(0),
	/**
	 * Tombstone GC horizon; always 0 in v1. It exists unused on purpose: adding it when GC turns on
	 * would leave every running device unaware of the horizon, so they would meet already purged
	 * tombstones and resurrect deleted records, with no way to tell which device is stale.
	 */
	tombstone_horizon_seq: bigint("tombstone_horizon_seq", { mode: "number" })
		.notNull()
		.default(0),
	record_count: integer("record_count").notNull().default(0),
	total_bytes: bigint("total_bytes", { mode: "number" }).notNull().default(0),
	created_at: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updated_at: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

/**
 * Zero-knowledge keyring. `auth_key` never leaves in any response: the server cannot recover the
 * DEK from it (one-way derivation), but knowing it lets one forge a valid MAC for a new keyring, so
 * a session thief could swap the key and make the account's data permanently undecryptable — far
 * worse than a read failure. Legacy kept it nullable for old keyrings at the cost of a "no proof"
 * branch; with nothing to migrate it is NOT NULL.
 */
export const sync_keyring = pgTable("sync_keyring", {
	owner: text("owner")
		.primaryKey()
		.references(() => member.id, { onDelete: "cascade" }),
	/**
	 * The client's string verbatim; never parsed and re-serialized. The proof of possession is a MAC
	 * over exactly this string, so one character of key order or whitespace would make every later
	 * replacement request a 403.
	 */
	keyring: text("keyring").notNull(),
	auth_key: text("auth_key").notNull(),
	created_at: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updated_at: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

/**
 * Push retry idempotency. Without it a retry after a lost response would raise the server version
 * twice, permanently skewing that device's `baseVersion` so the record conflicts on every sync.
 */
export const sync_push_dedupe = pgTable(
	"sync_push_dedupe",
	{
		owner: text("owner")
			.notNull()
			.references(() => member.id, { onDelete: "cascade" }),
		idempotency_key: text("idempotency_key").notNull(),
		/** The same key with a different body is a 409: a client bug, not a retry. */
		request_hash: text("request_hash").notNull(),
		/** Serialized response; `""` means in progress. */
		response: text("response").notNull(),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.owner, t.idempotency_key] }),
		// Expired rows are deleted opportunistically by push; no separate worker.
		index("sync_push_dedupe_expiry_idx").on(t.expires_at),
	],
);
/**
 * Device pairing relay: expiring transport state, not a device list. What to check is the columns
 * that are absent:
 *
 * ```text
 * code plaintext   only the hash. The plaintext is the HKDF salt and the AAD, so storing it
 *                  would lose the channel binding to one DB dump.
 * DEK · plaintext  what is relayed is an envelope only the two devices can open.
 * private key      never leaves either device's memory.
 * device name·os   the server holds no device identity; that is the design's promise.
 * success·cancel   a row disappears once consumed, cancelled or expired.
 * ```
 *
 * The last line matters most. Using this table as "trusted device history" would give the server a
 * member device list, which demands a "revoke remotely" button that would be a lie: undoing a
 * device's knowledge of a DEK it already has is cryptographically impossible without DEK rotation
 * plus full re-encryption.
 */
export const sync_pairing = pgTable(
	"sync_pairing",
	{
		owner: text("owner")
			.notNull()
			.references(() => member.id, { onDelete: "cascade" }),
		/** Hex of `SHA-256(prefix \0 owner \0 normalized code)`. The server compares it and never produces it. */
		code_hash: text("code_hash").notNull(),
		/** The new device's x25519 public key (base64); an opaque string to the server. */
		new_pub: text("new_pub").notNull(),
		/**
		 * The DEK sealed by the trusted device; null before approval. Not parsed (same treatment as
		 * `sync_keyring.keyring`); the server knows only a length cap.
		 */
		payload: text("payload"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
	},
	(t) => [
		/**
		 * `(owner, code_hash)` is the identity. Not unique on `code_hash` alone, not because the owner
		 * already mixed into the hash could collide, but so that no lookup path can touch another
		 * account's row: every query must pass owner first, and the primary key encodes it.
		 */
		primaryKey({ columns: [t.owner, t.code_hash] }),
		// Expired rows are swept when pairing starts, like the push dedupe records.
		index("sync_pairing_expiry_idx").on(t.expires_at),
	],
);
