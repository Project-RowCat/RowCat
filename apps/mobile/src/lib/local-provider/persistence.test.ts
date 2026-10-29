import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../test/sqlite-node.ts";
import type { LocalScopeController } from "../local-data/activation.ts";
import { viewerDatabaseName } from "../local-data/database.ts";
import { deleteLocalDataForViewer } from "../local-data/purge.ts";
import { deviceKeyEntry } from "../local-sync/device-key.ts";
import { providerCredentialEntry } from "./record.ts";

/**
 * Where the provider API key **is, and is not**: a round trip on real SQLite.
 *
 * `store.test.ts` guards the port's contract, and this file guards **the storage medium**. Breaking
 * any one of the three below still compiles, and all three are P0:
 *
 * ```text
 * secret written to SQLite   the API key stays in a plaintext file (carried into backups and diagnostic tools)
 * secret synced              the user's key goes up to the server, which breaks the definition of BYO
 * missed by cleanup          the key stays on the device of someone who believes they deleted it
 * ```
 *
 * No mocks: "the file lacks that string" is a question that can only be asked of a real file.
 * `isolation.test.ts` uses the same harness for the same reason.
 */

const ALICE = "alice-viewer-id";
const BOB = "bob-viewer-id";
/** A conspicuous value, so that when the file is searched the match is unambiguous. */
const SECRET = "SUPER-SECRET-ANTHROPIC-TEST-VALUE";
const BOB_SECRET = "BOB-SECRET-GEMINI-TEST-VALUE";
const DEK = new Uint8Array(32).fill(7);

let temp: ReturnType<typeof createTempDirectory>;
let secure: ReturnType<typeof createMemorySecureStorage>;
let controller: LocalScopeController;

beforeEach(() => {
	temp = createTempDirectory();
	secure = createMemorySecureStorage();
	controller = createTestScopeController(temp.path, secure);
});

afterEach(async () => {
	await controller.release();
	temp.dispose();
});

/** Goes through the same assembly as the product: it uses only the store the scope built, with no shortcut. */
async function connectAnthropic(viewerId: string, secret: string) {
	const scope = await controller.activate(viewerId);
	await scope.stores.providers.connect("anthropic-byo", secret);
	return scope;
}

describe("secrets never touch SQLite", () => {
	/**
	 * **P0.** Reads the database file as bytes and checks that the string is absent. Inspecting the
	 * schema for "no such column" is not enough: whatever the column is named, if the value is written
	 * the file still contains it.
	 */
	it("the database file has no API key", async () => {
		const scope = await connectAnthropic(ALICE, SECRET);
		/** Also writes ordinary data into the same scope, so the file is actually in use. */
		await scope.stores.chat.createPersona({ name: "role", description: "" });
		await controller.release();

		const file = readFileSync(join(temp.path, viewerDatabaseName(ALICE)));
		expect(file.includes(Buffer.from(SECRET))).toBe(false);
		expect(file.includes(Buffer.from("anthropic-byo"))).toBe(false);
	});

	/** The reverse check: the secret must be in the **secret store**. */
	it("the secret store has it", async () => {
		await connectAnthropic(ALICE, SECRET);
		const stored = secure
			.entries()
			.get(providerCredentialEntry(ALICE, "anthropic-byo"));
		expect(stored).toBeDefined();
		expect(stored).toContain(SECRET);
	});

	/**
	 * The schema has no place for it either. The check above looks at values; this one looks at the
	 * **shape**. If a column appears, it breaks here even before any value exists.
	 */
	it("the schema has no provider credentials table", async () => {
		const scope = await controller.activate(ALICE);
		const tables = await scope.db.all<{ name: string; sql: string | null }>(
			"SELECT name, sql FROM sqlite_master WHERE type = 'table'",
			[],
		);
		for (const table of tables) {
			expect(table.name).not.toMatch(/provider|credential|api_key/i);
			expect(table.sql ?? "").not.toMatch(/api_key|secret|credential/i);
		}
	});
});

describe("secrets don't ride on sync", () => {
	/**
	 * **P0.** Collects the entire outbound set and checks that it holds no provider record and no
	 * secret string. Every operation (connect, replace, disconnect) is run, because doing only one of
	 * them to create a record would still send the user's key to the server.
	 */
	it("nothing to upload grows after connecting, replacing or unlinking", async () => {
		const scope = await controller.activate(ALICE);
		/** Compares only while there is something to upload: an empty outbound set proves nothing. */
		await scope.stores.chat.createPersona({ name: "role", description: "" });
		const before = await scope.stores.sync.collectOutbound({ limit: 500 });

		await scope.stores.providers.connect("anthropic-byo", SECRET);
		await scope.stores.providers.connect("anthropic-byo", `${SECRET}-2`);
		await scope.stores.providers.connect("gemini-byo", "gm");
		await scope.stores.providers.disconnect("gemini-byo");

		const after = await scope.stores.sync.collectOutbound({ limit: 500 });
		expect(after.records.length).toBe(before.records.length);

		const serialized = JSON.stringify(after.records);
		expect(serialized).not.toContain(SECRET);
		expect(serialized).not.toContain("anthropic-byo");
		expect(serialized).not.toContain("gemini-byo");
		for (const record of after.records)
			expect(record.type).not.toMatch(/provider|credential/);
	});
});

