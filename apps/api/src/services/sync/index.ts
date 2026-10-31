import { createHash } from "node:crypto";
import type {
	KeyringDto,
	PullResponse,
	PushConflict,
	PushItem,
	PushResponse,
} from "@rowcat/contracts";
import { SYNC_ERROR_CODE, SYNC_LIMITS } from "@rowcat/contracts";
import {
	b64ToBytes,
	isValidEnvelopeSyntax,
	verifyKeyringProof,
} from "@rowcat/sync/server";
import {
	and,
	asc,
	desc,
	eq,
	gt,
	inArray,
	lt,
	lte,
	notInArray,
	sql,
} from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
	sync_keyring,
	sync_pairing,
	sync_push_dedupe,
	sync_record,
	sync_state,
} from "../../db/schema.ts";
import { ApiError } from "../../lib/errors.ts";
import { syncWakeBroker } from "./wake.ts";

/**
 * Sync server rules over an opaque store. What this file does not do is its spec: it never decrypts
 * ciphertext, parses domain payloads, knows `ChatRoom`/`StoryDraft` fields or the meaning of
 * `fieldRev`, merges, or holds a record-type vocabulary. The server knows identity (`owner`, `id`),
 * form (`type`, envelope syntax) and bookkeeping (`version`, `seq`, `bytes`) only; domain knowledge
 * entering here breaks the zero-knowledge claim.
 *
 * `owner` always arrives as an argument. There is no session reading here, so the request has no
 * slot where a client could name the owner.
 */

const syncError = (
	status: 400 | 403 | 404 | 409 | 410 | 413 | 507,
	code: string,
	message: string,
): ApiError => new ApiError(status, code, message);

/** `auth_key` is kept out of the select list so it has no place to leak from. */
export async function getKeyring(owner: string): Promise<KeyringDto> {
	const [row] = await db
		.select({ keyring: sync_keyring.keyring })
		.from(sync_keyring)
		.where(eq(sync_keyring.owner, owner))
		.limit(1);
	return { keyring: row?.keyring ?? null };
}

/**
 * First-writer-only. Overwriting would make ciphertext already uploaded under the winning DEK
 * permanently undecryptable; two clients both seeing "sync is off" and each minting a DEK really
 * happens.
 */
export async function setupKeyring(
	owner: string,
	input: { keyring: string; authKey: string },
): Promise<KeyringDto> {
	assertKeyringSize(input.keyring);
	const inserted = await db
		.insert(sync_keyring)
		.values({
			owner,
			keyring: input.keyring,
			auth_key: input.authKey,
		})
		.onConflictDoNothing({ target: sync_keyring.owner })
		.returning({ keyring: sync_keyring.keyring });

	if (inserted.length === 0)
		throw syncError(
			409,
			SYNC_ERROR_CODE.keyringExists,
			"A sync key is already registered.",
		);
	return { keyring: input.keyring };
}

/**
 * Replacement (recovery code reissue) requires proof of the current key. A session thief has no
 * DEK, so cannot forge `authKey` or the MAC: they can neither read the data nor swap the key to
 * lock the owner out, and the latter matters more because it would lose the user's data for good.
 */
export async function replaceKeyring(
	owner: string,
	input: { keyring: string; proof: string },
): Promise<KeyringDto> {
	assertKeyringSize(input.keyring);
	const authKey = await readAuthKey(owner);
	assertProof(authKey, input.keyring, input.proof);

	await db
		.update(sync_keyring)
		.set({ keyring: input.keyring, updated_at: new Date() })
		.where(eq(sync_keyring.owner, owner));
	return { keyring: input.keyring };
}

/**
 * Wipes keyring and ciphertext whole (the same deletion account removal does; the account stays).
 * It exists because of first-writer-only: someone who briefly steals the session of an account that
 * never enabled sync can register their own keyring, and the owner is then stuck at `locked` with a
 * 409, no recovery code, and no way to produce the proof `replaceKeyring` needs.
 *
 * This is the only keyring write that skips proof of possession (it could not work in that
 * situation); the route requires a recent login instead, and the scope of the deletion is the
 * safeguard: all it gains is the ability to delete ciphertext it cannot read. Keyring goes first,
 * as in account deletion, since destroying key material is the cryptographic erase. Idempotent.
 */
