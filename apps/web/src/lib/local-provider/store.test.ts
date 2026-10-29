import { afterEach, describe, expect, it } from "vitest";
import {
	activateLocalDbScope,
	LocalDb,
	resetLocalDbScope,
} from "#/lib/local-data/db.ts";
import { createGenerationPreferenceStore } from "#/lib/local-generation/store.ts";
import { syncCodecRegistry } from "#/lib/local-sync/registry.ts";
import { createDexieSyncStore } from "#/lib/local-sync/store.ts";
import {
	createProviderConnectionStore,
	createProviderCredentialAccess,
} from "./store.ts";

/**
 * Provider credentials are user API keys, so types alone are not enough. Failures here are silent
 * and costly. Broken account isolation sends one user's generation with another user's key.
 * Plaintext storage lets an extension read it. A leaked sync axis uploads the key to the server.
 * This file pins: no plaintext in the stored row; the AAD bound to member, provider, and connection
 * (a moved row fails to open); rotation issuing new wrapping material; disconnect deleting the row;
 * and none of it reaching sync.
 */

let sequence = 0;
const nextViewer = (label: string): string => `${label}-${++sequence}`;

const open = (viewerId: string) =>
	createProviderConnectionStore(activateLocalDbScope(viewerId), viewerId);

const access = (viewerId: string) =>
	createProviderCredentialAccess(activateLocalDbScope(viewerId), viewerId);

const ANTHROPIC_KEY = "sk-ant-test-0123456789";
const GEMINI_KEY = "AIzaTestKey0123456789";

afterEach(() => {
	resetLocalDbScope();
});

describe("connecting and disconnecting", () => {
	it("connecting shows a summary", async () => {
		const store = open(nextViewer("alice"));
		await store.connect("anthropic-byo", ANTHROPIC_KEY);

		const summary = await store.get("anthropic-byo");
		expect(summary).toMatchObject({
			provider: "anthropic-byo",
			connected: true,
		});
		expect(await store.has("anthropic-byo")).toBe(true);
		expect(await store.list()).toHaveLength(1);
	});

	it("unconnected providers are absent", async () => {
		const store = open(nextViewer("alice"));
		await store.connect("anthropic-byo", ANTHROPIC_KEY);

		expect(await store.get("gemini-byo")).toBeNull();
		expect(await store.has("gemini-byo")).toBe(false);
	});

	it("two providers can be connected together", async () => {
		const store = open(nextViewer("alice"));
		await store.connect("anthropic-byo", ANTHROPIC_KEY);
		await store.connect("gemini-byo", GEMINI_KEY);

		expect((await store.list()).map((entry) => entry.provider).sort()).toEqual([
			"anthropic-byo",
			"gemini-byo",
		]);
	});

	it("disconnecting removes the row itself", async () => {
		const alice = nextViewer("alice");
		const db = activateLocalDbScope(alice);
		const store = createProviderConnectionStore(db, alice);

		await store.connect("anthropic-byo", ANTHROPIC_KEY);
		expect(await db.providerConnections.get("anthropic-byo")).toBeDefined();

		await store.disconnect("anthropic-byo");
		expect(await db.providerConnections.get("anthropic-byo")).toBeUndefined();
		expect(await store.get("anthropic-byo")).toBeNull();
	});

	/**
	 * Disconnecting a connection that does not exist succeeds (idempotent). Two tabs can press the
	 * same button, and the second call has no reason to fail.
	 */
	it("disconnecting a missing connection succeeds (idempotent)", async () => {
		const store = open(nextViewer("alice"));
		await expect(store.disconnect("gemini-byo")).resolves.toBeUndefined();
	});

	it("empty credentials are not saved", async () => {
		const store = open(nextViewer("alice"));
		await expect(store.connect("anthropic-byo", "   ")).rejects.toThrow();
		expect(await store.has("anthropic-byo")).toBe(false);
	});

	/**
	 * Keys copied from a console often carry a trailing newline. That one character would surface as
	 * the provider's 401, and the user would conclude the key is wrong.
	 */
	it("surrounding whitespace is trimmed before saving", async () => {
		const alice = nextViewer("alice");
		const store = open(alice);
		await store.connect("anthropic-byo", `  ${ANTHROPIC_KEY}\n`);

		const secret = await access(alice).withCredential(
			"anthropic-byo",
			async (value) => value,
		);
		expect(secret).toBe(ANTHROPIC_KEY);
	});
});

