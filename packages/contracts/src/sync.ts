import { z } from "zod";

/**
 * Wire-shape contract for the `/v2/me/sync/*` endpoints. Shapes only, no behavior.
 * - Behavior (encryption, merge rules, engine, tick/absorb/compare) lives in @rowcat/sync, shared
 *   by web and mobile. The server only parses requests with zod, so behavior here would pull that
 *   code into the server.
 * - `SyncCodec` is not here for the same reason.
 * - `DraftFieldGroup` belongs to @rowcat/authoring. The server has no reason to know the merge
 *   vocabulary.
 * - Pairing code normalization, hashing and envelope construction belong to @rowcat/sync. This
 *   file holds only the wire shape. The absence of the raw code is the spec.
 * - Asset blobs are slice 6. Only their path namespace is reserved in the docs.
 */

/**
 * Record revision: a point on a Hybrid Logical Clock.
 * - `t`: logical wall-clock time in ms, kept readable for diagnosis.
 * - `c`: counter for several writes within the same `t`.
 * - `d`: device id. It breaks ties deterministically when two devices reach the same (t, c).
 *
 * `updatedAt` is not the merge axis. Wall clocks can move backward (manual edits, NTP correction),
 * identical milliseconds do occur, and a wall clock cannot break ties. `updatedAt` stays for
 * display and recency sorting.
 *
 * The field names are deliberately short. One revision is attached to every record (a draft carries
 * seven), so long names would outweigh the values.
 */
export const Rev = z.object({
	/**
	 * Logical wall-clock time in ms. Never negative or fractional. `t` never goes down, even if the
	 * device clock moves backward.
	 */
	t: z.number().int().nonnegative(),
	c: z.number().int().nonnegative(),
	/** Device identifier. An empty string cannot break ties, so the contract rejects it. */
	d: z.string().min(1),
});
export type Rev = z.infer<typeof Rev>;

/*
 * Wire protocol for `/v2/me/sync/*`: request and response shapes only. The contract treats
 * ciphertext as an opaque string and does not know what it holds. The server does not either. That
 * boundary is the point of this slice.
 */

/**
 * Four version axes exist. This file owns two of them.
 * - SYNC_PROTOCOL_VERSION: wire contract version (this file).
 * - SYNC_ENVELOPE_VERSION: version of the `{v, iv, ct}` envelope (this file). It is also included
 *   in the AAD.
 * - payload.schemaVersion: per record type, owned by the domain codecs.
 * - sync_record.version: optimistic-concurrency counter, owned by the server, unrelated to
 *   schema.
 *
 * Do not fold them into one number. That would tie envelope changes to draft schema changes, and
 * adding one draft field would mark every already-uploaded envelope as outdated.
 */
export const SYNC_PROTOCOL_VERSION = 1;
export const SYNC_ENVELOPE_VERSION = 1;

/**
 * Request limits. The server is the final authority. Clients read the same constants only to save a
 * round trip. The server re-validates every value. The constants live in the contract so both sides
 * see the same numbers, and a chunk the client sized is never rejected by the server's limits.
 */
