import { SYNC_ERROR_CODE, SYNC_LIMITS } from "@rowcat/contracts";
import { nobleAead } from "@rowcat/sync/aead";
import { bytesToB64 } from "@rowcat/sync/codec";
import { encryptRecord, generateDek } from "@rowcat/sync/crypto";
import {
	buildKeyring,
	deriveAuthKey,
	proveKeyring,
} from "@rowcat/sync/keyring";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import {
	member,
	sync_keyring,
	sync_push_dedupe,
	sync_record,
	sync_state,
} from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import { pushRequestHash, readSyncCursor } from "../../services/sync/index.ts";
import { syncWakeBroker } from "../../services/sync/wake.ts";

import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";

/**
 * `/v2/me/sync/*` integration tests against a real Postgres.
 *
 * Everything checked here is a property of SQL and cannot be verified with a mock: per-member
 * sequence vs commit order, batch atomicity, one idempotency key never bumping a version twice, the
 * unique index enforcing first-writer. With Drizzle mocked these all leave the test. Theme: the
 * server must guard everything exactly while reading nothing.
 */

const EMAIL_PREFIX = "sync-route-test-";

interface Account {
	cookie: string;
	memberId: string;
}

const signUp = (name = "Sync test") => createTestMember(EMAIL_PREFIX, { name });