describe("protection at rest", () => {
	/**
	 * The most important assertion in this file: no plaintext anywhere in the stored row. The whole
	 * row is serialized and scanned. Checking fields one by one would miss fields added later.
	 */
	it("stored rows have no plaintext key", async () => {
		const alice = nextViewer("alice");
		const db = activateLocalDbScope(alice);
		await createProviderConnectionStore(db, alice).connect(
			"anthropic-byo",
			ANTHROPIC_KEY,
		);

		const row = await db.providerConnections.get("anthropic-byo");
		expect(row).toBeDefined();

		const serialized = JSON.stringify(row, (_key, value) =>
			value instanceof Uint8Array ? Array.from(value) : value,
		);
		expect(serialized).not.toContain(ANTHROPIC_KEY);
		expect(serialized).not.toContain("sk-ant");
	});

	it("the wrapping key's bytes cannot be extracted", async () => {
		const alice = nextViewer("alice");
		const db = activateLocalDbScope(alice);
		await createProviderConnectionStore(db, alice).connect(
			"anthropic-byo",
			ANTHROPIC_KEY,
		);

		const row = await db.providerConnections.get("anthropic-byo");
		expect(row?.wrapKey.extractable).toBe(false);
		await expect(
			crypto.subtle.exportKey("raw", row?.wrapKey as CryptoKey),
		).rejects.toThrow();
	});

	it("opening at runtime yields the original key", async () => {
		const alice = nextViewer("alice");
		await open(alice).connect("gemini-byo", GEMINI_KEY);

		expect(
			await access(alice).withCredential("gemini-byo", async (value) => value),
		).toBe(GEMINI_KEY);
	});

	it("without a connection the callback is not called", async () => {
		const alice = nextViewer("alice");
		let called = false;
		const result = await access(alice).withCredential(
			"anthropic-byo",
			async () => {
				called = true;
				return "x";
			},
		);
		expect(result).toBeNull();
		expect(called).toBe(false);
	});
});

describe("tampering and domain separation", () => {
	/**
	 * Altering the ciphertext makes GCM authentication fail. It must never yield a different value
	 * silently.
	 */
	it("tampered ciphertext does not open", async () => {
		const alice = nextViewer("alice");
		const db = activateLocalDbScope(alice);
		await createProviderConnectionStore(db, alice).connect(
			"anthropic-byo",
			ANTHROPIC_KEY,
		);

		const row = await db.providerConnections.get("anthropic-byo");
		if (!row) throw new Error("row missing");
		const tampered = new Uint8Array(row.ct);
		tampered[0] = (tampered[0] ?? 0) ^ 0xff;
		await db.providerConnections.put({ ...row, ct: tampered });

		expect(
			await access(alice).withCredential("anthropic-byo", async (v) => v),
		).toBeNull();
	});

	/**
	 * Moving the row under another provider must not open it. Otherwise an Anthropic key row could be
	 * relabeled as a Gemini connection, and the Anthropic key would be sent to Gemini.
	 */
	it("moving it to another provider's row does not open", async () => {
		const alice = nextViewer("alice");
		const db = activateLocalDbScope(alice);
		await createProviderConnectionStore(db, alice).connect(
			"anthropic-byo",
			ANTHROPIC_KEY,
		);

		const row = await db.providerConnections.get("anthropic-byo");
		if (!row) throw new Error("row missing");
		await db.providerConnections.put({ ...row, provider: "gemini-byo" });

		expect(
			await access(alice).withCredential("gemini-byo", async (v) => v),
		).toBeNull();
	});

	/**
	 * Changing the connection id must not open it either. Otherwise ciphertext from before a key
	 * replacement could be restored.
	 */
	it("changing the connection id does not open", async () => {
		const alice = nextViewer("alice");
		const db = activateLocalDbScope(alice);
		await createProviderConnectionStore(db, alice).connect(
			"anthropic-byo",
			ANTHROPIC_KEY,
		);

		const row = await db.providerConnections.get("anthropic-byo");
		if (!row) throw new Error("row missing");
		await db.providerConnections.put({ ...row, connectionId: "someone-else" });

		expect(
			await access(alice).withCredential("anthropic-byo", async (v) => v),
		).toBeNull();
	});

	/**
	 * Planting Alice's ciphertext in Bob's database must not open it. The member id in the AAD also
	 * blocks copying a whole database file into another account.
	 */
	it("transplanting another member's row does not open", async () => {
		const alice = nextViewer("alice");
		const bob = nextViewer("bob");

		const aliceDb = activateLocalDbScope(alice);
		await createProviderConnectionStore(aliceDb, alice).connect(
			"anthropic-byo",
			ANTHROPIC_KEY,
		);
		const stolen = await aliceDb.providerConnections.get("anthropic-byo");
		resetLocalDbScope();

		const bobDb = activateLocalDbScope(bob);
		if (!stolen) throw new Error("row missing");
		await bobDb.providerConnections.put(stolen);

		expect(
			await createProviderCredentialAccess(bobDb, bob).withCredential(
				"anthropic-byo",
				async (v) => v,
			),
		).toBeNull();
	});
});