export const SYNC_LIMITS = {
	/**
	 * Maximum record id length. Fits 36-character UUIDs and the server's 32-character hex ids, with
	 * headroom.
	 */
	recordIdMaxLength: 64,
	typeMaxLength: 32,
	/**
	 * Maximum ciphertext size for one record. A room `seed` must still fit under this after
	 * compression.
	 */
	ciphertextMaxBytes: 512_000,
	/**
	 * Batch limit. Smaller than the legacy limit (500 items / 8 MB). Batches are atomic, so one hot
	 * record blocks every unrelated record in the same batch. Keeping batches small matters more than
	 * total retransmission volume.
	 */
	pushMaxItems: 200,
	pushMaxTotalBytes: 4_000_000,
	pullDefaultLimit: 200,
	pullMaxLimit: 500,
	/**
	 * Ciphertext bytes one pull page may carry. The row cap alone let one page hold 500 records near
	 * `ciphertextMaxBytes` — about 256 MB read from Postgres and copied again into the JSON response,
	 * so a handful of concurrent pulls from one account could exhaust the API's heap. A page stops before
	 * the record that would cross this budget and says `hasMore`; it always carries at least one record,
	 * so a page can never be empty while records remain. Clients already loop on `hasMore`, which is
	 * why this needed no client change.
	 */
	pullMaxBytes: 8_000_000,
	ownerMaxRecords: 200_000,
	/** 512 MiB. */
	ownerMaxTotalBytes: 536_870_912,
	/**
	 * Distinct types per owner. This is the abuse guard used in place of a server-side type allowlist
	 * (§16.7). It stops a namespace from being squatted, without blocking a client that is ahead of a
	 * lagging server.
	 */
	ownerMaxDistinctTypes: 32,
	keyringMaxBytes: 4_096,
	idempotencyTtlDays: 7,
	/**
	 * Idempotency rows one owner keeps. Expiry alone did not bound them: every push writes one, and a
	 * push of nothing but conflicts writes one too without touching the record quota, so an account
	 * pushing in a loop grew the table for a week. A client retries the last few chunks of one run, so
	 * keeping the newest thousand loses nothing a real retry needs.
	 */
	idempotencyMaxPerOwner: 1_000,

	/**
	 * Lifetime of a pairing session. The server is the final authority. The row is relay state, not
	 * storage, so the window only has to cover copying one code between two devices placed side by
	 * side. A longer window lets a leaked code (shared screen, shoulder surfing) stay valid for
	 * longer.
	 */
	pairingTtlMinutes: 5,
	/**
	 * Maximum open pairing sessions per owner. This is the owner's own budget, not an abuse vector.
	 * Without a cap, this table would be the only place rows grow without limit, since expired rows
	 * are cleaned up only when the next start runs.
	 */
	pairingMaxActive: 5,
	/**
	 * Upper bound for the approval payload. A real envelope is about 300 bytes (44-byte public key,
	 * 16-byte nonce, 64-byte ciphertext of a 32-byte key). The margin is kept small on purpose. The
	 * server cannot read the payload, so its size limit is the only defense.
	 */
	pairingPayloadMaxBytes: 1_024,
} as const;

/**
 * Error codes. Clients branch on these names, not on HTTP status codes. Optimistic-concurrency
 * conflicts are deliberately absent. A conflict is an expected result, not a failed request, and it
 * must carry a list of `serverVersion` values that `ApiErrorBody` has no slot for. Conflicts return
 * `200 { ok: false, conflicts }` (§18.2).
 */
export const SYNC_ERROR_CODE = {
	/** HTTP 404. No keyring exists, so this account has never enabled sync. */
	notConfigured: "sync_not_configured",
	/**
	 * Client-only code. The server never returns it. The client uses it when the DEK is not in memory.
	 */
	locked: "sync_locked",

	/** HTTP 400. The cursor is negative or NaN. */
	cursorInvalid: "sync_cursor_invalid",
	/**
	 * HTTP 410. The tombstone horizon was exceeded. Never raised in v1, where the horizon is always 0.
	 */
	cursorExpired: "sync_cursor_expired",
	/** HTTP 400. Record id, type, or envelope syntax is invalid. */
	recordInvalid: "sync_record_invalid",
	/** HTTP 413. One record or the batch limit was exceeded. */
	payloadTooLarge: "sync_payload_too_large",
	/** HTTP 507. Account-wide quota exceeded. */
	quotaExceeded: "sync_quota_exceeded",

	/** HTTP 409. The same idempotency key was sent with a different body. */
	idempotencyMismatch: "sync_idempotency_mismatch",
	/** HTTP 409 with Retry-After. A request with the same idempotency key is still in progress. */
	idempotencyInProgress: "sync_idempotency_in_progress",

	/**
	 * HTTP 409, first writer only. The loser receives the winning keyring and enters the locked state.
	 */
	keyringExists: "sync_keyring_exists",
	/** 404. */
	keyringMissing: "sync_keyring_missing",
	/** HTTP 403. The proof of possession of the current DEK is wrong. */
	keyringProofInvalid: "sync_keyring_proof_invalid",

	/**
	 * HTTP 404 when no open session exists for that codeHash. An expired session returns the same
	 * code. It must be indistinguishable from a missing one (§8). If the two were split, the branch
	 * would depend on when the cleanup job happens to run, so the same situation could return 404 one
	 * day and 410 the next. A new device judges expiry from the `expiresAt` it received.
	 */
	pairingNotFound: "sync_pairing_not_found",
	/** HTTP 409. A session with this codeHash is already open. Generate a new code and start over. */
	pairingExists: "sync_pairing_exists",
	/**
	 * HTTP 409. The session is already approved. The first approval to arrive wins. If two trusted
	 * devices approve the same code at once, the later one gets this error. Overwriting the payload
	 * would leave an envelope on the server that differs from the one the new device already fetched,
	 * and the next poll would fetch a value it cannot open.
	 */
	pairingAlreadyApproved: "sync_pairing_already_approved",
	/** HTTP 429. This member has more open pairing sessions than the limit allows. */
	pairingTooMany: "sync_pairing_too_many",
	/**
	 * HTTP 429 with Retry-After. Pairing was started too often. It is kept separate from
	 * `pairingTooMany` because the next action differs. That code means the open-session cap was
	 * reached, which clears as soon as one session is cancelled. This one clears only with time.
	 * Folding them together would tell the user to cancel an existing connection, and cancelling would
	 * change nothing. The status endpoint (`POST /pairing/status`) has no such code. It is designed
	 * polling, about every 2 seconds while the screen is open, so it is not rate limited (§13).
	 */
	pairingRateLimited: "sync_pairing_rate_limited",
	/**
	 * Client-only code. The envelope opened, but the key inside it cannot open this account's keyring.
	 * That key is not remembered, and the device stays locked (§20).
	 */
	pairingKeyRejected: "sync_pairing_key_rejected",
} as const;
export type SyncErrorCode =
	(typeof SYNC_ERROR_CODE)[keyof typeof SYNC_ERROR_CODE];