const call = (
	method: string,
	path: string,
	cookie: string | null,
	init: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> =>
	Promise.resolve(
		app.request(`/v2/me/sync${path}`, {
			method,
			headers: {
				...(init.body !== undefined
					? { "Content-Type": "application/json" }
					: {}),
				Origin: WEB_ORIGIN,
				...(cookie ? { Cookie: cookie } : {}),
				...init.headers,
			},
			...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
		}),
	);

const readJson = async <T>(response: Response): Promise<T> =>
	(await response.json()) as T;
const readCode = async (response: Response): Promise<string | undefined> =>
	((await response.json()) as { code?: string }).code;

/* Crypto material: the server validates envelope syntax, so arbitrary strings give 400. Tests
 * build real envelopes so the server receives the same shape real clients send. */
const DEK = generateDek();

const cipher = (owner: string, id: string, type: string, data: unknown) =>
	encryptRecord(
		DEK,
		{ owner, recordId: id, type },
		{ schemaVersion: 1, rev: { t: 1, c: 0, d: "test" }, deletedAt: null, data },
		nobleAead,
	);

interface ItemInput {
	id: string;
	type?: string;
	baseVersion?: number;
	data?: unknown;
	deleted?: boolean;
}

async function item(owner: string, input: ItemInput) {
	const type = input.type ?? "chat.room";
	if (input.deleted)
		return {
			id: input.id,
			type,
			baseVersion: input.baseVersion ?? 0,
			ciphertext: null,
			envelope: 1,
			deleted: true,
		};
	return {
		id: input.id,
		type,
		baseVersion: input.baseVersion ?? 0,
		ciphertext: await cipher(owner, input.id, type, input.data ?? { n: 1 }),
		envelope: 1,
		deleted: false,
	};
}

const recordId = (): string => `rec-${newId()}`;

/**
 * Builds the request hash with the same normalization as the service. Re-typing the hash by hand
 * would let both copies pass after the normalization diverged, and only production retries after a
 * lost response would break.
 */
const pushHashOf = (items: Awaited<ReturnType<typeof item>>[]): string =>
	pushRequestHash(items);

interface PushBody {
	ok: boolean;
	cursor: number;
	conflicts: Array<{ id: string; serverVersion: number }>;
	deduplicated?: boolean;
}
interface PullBody {
	records: Array<{
		id: string;
		type: string;
		ciphertext: string | null;
		envelope: number;
		version: number;
		seq: number;
		deleted: boolean;
		serverUpdatedAt: string;
	}>;
	cursor: number;
	hasMore: boolean;
}

const push = async (
	account: Account,
	items: unknown[],
	key = `idem-${newId()}`,
): Promise<Response> =>
	call("POST", "/records", account.cookie, {
		body: { items },
		headers: { "Idempotency-Key": key },
	});

const pull = (account: Account, since = 0, limit?: number): Promise<Response> =>
	call(
		"GET",
		`/records?since=${since}${limit === undefined ? "" : `&limit=${limit}`}`,
		account.cookie,
	);

/** Sets up a keyring and returns that account's authKey, for tests that need proof. */
async function enableSync(account: Account): Promise<{
	keyring: string;
	authKey: Uint8Array;
	recoveryCode: string;
}> {
	const built = await buildKeyring(account.memberId, DEK, nobleAead);
	const authKey = deriveAuthKey(DEK, account.memberId);
	const response = await call("POST", "/keyring", account.cookie, {
		body: { keyring: built.keyring, authKey: bytesToB64(authKey) },
	});
	expect(response.status).toBe(200);
	return { keyring: built.keyring, authKey, recoveryCode: built.recoveryCode };
}

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

describe.skipIf(!databaseReady)("authorization gate", () => {
	test("a guest gets 401 on every path", async () => {
		expect((await call("GET", "/keyring", null)).status).toBe(401);
		expect((await call("GET", "/records?since=0", null)).status).toBe(401);
		expect(
			(
				await call("POST", "/records", null, {
					body: { items: [] },
					headers: { "Idempotency-Key": "a".repeat(20) },
				})
			).status,
		).toBe(401);
	});

	/**
	 * Reads and writes use different gates. A suspended account has no reason to keep growing server
	 * storage, but blocking it from carrying its data to another device would hold that data hostage.
	 */
	test.each([
		"suspended",
		"banned",
	])("a %s account can still read the keyring and pull", async (status) => {
		const account = await signUp();
		await enableSync(account);
		await push(account, [await item(account.memberId, { id: recordId() })]);
		await db
			.update(member)
			.set({ status })
			.where(eq(member.id, account.memberId));

		expect((await call("GET", "/keyring", account.cookie)).status).toBe(200);
		const pulled = await pull(account, 0);
		expect(pulled.status).toBe(200);
		expect((await readJson<PullBody>(pulled)).records).toHaveLength(1);
	});

	test.each([
		"suspended",
		"banned",
	])("a %s account's push and keyring writes are refused", async (status) => {
		const account = await signUp();
		await enableSync(account);
		await db
			.update(member)
			.set({ status })
			.where(eq(member.id, account.memberId));

		const pushed = await push(account, [
			await item(account.memberId, { id: recordId() }),
		]);
		expect(pushed.status).toBe(403);
		expect(await readCode(pushed)).toBe("account_restricted");

		const rewrapped = await call("PUT", "/keyring", account.cookie, {
			body: { keyring: "{}", proof: "AAAA" },
		});
		expect(rewrapped.status).toBe(403);
	});

	test("a suspended account can still prove possession (verify)", async () => {
		/** POST but read-only: if a locked device cannot even check its key, a restricted account can never retrieve its data. */
		const account = await signUp();
		const { keyring, authKey } = await enableSync(account);
		await db
			.update(member)
			.set({ status: "suspended" })
			.where(eq(member.id, account.memberId));

		const response = await call("POST", "/keyring/verify", account.cookie, {
			body: { keyring, proof: proveKeyring(authKey, keyring) },
		});
		expect(response.status).toBe(204);
	});

	test("every response carries Cache-Control: no-store", async () => {
		const account = await signUp();
		await enableSync(account);
		for (const response of [
			await call("GET", "/keyring", account.cookie),
			await pull(account, 0),
			await push(account, [await item(account.memberId, { id: recordId() })]),
		])
			expect(response.headers.get("Cache-Control")).toBe("no-store");
	});
});

describe.skipIf(!databaseReady)("owner isolation", () => {
	test("another account's records aren't visible", async () => {
		const alice = await signUp("Alice");
		const bob = await signUp("Bob");
		await enableSync(alice);
		await enableSync(bob);

		const secret = recordId();
		await push(alice, [
			await item(alice.memberId, { id: secret, data: { t: "Alice's room" } }),
		]);

		const bobPull = await readJson<PullBody>(await pull(bob, 0));
		expect(bobPull.records).toHaveLength(0);
		expect(bobPull.cursor).toBe(0);
	});

	test("the body's owner and viewerId fields can't pick the owner", async () => {
		/**
		 * The contract schema has no such field. zod drops unknown keys, so the request succeeds and
		 * stores only under the session's member: the attempt has no effect. Do not expect a 400.
		 */
		const alice = await signUp("Alice");
		const bob = await signUp("Bob");
		await enableSync(alice);

		const id = recordId();
		const injected = {
			owner: bob.memberId,
			viewerId: bob.memberId,
			memberId: bob.memberId,
			userId: bob.memberId,
			items: [await item(alice.memberId, { id })],
		};
		const response = await call("POST", "/records", alice.cookie, {
			body: injected,
			headers: { "Idempotency-Key": `idem-${newId()}` },
		});
		expect(response.status).toBe(200);

		const stored = await db
			.select({ owner: sync_record.owner })
			.from(sync_record)
			.where(eq(sync_record.id, id));
		expect(stored.map((row) => row.owner)).toEqual([alice.memberId]);
	});

	test("two accounts can each have the same record id", async () => {
		// The PK is (owner, id), so the two accounts do not interfere.
		const alice = await signUp("Alice");
		const bob = await signUp("Bob");
		await enableSync(alice);
		await enableSync(bob);
		const shared = recordId();

		expect(
			(await push(alice, [await item(alice.memberId, { id: shared })])).status,
		).toBe(200);
		expect(
			(await push(bob, [await item(bob.memberId, { id: shared })])).status,
		).toBe(200);

		const rows = await db
			.select({ owner: sync_record.owner })
			.from(sync_record)
			.where(eq(sync_record.id, shared));
		expect(rows).toHaveLength(2);
	});
});

describe.skipIf(!databaseReady)("keyring", () => {
	test("null before setup", async () => {
		const account = await signUp();
		const body = await readJson<{ keyring: string | null }>(
			await call("GET", "/keyring", account.cookie),
		);
		expect(body.keyring).toBeNull();
	});

	test("the string the client made is stored **byte for byte** and comes back as is", async () => {
		/** Re-serializing after parsing could change key order or whitespace; the proof is a MAC over this exact string, so every rewrap would then 403. */
		const account = await signUp();
		const { keyring } = await enableSync(account);
		const body = await readJson<{ keyring: string | null }>(
			await call("GET", "/keyring", account.cookie),
		);
		expect(body.keyring).toBe(keyring);

		const [row] = await db
			.select({ keyring: sync_keyring.keyring })
			.from(sync_keyring)
			.where(eq(sync_keyring.owner, account.memberId));
		expect(row.keyring).toBe(keyring);
	});

	test("a second setup is a 409 and **the original remains**", async () => {
		/** First-writer-only is the costliest invariant here: overwriting would make ciphertext already uploaded under the winning DEK permanently undecryptable. */
		const account = await signUp();
		const { keyring } = await enableSync(account);

		const second = await buildKeyring(
			account.memberId,
			generateDek(),
			nobleAead,
		);
		const response = await call("POST", "/keyring", account.cookie, {
			body: {
				keyring: second.keyring,
				authKey: bytesToB64(deriveAuthKey(generateDek(), account.memberId)),
			},
		});
		expect(response.status).toBe(409);
		expect(await readCode(response)).toBe("sync_keyring_exists");

		const [row] = await db
			.select({ keyring: sync_keyring.keyring, authKey: sync_keyring.auth_key })
			.from(sync_keyring)
			.where(eq(sync_keyring.owner, account.memberId));
		expect(row.keyring).toBe(keyring);
	});

	test("no keyring response carries auth_key", async () => {
		/** Scans the whole response JSON as a string; checking field names one by one would miss a nested occurrence. */
		const account = await signUp();
		const { keyring, authKey } = await enableSync(account);
		const encoded = bytesToB64(authKey);

		const responses = [
			await call("GET", "/keyring", account.cookie),
			await call("PUT", "/keyring", account.cookie, {
				body: { keyring, proof: proveKeyring(authKey, keyring) },
			}),
		];
		for (const response of responses) {
			const text = await response.text();
			expect(text).not.toContain(encoded);
			expect(text).not.toContain("auth_key");
			expect(text).not.toContain("authKey");
		}
	});

	test("can't replace without proof", async () => {
		const account = await signUp();
		const { keyring, authKey } = await enableSync(account);
		const next = await buildKeyring(account.memberId, DEK, nobleAead);

		const wrong = await call("PUT", "/keyring", account.cookie, {
			body: {
				keyring: next.keyring,
				proof: proveKeyring(authKey, "a different string"),
			},
		});
		expect(wrong.status).toBe(403);
		expect(await readCode(wrong)).toBe("sync_keyring_proof_invalid");

		// Proof made from an authKey derived from a different DEK.
		const foreign = await call("PUT", "/keyring", account.cookie, {
			body: {
				keyring: next.keyring,
				proof: proveKeyring(
					deriveAuthKey(generateDek(), account.memberId),
					next.keyring,
				),
			},
		});
		expect(foreign.status).toBe(403);

		expect(
			(
				await readJson<{ keyring: string | null }>(
					await call("GET", "/keyring", account.cookie),
				)
			).keyring,
		).toBe(keyring);
	});

	test("the proof is bound to **exactly that keyring string**", async () => {
		const account = await signUp();
		const { authKey } = await enableSync(account);
		const next = await buildKeyring(account.memberId, DEK, nobleAead);
		// Proof for a string identical except for one space: rejected.
		const response = await call("PUT", "/keyring", account.cookie, {
			body: {
				keyring: next.keyring,
				proof: proveKeyring(authKey, `${next.keyring} `),
			},
		});
		expect(response.status).toBe(403);
	});

	test("a correct proof replaces it and auth_key stays", async () => {
		// Rotation keeps the DEK, so authKey is unchanged and existing records stay readable.
		const account = await signUp();
		const { authKey } = await enableSync(account);
		const before = await db
			.select({ authKey: sync_keyring.auth_key })
			.from(sync_keyring)
			.where(eq(sync_keyring.owner, account.memberId));

		const next = await buildKeyring(account.memberId, DEK, nobleAead);
		const response = await call("PUT", "/keyring", account.cookie, {
			body: {
				keyring: next.keyring,
				proof: proveKeyring(authKey, next.keyring),
			},
		});
		expect(response.status).toBe(200);

		const after = await db
			.select({ keyring: sync_keyring.keyring, authKey: sync_keyring.auth_key })
			.from(sync_keyring)
			.where(eq(sync_keyring.owner, account.memberId));
		expect(after[0].keyring).toBe(next.keyring);
		expect(after[0].authKey).toBe(before[0].authKey);
	});

	/** Reset is the exit for a locked account with no key. No proof needed, but it erases only its own namespace; local data is unknown to this route. */
	test("reset deletes the keyring and every record, and is idempotent", async () => {
		const account = await signUp();
		await enableSync(account);
		const pushed = await push(account, [
			await item(account.memberId, { id: newId(), type: "chat.room" }),
		]);
		expect(pushed.status).toBe(200);

		const reset = await call("DELETE", "/keyring", account.cookie);
		expect(reset.status).toBe(204);

		expect(
			await readJson<{ keyring: string | null }>(
				await call("GET", "/keyring", account.cookie),
			),
		).toEqual({ keyring: null });
		const pulled = await readJson<{ records: unknown[]; cursor: number }>(
			await call("GET", "/records?since=0", account.cookie),
		);
		expect(pulled.records).toEqual([]);
		expect(pulled.cursor).toBe(0);

		// Succeeds even with nothing to erase, so a retry after a lost response does not look like a
		// failure.
		expect((await call("DELETE", "/keyring", account.cookie)).status).toBe(204);
		// Setup works again afterwards; reset does not close the account.
		await enableSync(account);
	});

	test("reset doesn't touch someone else's namespace", async () => {
		const alice = await signUp();
		const bob = await signUp();
		const bobKeys = await enableSync(bob);
		await call("DELETE", "/keyring", alice.cookie);
		expect(
			await readJson<{ keyring: string | null }>(
				await call("GET", "/keyring", bob.cookie),
			),
		).toEqual({ keyring: bobKeys.keyring });
	});

	test("without a keyring, replace and verify are 404", async () => {
		const account = await signUp();
		const response = await call("PUT", "/keyring", account.cookie, {
			body: { keyring: "{}", proof: "AAAA" },
		});
		expect(response.status).toBe(404);
		expect(await readCode(response)).toBe("sync_keyring_missing");
	});

	test("no slot anywhere in the request to carry a DEK", async () => {
		/** Runtime check that the contract has no DEK field: zod drops it and only the `keyring` and `auth_key` columns are stored. */
		const account = await signUp();
		const built = await buildKeyring(account.memberId, DEK, nobleAead);
		const response = await call("POST", "/keyring", account.cookie, {
			body: {
				keyring: built.keyring,
				authKey: bytesToB64(deriveAuthKey(DEK, account.memberId)),
				dek: bytesToB64(DEK),
				recoveryCode: built.recoveryCode,
			},
		});
		expect(response.status).toBe(200);

		const [row] = await db
			.select()
			.from(sync_keyring)
			.where(eq(sync_keyring.owner, account.memberId));
		const stored = JSON.stringify(row);
		expect(stored).not.toContain(bytesToB64(DEK));
		expect(stored).not.toContain(built.recoveryCode);
	});
});

describe.skipIf(!databaseReady)("push — optimistic concurrency", () => {
	test("a new record goes in with baseVersion 0 and becomes version 1", async () => {
		const account = await signUp();
		await enableSync(account);
		const id = recordId();

		const body = await readJson<PushBody>(
			await push(account, [await item(account.memberId, { id })]),
		);
		expect(body.ok).toBe(true);
		expect(body.conflicts).toEqual([]);
		expect(body.cursor).toBe(1);

		const [row] = await db
			.select({ version: sync_record.version, seq: sync_record.seq })
			.from(sync_record)
			.where(
				and(eq(sync_record.owner, account.memberId), eq(sync_record.id, id)),
			);
		expect(row.version).toBe(1);
		expect(row.seq).toBe(1);
	});

	test("baseVersion≠0 for a record the server doesn't have is a conflict", async () => {
		const account = await signUp();
		await enableSync(account);
		const body = await readJson<PushBody>(
			await push(account, [
				await item(account.memberId, { id: recordId(), baseVersion: 3 }),
			]),
		);
		expect(body.ok).toBe(false);
		expect(body.conflicts).toEqual([
			{ id: expect.any(String), serverVersion: 0 },
		]);
	});

	test("a stale baseVersion is refused along with the server's current version", async () => {
		const account = await signUp();
		await enableSync(account);
		const id = recordId();
		await push(account, [await item(account.memberId, { id })]);
		await push(account, [await item(account.memberId, { id, baseVersion: 1 })]);

		const body = await readJson<PushBody>(
			await push(account, [
				await item(account.memberId, { id, baseVersion: 1 }),
			]),
		);
		expect(body.ok).toBe(false);
		expect(body.conflicts).toEqual([{ id, serverVersion: 2 }]);
	});

	test("**one conflict means the whole batch is not applied**", async () => {
		/**
		 * A batch groups what was one user action locally (draft + children, message + room).
		 * Half-applied, other devices would see a parent at the new revision and children at the old one,
		 * and merging that matches no device's intent.
		 */
		const account = await signUp();
		await enableSync(account);
		const good = recordId();
		const bad = recordId();
		await push(account, [await item(account.memberId, { id: bad })]);
		const cursorBefore = await readJson<PullBody>(await pull(account, 0));

		const body = await readJson<PushBody>(
			await push(account, [
				await item(account.memberId, { id: good }),
				await item(account.memberId, { id: bad, baseVersion: 0 }),
			]),
		);
		expect(body.ok).toBe(false);
		expect(body.conflicts).toHaveLength(1);

		// The valid record was not stored either.
		const stored = await db
			.select({ id: sync_record.id })
			.from(sync_record)
			.where(
				and(eq(sync_record.owner, account.memberId), eq(sync_record.id, good)),
			);
		expect(stored).toHaveLength(0);
		// The cursor did not advance: no seq was consumed.
		expect(body.cursor).toBe(cursorBefore.cursor);
	});

	test("swapping the type is a conflict — the same id with a different type", async () => {
		const account = await signUp();
		await enableSync(account);
		const id = recordId();
		await push(account, [
			await item(account.memberId, { id, type: "chat.room" }),
		]);

		const body = await readJson<PushBody>(
			await push(account, [
				await item(account.memberId, {
					id,
					type: "authoring.draft",
					baseVersion: 1,
				}),
			]),
		);
		expect(body.ok).toBe(false);
		expect(body.conflicts).toEqual([{ id, serverVersion: 1 }]);

		const [row] = await db
			.select({ type: sync_record.type })
			.from(sync_record)
			.where(
				and(eq(sync_record.owner, account.memberId), eq(sync_record.id, id)),
			);
		expect(row.type).toBe("chat.room");
	});
});

describe.skipIf(!databaseReady)("push — validation", () => {
	test("a duplicate id within the batch is a 400", async () => {
		// A duplicate would consume seq twice and keep only the last, corrupting state.
		const account = await signUp();
		await enableSync(account);
		const id = recordId();
		const response = await push(account, [
			await item(account.memberId, { id }),
			await item(account.memberId, { id }),
		]);
		expect(response.status).toBe(400);
		expect(await readCode(response)).toBe("sync_record_invalid");
	});

	test.each([
		["not JSON", "not-json"],
		["no v", '{"iv":"AAAAAAAAAAAAAAAA","ct":"AAAA"}'],
		["the iv is not 12 bytes", '{"v":1,"iv":"AAAA","ct":"AAAA"}'],
	])("a malformed envelope is a 400 and **is not stored** (%s)", async (_l, ciphertext) => {
		const account = await signUp();
		await enableSync(account);
		const id = recordId();
		const response = await push(account, [
			{
				id,
				type: "chat.room",
				baseVersion: 0,
				ciphertext,
				envelope: 1,
				deleted: false,
			},
		]);
		expect(response.status).toBe(400);
		expect(
			await db
				.select({ id: sync_record.id })
				.from(sync_record)
				.where(eq(sync_record.id, id)),
		).toHaveLength(0);
	});

	test("a tombstone carrying ciphertext is a 400", async () => {
		/** Legacy allowed "null or empty string", which makes the unrepresentable state of a tombstone with content representable. */
		const account = await signUp();
		await enableSync(account);
		const response = await push(account, [
			{
				id: recordId(),
				type: "chat.room",
				baseVersion: 0,
				ciphertext: "",
				envelope: 1,
				deleted: true,
			},
		]);
		expect(response.status).toBe(400);
	});

	test("a live record without ciphertext is a 400", async () => {
		const account = await signUp();
		await enableSync(account);
		const response = await push(account, [
			{
				id: recordId(),
				type: "chat.room",
				baseVersion: 0,
				ciphertext: null,
				envelope: 1,
				deleted: false,
			},
		]);
		expect(response.status).toBe(400);
	});

	test.each([
		["uppercase", "Chat.Room"],
		["no namespace", "room"],
		["four levels", "a.b.c.d"],
		["empty string", ""],
	])("a malformed type is a 400 (%s)", async (_l, type) => {
		const account = await signUp();
		await enableSync(account);
		const response = await push(account, [
			{
				id: recordId(),
				type,
				baseVersion: 0,
				ciphertext: '{"v":1,"iv":"AAAAAAAAAAAAAAAA","ct":"AAAA"}',
				envelope: 1,
				deleted: false,
			},
		]);
		expect(response.status).toBe(400);
	});

	test("the server has no type allowlist — it accepts unknown types too", async () => {
		/**
		 * A fixed list would require a server deploy before a client could use a new type, so newer
		 * clients would be blocked by a lagging server and forward compatibility would be pointless.
		 * Older clients ignore the unknown type and advance the cursor.
		 */
		const account = await signUp();
		await enableSync(account);
		const id = recordId();
		const response = await push(account, [
			await item(account.memberId, { id, type: "library.character" }),
		]);
		expect(response.status).toBe(200);
		expect((await readJson<PushBody>(response)).ok).toBe(true);
	});

	test("an id derived with a colon goes up and comes down as is", async () => {
		/**
		 * A record unique per parent derives its identity from the parent (`chat-summary:<room>`). While
		 * the contract rejected that shape, the whole chunk carrying it got 400 and the valid records in
		 * it could never upload, so a valid record is sent in the same chunk. Whether the derivation
		 * function passes this regex is asked at the web assembly point (this app does not depend on
		 * `runtime-persistence`).
		 */
		const account = await signUp();
		await enableSync(account);
		const plain = recordId();
		const derived = `chat-summary:${crypto.randomUUID()}`;
		const response = await push(account, [
			await item(account.memberId, { id: plain }),
			await item(account.memberId, { id: derived, type: "chat.summary" }),
		]);
		expect(response.status).toBe(200);
		expect((await readJson<PushBody>(response)).ok).toBe(true);

		const body = await readJson<PullBody>(await pull(account, 0));
		expect(body.records.map((row) => row.id).sort()).toEqual(
			[plain, derived].sort(),
		);
	});

	test("a missing or malformed Idempotency-Key header is a 400", async () => {
		const account = await signUp();
		await enableSync(account);
		const items = [await item(account.memberId, { id: recordId() })];
		expect(
			(await call("POST", "/records", account.cookie, { body: { items } }))
				.status,
		).toBe(400);
		// Header values must be ASCII, so a too-short key (under 16 characters) is used as the format
		// violation.
		expect((await push(account, items, "short")).status).toBe(400);
		// Characters outside the allowed set (a space) are rejected too.
		expect(
			(await push(account, items, `${"a".repeat(10)} ${"b".repeat(10)}`))
				.status,
		).toBe(400);
	});
});

describe.skipIf(!databaseReady)("pull — cursor and order", () => {
	test("order within a batch is seq order", async () => {
		// A parent sent before its child gets the lower server seq, so receiving devices see the parent
		// first.
		const account = await signUp();
		await enableSync(account);
		const ids = [recordId(), recordId(), recordId()];
		await push(
			account,
			await Promise.all(ids.map((id) => item(account.memberId, { id }))),
		);

		const body = await readJson<PullBody>(await pull(account, 0));
		expect(body.records.map((row) => row.id)).toEqual(ids);
		expect(body.records.map((row) => row.seq)).toEqual([1, 2, 3]);
	});

	test("an update pushes seq **forward only**", async () => {
		/** The sole premise of pagination correctness: a path where seq moves backwards would let a scanning cursor skip that record forever. */
		const account = await signUp();
		await enableSync(account);
		const [first, second] = [recordId(), recordId()];
		await push(account, [
			await item(account.memberId, { id: first }),
			await item(account.memberId, { id: second }),
		]);
		await push(account, [
			await item(account.memberId, { id: first, baseVersion: 1 }),
		]);

		const body = await readJson<PullBody>(await pull(account, 0));
		expect(body.records.map((row) => row.id)).toEqual([second, first]);
		expect(body.records[1].seq).toBe(3);
	});

	test("the cursor is the seq of **the last row actually returned**", async () => {
		/** Returning the global max seq would skip rows not in this page forever; the quietest defect in §17. */
		const account = await signUp();
		await enableSync(account);
		await push(
			account,
			await Promise.all(
				Array.from({ length: 5 }, () =>
					item(account.memberId, { id: recordId() }),
				),
			),
		);

		const page = await readJson<PullBody>(await pull(account, 0, 2));
		expect(page.records).toHaveLength(2);
		expect(page.cursor).toBe(2);
		expect(page.hasMore).toBe(true);

		const next = await readJson<PullBody>(await pull(account, page.cursor, 2));
		expect(next.records.map((row) => row.seq)).toEqual([3, 4]);
		expect(next.hasMore).toBe(true);

		const last = await readJson<PullBody>(await pull(account, next.cursor, 2));
		expect(last.records.map((row) => row.seq)).toEqual([5]);
		expect(last.hasMore).toBe(false);
		expect(last.cursor).toBe(5);
	});

	test("with no rows returned the cursor **does not advance**", async () => {
		const account = await signUp();
		await enableSync(account);
		await push(account, [await item(account.memberId, { id: recordId() })]);
		const body = await readJson<PullBody>(await pull(account, 1));
		expect(body.records).toHaveLength(0);
		expect(body.cursor).toBe(1);
		expect(body.hasMore).toBe(false);
	});

	test("a request over the limit is **truncated**, not a 400", async () => {
		const account = await signUp();
		await enableSync(account);
		const response = await pull(account, 0, 100_000);
		expect(response.status).toBe(200);
	});

	test.each([
		["negative", "-1"],
		["not an integer", "1.5"],
		["not a number", "abc"],
	])("a cursor of %s is a 400", async (_l, since) => {
		const account = await signUp();
		await enableSync(account);
		const response = await call(
			"GET",
			`/records?since=${since}`,
			account.cookie,
		);
		expect(response.status).toBe(400);
		expect(await readCode(response)).toBe("sync_cursor_invalid");
	});

	test("a tombstone has null ciphertext and carries serverUpdatedAt", async () => {
		/**
		 * Why `serverUpdatedAt` exists: a tombstone has nothing to decrypt, so a receiving device
		 * structurally cannot learn the original device's `deletedAt`. Carrying a value the server
		 * already has makes every device use the same one.
		 */
		const account = await signUp();
		await enableSync(account);
		const id = recordId();
		await push(account, [await item(account.memberId, { id })]);
		await push(account, [
			await item(account.memberId, { id, baseVersion: 1, deleted: true }),
		]);

		const body = await readJson<PullBody>(await pull(account, 0));
		expect(body.records).toHaveLength(1);
		const [row] = body.records;
		expect(row.deleted).toBe(true);
		expect(row.ciphertext).toBeNull();
		expect(row.version).toBe(2);
		expect(Number.isNaN(Date.parse(row.serverUpdatedAt))).toBe(false);
	});

	test("a tombstone stays as a row and doesn't lower record_count", async () => {
		// v1 keeps tombstones forever, which removes the resurrection problem entirely.
		const account = await signUp();
		await enableSync(account);
		const id = recordId();
		await push(account, [await item(account.memberId, { id })]);
		await push(account, [
			await item(account.memberId, { id, baseVersion: 1, deleted: true }),
		]);

		const [state] = await db
			.select({
				count: sync_state.record_count,
				bytes: sync_state.total_bytes,
			})
			.from(sync_state)
			.where(eq(sync_state.owner, account.memberId));
		expect(state.count).toBe(1);
		// A tombstone's bytes are 0.
		expect(state.bytes).toBe(0);
	});
});

describe.skipIf(!databaseReady)("idempotency", () => {
	test("same key + same body → the cached response, **server state unchanged**", async () => {
		/** A retry after a lost response bumping the server version twice would permanently skew that device's `baseVersion` and make the record conflict on every sync. */
		const account = await signUp();
		await enableSync(account);
		const id = recordId();
		const items = [await item(account.memberId, { id })];
		const key = `idem-${newId()}`;

		const first = await readJson<PushBody>(await push(account, items, key));
		expect(first.ok).toBe(true);
		expect(first.deduplicated).toBeUndefined();

		const before = await db
			.select({
				version: sync_record.version,
				seq: sync_record.seq,
				ciphertext: sync_record.ciphertext,
			})
			.from(sync_record)
			.where(
				and(eq(sync_record.owner, account.memberId), eq(sync_record.id, id)),
			);

		const second = await readJson<PushBody>(await push(account, items, key));
		expect(second.ok).toBe(true);
		expect(second.cursor).toBe(first.cursor);

		const after = await db
			.select({
				version: sync_record.version,
				seq: sync_record.seq,
				ciphertext: sync_record.ciphertext,
			})
			.from(sync_record)
			.where(
				and(eq(sync_record.owner, account.memberId), eq(sync_record.id, id)),
			);
		// Version, seq and ciphertext are unchanged: the second request did nothing.
		expect(after).toEqual(before);

		const [state] = await db
			.select({ seq: sync_state.seq })
			.from(sync_state)
			.where(eq(sync_state.owner, account.memberId));
		expect(state.seq).toBe(first.cursor);
	});

	test("same key + different body → 409 with state unchanged", async () => {
		const account = await signUp();
		await enableSync(account);
		const key = `idem-${newId()}`;
		await push(
			account,
			[await item(account.memberId, { id: recordId() })],
			key,
		);

		const other = recordId();
		const response = await push(
			account,
			[await item(account.memberId, { id: other })],
			key,
		);
		expect(response.status).toBe(409);
		expect(await readCode(response)).toBe("sync_idempotency_mismatch");
		expect(
			await db
				.select({ id: sync_record.id })
				.from(sync_record)
				.where(eq(sync_record.id, other)),
		).toHaveLength(0);
	});

	test("a row marked in progress gives 409 + Retry-After", async () => {
		/**
		 * On the normal path claim and work share a transaction, so this state is never created. The
		 * branch stays because a refactor breaking that invariant (moving the claim to a separate
		 * transaction) is tempting, and this test must still be there then.
		 */
		const account = await signUp();
		await enableSync(account);
		const key = `idem-${newId()}`;
		const items = [await item(account.memberId, { id: recordId() })];
		await db.insert(sync_push_dedupe).values({
			owner: account.memberId,
			idempotency_key: key,
			request_hash: pushHashOf(items),
			response: "",
			expires_at: new Date(Date.now() + 60_000),
		});

		const response = await push(account, items, key);
		expect(response.status).toBe(409);
		expect(await readCode(response)).toBe("sync_idempotency_in_progress");
	});

	test("idempotency keys are per account — they don't mix with another account's keys", async () => {
		const alice = await signUp("Alice");
		const bob = await signUp("Bob");
		await enableSync(alice);
		await enableSync(bob);
		const key = `idem-${newId()}`;

		expect(
			(await push(alice, [await item(alice.memberId, { id: recordId() })], key))
				.status,
		).toBe(200);
		// Bob's same key really applies Bob's batch (not a 409, though the body differs).
		const bobResponse = await push(
			bob,
			[await item(bob.memberId, { id: recordId() })],
			key,
		);
		expect(bobResponse.status).toBe(200);
		expect((await readJson<PushBody>(bobResponse)).ok).toBe(true);
	});
});

describe.skipIf(!databaseReady)("per-member sequence — concurrency", () => {
	/**
	 * Basis of §17. A Postgres `SEQUENCE` issues values outside the transaction, so a later-starting
	 * transaction can commit first and a lower seq appears afterwards; a device that pulled in between
	 * never sees that record. Locking the member row `FOR UPDATE` inside the transaction makes commit
	 * order match seq order. Arithmetic unit tests cannot replace this: the subject is a property of
	 * the lock.
	 */
	test("concurrent pushes from the same member get unique, increasing seq with no gaps", async () => {
		const account = await signUp();
		await enableSync(account);
		const batches = await Promise.all(
			Array.from({ length: 8 }, async () => [
				await item(account.memberId, { id: recordId() }),
				await item(account.memberId, { id: recordId() }),
			]),
		);

		const responses = await Promise.all(
			batches.map((items) => push(account, items)),
		);
		for (const response of responses) expect(response.status).toBe(200);

		const rows = await db
			.select({ seq: sync_record.seq })
			.from(sync_record)
			.where(eq(sync_record.owner, account.memberId));
		const seqs = rows.map((row) => row.seq).sort((a, b) => a - b);
		expect(seqs).toHaveLength(16);
		// Unique and gapless 1..16, so no cursor can skip a batch.
		expect(new Set(seqs).size).toBe(16);
		expect(seqs).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));

		// Pulling from cursor 0 after commits finish sees everything.
		const pulled = await readJson<PullBody>(await pull(account, 0, 500));
		expect(pulled.records).toHaveLength(16);
	});

	test("different members don't share each other's sequence", async () => {
		/** Legacy used one global row, a serialization point for all writes with cursor values inflated by global write volume. Per member, each starts at 1. */
		const alice = await signUp("Alice");
		const bob = await signUp("Bob");
		await enableSync(alice);
		await enableSync(bob);

		await Promise.all([
			push(alice, [await item(alice.memberId, { id: recordId() })]),
			push(bob, [await item(bob.memberId, { id: recordId() })]),
			push(alice, [await item(alice.memberId, { id: recordId() })]),
			push(bob, [await item(bob.memberId, { id: recordId() })]),
		]);

		for (const account of [alice, bob]) {
			const rows = await db
				.select({ seq: sync_record.seq })
				.from(sync_record)
				.where(eq(sync_record.owner, account.memberId));
			expect(rows.map((row) => row.seq).sort((a, b) => a - b)).toEqual([1, 2]);
		}
	});
});

