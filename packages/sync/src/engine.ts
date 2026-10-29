import { randomBytes } from "@noble/hashes/utils.js";
import type { PullRecord, PushItem } from "@rowcat/contracts/sync";
import {
	SYNC_ENVELOPE_VERSION,
	SYNC_ERROR_CODE,
	SYNC_LIMITS,
	SyncPayloadEnvelope,
} from "@rowcat/contracts/sync";
import type { AeadProvider } from "./aead.ts";
import { bytesToBase32, utf8ToBytes } from "./codec.ts";
import { decryptRecord, encryptRecord } from "./crypto.ts";
import type { SyncCodecRegistry } from "./registry.ts";
import type {
	IgnoredReason,
	InboundEntry,
	OutboundCursor,
	OutboundRecord,
	SyncStore,
} from "./store.ts";
import {
	type SyncFailure,
	type SyncSignal,
	type SyncTransport,
	syncFailureOf,
} from "./transport.ts";

/**
 * Sync engine: pure orchestration of pull, push and bootstrap. It has no React, Web API or account
 * hooks.
 *
 * It decides which calls run in what order. When they run is decided by the controller and the app;
 * in slice 1b the only trigger is a single button.
 *
 * Two rules shape this file:
 * - Crypto and network finish outside the storage transaction. Decryption happens first and only
 *   ready items go to applyPull. Dexie auto-commits a transaction when it meets an await outside
 *   its scope, so decrypting inside the callback would silently break atomicity.
 * - Ownership is checked again right before every local write. Logout or an account switch can
 *   happen during a round trip, and writing to the old store would add the wrong account's data.
 */

/** Injected clock. This package never calls `Date.now()`; see the header of `clock.ts`. */
export interface SyncClock {
	/** ISO 8601 string, written to `lastSyncedAt`. */
	nowIso(): string;
	/** Elapsed time for diagnostics only. Merge decisions never use it. */
	nowMs(): number;
}

export interface SyncEngineOptions {
	/**
	 * Owner: the `Viewer.id` confirmed for the session. It is an AAD component and the salt for
	 * `authKey`.
	 */
	owner: string;
	registry: SyncCodecRegistry;
	store: SyncStore;
	transport: SyncTransport;
	aead: AeadProvider;
	clock: SyncClock;
	/**
	 * Whether this store still belongs to the active scope right now.
	 *
	 * The default (always true) exists for tests and mobile; the web must pass a real check. A member
	 * can log out and log back in as the same id, which opens a new instance. Comparing member ids
	 * alone would let an old operation pass as belonging to the new scope.
	 */
	ownsStore?: () => boolean;
	signal?: SyncSignal;
	/** Backoff wait. Tests replace it with a function that returns immediately. */
	sleep?: (ms: number) => Promise<void>;
	onDiagnostic?: (event: SyncDiagnosticEvent) => void;
}

/**
 * Diagnostic event. Carries only counts and reasons.
 *
 * No record ids, plaintext or ciphertext. Ciphertext is still user data even though it is opaque,
 * and ids would let logs correlate one user's activity. Counts and categories are enough for
 * diagnosis.
 */
export type SyncDiagnosticEvent =
	| { kind: "ignored"; reason: IgnoredReason; count: number }
	| { kind: "conflict"; count: number }
	| { kind: "retry"; status: number; code: string }
	| { kind: "note"; code: string; count: number }
	| { kind: "oversized"; type: string; bytes: number };

export interface SyncRunResult {
	pulled: number;
	applied: number;
	ignored: number;
	pushed: number;
	conflicts: number;
	retries: number;
	durationMs: number;
	/** Set when ownership moved away during the run and it stopped quietly. Not an error. */
	abandoned: boolean;
}

/** A failure that retrying will not fix. The state machine reads this and halts. */
export class SyncEngineError extends Error {
	readonly failure: SyncFailure;
	constructor(message: string, failure: SyncFailure) {
		super(message);
		this.name = "SyncEngineError";
		this.failure = failure;
	}
}

/** Cancellation, raised on logout or unmount. Not surfaced to the user as an error. */
export class SyncAbortedError extends Error {
	constructor() {
		super("sync was cancelled");
		this.name = "SyncAbortedError";
	}
}

