import { beforeEach, describe, expect, it } from "vitest";
import { createMemorySecureStorage } from "../../test/sqlite-node.ts";
import {
	PROVIDER_CREDENTIAL_VERSION,
	providerCredentialEntry,
} from "./record.ts";
import {
	createProviderConnectionStore,
	createProviderCredentialAccess,
} from "./store.ts";

/**
 * Provider connection store: where secrets live and who reads them.
 *
 * `expo-secure-store` is not mocked. What plugs in here is a string-to-string map
 * (`createMemorySecureStorage`), and what actually runs on top of it are the rules this file
 * guards: entry naming, format versioning, read conventions, and the split between summaries and
 * secrets. Whether the Keychain really stores values is not this layer's question; that claim
 * belongs to simulator QA (the header of `local-sync/device-key.ts` made the same call).
 *
 * The failures targeted here are all silent:
 *
 * ```text
 * a secret leaks into a summary        API keys end up in screen state and diagnostic snapshots
 * entry names collapse across members  Bob reads Alice's key
 * a corrupt entry throws               the settings screen dies and the user cannot reconnect
 * a future format is half-read         the failure looks like "the key is wrong"
 * ```
 */

const ALICE = "alice-viewer-id";
const BOB = "bob-viewer-id";
const SECRET_A = "sk-alice-SUPER-SECRET-ANTHROPIC-TEST-VALUE";
const SECRET_B = "sk-bob-SUPER-SECRET-ANTHROPIC-TEST-VALUE";

let secure: ReturnType<typeof createMemorySecureStorage>;

beforeEach(() => {
	secure = createMemorySecureStorage();
});

const aliceStore = () => createProviderConnectionStore(secure, ALICE);
const aliceAccess = () => createProviderCredentialAccess(secure, ALICE);

describe("connecting and unlinking", () => {
	it("nothing is connected at first", async () => {
		const store = aliceStore();
		expect(await store.list()).toEqual([]);
		expect(await store.get("anthropic-byo")).toBeNull();
		expect(await store.has("anthropic-byo")).toBe(false);
	});

	it("connecting creates a summary", async () => {
		const store = aliceStore();
		await store.connect("anthropic-byo", SECRET_A);

		const summary = await store.get("anthropic-byo");
		expect(summary?.provider).toBe("anthropic-byo");
		expect(summary?.connected).toBe(true);
		expect(await store.has("anthropic-byo")).toBe(true);
	});

	/**
	 * **P0.** If a summary carries the secret, the value travels through React state and diagnostic
	 * snapshots. The test counts the whole key set rather than checking named fields, because when
	 * fields are added later this check must still catch them ("no sensitive fields" would let a new
	 * field pass).
	 */
	it("the summary has no secret", async () => {
		const store = aliceStore();
		await store.connect("anthropic-byo", SECRET_A);

		const summary = await store.get("anthropic-byo");
		expect(Object.keys(summary ?? {}).sort()).toEqual([
			"connected",
			"provider",
			"updatedAt",
		]);
		expect(JSON.stringify(summary)).not.toContain(SECRET_A);
		expect(JSON.stringify(await store.list())).not.toContain(SECRET_A);
	});

	it("connecting two makes a list of two", async () => {
		const store = aliceStore();
		await store.connect("anthropic-byo", SECRET_A);
		await store.connect("gemini-byo", "gm-secret");

		expect((await store.list()).map((row) => row.provider).sort()).toEqual([
			"anthropic-byo",
			"gemini-byo",
		]);
	});

	it("unlinking removes only that provider", async () => {
		const store = aliceStore();
		await store.connect("anthropic-byo", SECRET_A);
		await store.connect("gemini-byo", "gm-secret");

		await store.disconnect("anthropic-byo");

		expect((await store.list()).map((row) => row.provider)).toEqual([
			"gemini-byo",
		]);
	});

	/** Pressing twice really happens, so removing a missing connection succeeds. */
	it("unlinking a missing connection succeeds", async () => {
		const store = aliceStore();
		await expect(store.disconnect("anthropic-byo")).resolves.toBeUndefined();
		await store.connect("anthropic-byo", SECRET_A);
		await store.disconnect("anthropic-byo");
		await expect(store.disconnect("anthropic-byo")).resolves.toBeUndefined();
		expect(await store.has("anthropic-byo")).toBe(false);
	});

	/**
	 * Replacement overwrites. If the old entry is removed first and writing the new one fails in
	 * between, the connection is left gone, and the user loses it while trying to replace the key.
	 */
	it("replacing the key switches to the new secret", async () => {
		const store = aliceStore();
		await store.connect("anthropic-byo", SECRET_A);
		await store.connect("anthropic-byo", "sk-second");

		const seen = await aliceAccess().withCredential(
			"anthropic-byo",
			async (secret) => secret,
		);
		expect(seen).toBe("sk-second");
		expect((await store.list()).length).toBe(1);
	});

	/** An empty value has nothing to ask the provider about and nothing worth storing. */
	it("an empty secret isn't saved", async () => {
		const store = aliceStore();
		await expect(store.connect("anthropic-byo", "   ")).rejects.toThrow();
		expect(await store.has("anthropic-byo")).toBe(false);
	});

	/** Keys copied from the console arrive with a trailing newline, and that one character becomes a 401. */
	it("trims leading and trailing spaces before saving", async () => {
		await aliceStore().connect("anthropic-byo", `  ${SECRET_A}\n`);
		expect(
			await aliceAccess().withCredential("anthropic-byo", async (s) => s),
		).toBe(SECRET_A);
	});

	/**
	 * Reopening the store object reads the same entry. This checks that entry names are deterministic;
	 * reopening the app after a restart is the real case.
	 */
	it("the connection remains after reopening", async () => {
		await aliceStore().connect("anthropic-byo", SECRET_A);
		expect(
			await createProviderConnectionStore(secure, ALICE).has("anthropic-byo"),
		).toBe(true);
	});
});