export async function resetSyncNamespace(
	owner: string,
): Promise<{ purgedRecords: number }> {
	return db.transaction(async (tx) => {
		await tx.delete(sync_keyring).where(eq(sync_keyring.owner, owner));
		await tx.delete(sync_pairing).where(eq(sync_pairing.owner, owner));
		await tx.delete(sync_push_dedupe).where(eq(sync_push_dedupe.owner, owner));
		await tx.delete(sync_state).where(eq(sync_state.owner, owner));
		const purged = await tx
			.delete(sync_record)
			.where(eq(sync_record.owner, owner))
			.returning({ id: sync_record.id });
		return { purgedRecords: purged.length };
	});
}

/** Changes nothing, so suspended and blocked members may call it. */
export async function verifyKeyring(
	owner: string,
	input: { keyring: string; proof: string },
): Promise<void> {
	const authKey = await readAuthKey(owner);
	assertProof(authKey, input.keyring, input.proof);
}

/** HKDF-SHA256 output length; a shorter key makes the proof brute-forceable. */
const AUTH_KEY_BYTES = 32;

async function readAuthKey(owner: string): Promise<Uint8Array> {
	const [row] = await db
		.select({ authKey: sync_keyring.auth_key })
		.from(sync_keyring)
		.where(eq(sync_keyring.owner, owner))
		.limit(1);
	if (!row)
		throw syncError(
			404,
			SYNC_ERROR_CODE.keyringMissing,
			"No sync key is registered.",
		);
	try {
		const key = b64ToBytes(row.authKey);
		// The contract pins the shape, but a stored row (older version) may predate that validation.
		if (key.length !== AUTH_KEY_BYTES) throw new Error("auth key length");
		return key;
	} catch {
		// Corrupt stored value: locking is safer than letting it through (fail-closed).
		throw syncError(
			403,
			SYNC_ERROR_CODE.keyringProofInvalid,
			"The sync key proof of possession is invalid.",
		);
	}
}

/**
 * Constant-time and fail-closed. The comparison itself is `@rowcat/sync`'s; hand-written here it
 * would eventually become `===`, whose early exit leaks how many bytes matched.
 */
function assertProof(
	authKey: Uint8Array,
	keyring: string,
	proof: string,
): void {
	if (!verifyKeyringProof(authKey, keyring, proof))
		throw syncError(
			403,
			SYNC_ERROR_CODE.keyringProofInvalid,
			"The sync key proof of possession is invalid.",
		);
}

function assertKeyringSize(keyring: string): void {
	if (Buffer.byteLength(keyring, "utf8") > SYNC_LIMITS.keyringMaxBytes)
		throw syncError(
			413,
			SYNC_ERROR_CODE.payloadTooLarge,
			"The keyring is too large.",
		);
}