describe.skipIf(!databaseReady)("quota", () => {
	test("over the record count cap it is a 507 and **nothing is applied**", async () => {
		/**
		 * The aggregate row is set to the cap instead of really reaching 200k records. The subject is
		 * whether the decision precedes application, which one aggregate value reproduces exactly.
		 */
		const account = await signUp();
		await enableSync(account);
		await push(account, [await item(account.memberId, { id: recordId() })]);
		await db
			.update(sync_state)
			.set({ record_count: SYNC_LIMITS.ownerMaxRecords })
			.where(eq(sync_state.owner, account.memberId));

		const blocked = recordId();
		const response = await push(account, [
			await item(account.memberId, { id: blocked }),
		]);
		expect(response.status).toBe(507);
		expect(await readCode(response)).toBe("sync_quota_exceeded");
		expect(
			await db
				.select({ id: sync_record.id })
				.from(sync_record)
				.where(eq(sync_record.id, blocked)),
		).toHaveLength(0);
	});

	test("the total byte cap blocks the same way", async () => {
		const account = await signUp();
		await enableSync(account);
		await db
			.insert(sync_state)
			.values({
				owner: account.memberId,
				total_bytes: SYNC_LIMITS.ownerMaxTotalBytes,
			})
			.onConflictDoUpdate({
				target: sync_state.owner,
				set: { total_bytes: SYNC_LIMITS.ownerMaxTotalBytes },
			});

		const response = await push(account, [
			await item(account.memberId, { id: recordId() }),
		]);
		expect(response.status).toBe(507);
	});

	test("an update that **shrinks** an existing record is not caught by the cap", async () => {
		// Byte totals must update by `new - old`; adding only would leave an account that once wrote a
		// large value unable to write anything.
		const account = await signUp();
		await enableSync(account);
		const id = recordId();
		await push(account, [
			await item(account.memberId, {
				id,
				data: { big: "\uac00".repeat(2000) },
			}),
		]);
		const [before] = await db
			.select({ bytes: sync_state.total_bytes })
			.from(sync_state)
			.where(eq(sync_state.owner, account.memberId));

		await push(account, [
			await item(account.memberId, { id, baseVersion: 1, data: { small: 1 } }),
		]);
		const [after] = await db
			.select({ bytes: sync_state.total_bytes, count: sync_state.record_count })
			.from(sync_state)
			.where(eq(sync_state.owner, account.memberId));
		expect(after.bytes).toBeLessThan(before.bytes);
		expect(after.count).toBe(1);
	});

	test("over the distinct type cap it is a 507", async () => {
		/** Abuse defence in place of a type allowlist: any well-formed type is accepted, so unbounded namespaces filling storage are blocked here. */
		const account = await signUp();
		await enableSync(account);
		const types = Array.from(
			{ length: SYNC_LIMITS.ownerMaxDistinctTypes },
			(_, i) => `t${i}.rec`,
		);
		const filled = await push(
			account,
			await Promise.all(
				types.map((type) => item(account.memberId, { id: recordId(), type })),
			),
		);
		expect(filled.status).toBe(200);

		const overflow = await push(account, [
			await item(account.memberId, { id: recordId(), type: "extra.rec" }),
		]);
		expect(overflow.status).toBe(507);
		expect(await readCode(overflow)).toBe("sync_quota_exceeded");

		// Writes to an already-present type keep working.
		expect(
			(
				await push(account, [
					await item(account.memberId, { id: recordId(), type: types[0] }),
				])
			).status,
		).toBe(200);
	});
});