describe("a damaged entry is the same as no connection", () => {
	const entry = providerCredentialEntry(ALICE, "anthropic-byo");

	/** Does not throw. Throwing would fail the whole settings screen and remove the chance to reconnect. */
	it("broken JSON", async () => {
		await secure.set(entry, "{not json");
		expect(await aliceStore().get("anthropic-byo")).toBeNull();
		expect(await aliceStore().list()).toEqual([]);
	});

	/** Reading a future format partially makes the failure indistinguishable from "the key is wrong". */
	it("unknown version", async () => {
		await secure.set(
			entry,
			JSON.stringify({
				version: PROVIDER_CREDENTIAL_VERSION + 1,
				provider: "anthropic-byo",
				connectionId: "c1",
				updatedAt: "2026-01-01T00:00:00.000Z",
				secret: SECRET_A,
			}),
		);
		expect(await aliceStore().get("anthropic-byo")).toBeNull();
		expect(
			await aliceAccess().withCredential("anthropic-byo", async (s) => s),
		).toBeNull();
	});

	it("the secret is empty", async () => {
		await secure.set(
			entry,
			JSON.stringify({
				version: PROVIDER_CREDENTIAL_VERSION,
				provider: "anthropic-byo",
				connectionId: "c1",
				updatedAt: "",
				secret: "",
			}),
		);
		expect(await aliceStore().get("anthropic-byo")).toBeNull();
	});

	/**
	 * The other provider's key is copied into this slot. Sending a request with that value would hand
	 * the user's secret to a provider they did not choose, which is why the entry name and the
	 * provider name inside the value are compared together.
	 */
	it("an entry with a mismatched provider name", async () => {
		await secure.set(
			entry,
			JSON.stringify({
				version: PROVIDER_CREDENTIAL_VERSION,
				provider: "gemini-byo",
				connectionId: "c1",
				updatedAt: "",
				secret: SECRET_A,
			}),
		);
		expect(await aliceStore().get("anthropic-byo")).toBeNull();
		expect(
			await aliceAccess().withCredential("anthropic-byo", async (s) => s),
		).toBeNull();
	});
});