/**
 * How a push handles conflicts. The default keeps the existing behavior.
 *
 * `converge` pulls, merges, re-collects and retries. Daily sync on web and mobile uses it.
 * `surface` raises the conflict to the caller instead. Explicit read-edit-write operations use it.
 *
 * Convergence is correct for the protocol, but for an edit based on a previously read view it would
 * silently overwrite a value changed in between. The `expectedHash` contract promises the opposite,
 * so the caller chooses the branch.
 */
export type SyncConflictMode = "converge" | "surface";

/**
 * Thrown in surface mode when the server rejects a push under optimistic concurrency. Nothing was
 * applied.
 *
 * No details are attached. The caller must re-read the latest state and merge. The record id is not
 * needed for that, and ids are kept out of diagnostics, including logs of this error.
 */
export class SyncPushConflictError extends Error {
	readonly status = 409;
	readonly code = "sync_push_conflict";
	constructor() {
		super("could not push because the server's version is newer");
		this.name = "SyncPushConflictError";
	}
}

/**
 * Upper bound on convergence attempts. Conflicts that persist beyond four attempts indicate a bug,
 * not contention.
 *
 * A non-deterministic merge, for example, could make two devices keep overwriting each other. An
 * unbounded loop would hide that: the battery drains with no visible cause, and the bug never
 * surfaces.
 */
const MAX_CONVERGENCE_ATTEMPTS = 4;

/**
 * Retry cap and backoff for transport failures. Kept short because runs are triggered manually.
 */
const MAX_TRANSPORT_ATTEMPTS = 4;
const BACKOFF_BASE_MS = 250;
const BACKOFF_MAX_MS = 8_000;

const defaultSleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

/**
 * The key is random on purpose. A content hash would let two separate runs that build the same
 * chunk share one key. The second run would receive the first run's cached response and report
 * success even though nothing was applied.
 */
const newIdempotencyKey = (): string => bytesToBase32(randomBytes(16));

export interface SyncEngine {
	/** Server to local. One storage transaction per page. */
	pull(dek: Uint8Array): Promise<SyncRunResult>;
	/**
	 * Local to server. With `all`, dirty flags are ignored and every record is scanned.
	 *
	 * With `conflictMode: 'surface'`, a conflict throws `SyncPushConflictError` instead of converging.
	 * Local data is unchanged and the call applied nothing.
	 */
	push(
		dek: Uint8Array,
		options?: { all?: boolean; conflictMode?: SyncConflictMode },
	): Promise<SyncRunResult>;
	normalSync(dek: Uint8Array): Promise<SyncRunResult>;
	bootstrap(dek: Uint8Array): Promise<SyncRunResult>;
	run(dek: Uint8Array): Promise<SyncRunResult>;
}