describe.skipIf(!databaseReady)("server opacity", () => {
	test("the plaintext marker appears nowhere in the DB", async () => {
		/** The measured check of the zero-knowledge claim: other tests verify behavior, this one verifies the stored bytes contain no plaintext. */
		const account = await signUp();
		await enableSync(account);
		const marker = `SYNC_PLAINTEXT_MARKER_${newId()}`;
		const id = recordId();
		await push(account, [
			await item(account.memberId, {
				id,
				data: { title: marker, body: `${marker} repeated`.repeat(30) },
			}),
		]);

		const rows = await db
			.select()
			.from(sync_record)
			.where(eq(sync_record.owner, account.memberId));
		expect(JSON.stringify(rows)).not.toContain(marker);

		const dedupe = await db
			.select()
			.from(sync_push_dedupe)
			.where(eq(sync_push_dedupe.owner, account.memberId));
		expect(JSON.stringify(dedupe)).not.toContain(marker);

		const keyrings = await db
			.select()
			.from(sync_keyring)
			.where(eq(sync_keyring.owner, account.memberId));
		expect(JSON.stringify(keyrings)).not.toContain(marker);

		// This is all the server knows: type, length, deleted flag.
		expect(rows[0].type).toBe("chat.room");
		expect(rows[0].bytes).toBeGreaterThan(0);
		expect(rows[0].deleted).toBe(false);
	});
});

