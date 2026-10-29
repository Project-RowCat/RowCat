import type { AuthoringStore } from "@rowcat/authoring";
import type { ChatStore } from "@rowcat/chat";
import type { PullResponse, PushItem, PushResponse } from "@rowcat/contracts";
import { SYNC_ERROR_CODE, SYNC_LIMITS } from "@rowcat/contracts";
import type {
	RuntimeConversationStore,
	RuntimeSaveStore,
} from "@rowcat/runtime-persistence";
import type {
	SyncDiagnosticEvent,
	SyncEngine,
	SyncStore,
	SyncTransport,
} from "@rowcat/sync";
import {
	b64ToBytes,
	createSyncEngine,
	nobleAead,
	verifyKeyringProof,
} from "@rowcat/sync";
import { LocalDb } from "#/lib/local-data/db.ts";
import type { LocalMutationSignal } from "#/lib/local-data/mutation-signal.ts";
import { createLocalDataStores } from "#/lib/local-data/stores.ts";
import type { AutoSyncPreferenceStore } from "#/lib/local-sync/preference.ts";
import { syncCodecRegistry } from "#/lib/local-sync/registry.ts";

/**
 * In-process two-device harness. Runs the sync protocol without React. What is checked is
 * convergence, not the screen: do two devices reach the same final state through the same server,
 * and is no draft lost on the way? Adding rendering would break merge tests every time markup
 * changes.
 *
 * One device = one fake-indexeddb database + three stores + one engine, which matches what one
 * account holds on the real web.
 */

/** A row stored by the fake server. Has only the same columns as the real `sync_record` table. */
interface ServerRow {
	id: string;
	type: string;
	ciphertext: string | null;
	envelope: number;
	version: number;
	seq: number;
	deleted: boolean;
	updatedAt: string;
}

export interface FakeServerOptions {
	/**
	 * With idempotency off, a retry after a lost ack shows up as a conflict. The convergence-path
	 * tests use this.
	 */
	idempotency?: boolean;
}

/**
 * Stand-in server with the same semantics as the real one: per-owner monotonic sequence, atomic
 * batches, baseVersion optimistic concurrency, type immutability, and an idempotency cache. Whether
 * these are correct is verified against real Postgres in apps/api/src/routes/me/sync.test.ts. This
 * is a double for running the client, not the server's spec.
 */
export class FakeSyncServer {
	private readonly rows = new Map<string, ServerRow>();
	private readonly dedupe = new Map<
		string,
		{ hash: string; response: PushResponse }
	>();
	private seq = 0;
	private clock = 0;
	private readonly useIdempotency: boolean;

	/** Observation only: every push request received. Tests count round trips with it. */
	readonly pushes: PushItem[][] = [];
	pulls = 0;
	/** Makes the next push fail with this status and code, to reproduce a lost response or a 5xx. */
	failNextPush: { status: number; code: string } | null = null;
	/**
	 * Runs once after a push is applied but before its response reaches the client. This window is
	 * where the commitPush race happens: the server has the change, the client does not yet know, and
	 * the user edits the same record again. That is common (typing while autosave runs). If dirty were
	 * cleared unconditionally here, that edit would be lost for good.
	 */
	duringPush: (() => Promise<void>) | null = null;

	constructor(options: FakeServerOptions = {}) {
		this.useIdempotency = options.idempotency !== false;
	}

	private now(): string {
		this.clock += 1000;
		return new Date(1_700_000_000_000 + this.clock).toISOString();
	}

	push(items: PushItem[], idempotencyKey: string): PushResponse {
		if (this.failNextPush) {
			const failure = this.failNextPush;
			this.failNextPush = null;
			throw Object.assign(new Error("push failed"), failure);
		}
		this.pushes.push(items);

		const hash = JSON.stringify(items);
		if (this.useIdempotency) {
			const cached = this.dedupe.get(idempotencyKey);
			if (cached) {
				if (cached.hash !== hash)
					throw Object.assign(new Error("idempotency key mismatch"), {
						status: 409,
						code: "sync_idempotency_mismatch",
					});
				return { ...cached.response, deduplicated: true };
			}
		}

		const conflicts = items
			.map((item) => {
				const row = this.rows.get(item.id);
				if (!row)
					return item.baseVersion === 0
						? null
						: { id: item.id, serverVersion: 0 };
				if (row.type !== item.type || row.version !== item.baseVersion)
					return { id: item.id, serverVersion: row.version };
				return null;
			})
			.filter(
				(conflict): conflict is { id: string; serverVersion: number } =>
					conflict !== null,
			);

		let response: PushResponse;
		if (conflicts.length > 0) {
			// If any item conflicts, nothing is applied.
			response = { ok: false, cursor: this.seq, conflicts };
		} else {
			const now = this.now();
			for (const item of items) {
				this.seq += 1;
				this.rows.set(item.id, {
					id: item.id,
					type: item.type,
					ciphertext: item.ciphertext,
					envelope: item.envelope,
					version: item.baseVersion + 1,
					seq: this.seq,
					deleted: item.deleted,
					updatedAt: now,
				});
			}
			response = { ok: true, cursor: this.seq, conflicts: [] };
		}
		if (this.useIdempotency)
			this.dedupe.set(idempotencyKey, { hash, response });
		return response;
	}

