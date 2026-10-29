import type { GenerationPreference } from "@rowcat/chat";
import {
	EMPTY_GENERATION_PREFERENCE,
	PRODUCT_GENERATION_TARGET,
	PRODUCT_RESPONSE_LENGTH,
	resolveEffectiveGeneration,
} from "@rowcat/chat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../test/sqlite-node.ts";
import type { LocalScopeController, MobileLocalScope } from "./activation.ts";
import { TABLE_ORDER } from "./tables.ts";

/**
 * Device generation preferences: the contract for **a store that is not synced.**
 *
 * This file locks three things: whether precedence actually holds, whether accounts and rooms can
 * see each other, and **whether this value never enters the sync plane even once.** The last is the
 * quietest regression. A single line wrapping the preference in a sync signal compiles, the screen
 * looks fine, and the only symptom is an unnecessary sync going out every time settings change.
 */

let temp: ReturnType<typeof createTempDirectory>;
let controller: LocalScopeController;
let scope: MobileLocalScope;

beforeEach(async () => {
	temp = createTempDirectory();
	controller = createTestScopeController(
		temp.path,
		createMemorySecureStorage(),
	);
	scope = await controller.activate("alice");
});

afterEach(async () => {
	await controller.release();
	temp.dispose();
});

const store = () => scope.stores.generation;

const preference = (
	patch: Partial<GenerationPreference> = {},
): GenerationPreference => ({ ...EMPTY_GENERATION_PREFERENCE, ...patch });

const anthropic = {
	provider: "anthropic-byo",
	model: "claude-sonnet-5",
} as const;

describe("reading", () => {
	it("missing preferences are empty preferences — it doesn't throw", async () => {
		/**
		 * The reader for this value runs **just before generation**, so if a missing row threw, the user
		 * would see a broken conversation rather than a broken setting.
		 */
		expect(await store().getGlobal()).toEqual(EMPTY_GENERATION_PREFERENCE);
		expect(await store().getRoom("missing-room")).toEqual(
			EMPTY_GENERATION_PREFERENCE,
		);
	});

	it("a damaged target falls to not chosen", async () => {
		/**
		 * An unknown provider or broken JSON is read as **no override**. The layers above then apply, so
		 * the worst outcome is "same as before". Throwing would block that room's conversation entirely.
		 */
		await scope.db.run(
			`INSERT INTO generation_preference (key, version, response_length, target)
			 VALUES (?, 1, ?, ?)`,
			["room:broken", "notlong", '{"provider":"unknownprovider","model":"x"}'],
		);
		expect(await store().getRoom("damaged")).toEqual(
			EMPTY_GENERATION_PREFERENCE,
		);
	});

	/**
	 * A step removed from the vocabulary is also read as **no override**.
	 *
	 * This axis is special because its range of values depends on the model. Catalog changes and
	 * vocabulary changes can both happen. Passing the stored string through would send that value in
	 * the request, and the provider would reject it, so one setting would block a conversation.
	 */
	it("an unknown reasoning level falls to not chosen", async () => {
		await scope.db.run(
			`INSERT INTO generation_preference
			   (key, version, response_length, target, reasoning_effort)
			 VALUES (?, 1, NULL, NULL, ?)`,
			["room:reasoning", "insane"],
		);
		expect(await store().getRoom("reasoning")).toEqual(
			EMPTY_GENERATION_PREFERENCE,
		);
	});

	/** A row from a file created before the column existed is `NULL`, which means "not decided". */
	it("an empty reasoning column follows the parent", async () => {
		await scope.db.run(
			`INSERT INTO generation_preference (key, version, response_length, target)
			 VALUES (?, 1, ?, NULL)`,
			["global", "long"],
		);
		expect(await store().getGlobal()).toEqual({
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});
	});

	it("a row of an unknown version is ignored entirely", async () => {
		await scope.db.run(
			`INSERT INTO generation_preference (key, version, response_length, target)
			 VALUES (?, 99, ?, NULL)`,
			["global", "long"],
		);
		expect(await store().getGlobal()).toEqual(EMPTY_GENERATION_PREFERENCE);
	});
});