/**
 * Record id. The local id is the sync id, so no separate `syncId` exists. The pattern is not
 * narrowed to UUIDs. The web client creates 36-character hyphenated UUIDs, the server creates
 * 32-character hex ids, and migrated legacy ids must keep working. The 8 to 64 character bounds
 * only block oversized ids that bloat indexes. Colons are allowed because they separate derived
 * identities, such as `chat-summary:<room>` and `authoring-runtime:<draft>`. Before this was
 * widened, a push chunk containing such a record was rejected whole with 400. Chunks are atomic, so
 * valid neighbors never synced either. The cost is that builds from before this change cannot parse
 * pull pages with colon ids and must be updated. Derived ids are pinned to this pattern at the
 * assembly point (`apps/web/src/test/sync-record-id.test.ts`).
 */
export const SyncRecordId = z
	.string()
	.regex(/^[A-Za-z0-9_:-]{8,64}$/, "not a record id");

/**
 * Record type: a namespace string. The server holds no vocabulary of its own. There is no fixed
 * allowlist, for forward compatibility. If a new type required a server deploy first, a newer
 * client would be blocked by an older server. Only the format is enforced. Older clients ignore
 * unknown types and advance their cursor. Uppercase letters are allowed inside segments. The
 * original lowercase-only rule blocked `authoring.sceneImage`: every push batch containing it got
 * 400. Because batches are atomic, unrelated chats and drafts were rejected too, and that account
 * never synced. Widening the predicate fixes already-shipped clients with one API deploy. Renaming
 * the type would leave those devices blocked until their users update. Segments still start with a
 * lowercase letter, allow one or two dots, and keep the length cap.
 */
export const SyncRecordType = z
	.string()
	.max(SYNC_LIMITS.typeMaxLength)
	.regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){1,2}$/, "not a record type");

/**
 * Encrypted envelope: a shell that the server validates for syntax only. `v` is carried explicitly,
 * unlike the legacy `{iv, ct}` blob. With the legacy format, a changed envelope could only show up
 * to older clients as a decryption failure, so 'wrong key' and 'unknown envelope' could not be told
 * apart. They are different events for the user. The first needs the recovery code re-entered, and
 * the second needs an app update. Stored as `JSON.stringify(EncryptedBlob)`. The server keeps the
 * string verbatim.
 */
export const EncryptedBlob = z.object({
	/** Envelope version. It is included in the AAD, so the value itself is authenticated. */
	v: z.number().int().min(1).max(255),
	/** base64. Must decode to exactly 12 bytes. The server checks this without decrypting. */
	iv: z.string().min(1),
	/** base64(ciphertext || GCM tag). */
	ct: z.string().min(1),
});
export type EncryptedBlob = z.infer<typeof EncryptedBlob>;