export function createSyncEngine(options: SyncEngineOptions): SyncEngine {
	const {
		owner,
		registry,
		store,
		transport,
		aead,
		clock,
		ownsStore = () => true,
		signal,
		sleep = defaultSleep,
		onDiagnostic,
	} = options;

	const emit = (event: SyncDiagnosticEvent): void => onDiagnostic?.(event);

	const throwIfAborted = (): void => {
		if (signal?.aborted) throw new SyncAbortedError();
	};

	/**
	 * Wraps one transport call in retries. Deciding what to retry, and what not to, is the whole job
	 * of this function.
	 *
	 * Retrying a permanent error would send a bad record the same 400 on every run, draining the
	 * battery, while the real problem (that record must be quarantined) stays hidden.
	 */
	async function withRetry<T>(
		call: () => Promise<T>,
		counters: { retries: number },
	): Promise<T> {
		for (let attempt = 1; ; attempt++) {
			throwIfAborted();
			try {
				return await call();
			} catch (error) {
				if (error instanceof SyncAbortedError) throw error;
				const failure = syncFailureOf(error);
				const retryable =
					failure.status === 0 ||
					failure.status === 408 ||
					failure.status === 429 ||
					failure.status >= 500 ||
					failure.code === SYNC_ERROR_CODE.idempotencyInProgress;
				if (!retryable || attempt >= MAX_TRANSPORT_ATTEMPTS)
					throw new SyncEngineError("the sync request failed", failure);
				counters.retries++;
				emit({ kind: "retry", status: failure.status, code: failure.code });
				/**
				 * Honors the wait time the server sends. Ignoring it and using only backoff would keep a
				 * rate-limited client retrying while still blocked, making things worse.
				 */
				const backoff = Math.min(
					BACKOFF_MAX_MS,
					BACKOFF_BASE_MS * 2 ** (attempt - 1),
				);
				await sleep(failure.retryAfterMs ?? backoff);
			}
		}
	}

	/* ── pull ─────────────────────────────────────────────────────────────── */

	/**
	 * Converts a wire record into an entry for storage. Decryption finishes here.
	 *
	 * Every failure path returns `ignored` on purpose (§19). Throwing would fail the whole page, and
	 * one corrupted record would halt this device's sync indefinitely.
	 */
	async function prepareEntry(
		dek: Uint8Array,
		record: PullRecord,
	): Promise<InboundEntry> {
		const codec = registry.get(record.type);
		if (!codec) return { kind: "ignored", reason: "unknown_type" };

		if (record.deleted || record.ciphertext === null)
			return {
				kind: "tombstone",
				id: record.id,
				type: record.type,
				version: record.version,
				serverUpdatedAt: record.serverUpdatedAt,
			};

		/**
		 * Checks the envelope version before decrypting. Opening an unknown envelope as v1 produces an
		 * AEAD tag mismatch, which reads as 'wrong key', a different event for the user.
		 */
		if (record.envelope !== SYNC_ENVELOPE_VERSION)
			return { kind: "ignored", reason: "unknown_envelope" };

		let payload: unknown;
		try {
			payload = await decryptRecord(
				dek,
				{ owner, recordId: record.id, type: record.type },
				record.ciphertext,
				aead,
			);
		} catch {
			return { kind: "ignored", reason: "decrypt_failed" };
		}

		const envelope = SyncPayloadEnvelope.safeParse(payload);
		if (!envelope.success)
			return { kind: "ignored", reason: "invalid_payload" };
		/**
		 * Ignores schema versions newer than this codec. Older or equal versions are migrated by the
		 * codec itself, since that knowledge belongs to the domain and cannot be copied here.
		 */
		if (envelope.data.schemaVersion > codec.schemaVersion)
			return { kind: "ignored", reason: "unknown_schema" };

		const remote = codec.decode({
			id: record.id,
			schemaVersion: envelope.data.schemaVersion,
			rev: envelope.data.rev,
			deletedAt: envelope.data.deletedAt,
			data: envelope.data.data,
		});
		if (!remote) return { kind: "ignored", reason: "invalid_payload" };

		return {
			kind: "record",
			id: record.id,
			type: record.type,
			version: record.version,
			serverUpdatedAt: record.serverUpdatedAt,
			rev: envelope.data.rev,
			remote,
			merge: (local, context) => codec.merge(local, remote, context),
		};
	}

	/**
	 * Fetches and applies one page. Returns `hasMore: false` on the last page.
	 *
	 * `markInitialSyncDone` travels in the same write as the page, for atomicity. If the cursor and
	 * that flag were separate, a crash between them would leave bootstrap marked done while the last
	 * page was never applied.
	 */
	async function pullPage(
		dek: Uint8Array,
		since: number,
		counters: { retries: number },
		finishBootstrap: boolean,
	): Promise<{
		cursor: number;
		hasMore: boolean;
		result: SyncRunResult;
	} | null> {
		const page = await withRetry(
			() =>
				transport.pull(
					{ since, limit: SYNC_LIMITS.pullDefaultLimit },
					{ signal },
				),
			counters,
		);
		const entries = await Promise.all(
			page.records.map((record) => prepareEntry(dek, record)),
		);
		throwIfAborted();
		// Ownership is checked again here, after the round trip and decryption. The next line is the
		// local write.
		if (!ownsStore()) return null;

		const applied = await store.applyPull({
			entries,
			cursor: page.cursor,
			...(finishBootstrap && !page.hasMore
				? { markInitialSyncDone: true }
				: {}),
		});

		for (const [reason, count] of countBy(entries))
			emit({ kind: "ignored", reason, count });
		for (const [code, count] of Object.entries(applied.notes))
			emit({ kind: "note", code, count });

		return {
			cursor: page.cursor,
			hasMore: page.hasMore,
			result: {
				pulled: page.records.length,
				applied: applied.applied,
				ignored: applied.ignored,
				pushed: 0,
				conflicts: applied.conflicts,
				retries: counters.retries,
				durationMs: 0,
				abandoned: false,
			},
		};
	}

	const countBy = (entries: InboundEntry[]): Array<[IgnoredReason, number]> => {
		const counts = new Map<IgnoredReason, number>();
		for (const entry of entries)
			if (entry.kind === "ignored")
				counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
		return [...counts];
	};

	async function pullAll(
		dek: Uint8Array,
		counters: { retries: number },
		finishBootstrap: boolean,
	): Promise<SyncRunResult> {
		const total = emptyResult();
		if (!ownsStore()) return { ...total, abandoned: true };
		let since = (await store.readState()).cursor;
		for (;;) {
			const page = await pullPage(dek, since, counters, finishBootstrap);
			if (!page) return { ...total, abandoned: true };
			total.pulled += page.result.pulled;
			total.applied += page.result.applied;
			total.ignored += page.result.ignored;
			total.conflicts += page.result.conflicts;
			if (!page.hasMore) break;
			/**
			 * If the cursor did not advance but the server reports more pages, the server is repeating a
			 * page. Stop to avoid an infinite loop; the next run retries.
			 */
			if (page.cursor <= since) break;
			since = page.cursor;
		}
		total.retries = counters.retries;
		return total;
	}

	/* ── push ─────────────────────────────────────────────────────────────── */

	/**
	 * One encrypted item: the wire item plus the revision captured at collection time, which
	 * `commitPush` writes.
	 */
	interface EncodedItem {
		item: PushItem;
		record: OutboundRecord;
		bytes: number;
	}

	async function encodeOutbound(
		dek: Uint8Array,
		record: OutboundRecord,
	): Promise<EncodedItem | null> {
		if (record.deleted || record.payload === null)
			return {
				record,
				bytes: 0,
				item: {
					id: record.id,
					type: record.type,
					baseVersion: record.baseVersion,
					ciphertext: null,
					envelope: SYNC_ENVELOPE_VERSION,
					deleted: true,
				},
			};

		const ciphertext = await encryptRecord(
			dek,
			{ owner, recordId: record.id, type: record.type },
			record.payload,
			aead,
		);
		const bytes = utf8ToBytes(ciphertext).length;
		/**
		 * Records over the size limit are quarantined and not sent.
		 *
		 * Sending one would get the same 400 every time. Batches are atomic, so the valid records in the
		 * same batch would be rejected each time too. Holding back one record and emitting a diagnostic
		 * is better than blocking everything else indefinitely.
		 */
		if (bytes > SYNC_LIMITS.ciphertextMaxBytes) {
			emit({ kind: "oversized", type: record.type, bytes });
			return null;
		}
		return {
			record,
			bytes,
			item: {
				id: record.id,
				type: record.type,
				baseVersion: record.baseVersion,
				ciphertext,
				envelope: SYNC_ENVELOPE_VERSION,
				deleted: false,
			},
		};
	}

	/**
	 * Sends one chunk. On conflict, nothing is applied and the conflict list is returned.
	 *
	 * A retry of the same chunk must reuse its idempotency key. If a retry after a lost response
	 * bumped the server version twice, this device's baseVersion would drift permanently and that
	 * record would conflict on every sync.
	 */
	async function pushChunk(
		chunk: EncodedItem[],
		counters: { retries: number },
	): Promise<{ conflicted: boolean; pushed: number } | null> {
		const idempotencyKey = newIdempotencyKey();
		const response = await withRetry(
			() =>
				transport.push(
					{ items: chunk.map((entry) => entry.item), idempotencyKey },
					{ signal },
				),
			counters,
		);

		if (!response.ok) {
			emit({ kind: "conflict", count: response.conflicts.length });
			return { conflicted: true, pushed: 0 };
		}

		throwIfAborted();
		if (!ownsStore()) return null;
		/**
		 * A successful item's new version is `baseVersion + 1`, as the server defines it (§18).
		 *
		 * The response carries no version list because the value is derivable. Including one would record
		 * the same fact in two places and let a stale list come back from the idempotency cache.
		 */
		await store.commitPush(
			chunk.map((entry) => ({
				id: entry.record.id,
				type: entry.record.type,
				version: entry.record.baseVersion + 1,
				rev: entry.record.rev,
			})),
		);
		return { conflicted: false, pushed: chunk.length };
	}

	/**
	 * Splits all outbound items into chunks while preserving collection order, so parents go before
	 * children (room before message, draft before its children). The server seq follows that order.
	 *
	 * Receivers do not depend on order (§28.1). Keeping it still prevents a child without its parent
	 * from briefly appearing on screen.
	 */
	async function pushOnce(
		dek: Uint8Array,
		all: boolean,
		counters: { retries: number },
	): Promise<{ pushed: number; conflicted: boolean; abandoned: boolean }> {
		let cursor: OutboundCursor | null = null;
		let pushed = 0;
		let chunk: EncodedItem[] = [];
		let chunkBytes = 0;

		const flush = async (): Promise<"ok" | "conflict" | "abandoned"> => {
			if (chunk.length === 0) return "ok";
			const sent = await pushChunk(chunk, counters);
			chunk = [];
			chunkBytes = 0;
			if (!sent) return "abandoned";
			if (sent.conflicted) return "conflict";
			pushed += sent.pushed;
			return "ok";
		};

		for (;;) {
			throwIfAborted();
			if (!ownsStore()) return { pushed, conflicted: false, abandoned: true };
			const batch = await store.collectOutbound({
				limit: SYNC_LIMITS.pushMaxItems,
				all,
				after: cursor,
			});
			for (const record of batch.records) {
				const encoded = await encodeOutbound(dek, record);
				if (!encoded) continue;
				const wouldOverflow =
					chunk.length >= SYNC_LIMITS.pushMaxItems ||
					chunkBytes + encoded.bytes > SYNC_LIMITS.pushMaxTotalBytes;
				if (wouldOverflow) {
					const outcome = await flush();
					if (outcome === "conflict")
						return { pushed, conflicted: true, abandoned: false };
					if (outcome === "abandoned")
						return { pushed, conflicted: false, abandoned: true };
				}
				chunk.push(encoded);
				chunkBytes += encoded.bytes;
			}
			if (!batch.next) break;
			cursor = batch.next;
		}

		const outcome = await flush();
		return {
			pushed,
			conflicted: outcome === "conflict",
			abandoned: outcome === "abandoned",
		};
	}

	/**
	 * On conflict: pull, merge, re-collect, then retry.
	 *
	 * Re-collection matters. The pull fetched the server copy and merged it, which updates
	 * `baseVersion`. Resending the same chunk unchanged would conflict forever; only the refreshed
	 * value passes.
	 */
	async function pushConverging(
		dek: Uint8Array,
		all: boolean,
		counters: { retries: number },
	): Promise<{ pushed: number; conflicts: number; abandoned: boolean }> {
		let pushed = 0;
		let conflicts = 0;
		for (let attempt = 1; attempt <= MAX_CONVERGENCE_ATTEMPTS; attempt++) {
			const outcome = await pushOnce(dek, all, counters);
			pushed += outcome.pushed;
			if (outcome.abandoned) return { pushed, conflicts, abandoned: true };
			if (!outcome.conflicted) return { pushed, conflicts, abandoned: false };
			conflicts++;
			const pulled = await pullAll(dek, counters, false);
			if (pulled.abandoned) return { pushed, conflicts, abandoned: true };
		}
		throw new SyncEngineError("the conflict does not converge", {
			status: 409,
			code: "sync_conflict_unresolved",
		});
	}

	/**
	 * Wraps one run: measures elapsed time and records the result in `syncState`.
	 *
	 * On failure, local data stays as it is. `dirty` remains set so the next attempt picks the records
	 * up again, and the screen changes only a status line. Sync must never block editing.
	 */
	async function runOnce(
		body: (counters: { retries: number }) => Promise<SyncRunResult>,
	): Promise<SyncRunResult> {
		const startedAt = clock.nowMs();
		const counters = { retries: 0 };
		try {
			const result = await body(counters);
			result.retries = counters.retries;
			result.durationMs = clock.nowMs() - startedAt;
			if (!result.abandoned && ownsStore())
				await store.recordOutcome({ syncedAt: clock.nowIso(), error: null });
			return result;
		} catch (error) {
			if (error instanceof SyncAbortedError) throw error;
			/**
			 * Records only the error code, never the message. A message may contain a sentence the server
			 * supplied, and nothing guarantees that it never includes a record id or user value.
			 */
			const failure = syncFailureOf(error);
			if (ownsStore())
				await store
					.recordOutcome({ error: failure.code })
					.catch(() => undefined);
			throw error;
		}
	}

	const emptyResult = (): SyncRunResult => ({
		pulled: 0,
		applied: 0,
		ignored: 0,
		pushed: 0,
		conflicts: 0,
		retries: 0,
		durationMs: 0,
		abandoned: false,
	});

	const merged = (a: SyncRunResult, b: SyncRunResult): SyncRunResult => ({
		pulled: a.pulled + b.pulled,
		applied: a.applied + b.applied,
		ignored: a.ignored + b.ignored,
		pushed: a.pushed + b.pushed,
		conflicts: a.conflicts + b.conflicts,
		retries: Math.max(a.retries, b.retries),
		durationMs: 0,
		abandoned: a.abandoned || b.abandoned,
	});

	return {
		pull: (dek) => runOnce((counters) => pullAll(dek, counters, false)),

		push: (dek, opts) =>
			runOnce(async (counters) => {
				const all = opts?.all === true;
				if (opts?.conflictMode === "surface") {
					const once = await pushOnce(dek, all, counters);
					if (once.conflicted) throw new SyncPushConflictError();
					return {
						...emptyResult(),
						pushed: once.pushed,
						abandoned: once.abandoned,
					};
				}
				const outcome = await pushConverging(dek, all, counters);
				return {
					...emptyResult(),
					pushed: outcome.pushed,
					conflicts: outcome.conflicts,
					abandoned: outcome.abandoned,
				};
			}),

		/**
		 * Routine sync pulls first. Reversing the order would send pushes with a stale `baseVersion`,
		 * causing avoidable conflicts. Conflicts are a normal path, but they double the round trips,
		 * which is costly on large batches.
		 */
		normalSync: (dek) =>
			runOnce(async (counters) => {
				const pulled = await pullAll(dek, counters, false);
				if (pulled.abandoned) return pulled;
				const outcome = await pushConverging(dek, false, counters);
				return merged(pulled, {
					...emptyResult(),
					pushed: outcome.pushed,
					conflicts: outcome.conflicts,
					abandoned: outcome.abandoned,
				});
			}),

		/**
		 * First activation: push all, then pull all. Pushing first prevents data loss. A device that
		 * holds data from before sync existed would, if it pulled first after another device had already
		 * created the keyring, never upload its records.
		 *
		 * An empty new device has no records, so this order costs nothing. `all: true` ignores dirty
		 * flags for the same reason: a database migrated from v1 or v2 can contain rows with `dirty=0`
		 * that the server has never seen.
		 *
		 * When both sides have data, nothing is overwritten. Record ids are UUIDs, so the two sets do not
		 * collide and the result is their union.
		 */
		bootstrap: (dek) =>
			runOnce(async (counters) => {
				const pushed = await pushConverging(dek, true, counters);
				if (pushed.abandoned)
					return { ...emptyResult(), pushed: pushed.pushed, abandoned: true };
				const pulled = await pullAll(dek, counters, true);
				return merged(pulled, {
					...emptyResult(),
					pushed: pushed.pushed,
					conflicts: pushed.conflicts,
				});
			}),

		async run(dek) {
			const state = await store.readState();
			return state.initialSyncDone ? this.normalSync(dek) : this.bootstrap(dek);
		},
	};
}