describe("member isolation", () => {
	/**
	 * **P0.** Bob fetching the key Alice stored on the same device is cross-account credential
	 * leakage. The point is to check through the real port rather than enumerating entry names; the
	 * same fact is caught even if the naming rule changes.
	 */
	it("each sees only their own", async () => {
		await createProviderConnectionStore(secure, ALICE).connect(
			"anthropic-byo",
			SECRET_A,
		);
		await createProviderConnectionStore(secure, BOB).connect(
			"anthropic-byo",
			SECRET_B,
		);

		expect(
			await createProviderCredentialAccess(secure, ALICE).withCredential(
				"anthropic-byo",
				async (s) => s,
			),
		).toBe(SECRET_A);
		expect(
			await createProviderCredentialAccess(secure, BOB).withCredential(
				"anthropic-byo",
				async (s) => s,
			),
		).toBe(SECRET_B);
	});

	it("one side's unlink doesn't touch the other", async () => {
		await createProviderConnectionStore(secure, ALICE).connect(
			"anthropic-byo",
			SECRET_A,
		);
		await createProviderConnectionStore(secure, BOB).connect(
			"anthropic-byo",
			SECRET_B,
		);

		await createProviderConnectionStore(secure, ALICE).disconnect(
			"anthropic-byo",
		);

		expect(
			await createProviderConnectionStore(secure, ALICE).has("anthropic-byo"),
		).toBe(false);
		expect(
			await createProviderConnectionStore(secure, BOB).has("anthropic-byo"),
		).toBe(true);
	});

	/**
	 * The entry name must not contain the member id in plain text. Names appear in backups and
	 * diagnostic tools, and a member identifier has no business there (same judgment as
	 * `deviceKeyEntry`). Avoiding a character-replacement scheme is also guarded here: if two members
	 * fold to the same name, the leak above happens.
	 */
	it("entry names don't reveal the member id and differ from each other", () => {
		const a = providerCredentialEntry(ALICE, "anthropic-byo");
		const b = providerCredentialEntry(BOB, "anthropic-byo");
		expect(a).not.toContain(ALICE);
		expect(b).not.toContain(BOB);
		expect(a).not.toBe(b);
		/** The same member's two providers also differ, so exactly one entry can be removed. */
		expect(a).not.toBe(providerCredentialEntry(ALICE, "gemini-byo"));
		/** Deterministic: the same member logging in again opens the same entry. */
		expect(providerCredentialEntry(ALICE, "anthropic-byo")).toBe(a);
	});

	/** Does not reuse the sync key's name space; this is a different security domain. */
	it("doesn't overlap the sync key's namespace", () => {
		expect(providerCredentialEntry(ALICE, "anthropic-byo")).toMatch(
			/^rowcat\.provider\./,
		);
		expect(providerCredentialEntry(ALICE, "anthropic-byo")).not.toContain(
			"rowcat.sync.dek.",
		);
	});
});

describe("runtime accessor", () => {
	/** With no connection the callback is **not called**; the layer above treats this as "not connected". */
	it("without a connection the callback doesn't run", async () => {
		let called = 0;
		const result = await aliceAccess().withCredential(
			"anthropic-byo",
			async () => {
				called += 1;
				return "x";
			},
		);
		expect(called).toBe(0);
		expect(result).toBeNull();
	});

	/**
	 * Read at execution time. Caching would mean a key just replaced never reaches this execution.
	 */
	it("reads from the store again every time", async () => {
		const access = aliceAccess();
		await aliceStore().connect("anthropic-byo", "first");
		expect(await access.withCredential("anthropic-byo", async (s) => s)).toBe(
			"first",
		);

		await aliceStore().connect("anthropic-byo", "second");
		expect(await access.withCredential("anthropic-byo", async (s) => s)).toBe(
			"second",
		);

		await aliceStore().disconnect("anthropic-byo");
		expect(
			await access.withCredential("anthropic-byo", async (s) => s),
		).toBeNull();
	});

	/** Per provider: a Gemini connection does not satisfy an Anthropic request. */
	it("another provider's connection doesn't stand in", async () => {
		await aliceStore().connect("gemini-byo", "gm-secret");
		expect(
			await aliceAccess().withCredential("anthropic-byo", async (s) => s),
		).toBeNull();
	});
});