/**
 * The common envelope of the authenticated plaintext, in the shape it has just before encryption.
 * What is absent here is the point of this schema:
 * - `id`, `owner`, `type`: already authenticated by the AAD. Repeating them risks values that
 *   disagree.
 * - `serverVersion`: server bookkeeping. It differs per device and is unknown at encryption time.
 * - `dirty`: local push metadata. Another device's `dirty` means nothing. `deletedAt` is
 *   included. It is not the same as the server's `deleted` flag. That flag means the row has no
 *   ciphertext, while this value records when the record was deleted. Real tombstones carry no
 *   ciphertext, so this value is rarely sent. It is the reserved place for a future
 *   content-preserving delete. `rev` is here, and it is the whole rollback defense (§10.3). If the
 *   server restores an old blob, the client rejects it when the blob's revision is older than the
 *   local one. Legacy data had no such defense.
 */
export const SyncPayloadEnvelope = z.object({
	schemaVersion: z.number().int().nonnegative(),
	rev: Rev,
	deletedAt: z.string().nullable(),
	/**
	 * Per-type content. Its shape belongs to each domain's codec. The contract knows nothing beyond
	 * this field.
	 */
	data: z.unknown(),
});
export type SyncPayloadEnvelope = z.infer<typeof SyncPayloadEnvelope>;

/* ─────────────────────────────────────────────────────────────────────────────
 * push
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * A single push item. `owner` is absent on purpose, and that is the most important fact about this
 * schema. The owner comes only from the session. With no slot for it in the contract, passing it by
 * mistake is a type error. `version` is absent too. The client only knows the `baseVersion` it last
 * saw, and the server decides the next version.
 */
export const PushItem = z.object({
	id: SyncRecordId,
	type: SyncRecordType,
	/** Last server version this device confirmed. Must be 0 for a record the server does not have. */
	baseVersion: z.number().int().nonnegative(),
	/**
	 * Tombstones must have `ciphertext: null` exactly. Unlike the legacy contract, an empty string is
	 * not accepted.
	 */
	ciphertext: z.string().nullable(),
	envelope: z.number().int().min(1).max(255),
	deleted: z.boolean(),
});
export type PushItem = z.infer<typeof PushItem>;

/**
 * Push batch: every item applies, or none do. A batch groups things that were one user action
 * locally (a draft and its children, or a message and its room). Partial application would show
 * other devices an intermediate state, such as a new parent with old children.
 */
export const PushRequest = z.object({
	items: z.array(PushItem).min(1).max(SYNC_LIMITS.pushMaxItems),
});
export type PushRequest = z.infer<typeof PushRequest>;

/**
 * One optimistic-concurrency conflict. It carries the server's current version so the client can
 * pull and retry.
 */
export const PushConflict = z.object({
	id: SyncRecordId,
	serverVersion: z.number().int().nonnegative(),
});
export type PushConflict = z.infer<typeof PushConflict>;

/**
 * Push response: a conflict is also a 200. `ApiErrorBody` is not used because a conflict is a
 * normal, expected outcome rather than a failed request. The response must also carry a list of
 * `serverVersion` values, which the error body has no slot for. Real failures (validation, quota,
 * idempotency) still use `ApiErrorBody`.
 */
export const PushResponse = z.object({
	ok: z.boolean(),
	/** The owner's current maximum seq. On success, this is the last value the batch received. */
	cursor: z.number().int().nonnegative(),
	/** Non-empty only when `ok: false`. In that case nothing was applied. */
	conflicts: z.array(PushConflict),
	/** Set when an idempotent retry received a cached response. Server state did not change again. */
	deduplicated: z.boolean().optional(),
});
export type PushResponse = z.infer<typeof PushResponse>;

/**
 * Idempotency key. One per chunk, and every retry of that chunk uses the same key. If the chunk
 * contents change (for example, after re-collection following a conflict), a new key is created.
 * Sending a different body with the same key is rejected with 409. That is a client bug, not a
 * retry.
 */
export const SyncIdempotencyKey = z
	.string()
	.regex(/^[A-Za-z0-9_-]{16,128}$/, "not an idempotency key");