describe("key replacement", () => {
	it("replacing yields the new key", async () => {
		const alice = nextViewer("alice");
		const store = open(alice);
		await store.connect("anthropic-byo", ANTHROPIC_KEY);
		await store.connect("anthropic-byo", "sk-ant-second-key");

		expect(
			await access(alice).withCredential("anthropic-byo", async (v) => v),
		).toBe("sk-ant-second-key");
	});

	/**
	 * Reusing the wrapping key would let disconnect-then-reconnect run with the same key, so an old
	 * ciphertext left somewhere would open in the new state.
	 */
	it("replacing issues new wrapping material", async () => {
		const alice = nextViewer("alice");
		const db = activateLocalDbScope(alice);
		const store = createProviderConnectionStore(db, alice);

		await store.connect("anthropic-byo", ANTHROPIC_KEY);
		const before = await db.providerConnections.get("anthropic-byo");
		await store.connect("anthropic-byo", "sk-ant-second-key");
		const after = await db.providerConnections.get("anthropic-byo");

		expect(after?.connectionId).not.toBe(before?.connectionId);
		expect(after?.wrapKey).not.toBe(before?.wrapKey);
		expect(Array.from(after?.iv ?? [])).not.toEqual(
			Array.from(before?.iv ?? []),
		);
		expect(Array.from(after?.ct ?? [])).not.toEqual(
			Array.from(before?.ct ?? []),
		);
	});

	/**
	 * Replacement overwrites a single row, so there is no window in which the connection disappears if
	 * it fails halfway.
	 */
	it("replacing keeps one connection", async () => {
		const store = open(nextViewer("alice"));
		await store.connect("anthropic-byo", ANTHROPIC_KEY);
		await store.connect("anthropic-byo", "sk-ant-second-key");
		expect(await store.list()).toHaveLength(1);
	});
});

describe("account isolation", () => {
	it("Alice's connections are not visible to Bob", async () => {
		const alice = nextViewer("alice");
		const bob = nextViewer("bob");

		await open(alice).connect("anthropic-byo", ANTHROPIC_KEY);
		resetLocalDbScope();

		expect(await open(bob).list()).toEqual([]);
		expect(await open(bob).has("anthropic-byo")).toBe(false);
	});

	/**
	 * Checking only one side would not distinguish this from a test that passes because both sides are
	 * empty. Each member connects a different provider, and neither may see the other's.
	 */
	it("two members have different connections", async () => {
		const alice = nextViewer("alice");
		const bob = nextViewer("bob");

		await open(alice).connect("anthropic-byo", ANTHROPIC_KEY);
		resetLocalDbScope();
		await open(bob).connect("gemini-byo", GEMINI_KEY);
		resetLocalDbScope();

		expect((await open(alice).list()).map((e) => e.provider)).toEqual([
			"anthropic-byo",
		]);
		resetLocalDbScope();
		expect((await open(bob).list()).map((e) => e.provider)).toEqual([
			"gemini-byo",
		]);
	});

	it("Bob cannot generate with Alice's key", async () => {
		const alice = nextViewer("alice");
		const bob = nextViewer("bob");

		await open(alice).connect("anthropic-byo", ANTHROPIC_KEY);
		resetLocalDbScope();

		expect(
			await access(bob).withCredential("anthropic-byo", async (v) => v),
		).toBeNull();
	});

	/**
	 * Logging out closes access but does not discard ownership. On the same device with the same
	 * account, the connection remains.
	 */
	it("signing back in as the same member keeps the connection", async () => {
		const alice = nextViewer("alice");
		await open(alice).connect("anthropic-byo", ANTHROPIC_KEY);
		resetLocalDbScope();

		expect(await open(alice).has("anthropic-byo")).toBe(true);
		expect(
			await access(alice).withCredential("anthropic-byo", async (v) => v),
		).toBe(ANTHROPIC_KEY);
	});
});