/* Wake stream: `GET /v2/me/sync/events`.
 *
 * A real Postgres is needed because the subject is transaction ordering: notify only after
 * commit, never on rollback, and the announced cursor is immediately pullable. A mocked broker
 * takes all three out of the test. The response is a stream, so the body is read directly to see
 * frames actually flow; broker-callback unit tests cannot replace that (`services/sync/wake.test.ts` covers those). */

interface WakeStream {
	/** Next frame; null if nothing arrives within the cap, so the test does not hang. */
	next(timeoutMs?: number): Promise<string | null>;
	/** Next wake cursor, skipping heartbeats. */
	nextCursor(timeoutMs?: number): Promise<number | null>;
	close(): void;
	response: Response;
}

const wakeDecoder = new TextDecoder();

async function openWake(account: Account): Promise<WakeStream> {
	const abort = new AbortController();
	const response = await app.request("/v2/me/sync/events", {
		headers: { Cookie: account.cookie, Origin: WEB_ORIGIN },
		signal: abort.signal,
	});
	expect(response.status).toBe(200);
	if (!response.body) throw new Error("there is no stream body");
	const reader = response.body.getReader();

	/**
	 * Frames are queued and consumed from the queue. Racing `reader.read()` against a timeout leaves
	 * that read pending when time wins and it steals the next frame, shifting every later assertion by
	 * one.
	 */
	const frames: string[] = [];
	let ended = false;
	void (async () => {
		let buffer = "";
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += wakeDecoder.decode(value, { stream: true });
				// Split even when one chunk carries several frames.
				let end = buffer.indexOf("\n\n");
				while (end >= 0) {
					frames.push(buffer.slice(0, end + 2));
					buffer = buffer.slice(end + 2);
					end = buffer.indexOf("\n\n");
				}
			}
		} catch {
			// Ending via abort is the normal termination path.
		} finally {
			ended = true;
		}
	})();

	const next = async (timeoutMs = 2_000): Promise<string | null> => {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const frame = frames.shift();
			if (frame !== undefined) return frame;
			if (ended || Date.now() >= deadline) return null;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	};

	return {
		response,
		next,
		async nextCursor(timeoutMs) {
			for (;;) {
				const frame = await next(timeoutMs);
				if (frame === null) return null;
				// A heartbeat is a comment, not an event.
				if (frame.startsWith(":")) continue;
				const match = /^data: (.*)$/m.exec(frame);
				if (!match) return null;
				return (JSON.parse(match[1]) as { cursor: number }).cursor;
			}
		},
		close() {
			abort.abort();
			void reader.cancel().catch(() => {});
		},
	};
}