describe("writing", () => {
	/**
	 * If you forget to update `isEmptyGenerationPreference` when an axis is added, **a preference that
	 * chose only reasoning is deleted right after saving.** To the user it looks like "I chose it, but
	 * it did not save".
	 */
	it("choosing only reasoning keeps the row", async () => {
		await store().setRoom("Room1", {
			responseLength: null,
			target: null,
			reasoningEffort: "high",
		});
		expect(await store().getRoom("Room1")).toEqual({
			responseLength: null,
			target: null,
			reasoningEffort: "high",
		});
	});

	/** Reverting one axis does not erase the others. */
	it("clearing reasoning keeps the other axes", async () => {
		await store().setRoom("Room1", {
			responseLength: "long",
			target: null,
			reasoningEffort: "high",
		});
		await store().setRoom("Room1", {
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});
		expect(await store().getRoom("Room1")).toEqual({
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});
	});

	it("global and room each remain", async () => {
		await store().setGlobal(preference({ responseLength: "long" }));
		await store().setRoom("Room1", preference({ responseLength: "short" }));

		expect(await store().getGlobal()).toEqual(
			preference({ responseLength: "long" }),
		);
		expect(await store().getRoom("Room1")).toEqual(
			preference({ responseLength: "short" }),
		);
	});

	it("rooms don't see each other", async () => {
		await store().setRoom("Room1", preference({ target: anthropic }));
		expect(await store().getRoom("Room2")).toEqual(EMPTY_GENERATION_PREFERENCE);
	});

	it("the two axes don't erase each other", async () => {
		/**
		 * Reverting one axis to `Use default` must not erase the other. If it did, a person who picked a
		 * model would lose it at the moment they revert the response length.
		 */
		await store().setRoom(
			"Room1",
			preference({ responseLength: "long", target: anthropic }),
		);
		await store().setRoom("Room1", preference({ target: anthropic }));

		expect(await store().getRoom("Room1")).toEqual(
			preference({ target: anthropic }),
		);
	});

	/**
	 * **Never stores "not decided" as a value.** If it did, that would be indistinguishable from
	 * "never opened", and above all it would not follow when the product default changes. The user
	 * would be bound to a value they never chose.
	 */
	it("empty preferences delete the row", async () => {
		await store().setRoom("Room1", preference({ responseLength: "long" }));
		await store().setRoom("Room1", EMPTY_GENERATION_PREFERENCE);

		const rows = await scope.db.all(
			"SELECT key FROM generation_preference WHERE key = ?",
			["room:Room1"],
		);
		expect(rows).toHaveLength(0);
	});

	it("clearing the room override follows the parent", async () => {
		await store().setGlobal(preference({ responseLength: "short" }));
		await store().setRoom("Room1", preference({ responseLength: "long" }));
		await store().clearRoom("Room1");

		const effective = resolveEffectiveGeneration({
			global: await store().getGlobal(),
			room: await store().getRoom("Room1"),
		});
		expect(effective.responseLength).toBe("short");
		expect(effective.sources.responseLength).toBe("global");
	});

	/** Deletion can happen in two places at once, so the second call has no reason to fail. */
	it("clearing a missing room succeeds", async () => {
		await expect(store().clearRoom("missing-room")).resolves.toBeUndefined();
	});
});

describe("runtime story overrides", () => {
	/**
	 * Same table as rooms, **different prefix** (`runtime:`). The same string id must not see each
	 * other between a room and a runtime work, and the cleanup that deletes a room must not reach a
	 * work's value. The two values have different lifetimes. This is the counterpart of the web's same
	 * check.
	 */
	it("a room and a story with the same id don't see each other", async () => {
		await store().setRuntime("same-id", preference({ target: anthropic }));
		expect(await store().getRoom("same-id")).toEqual(
			EMPTY_GENERATION_PREFERENCE,
		);
		expect(await store().getRuntime("same-id")).toEqual(
			preference({ target: anthropic }),
		);
	});

	it("clearRoom doesn't clear the story's override", async () => {
		await store().setRuntime("Story1", preference({ reasoningEffort: "low" }));
		await store().clearRoom("Story1");
		expect(await store().getRuntime("Story1")).toEqual(
			preference({ reasoningEffort: "low" }),
		);
	});

	it("writing empty preferences removes the row", async () => {
		await store().setRuntime("Story1", preference({ reasoningEffort: "low" }));
		await store().setRuntime("Story1", EMPTY_GENERATION_PREFERENCE);
		const rows = await scope.db.all(
			"SELECT key FROM generation_preference WHERE key = ?",
			["runtime:Story1"],
		);
		expect(rows).toHaveLength(0);
	});

	/** Writes emit their own signal and do not wake sync. This is the same rule as room overrides. */
	it("writes emit only their own signal", async () => {
		let sync = 0;
		let changes = 0;
		const stopSync = scope.stores.mutations.subscribe(() => {
			sync += 1;
		});
		const stopChanges = scope.stores.preferences.subscribe(() => {
			changes += 1;
		});
		await store().setRuntime("Story1", preference({ target: anthropic }));
		await store().getRuntime("Story1");
		expect(sync).toBe(0);
		expect(changes).toBe(1);
		stopSync();
		stopChanges();
	});
});