/* ─────────────────────────────────────────────────────────────────────────────
 * pull
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Pull item. `serverUpdatedAt` was not in the design document. It is needed because a tombstone has
 * `ciphertext = null`, so the receiving device has nothing to decrypt. The original device's
 * `deletedAt` and `rev` are never sent, so the receiver cannot know when the record was deleted. If
 * each device wrote its own time, the deletion times would diverge, and the messages cascade
 * deleted with a room would inherit different values. The server already stores
 * `sync_record.updated_at` for quotas and diagnostics. Sending it explicitly means every device
 * uses the same value. It is server bookkeeping, not plaintext domain data, and it is not the merge
 * axis. The winner is still decided only by the `rev` inside the payload. A live record's product
 * `updatedAt` still comes from inside the ciphertext.
 */
export const PullRecord = z.object({
	id: SyncRecordId,
	type: SyncRecordType,
	/** Null for tombstones. */
	ciphertext: z.string().nullable(),
	envelope: z.number().int().min(1).max(255),
	version: z.number().int().nonnegative(),
	/** The owner's monotonic sequence. This is the axis of the cursor. */
	seq: z.number().int().nonnegative(),
	deleted: z.boolean(),
	/** When the server last wrote this row. A tombstone's `deletedAt` comes from here. */
	serverUpdatedAt: z.iso.datetime(),
});
export type PullRecord = z.infer<typeof PullRecord>;

/**
 * Pull page. `cursor` is the seq of the last row actually returned, not the server's global
 * maximum. Using the global maximum would skip rows that did not fit in the page. If no rows came
 * back, the requested `since` is returned unchanged, so the cursor never moves forward without
 * data.
 */
export const PullResponse = z.object({
	records: z.array(PullRecord),
	cursor: z.number().int().nonnegative(),
	hasMore: z.boolean(),
});
export type PullResponse = z.infer<typeof PullResponse>;

/**
 * Keyring lookup response. It deliberately has no `authKey`. The server stores `authKey` only to
 * verify proof of possession and never returns it. If it were sent out, an attacker who had only
 * hijacked a session could mint a valid MAC for a new keyring, and every existing record of the
 * account would become undecryptable. The schema lacking the field is part of the defense. If the
 * server ever emits the value by mistake, the SDK's parse drops it.
 */
export const KeyringDto = z.object({
	/** The string exactly as the client created it. `null` if sync was never enabled. */
	keyring: z.string().nullable(),
});
export type KeyringDto = z.infer<typeof KeyringDto>;

/** Upper bound on the stored keyring string. The server does not parse it; only the client does. */
const KeyringString = z.string().min(1).max(SYNC_LIMITS.keyringMaxBytes);

/**
 * Initial registration, first writer only. `authKey` is accepted as input only here. Two clients
 * can both see 'sync off' and each create a DEK at the same time. If the later request overwrote,
 * data already encrypted under the winning DEK would become permanently undecryptable. So the loser
 * gets a 409, discards its own key material, and enters the locked state with the winning keyring.
 */
export const KeyringSetupRequest = z.object({
	keyring: KeyringString,
	/**
	 * base64 of 32 bytes: HKDF-SHA256(DEK, salt=owner, 'rowcat-sync-auth-v1'). The length is enforced
	 * by shape (43 base64 characters plus `=`). If any string were accepted, a client could register a
	 * 1-byte key, and a rewrap proof built on such a key could be forged offline in no time. Forging
	 * exactly that is what the proof exists to prevent.
	 */
	authKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
});
export type KeyringSetupRequest = z.infer<typeof KeyringSetupRequest>;

/**
 * Rotation (recovery code reissue). Requires proof of possession of the current DEK. `proof =
 * HMAC-SHA256(authKey, new keyring string)`. The server computes the same MAC with the stored
 * `authKey` and compares in constant time. An attacker who holds only the session does not know the
 * DEK, so cannot derive `authKey` or a valid MAC. The DEK does not change. Only the wrapper does,
 * so re-encryption is zero, and old recovery codes stop working immediately.
 */
export const KeyringRewrapRequest = z.object({
	keyring: KeyringString,
	proof: z.string().min(1).max(256),
});
export type KeyringRewrapRequest = z.infer<typeof KeyringRewrapRequest>;