	pull(
		since: number,
		limit: number = SYNC_LIMITS.pullDefaultLimit,
	): PullResponse {
		this.pulls += 1;
		const ordered = [...this.rows.values()]
			.filter((row) => row.seq > since)
			.sort((a, b) => a.seq - b.seq);
		const page = ordered.slice(0, limit);
		return {
			records: page.map((row) => ({
				id: row.id,
				type: row.type,
				ciphertext: row.ciphertext,
				envelope: row.envelope,
				version: row.version,
				seq: row.seq,
				deleted: row.deleted,
				serverUpdatedAt: row.updatedAt,
			})),
			// Matches the real server: the seq of the last row returned, or the requested `since` value if
			// the page is empty.
			cursor: page.length > 0 ? page[page.length - 1].seq : since,
			hasMore: ordered.length > page.length,
		};
	}

	/**
	 * This owner's current max seq, the same value as readSyncCursor on the real server. Wake-up tests
	 * use it to decide whether a run moved server state forward. Without that check, every run would
	 * notify even when it only pulled, and two devices would wake each other forever. The real server
	 * draws the same line at its post-commit boundary.
	 */
	cursor(): number {
		return this.seq;
	}

	row(id: string): ServerRow | undefined {
		return this.rows.get(id);
	}
	get size(): number {
		return this.rows.size;
	}
	/** Plants an arbitrary row, for abnormal input such as an unknown type or corrupted ciphertext. */
	seed(row: Omit<ServerRow, "seq" | "updatedAt">): void {
		this.seq += 1;
		this.rows.set(row.id, { ...row, seq: this.seq, updatedAt: this.now() });
	}
}

/**
 * Account-side server: keyring and pairing relay. Kept separate from the record server because the
 * two axes really differ. Records are shared storage regardless of which device wrote them; this
 * class models who may hold the account's keys. Putting both in one class would blur that in tests.
 *
 * Same semantics as the real server, but not its spec: first-writer-only, constant-time proof
 * verification, expiry, and first approval wins. Correctness is verified against real Postgres in
 * apps/api/src/routes/me/sync-pairing.test.ts.
 */
export class FakeAccountServer {
	keyring: string | null = null;
	authKey: Uint8Array | null = null;
	/**
	 * Number of key-proof checks. Tests use it to confirm the check ran before the key was remembered.
	 */
	verifyCalls = 0;
	/** Maps codeHash to a pairing session. Holds only the columns of the real `sync_pairing` row. */
	readonly pairings = new Map<
		string,
		{ newPub: string; payload: string | null; expiresAt: number }
	>();
	/** The test owns the clock, so expiry can be reproduced. */
	now = () => Date.now();

	private live(codeHash: string) {
		const row = this.pairings.get(codeHash);
		if (!row) return null;
		// An expired row counts as missing, the same judgment the real server makes.
		if (row.expiresAt <= this.now()) return null;
		return row;
	}

	private notFound(): never {
		throw Object.assign(new Error("no pairing"), {
			status: 404,
			code: SYNC_ERROR_CODE.pairingNotFound,
		});
	}

	/** First registration only. The losing caller gets a 409 and discards its own key material. */
	setupKeyring(input: { keyring: string; authKey: string }) {
		if (this.keyring !== null)
			throw Object.assign(new Error("already exists"), {
				status: 409,
				code: SYNC_ERROR_CODE.keyringExists,
			});
		this.keyring = input.keyring;
		this.authKey = b64ToBytes(input.authKey);
		return { keyring: this.keyring };
	}