export async function pullRecords(
	owner: string,
	input: { since: number; limit?: number },
): Promise<PullResponse> {
	/**
	 * `isSafeInteger`, not `isInteger`: `1e30` passes the latter and becomes a driver error (500) at
	 * the bigint bind. `limit` goes through the same gate because the route's `readInt` passes `NaN`
	 * through, which would otherwise reach `.limit()`.
	 */
	if (!Number.isSafeInteger(input.since) || input.since < 0)
		throw syncError(
			400,
			SYNC_ERROR_CODE.cursorInvalid,
			"The sync cursor is invalid.",
		);
	if (
		input.limit !== undefined &&
		(!Number.isSafeInteger(input.limit) || input.limit < 1)
	)
		throw syncError(
			400,
			SYNC_ERROR_CODE.cursorInvalid,
			"The sync page size is invalid.",
		);

	/** Over-cap is clamped, not a 400; rejecting would break old clients whenever the cap is raised. */
	const limit = Math.min(
		Math.max(1, Math.floor(input.limit ?? SYNC_LIMITS.pullDefaultLimit)),
		SYNC_LIMITS.pullMaxLimit,
	);

	const [state] = await db
		.select({ horizon: sync_state.tombstone_horizon_seq })
		.from(sync_state)
		.where(eq(sync_state.owner, owner))
		.limit(1);
	/**
	 * A cursor behind the tombstone horizon is a 410: that device missed pruned tombstones, and
	 * continuing incrementally would resurrect deleted records. The horizon is always 0 in v1, but
	 * without this branch wired in, every device running the day GC turns on would silently resurrect
	 * records.
	 */
	if (input.since > 0 && state && input.since < state.horizon)
		throw syncError(
			410,
			SYNC_ERROR_CODE.cursorExpired,
			"The sync cursor has expired. A full resync is required.",
		);

	/**
	 * The page is decided first from sizes alone, then read. Reading ciphertext for `limit + 1` rows
	 * and trimming in memory would be the very allocation the byte budget exists to prevent.
	 *
	 * The two reads are separate statements, so a push can rewrite rows between them; a rewritten row
	 * moves to a seq above the page. A page that came back empty would read to the engine as "the
	 * cursor did not move" and end the run, so the pair is retried until it returns something. Each
	 * retry needs another commit to land in between, and the last falls back to one row read in a
	 * single statement, which cannot come back empty while rows remain.
	 */
	let rows: PulledRow[] = [];
	let hasMore = false;
	for (
		let attempt = 0;
		attempt < PULL_PAGE_ATTEMPTS && rows.length === 0;
		attempt++
	) {
		const sizes = await db
			.select({ seq: sync_record.seq, bytes: sync_record.bytes })
			.from(sync_record)
			.where(
				and(eq(sync_record.owner, owner), gt(sync_record.seq, input.since)),
			)
			.orderBy(asc(sync_record.seq))
			.limit(limit + 1);
		const pageEnd = pullPageEnd(sizes, limit);
		if (pageEnd === null)
			return { records: [], cursor: input.since, hasMore: false };
		rows = await selectPulledRows(owner, input.since, pageEnd.lastSeq);
		/**
		 * A row rewritten between the two reads still has to be fetched, so a page shorter than sized
		 * says there is more.
		 */
		hasMore = pageEnd.hasMore || rows.length < pageEnd.count;
	}
	if (rows.length === 0) {
		rows = await selectPulledRows(owner, input.since, null, 2);
		hasMore = rows.length > 1;
		rows = rows.slice(0, 1);
	}
	const page = rows;

	return {
		records: page.map((row) => ({
			id: row.id,
			type: row.type,
			ciphertext: row.ciphertext,
			envelope: row.envelope,
			version: row.version,
			seq: row.seq,
			deleted: row.deleted,
			/**
			 * Source of a tombstone's `deletedAt`: a tombstone has no ciphertext, so the deleting device's
			 * time cannot be recovered, and each receiver stamping its own time would leave different values
			 * per device (inherited by thousands of cascade-deleted messages). Server bookkeeping, not a
			 * merge axis.
			 */
			serverUpdatedAt: row.updated_at.toISOString(),
		})),
		/**
		 * The seq of the last row actually returned; the global max would skip rows not on this page
		 * forever. With no rows it echoes the requested value (no advance).
		 */
		cursor: page.length > 0 ? page[page.length - 1].seq : input.since,
		hasMore,
	};
}

/** How many times the sized read and the fetch are tried before one row is read in one statement. */
const PULL_PAGE_ATTEMPTS = 3;

type PulledRow = Awaited<ReturnType<typeof selectPulledRows>>[number];

/**
 * The owner's rows after `since`, in seq order: up to `throughSeq`, or the first `limit` when no
 * upper bound is given.
 */