describe("not synced", () => {
	/**
	 * The second most important check in this file. If the credential gained a sync axis, it would
	 * reach the server as ciphertext. The server could not decrypt it, but that only makes the leak
	 * less severe.
	 */
	it("stored rows have no sync metadata", async () => {
		const alice = nextViewer("alice");
		const db = activateLocalDbScope(alice);
		await createProviderConnectionStore(db, alice).connect(
			"anthropic-byo",
			ANTHROPIC_KEY,
		);

		const row = await db.providerConnections.get("anthropic-byo");
		expect(row).toBeDefined();
		expect(row).not.toHaveProperty("dirty");
		expect(row).not.toHaveProperty("rev");
		expect(row).not.toHaveProperty("serverVersion");
		expect(row).not.toHaveProperty("deletedAt");
	});

	it("connecting, replacing and disconnecting create no push candidates", async () => {
		const alice = nextViewer("alice");
		const db = activateLocalDbScope(alice);
		const store = createProviderConnectionStore(db, alice);
		const sync = createDexieSyncStore(db, syncCodecRegistry);

		await store.connect("anthropic-byo", ANTHROPIC_KEY);
		await store.connect("anthropic-byo", "sk-ant-second-key");
		await store.connect("gemini-byo", GEMINI_KEY);
		await store.disconnect("gemini-byo");

		/**
		 * With `all: true`, collection ignores dirty and scans every record (the bootstrap path). The
		 * batch must still be empty, so the credential row never enters sync even on a full scan.
		 */
		const batch = await sync.collectOutbound({ limit: 100, all: true });
		expect(batch.records).toHaveLength(0);
	});

	/**
	 * Changing the generation target preference is the same case. If that axis synced, a device
	 * without a connection would receive a default it cannot use.
	 */
	it("changing the generation target creates no push candidates", async () => {
		const alice = nextViewer("alice");
		const db = activateLocalDbScope(alice);
		const preferences = createGenerationPreferenceStore(db);
		const sync = createDexieSyncStore(db, syncCodecRegistry);

		await preferences.setGlobal({
			responseLength: null,
			target: { provider: "anthropic-byo", model: "claude-sonnet-5" },
			reasoningEffort: null,
		});
		await preferences.setRoom("room-a", {
			responseLength: null,
			target: { provider: "gemini-byo", model: "gemini-3.7-flash" },
			reasoningEffort: null,
		});

		const batch = await sync.collectOutbound({ limit: 100, all: true });
		expect(batch.records).toHaveLength(0);
	});
});

describe("across tabs", () => {
	/**
	 * Credentials must not be cached at module scope. That rule is the whole point of this test: a
	 * cache would mean another tab's rotation or disconnect never reaches this one.
	 */
	it("the next request reads a key another tab replaced", async () => {
		const alice = nextViewer("alice");
		const tabA = access(alice);

		const tabBDb = new LocalDb(`rowcat_chat_${alice}`);
		const tabB = createProviderConnectionStore(tabBDb, alice);

		await tabB.connect("anthropic-byo", ANTHROPIC_KEY);
		expect(await tabA.withCredential("anthropic-byo", async (v) => v)).toBe(
			ANTHROPIC_KEY,
		);

		await tabB.connect("anthropic-byo", "sk-ant-second-key");
		expect(await tabA.withCredential("anthropic-byo", async (v) => v)).toBe(
			"sk-ant-second-key",
		);

		await tabB.disconnect("anthropic-byo");
		expect(
			await tabA.withCredential("anthropic-byo", async (v) => v),
		).toBeNull();

		tabBDb.close();
	});
});

describe("account deletion", () => {
	/**
	 * Credentials live in the same database as the member's other data. A separate IndexedDB would
	 * make account deletion a two-place operation, and a missed place would keep a deleted account's
	 * API key.
	 */
	it("deleting the database removes the credentials too", async () => {
		const alice = nextViewer("alice");
		await open(alice).connect("anthropic-byo", ANTHROPIC_KEY);

		const { deleteLocalDbForViewer } = await import("#/lib/local-data/db.ts");
		await deleteLocalDbForViewer(alice);

		expect(await open(alice).list()).toEqual([]);
	});
});