	/**
	 * Checks the proof for real by comparing the MAC. A stub that always returns true cannot verify
	 * the pairing rule that the proof is checked before the key is remembered (§20). To show a wrong
	 * key is never remembered, this must be able to reject.
	 */
	verifyKeyring(input: { keyring: string; proof: string }): boolean {
		this.verifyCalls += 1;
		return (
			this.authKey !== null &&
			verifyKeyringProof(this.authKey, input.keyring, input.proof)
		);
	}

	startPairing(input: { codeHash: string; newPublicKey: string }) {
		if (this.live(input.codeHash))
			throw Object.assign(new Error("already exists"), {
				status: 409,
				code: SYNC_ERROR_CODE.pairingExists,
			});
		const row = {
			newPub: input.newPublicKey,
			payload: null,
			expiresAt: this.now() + SYNC_LIMITS.pairingTtlMinutes * 60_000,
		};
		this.pairings.set(input.codeHash, row);
		return this.dto(row);
	}

	readPairing(codeHash: string) {
		const row = this.live(codeHash);
		if (!row) this.notFound();
		return this.dto(row);
	}

	approvePairing(input: { codeHash: string; payload: string }): void {
		const row = this.live(input.codeHash);
		if (!row) this.notFound();
		// First approval wins. A late approval cannot replace the envelope.
		if (row.payload !== null)
			throw Object.assign(new Error("already approved"), {
				status: 409,
				code: SYNC_ERROR_CODE.pairingAlreadyApproved,
			});
		row.payload = input.payload;
	}

	cancelPairing(codeHash: string): void {
		// Closing a session that does not exist also succeeds (idempotent).
		this.pairings.delete(codeHash);
	}

	private dto(row: {
		newPub: string;
		payload: string | null;
		expiresAt: number;
	}) {
		return {
			newPublicKey: row.newPub,
			payload: row.payload,
			expiresAt: new Date(row.expiresAt).toISOString(),
		};
	}
}

/**
 * Wraps the server as a SyncTransport. Without an `account`, the keyring and pairing paths throw. A
 * test that only looks at records and accidentally takes those paths should fail loudly, not pass
 * silently.
 */
export function createFakeTransport(
	server: FakeSyncServer,
	account?: FakeAccountServer,
): SyncTransport {
	const unsupported = (): never => {
		throw new Error("this harness only covers the records path");
	};
	const requireAccount = (): FakeAccountServer => {
		if (!account) throw new Error("this harness only covers the records path");
		return account;
	};
	return {
		getKeyring: async () => ({ keyring: account?.keyring ?? null }),
		setupKeyring: async (input) => requireAccount().setupKeyring(input),
		rewrapKeyring: unsupported,
		resetKeyring: unsupported,
		/**
		 * Without an account server the keyring check always passes. Record-only tests never reach it, so
		 * failing here would break them for unrelated reasons.
		 */
		verifyKeyring: async (input) =>
			account ? account.verifyKeyring(input) : true,
		startPairing: async (input) => requireAccount().startPairing(input),
		readPairing: async (input) => requireAccount().readPairing(input.codeHash),
		approvePairing: async (input) => {
			requireAccount().approvePairing(input);
		},
		cancelPairing: async (input) => {
			requireAccount().cancelPairing(input.codeHash);
		},
		pull: async (input) => server.pull(input.since, input.limit),
		push: async (input) => {
			const response = server.push(input.items, input.idempotencyKey);
			const hook = server.duringPush;
			if (hook) {
				server.duringPush = null;
				await hook();
			}
			return response;
		},
	};
}

export interface Device {
	name: string;
	db: LocalDb;
	chat: ChatStore;
	authoring: AuthoringStore;
	/**
	 * Player save store. Built the same way as in the product, with the write signal wrapped around
	 * it.
	 */
	runtimeSave: RuntimeSaveStore;
	/**
	 * Runtime library row store. Same assembly as the product; a separate port from the save store.
	 */
	runtimeConversation: RuntimeConversationStore;
	sync: SyncStore;
	/**
	 * Local write signal, built in the same assembly as the product. The harness does not create the
	 * store itself. `createChatStore(db)` would not be the product's store, since its writes are not
	 * wrapped with the signal. A test built on it would verify nothing about whether local changes
	 * wake auto-sync.
	 */
	mutations: LocalMutationSignal;
	autoSyncPreference: AutoSyncPreferenceStore;
	engine: SyncEngine;
	/** Collects diagnostic events. Tests check the signals that merges leave behind. */
	diagnostics: SyncDiagnosticEvent[];
	close(): void;
}