describe("cleanup deletes provider keys too", () => {
	/**
	 * **Local reset and account deletion pass through the same function**
	 * (`deleteLocalDataForViewer`), so this one check guards both paths. Had each written its own,
	 * this would check only one, and the missed one would show up only as "a key remains on the device
	 * of someone who believed they deleted it".
	 */
	it("this member's provider keys, sync key and database disappear together", async () => {
		const scope = await connectAnthropic(ALICE, SECRET);
		await scope.stores.providers.connect("gemini-byo", "gm-secret");
		await scope.stores.deviceKey.remember(DEK);
		await controller.release();

		await deleteLocalDataForViewer(ALICE, {
			async deleteDatabase(name) {
				const { rmSync } = await import("node:fs");
				rmSync(join(temp.path, name), { force: true });
			},
			secureStorage: secure,
			/** The cover slot is not this harness's concern: when called it does nothing. */
			deleteDraftCovers: () => undefined,
		});

		expect(
			secure.entries().has(providerCredentialEntry(ALICE, "anthropic-byo")),
		).toBe(false);
		expect(
			secure.entries().has(providerCredentialEntry(ALICE, "gemini-byo")),
		).toBe(false);
		expect(secure.entries().has(deviceKeyEntry(ALICE))).toBe(false);
	});

	/**
	 * **This is where the rule of not sweeping by prefix earns its keep.** What gets deleted is
	 * deterministically derived names, and another member of the same device is not in that list.
	 */
	it("Bob's provider key stays", async () => {
		await connectAnthropic(ALICE, SECRET);
		const bob = await controller.activate(BOB);
		await bob.stores.providers.connect("gemini-byo", BOB_SECRET);
		await controller.release();

		await deleteLocalDataForViewer(ALICE, {
			async deleteDatabase(name) {
				const { rmSync } = await import("node:fs");
				rmSync(join(temp.path, name), { force: true });
			},
			secureStorage: secure,
			/** The cover slot is not this harness's concern: when called it does nothing. */
			deleteDraftCovers: () => undefined,
		});

		const after = await controller.activate(BOB);
		expect(await after.stores.providers.has("gemini-byo")).toBe(true);
		expect(
			secure.entries().get(providerCredentialEntry(BOB, "gemini-byo")),
		).toContain(BOB_SECRET);
	});

	/** Must be re-runnable after a partial failure: deleting an absent entry counts as success. */
	it("running it twice doesn't fail", async () => {
		await connectAnthropic(ALICE, SECRET);
		await controller.release();
		const targets = {
			async deleteDatabase(name: string) {
				const { rmSync } = await import("node:fs");
				rmSync(join(temp.path, name), { force: true });
			},
			secureStorage: secure,
			/** The cover slot is not this harness's concern: when called it does nothing. */
			deleteDraftCovers: () => undefined,
		};
		await deleteLocalDataForViewer(ALICE, targets);
		await expect(
			deleteLocalDataForViewer(ALICE, targets),
		).resolves.toBeUndefined();
	});
});

describe("when the scope changes the store instance changes too", () => {
	/**
	 * The reason ownership checks compare **instances** rather than member ids. In `Alice → sign out →
	 * Alice` the id is the same, but in between the scope closed and reopened, and an operation
	 * started on the old instance must not be saved into the new session (the ownership recheck in
	 * `connect-provider.ts`).
	 */
	it("Alice → sign out → Alice splits the instance", async () => {
		const first = await controller.activate(ALICE);
		const firstStore = first.stores.providers;
		await controller.release();

		const second = await controller.activate(ALICE);
		expect(second.stores.providers).not.toBe(firstStore);
		expect(controller.current()?.stores.providers).toBe(
			second.stores.providers,
		);
		expect(controller.current()?.stores.providers).not.toBe(firstStore);
	});

	/** The connection signal is a **different instance** from the signal that wakes sync. */
	it("the connection signal is a different axis from the write and preference signals", async () => {
		const scope = await controller.activate(ALICE);
		expect(scope.stores.providerConnections).not.toBe(scope.stores.mutations);
		expect(scope.stores.providerConnections).not.toBe(scope.stores.preferences);

		let mutations = 0;
		let preferences = 0;
		let connections = 0;
		scope.stores.mutations.subscribe(() => {
			mutations += 1;
		});
		scope.stores.preferences.subscribe(() => {
			preferences += 1;
		});
		scope.stores.providerConnections.subscribe(() => {
			connections += 1;
		});

		await scope.stores.providers.connect("anthropic-byo", SECRET);
		await scope.stores.providers.disconnect("anthropic-byo");

		expect(connections).toBe(2);
		/** **Does not wake a sync that has nothing to upload.** */
		expect(mutations).toBe(0);
		expect(preferences).toBe(0);
	});

	/** Reads emit no signal: this prevents an endless read → signal → read loop. */
	it("list lookups emit no signal", async () => {
		const scope = await controller.activate(ALICE);
		let connections = 0;
		scope.stores.providerConnections.subscribe(() => {
			connections += 1;
		});
		await scope.stores.providers.list();
		await scope.stores.providers.get("anthropic-byo");
		await scope.stores.providers.has("anthropic-byo");
		expect(connections).toBe(0);
	});
});