function selectPulledRows(
	owner: string,
	since: number,
	throughSeq: number | null,
	limit?: number,
) {
	const query = db
		.select({
			id: sync_record.id,
			type: sync_record.type,
			ciphertext: sync_record.ciphertext,
			envelope: sync_record.envelope,
			version: sync_record.version,
			seq: sync_record.seq,
			deleted: sync_record.deleted,
			updated_at: sync_record.updated_at,
		})
		.from(sync_record)
		.where(
			and(
				eq(sync_record.owner, owner),
				gt(sync_record.seq, since),
				throughSeq === null ? undefined : lte(sync_record.seq, throughSeq),
			),
		)
		.orderBy(asc(sync_record.seq));
	return limit === undefined ? query : query.limit(limit);
}

/**
 * Where a pull page ends: at most `limit` rows whose bytes add up to no more than `pullMaxBytes`.
 * The first row is always taken whatever its size, so the page always advances.
 * `sizes` is the owner's next `limit + 1` rows in seq order; the extra row only says whether more
 * remain. `null` means nothing is left to send.
 */
export function pullPageEnd(
	sizes: readonly { seq: number; bytes: number }[],
	limit: number,
): { lastSeq: number; count: number; hasMore: boolean } | null {
	let total = 0;
	let taken = 0;
	for (const row of sizes) {
		if (taken === limit) break;
		if (taken > 0 && total + row.bytes > SYNC_LIMITS.pullMaxBytes) break;
		total += row.bytes;
		taken += 1;
	}
	if (taken === 0) return null;
	return {
		lastSeq: (sizes[taken - 1] as { seq: number }).seq,
		count: taken,
		hasMore: sizes.length > taken,
	};
}

/**
 * Same chunk on retry hashes the same, changed content differently. Canonical form: version tag,
 * five fields per item joined by `\0`, items joined by `\n`, order preserved (order is seq
 * assignment order). Request ids, times and headers are excluded; mixing them in would give a real
 * retry a new hash every time and defeat idempotency.
 */
export function pushRequestHash(items: readonly PushItem[]): string {
	const canonical = items
		.map((item) =>
			[
				item.id,
				item.type,
				String(item.baseVersion),
				item.deleted ? "1" : "0",
				item.ciphertext ?? "",
			].join("\0"),
		)
		.join("\n");
	return createHash("sha256")
		.update(`sync.push.v1\n${canonical}`)
		.digest("hex");
}

const byteLength = (value: string | null): number =>
	value === null ? 0 : Buffer.byteLength(value, "utf8");

/**
 * Checks everything checkable without decrypting. Not knowing the content does not mean accepting
 * any bytes: what is filtered here opens under no key, would only eat quota, and would fail
 * decryption on other devices at every pull.
 */
function validateItems(items: readonly PushItem[]): void {
	if (items.length > SYNC_LIMITS.pushMaxItems)
		throw syncError(
			413,
			SYNC_ERROR_CODE.payloadTooLarge,
			"This exceeds how much can be sent at once.",
		);

	const seen = new Set<string>();
	let total = 0;
	for (const item of items) {
		/** Duplicate ids in a batch fail closed: they consume seq twice and keep only the last, corrupting state. */
		if (seen.has(item.id))
			throw syncError(
				400,
				SYNC_ERROR_CODE.recordInvalid,
				"The same record appears twice in one request.",
			);
		seen.add(item.id);

		if (item.deleted) {
			// Tombstones allow null only; accepting "" made a tombstone with content representable.
			if (item.ciphertext !== null)
				throw syncError(
					400,
					SYNC_ERROR_CODE.recordInvalid,
					"A tombstone must have no ciphertext.",
				);
			continue;
		}

		if (item.ciphertext === null || item.ciphertext.length === 0)
			throw syncError(
				400,
				SYNC_ERROR_CODE.recordInvalid,
				"A live record must have ciphertext.",
			);

		const bytes = byteLength(item.ciphertext);
		if (bytes > SYNC_LIMITS.ciphertextMaxBytes)
			throw syncError(
				413,
				SYNC_ERROR_CODE.payloadTooLarge,
				"The record is too large.",
			);
		total += bytes;

		if (!isValidEnvelopeSyntax(item.ciphertext, item.envelope))
			throw syncError(
				400,
				SYNC_ERROR_CODE.recordInvalid,
				"The crypto envelope syntax is invalid.",
			);
	}

	if (total > SYNC_LIMITS.pushMaxTotalBytes)
		throw syncError(
			413,
			SYNC_ERROR_CODE.payloadTooLarge,
			"This exceeds how much can be sent at once.",
		);
}