const OWNER = "0123456789abcdef0123456789abcdef";

/**
 * Both devices use the same DEK, because they belong to the same account. In practice one device
 * sets it up and the other unlocks with the recovery code to reach the same value. The controller
 * tests cover that path.
 */
export const TEST_DEK = Uint8Array.from(
	{ length: 32 },
	(_, i) => (i * 7 + 1) & 0xff,
);

let dbCounter = 0;

export function createDevice(
	name: string,
	server: FakeSyncServer,
	options: { ownsStore?: () => boolean } = {},
): Device {
	dbCounter += 1;
	const db = new LocalDb(`sync_test_${name}_${dbCounter}`);
	const stores = createLocalDataStores(db, OWNER);
	const sync = stores.sync;
	const diagnostics: SyncDiagnosticEvent[] = [];
	let tick = 0;
	const advance = (): number => {
		tick += 1000;
		return tick;
	};
	const engine = createSyncEngine({
		owner: OWNER,
		registry: syncCodecRegistry,
		store: sync,
		transport: createFakeTransport(server),
		aead: nobleAead,
		clock: {
			nowIso: () => new Date(1_700_000_000_000 + advance()).toISOString(),
			nowMs: () => tick,
		},
		...(options.ownsStore ? { ownsStore: options.ownsStore } : {}),
		// Replaces backoff with an immediate return. The retry count is what gets verified, not the wait.
		sleep: async () => undefined,
		onDiagnostic: (event) => diagnostics.push(event),
	});
	return {
		name,
		db,
		chat: stores.chat,
		authoring: stores.authoring,
		runtimeSave: stores.runtimeSave,
		runtimeConversation: stores.runtimeConversation,
		sync,
		mutations: stores.mutations,
		autoSyncPreference: stores.autoSyncPreference,
		engine,
		diagnostics,
		close: () => db.close(),
	};
}

/**
 * Converts a wire page into the entries the store accepts. The engine normally does this. Tests
 * call it directly to probe transaction boundaries: throw mid-apply, insert one entry at a time, or
 * insert the same page twice.
 */
export async function buildEntries(
	device: Device,
	page: PullResponse,
): Promise<Parameters<SyncStore["applyPull"]>[0]["entries"]> {
	const { decryptRecord, nobleAead } = await import("@rowcat/sync");
	const entries: Parameters<SyncStore["applyPull"]>[0]["entries"] = [];
	for (const record of page.records) {
		const codec = syncCodecRegistry.get(record.type);
		if (!codec) {
			entries.push({ kind: "ignored", reason: "unknown_type" });
			continue;
		}
		if (record.deleted || record.ciphertext === null) {
			entries.push({
				kind: "tombstone",
				id: record.id,
				type: record.type,
				version: record.version,
				serverUpdatedAt: record.serverUpdatedAt,
			});
			continue;
		}
		const payload = (await decryptRecord(
			TEST_DEK,
			{ owner: OWNER, recordId: record.id, type: record.type },
			record.ciphertext,
			nobleAead,
		)) as {
			schemaVersion: number;
			rev: { t: number; c: number; d: string };
			deletedAt: string | null;
			data: unknown;
		};
		const remote = codec.decode({
			id: record.id,
			schemaVersion: payload.schemaVersion,
			rev: payload.rev,
			deletedAt: payload.deletedAt,
			data: payload.data,
		});
		if (!remote) {
			entries.push({ kind: "ignored", reason: "invalid_payload" });
			continue;
		}
		entries.push({
			kind: "record",
			id: record.id,
			type: record.type,
			version: record.version,
			serverUpdatedAt: record.serverUpdatedAt,
			rev: payload.rev,
			remote,
			merge: (local, context) => codec.merge(local, remote, context),
		});
	}
	// Does not suppress the unused-argument warning. The `device` parameter is a placeholder for when
	// codecs differ per device.
	void device;
	return entries;
}

/** Runs two sync rounds across the devices so each one sees the others' changes. */
export async function converge(...devices: Device[]): Promise<void> {
	// Round one uploads each device's changes; round two downloads the others'.
	for (let round = 0; round < 2; round++)
		for (const device of devices) await device.engine.run(TEST_DEK);
}
