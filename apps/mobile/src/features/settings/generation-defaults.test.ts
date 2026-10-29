import {
	EMPTY_GENERATION_PREFERENCE,
	resolveEffectiveGeneration,
} from "@rowcat/chat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
	LocalScopeController,
	MobileLocalScope,
} from "../../lib/local-data/activation.ts";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../test/sqlite-node.ts";

/**
 * Which layer the default-generation setting is written to, checked on real SQLite. A test
 * confirming only that the settings value was saved proves nothing about this slice. Three
 * questions need answers:
 * - Which slot it is written to: global, not room. Overwriting a room override would erase what
 *   the user chose.
 * - What `Use default` means: it clears the override. Copying the value would not follow a change in
 *   the product default.
 * - Whether it syncs: no. Provider connections differ per device.
 */

const ALICE = "alice-viewer-id";

let temp: ReturnType<typeof createTempDirectory>;
let controller: LocalScopeController;
let scope: MobileLocalScope;

beforeEach(async () => {
	temp = createTempDirectory();
	controller = createTestScopeController(
		temp.path,
		createMemorySecureStorage(),
	);
	scope = await controller.activate(ALICE);
});

afterEach(async () => {
	await controller.release();
	temp.dispose();
});

const store = () => scope.stores.generation;

describe("writes to the global cell", () => {
	it("starts from empty preferences", async () => {
		expect(await store().getGlobal()).toEqual(EMPTY_GENERATION_PREFERENCE);
	});

	it("the chosen value is saved and remains after reopening", async () => {
		await store().setGlobal({
			...EMPTY_GENERATION_PREFERENCE,
			responseLength: "long",
		});
		await controller.release();

		const again = await controller.activate(ALICE);
		expect((await again.stores.generation.getGlobal()).responseLength).toBe(
			"long",
		);
	});

	/**
	 * **`Use default` does not copy the parent value.** Copying would tie that user alone to the old
	 * value the day the product default changes, and nothing on any screen would show it.
	 */
	it("reverting leaves null, not a value", async () => {
		await store().setGlobal({
			...EMPTY_GENERATION_PREFERENCE,
			responseLength: "long",
		});
		await store().setGlobal({
			...EMPTY_GENERATION_PREFERENCE,
			responseLength: null,
		});

		expect((await store().getGlobal()).responseLength).toBeNull();
	});

	/**
	 * Reverting one axis must not clear the others. That is why the screen sends the rest unchanged;
	 * the store deletes the row when given an empty preference.
	 */
	it("reverting one axis keeps the others", async () => {
		const target = { provider: "rowcat", model: "claude-sonnet-5" } as const;
		await store().setGlobal({
			...EMPTY_GENERATION_PREFERENCE,
			responseLength: "long",
			target,
		});
		await store().setGlobal({
			...(await store().getGlobal()),
			responseLength: null,
		});

		const saved = await store().getGlobal();
		expect(saved.responseLength).toBeNull();
		expect(saved.target).toEqual(target);
	});
});

describe("doesn't touch room overrides", () => {
	/**
	 * **P0.** Changing the global value does nothing to values already chosen per room. Overwriting
	 * them would silently erase the decision the user made for that conversation.
	 */
	it("changing the global leaves room overrides as is", async () => {
		await store().setRoom("Room1", {
			...EMPTY_GENERATION_PREFERENCE,
			responseLength: "short",
		});
		await store().setGlobal({
			...EMPTY_GENERATION_PREFERENCE,
			responseLength: "long",
		});

		expect((await store().getRoom("Room1")).responseLength).toBe("short");
	});

	/**
	 * **The shared resolver decides precedence.** This check is worth something because it confirms,
	 * through that function's answer, that the setting went to the right layer: a room with an
	 * override stays as it is, and only rooms without one follow the new default.
	 */
	it("only rooms without an override follow the new default", async () => {
		await store().setRoom("Room1", {
			...EMPTY_GENERATION_PREFERENCE,
			responseLength: "short",
		});
		await store().setGlobal({
			...EMPTY_GENERATION_PREFERENCE,
			responseLength: "long",
		});

		const global = await store().getGlobal();
		const overridden = resolveEffectiveGeneration({
			global,
			room: await store().getRoom("Room1"),
		});
		const plain = resolveEffectiveGeneration({
			global,
			room: await store().getRoom("Room2"),
		});

		expect(overridden.responseLength).toBe("short");
		expect(plain.responseLength).toBe("long");
	});
});

describe("isn't synced", () => {
	/**
	 * This value is **device-local**. If it went outbound, an Anthropic model picked on a Mac would
	 * arrive on another device with no connection, as a setting that device cannot use.
	 */
	it("the global preference doesn't ride outbound", async () => {
		await store().setGlobal({
			...EMPTY_GENERATION_PREFERENCE,
			responseLength: "long",
		});

		const outbound = await scope.stores.sync.collectOutbound({ limit: 50 });
		expect(outbound.records).toHaveLength(0);
	});
});

describe("account boundary", () => {
	/**
	 * A write aimed at the store of the old scope goes to a **closed connection**; a save started on
	 * Alice's screen does not complete in Bob's database.
	 */
	it("a write after an account switch fails", async () => {
		const stale = store();
		await controller.activate("bob-viewer-id");

		await expect(
			stale.setGlobal({
				...EMPTY_GENERATION_PREFERENCE,
				responseLength: "long",
			}),
		).rejects.toThrow();

		expect(await controller.current()?.stores.generation.getGlobal()).toEqual(
			EMPTY_GENERATION_PREFERENCE,
		);
	});
});