const idempotencyExpiry = (): Date =>
	new Date(Date.now() + SYNC_LIMITS.idempotencyTtlDays * 24 * 60 * 60 * 1000);

/**
 * Batch push: all applied or all rejected. Order is the spec:
 *
 * ```text
 * 1. validate the batch (duplicate ids, envelope syntax, caps)
 * 2. claim the idempotency key; same key + same body returns the cached response
 * 3. lock the sync_state row, read current seq and quota
 * 4. check every item's baseVersion and type immutability
 * 5. any conflict: apply nothing, return the list
 * 6. check quota; over it also applies nothing
 * 7. issue n seqs and upsert all
 * 8. update quota totals and seq
 * -- commit --
 * 9. announce wake-up only if state actually advanced (outside the transaction)
 * ```
 *
 * Step 9 is outside because announcing inside would send out the cursor of a transaction that then
 * rolls back, and receivers would pull a state that does not exist. A failed notification does not
 * fail the push: wake-up is a latency optimization, and correctness already lives in startup,
 * foreground, reconnect and manual sync.
 *
 * No partial apply: a batch is what was one user action locally (draft + children, message + room).
 * Half applied, other devices would see a new parent with old children, and merging that matches
 * nobody's intent.
 */
export async function pushRecords(
	owner: string,
	input: { items: PushItem[]; idempotencyKey: string },
): Promise<PushResponse> {
	validateItems(input.items);
	const requestHash = pushRequestHash(input.items);

	const outcome = await db.transaction(async (tx) => {
		/** Expired rows are swept for this owner only; a global sweep would lock other members' rows on every push. */
		await tx
			.delete(sync_push_dedupe)
			.where(
				and(
					eq(sync_push_dedupe.owner, owner),
					lt(sync_push_dedupe.expires_at, new Date()),
				),
			);

		/**
		 * Idempotency claim. A concurrent request with the same key blocks on the unique index until the
		 * first commits, then gets 0 rows here and reads the cached response; if the first rolled back,
		 * this one claims it. Claim and work share one transaction: split, a crash in between leaves an
		 * "in progress" row blocking that key for the 7-day TTL.
		 */
		const claimed = await tx
			.insert(sync_push_dedupe)
			.values({
				owner,
				idempotency_key: input.idempotencyKey,
				request_hash: requestHash,
				response: "",
				expires_at: idempotencyExpiry(),
			})
			.onConflictDoNothing()
			.returning({ key: sync_push_dedupe.idempotency_key });

		if (claimed.length === 0) {
			const [existing] = await tx
				.select({
					hash: sync_push_dedupe.request_hash,
					response: sync_push_dedupe.response,
				})
				.from(sync_push_dedupe)
				.where(
					and(
						eq(sync_push_dedupe.owner, owner),
						eq(sync_push_dedupe.idempotency_key, input.idempotencyKey),
					),
				)
				.limit(1);

			if (existing && existing.hash !== requestHash)
				throw syncError(
					409,
					SYNC_ERROR_CODE.idempotencyMismatch,
					"A different request came with the same idempotency key.",
				);
			if (existing && existing.response === "")
				throw syncError(
					409,
					SYNC_ERROR_CODE.idempotencyInProgress,
					"The same request is still being processed.",
				);
			/**
			 * Returns the cached response and does not announce again: the original transaction already
			 * advanced state and announced, and repeating it would make one retry after a lost response cost
			 * every device a wasted pull.
			 */
			if (existing)
				return {
					response: JSON.parse(existing.response) as PushResponse,
					advanced: false,
				};
			// Another transaction just swept it (expired); proceeding and re-applying is correct now.
		} else {
			/**
			 * Only a new claim can push the owner past the cap, so only a new claim trims. The row just
			 * claimed is the newest and always survives.
			 */
			const kept = tx
				.select({ key: sync_push_dedupe.idempotency_key })
				.from(sync_push_dedupe)
				.where(eq(sync_push_dedupe.owner, owner))
				.orderBy(desc(sync_push_dedupe.created_at))
				.limit(SYNC_LIMITS.idempotencyMaxPerOwner);
			await tx
				.delete(sync_push_dedupe)
				.where(
					and(
						eq(sync_push_dedupe.owner, owner),
						notInArray(sync_push_dedupe.idempotency_key, kept),
					),
				);
		}

		/**
		 * `FOR UPDATE` is the most important line here (§17): it aligns commit order with seq order.
		 * Without it a later-starting transaction can commit first, a lower seq appears afterwards, and a
		 * device that pulled in between never sees that record.
		 */
		await tx
			.insert(sync_state)
			.values({ owner })
			.onConflictDoNothing({ target: sync_state.owner });
		const [state] = await tx
			.select({
				seq: sync_state.seq,
				recordCount: sync_state.record_count,
				totalBytes: sync_state.total_bytes,
			})
			.from(sync_state)
			.where(eq(sync_state.owner, owner))
			.for("update");

		const ids = input.items.map((item) => item.id);
		const existing = await tx
			.select({
				id: sync_record.id,
				type: sync_record.type,
				version: sync_record.version,
				bytes: sync_record.bytes,
			})
			.from(sync_record)
			.where(and(eq(sync_record.owner, owner), inArray(sync_record.id, ids)));
		const current = new Map(existing.map((row) => [row.id, row]));

		const conflicts: PushConflict[] = [];
		for (const item of input.items) {
			const row = current.get(item.id);
			if (!row) {
				// A record the server lacks must have baseVersion 0.
				if (item.baseVersion !== 0)
					conflicts.push({ id: item.id, serverVersion: 0 });
				continue;
			}
			/**
			 * Type-swap defence: a different type on the same (owner, id) is a conflict. AAD also binds the
			 * type; blocking here keeps that ciphertext from being stored at all, where it would fail
			 * decryption on other devices at every pull.
			 */
			if (row.type !== item.type || row.version !== item.baseVersion)
				conflicts.push({ id: item.id, serverVersion: row.version });
		}

		if (conflicts.length > 0) {
			/** Nothing was applied and seq is unchanged, so there is nothing to wake; conflicts never ride the notification plane. */
			const response: PushResponse = {
				ok: false,
				cursor: state.seq,
				conflicts,
			};
			await cacheResponse(tx, owner, input.idempotencyKey, response);
			return { response, advanced: false };
		}

		/* Quota is judged before any item is applied. */
		let nextCount = state.recordCount;
		let nextBytes = state.totalBytes;
		for (const item of input.items) {
			const row = current.get(item.id);
			const bytes = byteLength(item.ciphertext);
			if (!row) nextCount += 1;
			nextBytes += bytes - (row?.bytes ?? 0);
		}
		if (
			nextCount > SYNC_LIMITS.ownerMaxRecords ||
			nextBytes > SYNC_LIMITS.ownerMaxTotalBytes
		)
			throw syncError(
				507,
				SYNC_ERROR_CODE.quotaExceeded,
				"Sync storage capacity was exceeded.",
			);

		await assertTypeBudget(tx, owner, input.items, current);

		/* Issue seqs and upsert. */
		const now = new Date();
		let seq = state.seq;
		for (const item of input.items) {
			seq += 1;
			const bytes = byteLength(item.ciphertext);
			await tx
				.insert(sync_record)
				.values({
					owner,
					id: item.id,
					type: item.type,
					ciphertext: item.ciphertext,
					envelope: item.envelope,
					version: item.baseVersion + 1,
					seq,
					updated_at: now,
					deleted: item.deleted,
					bytes,
				})
				.onConflictDoUpdate({
					target: [sync_record.owner, sync_record.id],
					set: {
						ciphertext: item.ciphertext,
						envelope: item.envelope,
						version: item.baseVersion + 1,
						seq,
						updated_at: now,
						deleted: item.deleted,
						bytes,
					},
				});
		}

		await tx
			.update(sync_state)
			.set({
				seq,
				record_count: nextCount,
				total_bytes: nextBytes,
				updated_at: now,
			})
			.where(eq(sync_state.owner, owner));

		const response: PushResponse = { ok: true, cursor: seq, conflicts: [] };
		await cacheResponse(tx, owner, input.idempotencyKey, response);
		return { response, advanced: true };
	});

	/**
	 * Announced after commit, one frame per batch: the value is the last seq the batch received, and a
	 * device pulls everything after its cursor, so announcing intermediate seqs would only trigger
	 * repeat pulls. The `try` is not because the current implementation throws; this boundary is where
	 * a cross-process implementation (Redis pub/sub) will go, and a network failure leaking out would
	 * report an already-committed push as failed.
	 */
	if (outcome.advanced) {
		try {
			syncWakeBroker.publish(owner, outcome.response.cursor);
		} catch {
			// A failed notification is not a failed push; devices catch up on their next lifecycle signal.
		}
	}
	return outcome.response;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const cacheResponse = async (
	tx: Tx,
	owner: string,
	key: string,
	response: PushResponse,
): Promise<void> => {
	await tx
		.update(sync_push_dedupe)
		.set({ response: JSON.stringify(response) })
		.where(
			and(
				eq(sync_push_dedupe.owner, owner),
				eq(sync_push_dedupe.idempotency_key, key),
			),
		);
};

/**
 * Per-owner cap on distinct types: the abuse defence standing in for a type allowlist (anything
 * well-formed is accepted, so unbounded namespaces could fill storage). It counts only when a new
 * type actually arrives; counting on every push would scan all of the owner's rows (no `(owner,
 * type)` index) as a cost on routine sync. A new record id is not a new type — every new message is
 * one — so each incoming type is first probed, and a type the owner already has stops that probe
 * at its first row.
 */
async function assertTypeBudget(
	tx: Tx,
	owner: string,
	items: readonly PushItem[],
	current: Map<string, { type: string }>,
): Promise<void> {
	const incoming = new Set<string>();
	for (const item of items) if (!current.has(item.id)) incoming.add(item.type);
	/**
	 * More distinct types than the cap in one batch cannot fit whatever the owner holds; no scan.
	 * Otherwise probing stops at the first type the owner lacks: that one alone means the full count
	 * is needed, and probing the rest would each scan every row for nothing.
	 */
	if (incoming.size > SYNC_LIMITS.ownerMaxDistinctTypes) throw tooManyTypes();
	let unseen = false;
	for (const type of incoming) {
		const [known] = await tx
			.select({ one: sql<number>`1` })
			.from(sync_record)
			.where(and(eq(sync_record.owner, owner), eq(sync_record.type, type)))
			.limit(1);
		if (!known) {
			unseen = true;
			break;
		}
	}
	if (!unseen) return;

	const rows = await tx
		.selectDistinct({ type: sync_record.type })
		.from(sync_record)
		.where(eq(sync_record.owner, owner));
	const types = new Set(rows.map((row) => row.type));
	for (const type of incoming) types.add(type);
	if (types.size > SYNC_LIMITS.ownerMaxDistinctTypes) throw tooManyTypes();
}

const tooManyTypes = () =>
	syncError(
		507,
		SYNC_ERROR_CODE.quotaExceeded,
		"There are too many sync record types.",
	);

/** For diagnostics and tests: the owner's current cursor (max seq). */
export async function readSyncCursor(owner: string): Promise<number> {
	const [row] = await db
		.select({ seq: sync_state.seq })
		.from(sync_state)
		.where(eq(sync_state.owner, owner))
		.limit(1);
	return row?.seq ?? 0;
}