/**
 * Possession check. Same shape as rotation, but read-only in effect. A remembered device calls it
 * to verify, against the server, a DEK it restored from its local wrapper. It changes nothing, so
 * even suspended or blocked members can call it. The method is POST only because a body must be
 * sent. It is a separate type because the two requests pass through different gates. Sharing one
 * type would let a future route fix move the other route's gate along with it.
 */
export const KeyringVerifyRequest = z.object({
	keyring: KeyringString,
	proof: z.string().min(1).max(256),
});
export type KeyringVerifyRequest = z.infer<typeof KeyringVerifyRequest>;

/*
 * Device pairing, `/v2/me/sync/pairing`. The server is an authenticated relay that expires, and
 * nothing more. These never reach the server: the pairing code in plaintext (only its hash travels,
 * §6), the DEK or any plaintext (only envelopes the two devices can open), the new device's private
 * key (§14), the ECDH shared secret (each side derives it), and the owner or viewer id (the owner
 * comes only from the session, §11). Device name, platform and location are absent too, since the
 * server has no device identity (§28). This is a one-time relay, not a device list. Succeeded,
 * cancelled and expired sessions are deleted, and nothing records which devices an account had.
 * That is why there is no remote revoke screen (§29).
 */

/**
 * Pairing envelope version. Bump it when the envelope bytes change. This is a different axis from
 * the record envelope (`SYNC_ENVELOPE_VERSION`). A pairing envelope lives five minutes and then
 * disappears, so bumping it costs almost nothing: there is no stored data to stay compatible with.
 * Record envelopes already have uploaded ciphertext that would all need rewriting. Folding both
 * into one number would make cheap changes pay for expensive ones.
 */
export const SYNC_PAIRING_VERSION = 1;

/**
 * Code hash: 64 lowercase hex characters (SHA-256). The server receives this hash, not the raw
 * code, as its lookup key (§6). A raw code would sit in the database, reverse-proxy logs and
 * request logs. The code is also the HKDF salt and the AAD, so if it leaked, channel binding would
 * be meaningless. A hash cannot open an envelope wherever it ends up. Hex is used because it has no
 * case variation and no `+/=`, so it is the same string in a path, a log, or a DB key. Construction
 * belongs to @rowcat/sync. The server only compares and never produces this value.
 */
export const SyncPairingCodeHash = z
	.string()
	.regex(/^[0-9a-f]{64}$/, "not a pairing code hash");

/**
 * The new device's x25519 public key: base64 of 32 bytes. The server treats this value as opaque.
 * Swapping it would let a trusted device seal the DEK to an attacker's key, which is the only real
 * attack surface this protocol gives the server. That attack fails at the code channel binding. The
 * code is in the envelope's AAD and HKDF salt, and the server does not know the code. An envelope
 * the server creates will not open on the new device, and an envelope sealed to an attacker's key
 * does not open with the new device's private key.
 */
export const SyncPairingPublicKey = z.string().min(1).max(128);

/**
 * Approval payload: a string the server never parses. It is handled the same way as the keyring
 * (`sync_keyring.keyring`). Only @rowcat/sync knows what is inside. The server knows one thing, the
 * length cap. Fields are deliberately not split out (for example, a separate `ephemeralPublicKey`).
 * Once the server knows an envelope's structure, that structure becomes something it might validate
 * or transform.
 */
export const SyncPairingPayload = z
	.string()
	.min(1)
	.max(SYNC_LIMITS.pairingPayloadMaxBytes);

/**
 * A pairing session: the response shared by lookup and start. The new device and the trusted device
 * read the same DTO. Both are sessions of the same owner, so nothing needs hiding. Splitting the
 * DTO would create two projections of one row, and one side would eventually gain fields the other
 * lacks.
 */
export const SyncPairingDto = z.object({
	newPublicKey: SyncPairingPublicKey,
	/** `null` until the session is approved. */
	payload: SyncPairingPayload.nullable(),
	/**
	 * Expiry time. The server's judgment is final. It serves two purposes: drawing the remaining time
	 * on screen, and letting a new device tell 'expired' from 'cancelled'. The server answers both
	 * with 404, since an expired session is indistinguishable from a missing one.
	 */
	expiresAt: z.iso.datetime(),
});
export type SyncPairingDto = z.infer<typeof SyncPairingDto>;