describe.skipIf(!databaseReady)("wake-up — authorization and isolation", () => {
	test("a guest gets 401", async () => {
		const response = await app.request("/v2/me/sync/events", {
			headers: { Origin: WEB_ORIGIN },
		});
		expect(response.status).toBe(401);
		expect(await readCode(response)).toBe("login_required");
	});

	test("the response is SSE, not cached, and not buffered by proxies", async () => {
		const alice = await signUp();
		const stream = await openWake(alice);
		try {
			expect(stream.response.headers.get("Content-Type")).toContain(
				"text/event-stream",
			);
			expect(stream.response.headers.get("Cache-Control")).toContain(
				"no-store",
			);
			expect(stream.response.headers.get("X-Accel-Buffering")).toBe("no");
		} finally {
			stream.close();
		}
	});

	/** P0: if Bob's advance appears on Alice's stream the slice cannot ship; a cursor is not content, but "this account just did something" is itself someone else's information. */
	test("split by owner — Alice's commit doesn't reach Bob", async () => {
		const alice = await signUp("wake Alice");
		const bob = await signUp("wake Bob");
		const aliceStream = await openWake(alice);
		const bobStream = await openWake(bob);
		try {
			// Drain the initial frame (both 0) first.
			expect(await aliceStream.nextCursor()).toBe(0);
			expect(await bobStream.nextCursor()).toBe(0);

			const pushed = await push(alice, [
				await item(alice.memberId, { id: recordId() }),
			]);
			expect(pushed.status).toBe(200);
			const cursor = (await readJson<PushBody>(pushed)).cursor;

			expect(await aliceStream.nextCursor()).toBe(cursor);
			// Nothing arrives for Bob; checked with a short cap (heartbeat is 20s).
			expect(await bobStream.next(300)).toBe(null);

			// Same in the other direction.
			const bobPush = await push(bob, [
				await item(bob.memberId, { id: recordId() }),
			]);
			expect(await bobStream.nextCursor()).toBe(
				(await readJson<PushBody>(bobPush)).cursor,
			);
			expect(await aliceStream.next(300)).toBe(null);
		} finally {
			aliceStream.close();
			bobStream.close();
		}
	});

	/** The owner comes only from the session; the route has no code reading it, so the query below is ignored. Pinned so nobody starts reading a query "for diagnostics". */
	test("the query can't pick someone else as owner", async () => {
		const alice = await signUp("wake Alice2");
		const bob = await signUp("wake Bob2");
		await push(bob, [await item(bob.memberId, { id: recordId() })]);

		const abort = new AbortController();
		const response = await app.request(
			`/v2/me/sync/events?owner=${bob.memberId}&viewerId=${bob.memberId}`,
			{
				headers: {
					Cookie: alice.cookie,
					Origin: WEB_ORIGIN,
					"X-Sync-Owner": bob.memberId,
				},
				signal: abort.signal,
			},
		);
		expect(response.status).toBe(200);
		const reader = response.body?.getReader();
		const first = await reader?.read();
		const frame = wakeDecoder.decode(first?.value);
		// Alice's cursor (0) comes back, not Bob's.
		expect(frame).toContain('"cursor":0');
		abort.abort();
		void reader?.cancel().catch(() => {});
	});
});