describe("Priority", () => {
	it("room > global > product default", async () => {
		expect(
			resolveEffectiveGeneration({
				global: await store().getGlobal(),
				room: await store().getRoom("Room1"),
			}).responseLength,
		).toBe(PRODUCT_RESPONSE_LENGTH);

		await store().setGlobal(preference({ target: anthropic }));
		expect(
			resolveEffectiveGeneration({
				global: await store().getGlobal(),
				room: await store().getRoom("Room1"),
			}).target,
		).toEqual(anthropic);

		await store().setRoom(
			"Room1",
			preference({ target: PRODUCT_GENERATION_TARGET }),
		);
		const effective = resolveEffectiveGeneration({
			global: await store().getGlobal(),
			room: await store().getRoom("Room1"),
		});
		expect(effective.target).toEqual(PRODUCT_GENERATION_TARGET);
		expect(effective.sources.target).toBe("room");
	});
});

describe("account isolation", () => {
	/**
	 * One file per member. If Alice's preference were visible to Bob, the account boundary would be
	 * broken, and the symptom would be "a model I never chose is in my settings".
	 */
	it("other members can't see those preferences", async () => {
		await store().setRoom("Room1", preference({ target: anthropic }));

		const bob = await controller.activate("bob");
		expect(await bob.stores.generation.getRoom("Room1")).toEqual(
			EMPTY_GENERATION_PREFERENCE,
		);
	});

	it("coming back as the same member it's still there", async () => {
		await store().setRoom("Room1", preference({ responseLength: "long" }));
		await controller.activate("bob");
		const alice = await controller.activate("alice");

		expect(await alice.stores.generation.getRoom("Room1")).toEqual(
			preference({ responseLength: "long" }),
		);
	});
});

describe("doesn't enter the sync plane", () => {
	/**
	 * **This group is the point of this file.**
	 *
	 * A preference is tied to provider connections (BYO), and connections differ per device. If it
	 * were synced, a value picked on a Mac with Anthropic connected would arrive on a phone with no
	 * connection, and become **a default that cannot be used on that device.**
	 */
	it("not in the type vocabulary — the protocol doesn't know this value exists", () => {
		expect(TABLE_ORDER).not.toContain("chat.generationPreference");
		for (const type of TABLE_ORDER) expect(type).not.toMatch(/preference/i);
	});

	it("not a single sync column", async () => {
		const columns = await scope.db.all<{ name: string }>(
			"PRAGMA table_info(generation_preference)",
		);
		expect(columns.map((column) => column.name).sort()).toEqual([
			"key",
			"reasoning_effort",
			"response_length",
			"target",
			"version",
		]);
	});

	/**
	 * **Does not wake automatic sync.** If a preference write went out in `mutations`, changing the
	 * response length once would wake a sync with nothing to upload. That request is always wasted.
	 */
	it("writes emit no sync signal", async () => {
		let sync = 0;
		const stop = scope.stores.mutations.subscribe(() => {
			sync += 1;
		});

		await store().setGlobal(preference({ responseLength: "long" }));
		await store().setRoom("Room1", preference({ target: anthropic }));
		await store().clearRoom("Room1");

		expect(sync).toBe(0);
		stop();
	});

	/**
	 * Still, **the screen must update.** With no signal at all, the value just picked would not appear
	 * in the settings screen, so the preference has its own signal.
	 */
	it("they emit their own signal instead", async () => {
		let changes = 0;
		const stop = scope.stores.preferences.subscribe(() => {
			changes += 1;
		});

		await store().setGlobal(preference({ responseLength: "long" }));
		await store().setRoom("Room1", preference({ target: anthropic }));
		await store().clearRoom("Room1");
		expect(changes).toBe(3);

		/** Reads emit no signal. Reading is not a change. */
		await store().getGlobal();
		await store().getRoom("Room1");
		expect(changes).toBe(3);
		stop();
	});

	it("doesn't ride outbound", async () => {
		await store().setGlobal(preference({ responseLength: "long" }));
		await store().setRoom("Room1", preference({ target: anthropic }));

		const outbound = await scope.stores.sync.collectOutbound({ limit: 50 });
		expect(outbound.records).toHaveLength(0);
	});
});