/**
 * Start: the new device generates a code and hands over its own public key. The schema has no slot
 * for the raw code. The server knows the session only by `codeHash`, and that hash is bound to
 * `owner` (§6). The same code therefore yields a different value for another account.
 */
export const SyncPairingStartRequest = z.object({
	codeHash: SyncPairingCodeHash,
	newPublicKey: SyncPairingPublicKey,
});
export type SyncPairingStartRequest = z.infer<typeof SyncPairingStartRequest>;

/**
 * Shape shared by lookup and cancel: a single hash. It sits in the body rather than a path
 * parameter, as an extension of §6. The hash is not the raw code, but it is still the session's
 * only key. In a path it would be logged by access logs, referrers and proxy caches.
 */
export const SyncPairingLookupRequest = z.object({
	codeHash: SyncPairingCodeHash,
});
export type SyncPairingLookupRequest = z.infer<typeof SyncPairingLookupRequest>;

/**
 * Approval: the trusted device hands over the DEK it sealed. The server does not transform this
 * payload. Requests to re-wrap the keyring or move recovery wrappers are not accepted here (§18).
 * If they were, the server would become a handler of key material, and the zero-knowledge claim
 * would break.
 */
export const SyncPairingApproveRequest = z.object({
	codeHash: SyncPairingCodeHash,
	payload: SyncPairingPayload,
});
export type SyncPairingApproveRequest = z.infer<
	typeof SyncPairingApproveRequest
>;

/*
 * Wake stream, `GET /v2/me/sync/events`. The contract's job here is to pin down one field. This
 * stream is a notification plane, not the data plane, and the zero-knowledge claim breaks as soon
 * as the two blur.
 * - Data plane (`/me/sync/records`): ciphertext travels, and the server cannot read it.
 * - Notification plane (`/me/sync/events`): one line saying 'your namespace may have advanced'.
 *   The omissions are the spec of this slice: record ids, types and ciphertext; room, work, draft
 *   and message ids; HLC revisions and device ids; provider, session, email and nickname; any 'a
 *   conflict happened' result; and any hint about what changed. The single `cursor` field is a
 *   boundary, not a saving. If a second field is ever wanted, the reason it belongs on the
 *   notification plane must be written down first.
 */

/**
 * Name of the SSE event for wake frames. A name is attached so clients can filter frames. A
 * nameless frame (only `data:`) gives a client no basis to filter it, unlike a heartbeat comment.
 * If a second frame kind were ever added, old clients would read it as a wake signal. With a name,
 * unknown names are simply ignored.
 */
export const SYNC_WAKE_EVENT = "sync";

/** Media type of this stream. `Accept` and the response `Content-Type` use the same value. */
export const SYNC_WAKE_CONTENT_TYPE = "text/event-stream";

/**
 * Heartbeat interval. This timer is not polling. It does not ask for sync records, does not push or
 * pull, and advances no state. It only emits a comment line (`: ping`) so the connection is not
 * dropped by a proxy's idle timeout. The promise that a quiet app makes no requests still holds. 20
 * seconds is comfortably below Cloudflare's 100-second idle timeout and the common nginx default of
 * 60 seconds. A frame is 8 bytes, so the cost is negligible.
 */
export const SYNC_WAKE_HEARTBEAT_MS = 20_000;

/**
 * A wake notification carries one cursor. The value is a hint, not an instruction to advance. The
 * receiving device must not write it to its local cursor, because that would skip records it never
 * downloaded. Only a pull followed by the `applyPull` transaction may move the local cursor. This
 * frame's only job is to request that pull. Duplicates and losses are both acceptable. The same
 * cursor may arrive several times (an echo of the device's own push, or the initial frame on
 * reconnect), and automatic sync merges them. If frames are lost during a disconnect, the initial
 * frame on reconnect reports the server's current cursor. That is why the server keeps no event
 * log.
 */
export const SyncWakeEvent = z.object({
	/**
	 * The owner's current maximum `seq`, on the same axis as `PullResponse.cursor` and
	 * `PushResponse.cursor`.
	 */
	cursor: z.number().int().nonnegative(),
});
export type SyncWakeEvent = z.infer<typeof SyncWakeEvent>;