describe.skipIf(!databaseReady)("wake-up — commit order", () => {
	/** §83: the cursor a wake announces must be pullable immediately; announcing before commit would point this pull at a row that does not exist yet, and the device would advance its cursor and never see the record. */
	test("the announced cursor is pulled immediately", async () => {
		const account = await signUp();
		const stream = await openWake(account);
		try {
			expect(await stream.nextCursor()).toBe(0);
			const id = recordId();
			await push(account, [await item(account.memberId, { id })]);

			const cursor = await stream.nextCursor();
			expect(cursor).not.toBeNull();

			const page = await readJson<PullBody>(await pull(account, 0));
			expect(page.records.map((row) => row.id)).toContain(id);
			expect(page.cursor).toBe(cursor);
		} finally {
			stream.close();
		}
	});

	/** §86: one batch is one frame; 50 records do not become 50 events. */
	test("a multi-record push makes one frame", async () => {
		const account = await signUp();
		const stream = await openWake(account);
		try {
			expect(await stream.nextCursor()).toBe(0);
			const items = await Promise.all(
				Array.from({ length: 50 }, () =>
					item(account.memberId, { id: recordId() }),
				),
			);
			const pushed = await readJson<PushBody>(await push(account, items));
			expect(pushed.cursor).toBe(50);

			expect(await stream.nextCursor()).toBe(50);
			// Intermediate cursors (1..49) never arrive.
			expect(await stream.next(300)).toBe(null);
		} finally {
			stream.close();
		}
	});

	test("two consecutive commits both arrive (or arrive as the last value)", async () => {
		const account = await signUp();
		const stream = await openWake(account);
		try {
			expect(await stream.nextCursor()).toBe(0);
			await push(account, [await item(account.memberId, { id: recordId() })]);
			await push(account, [await item(account.memberId, { id: recordId() })]);

			/*
			 * Coalesced (just 2) or split (1 then 2) are both fine. What is wrong is stopping at 1, which
			 * leaves the second commit unannounced until the next lifetime signal.
			 */
			let last = await stream.nextCursor();
			if (last === 1) last = await stream.nextCursor();
			expect(last).toBe(2);
		} finally {
			stream.close();
		}
	});

	/** §85: a request retried with the same idempotency key after a lost response does not advance server state; announcing again would cost every device of that account a pointless pull per retry. */
	test("an idempotent retry makes no new wake-up", async () => {
		const account = await signUp();
		const stream = await openWake(account);
		try {
			expect(await stream.nextCursor()).toBe(0);
			const items = [await item(account.memberId, { id: recordId() })];
			const key = `idem-${newId()}`;

			const first = await readJson<PushBody>(await push(account, items, key));
			expect(first.ok).toBe(true);
			expect(await stream.nextCursor()).toBe(first.cursor);

			const replay = await readJson<PushBody>(await push(account, items, key));
			expect(replay.cursor).toBe(first.cursor);
			expect(await stream.next(300)).toBe(null);
		} finally {
			stream.close();
		}
	});

	/** §12: a conflict applied nothing, so there is no advance to announce. */
	test("a conflicting push doesn't wake", async () => {
		const account = await signUp();
		const id = recordId();
		await push(account, [await item(account.memberId, { id })]);

		const stream = await openWake(account);
		try {
			expect(await stream.nextCursor()).toBe(1);
			// Re-upload with baseVersion still 0: the server is at 1, so it conflicts.
			const conflicted = await readJson<PushBody>(
				await push(account, [
					await item(account.memberId, { id, baseVersion: 0 }),
				]),
			);
			expect(conflicted.ok).toBe(false);
			expect(await stream.next(300)).toBe(null);
		} finally {
			stream.close();
		}
	});

	/** §84: a path that dies after state is prepared but before commit (type budget overflow throws inside a transaction ready to issue seq). Announcing that rolled-back cursor would send devices to pull state that does not exist. */
	test("a rolled-back push doesn't wake", async () => {
		const account = await signUp();
		const stream = await openWake(account);
		try {
			expect(await stream.nextCursor()).toBe(0);

			const items = await Promise.all(
				Array.from({ length: SYNC_LIMITS.ownerMaxDistinctTypes + 1 }, (_, i) =>
					item(account.memberId, {
						id: recordId(),
						type: `chat.t${i}`,
					}),
				),
			);
			const response = await push(account, items);
			expect(response.status).toBe(507);
			expect(await readCode(response)).toBe(SYNC_ERROR_CODE.quotaExceeded);

			expect(await stream.next(300)).toBe(null);
			// The server cursor is unchanged too.
			expect(await readSyncCursor(account.memberId)).toBe(0);
		} finally {
			stream.close();
		}
	});
});

describe.skipIf(!databaseReady)("wake-up — reconnect and cleanup", () => {
	/** §89: a device that missed changes while disconnected still learns the current cursor from the reconnect's initial frame, which is why the server keeps no event log (`sse_outbox`). */
	test("the reconnect's initial frame announces changes made while disconnected", async () => {
		const account = await signUp();
		const first = await openWake(account);
		expect(await first.nextCursor()).toBe(0);
		first.close();

		await push(account, [await item(account.memberId, { id: recordId() })]);
		await push(account, [await item(account.memberId, { id: recordId() })]);

		const second = await openWake(account);
		try {
			expect(await second.nextCursor()).toBe(2);
		} finally {
			second.close();
		}
	});

	/** §108: a subscription left by a disconnected client would grow that member's ledger forever. */
	test("repeated connections don't leak subscriber records", async () => {
		const account = await signUp();
		expect(syncWakeBroker.subscriberCount(account.memberId)).toBe(0);

		for (let i = 0; i < 5; i++) {
			const stream = await openWake(account);
			expect(await stream.nextCursor()).toBe(0);
			expect(syncWakeBroker.subscriberCount(account.memberId)).toBe(1);
			stream.close();
			// abort releases the subscription synchronously.
			expect(syncWakeBroker.subscriberCount(account.memberId)).toBe(0);
		}
	});
});

describe.skipIf(!databaseReady)("wake-up — frame contents", () => {
	/** §127: a frame must carry nothing but the cursor. Raw bytes are scanned to catch mistakes schema validation misses, such as the server hand-assembling a frame and adding a field. */
	test("a frame holds nothing but the cursor", async () => {
		const account = await signUp();
		const id = recordId();
		const stream = await openWake(account);
		try {
			expect(await stream.nextCursor()).toBe(0);
			await push(account, [
				await item(account.memberId, {
					id,
					data: { secret: "plaintextmarker" },
				}),
			]);

			const frame = await stream.next();
			expect(frame).not.toBeNull();
			const text = frame as string;

			expect(text).toBe('event: sync\ndata: {"cursor":1}\n\n');
			for (const forbidden of [
				id,
				account.memberId,
				"plaintextmarker",
				"ciphertext",
				"envelope",
				"type",
				"record",
				"deleted",
				"rev",
			])
				expect(text).not.toContain(forbidden);

			const payload = JSON.parse(
				(/^data: (.*)$/m.exec(text) as RegExpExecArray)[1],
			) as Record<string, unknown>;
			expect(Object.keys(payload)).toEqual(["cursor"]);
		} finally {
			stream.close();
		}
	});
});

/**
 * Creator-runtime player saves: to the server these are two ordinary records. The block checks that
 * the server does not know this domain: no type allowlist so a new name passes, the content is
 * undecryptable ciphertext, and the two lifetimes each own a row. No check opens the saved state's
 * content here, since a server able to see it would break the zero-knowledge claim first.
 */
describe.skipIf(!databaseReady)("runtime player saves", () => {
	test("the two types round-trip as ordinary records", async () => {
		const account = await signUp();
		const playthrough = recordId();
		const persistent = recordId();
		const response = await push(account, [
			await item(account.memberId, {
				id: playthrough,
				type: "runtime.playthrough",
			}),
			await item(account.memberId, {
				id: persistent,
				type: "runtime.persistent",
			}),
		]);
		expect(response.status).toBe(200);

		const pulled = await readJson<PullBody>(await pull(account));
		const byId = new Map(pulled.records.map((record) => [record.id, record]));
		expect(byId.get(playthrough)?.type).toBe("runtime.playthrough");
		expect(byId.get(persistent)?.type).toBe("runtime.persistent");
		/** The server stores ciphertext only: no key, board or chapter is in that row. */
		expect(byId.get(playthrough)?.ciphertext).not.toBeNull();
		expect(JSON.stringify(pulled.records)).not.toContain("formatVersion");
	});

	/** The two lifetimes are different rows: editing one does not move the other's version. */
	test("the two lifetimes don't move each other's versions", async () => {
		const account = await signUp();
		const playthrough = recordId();
		const persistent = recordId();
		await push(account, [
			await item(account.memberId, {
				id: playthrough,
				type: "runtime.playthrough",
			}),
			await item(account.memberId, {
				id: persistent,
				type: "runtime.persistent",
			}),
		]);
		await push(account, [
			await item(account.memberId, {
				id: playthrough,
				type: "runtime.playthrough",
				baseVersion: 1,
				data: { n: 2 },
			}),
		]);

		const pulled = await readJson<PullBody>(await pull(account));
		const byId = new Map(pulled.records.map((record) => [record.id, record]));
		expect(byId.get(playthrough)?.version).toBe(2);
		expect(byId.get(persistent)?.version).toBe(1);
	});
});
