import type { RuntimePersistentStateSnapshot } from "@rowcat/runtime-host/persistent-state";
import type { RuntimeStoryStateSnapshot } from "@rowcat/runtime-host/story-state";
import { describe, expect, it } from "vitest";
import { runtimePersistentIdFor, runtimePlaythroughIdFor } from "./model.ts";
import type { RuntimeSaveStore } from "./store.ts";

/**
 * Behavior suite for the save port. Dexie on web and SQLite on mobile must pass the same checks.
 * The suite exists because review cannot see the two adapters diverge when each has its own tests.
 * One side might set dirty while the other does not, advance the revision differently, or fold
 * tombstones to null. The symptom of such a split is 'progress disappears only on the phone'. What
 * the suite does not measure is also deliberate: slow writes, failed writes, and corrupt rows
 * cannot be made deterministic on a real store, so the in-memory implementation (testing.ts) covers
 * them.
 */

export interface RuntimeSaveStoreContractOptions {
	/** Adapter name. Failure messages must say which platform failed. */
	name: string;
	/**
	 * Returns a fresh, empty store for each check. Reusing one instance would make the checks depend
	 * on order.
	 */
	create(): Promise<{
		store: RuntimeSaveStore;
		/** Reopens the same data. Durability is a property of the medium, not of the instance. */
		reopen(): Promise<RuntimeSaveStore>;
		dispose(): Promise<void>;
	}>;
}

const story = (chapter: number): RuntimeStoryStateSnapshot => ({
	formatVersion: 1,
	entries: [{ key: "run", version: 1, value: { chapter } }],
});

const meta = (endings: string[]): RuntimePersistentStateSnapshot => ({
	formatVersion: 1,
	entries: [{ key: "meta", version: 1, value: { endings } }],
});

export function runtimeSaveStoreContract(
	options: RuntimeSaveStoreContractOptions,
): void {
	describe(`RuntimeSaveStore contract: ${options.name}`, () => {
		it("a missing save is null", async () => {
			const harness = await options.create();
			try {
				expect(await harness.store.getPlaythrough("story-1")).toBeNull();
				expect(await harness.store.getPersistent("story-1")).toBeNull();
			} finally {
				await harness.dispose();
			}
		});

		it("the first write sets a deterministic identity, dirty and a revision", async () => {
			const harness = await options.create();
			try {
				const record = await harness.store.putPlaythrough({
					storyId: "story-1",
					snapshot: story(1),
					updatedAt: "2026-09-01T00:00:00.000Z",
				});
				expect(record.id).toBe(runtimePlaythroughIdFor("story-1"));
				expect(record.slot).toBe("default");
				expect(record.dirty).toBe(1);
				expect(record.serverVersion).toBe(0);
				expect(record.deletedAt).toBeNull();
				expect(record.rev.t).toBeGreaterThan(0);
				expect(record.rev.d.length).toBeGreaterThan(0);

				const persistent = await harness.store.putPersistent({
					storyId: "story-1",
					snapshot: meta(["a"]),
					updatedAt: "2026-09-01T00:00:00.000Z",
				});
				expect(persistent.id).toBe(runtimePersistentIdFor("story-1"));
			} finally {
				await harness.dispose();
			}
		});

		it("overwriting advances the revision", async () => {
			const harness = await options.create();
			try {
				const first = await harness.store.putPlaythrough({
					storyId: "story-1",
					snapshot: story(1),
					updatedAt: "a",
				});
				const second = await harness.store.putPlaythrough({
					storyId: "story-1",
					snapshot: story(2),
					updatedAt: "b",
				});
				expect(second.id).toBe(first.id);
				expect(second.snapshot).toEqual(story(2));
				expect(
					second.rev.t > first.rev.t ||
						(second.rev.t === first.rev.t && second.rev.c > first.rev.c),
				).toBe(true);
				const read = await harness.store.getPlaythrough("story-1");
				expect(read?.snapshot).toEqual(story(2));
			} finally {
				await harness.dispose();
			}
		});

		it("writing an empty snapshot keeps the row rather than tombstoning it", async () => {
			const harness = await options.create();
			try {
				await harness.store.putPlaythrough({
					storyId: "story-1",
					snapshot: story(5),
					updatedAt: "a",
				});
				const reset = await harness.store.putPlaythrough({
					storyId: "story-1",
					snapshot: { formatVersion: 1, entries: [] },
					updatedAt: "b",
				});
				expect(reset.deletedAt).toBeNull();
				expect(reset.snapshot.entries).toEqual([]);
			} finally {
				await harness.dispose();
			}
		});

		it("the two lifetimes do not overwrite each other", async () => {
			const harness = await options.create();
			try {
				await harness.store.putPlaythrough({
					storyId: "story-1",
					snapshot: story(5),
					updatedAt: "a",
				});
				await harness.store.putPersistent({
					storyId: "story-1",
					snapshot: meta(["library"]),
					updatedAt: "a",
				});
				await harness.store.putPlaythrough({
					storyId: "story-1",
					snapshot: { formatVersion: 1, entries: [] },
					updatedAt: "b",
				});
				expect(
					(await harness.store.getPersistent("story-1"))?.snapshot,
				).toEqual(meta(["library"]));
			} finally {
				await harness.dispose();
			}
		});

		it("each story has its own row", async () => {
			const harness = await options.create();
			try {
				await harness.store.putPlaythrough({
					storyId: "story-1",
					snapshot: story(1),
					updatedAt: "a",
				});
				await harness.store.putPlaythrough({
					storyId: "story-2",
					snapshot: story(2),
					updatedAt: "a",
				});
				expect(
					(await harness.store.getPlaythrough("story-1"))?.snapshot,
				).toEqual(story(1));
				expect(
					(await harness.store.getPlaythrough("story-2"))?.snapshot,
				).toEqual(story(2));
			} finally {
				await harness.dispose();
			}
		});

		/**
		 * Durability is a property of the medium, not of the instance. Reading again from the same object
		 * proves nothing, because a memory cache can answer.
		 */
		it("survives reopening", async () => {
			const harness = await options.create();
			try {
				await harness.store.putPlaythrough({
					storyId: "story-1",
					snapshot: story(9),
					updatedAt: "a",
				});
				await harness.store.putPersistent({
					storyId: "story-1",
					snapshot: meta(["end"]),
					updatedAt: "a",
				});
				const reopened = await harness.reopen();
				expect((await reopened.getPlaythrough("story-1"))?.snapshot).toEqual(
					story(9),
				);
				expect((await reopened.getPersistent("story-1"))?.snapshot).toEqual(
					meta(["end"]),
				);
			} finally {
				await harness.dispose();
			}
		});
	});
}

import type { RuntimeConversationStore } from "./conversation.ts";
import { runtimeConversationIdFor } from "./conversation.ts";

/** Whether revision b was issued after revision a. Uses the same (t, c) order as compareRev. */
const revisionAdvanced = (
	a: { t: number; c: number },
	b: { t: number; c: number },
): boolean => b.t > a.t || (b.t === a.t && b.c > a.c);

export interface RuntimeConversationStoreContractOptions {
	name: string;
	create(): Promise<{
		store: RuntimeConversationStore;
		reopen(): Promise<RuntimeConversationStore>;
		dispose(): Promise<void>;
	}>;
}

/**
 * Behavior suite for the library-metadata port. Memory, Dexie, and SQLite must pass the same
 * checks. It locks this slice's product rules. The first open creates the row. Reopening does not
 * add a row. createdAt is preserved. Removal touches only the row, not progress. Reopening restores
 * a removed row under the same identity. If one adapter differs, the symptom is 'the list shows two
 * rows only on the phone', which review would miss.
 */
export function runtimeConversationStoreContract(
	options: RuntimeConversationStoreContractOptions,
): void {
	describe(`RuntimeConversationStore contract: ${options.name}`, () => {
		it("a missing row is null and the list is empty", async () => {
			const harness = await options.create();
			try {
				expect(await harness.store.get("story-1")).toBeNull();
				expect(await harness.store.list()).toEqual([]);
			} finally {
				await harness.dispose();
			}
		});

		it("the first open sets a deterministic identity, dirty, a revision and createdAt", async () => {
			const harness = await options.create();
			try {
				const record = await harness.store.touch({
					storyId: "story-1",
					title: "The Convenience Store That Rewinds the Night",
					now: "2026-09-01T00:00:00.000Z",
				});
				expect(record.id).toBe(runtimeConversationIdFor("story-1"));
				expect(record.slot).toBe("default");
				expect(record.title).toBe(
					"The Convenience Store That Rewinds the Night",
				);
				expect(record.createdAt).toBe("2026-09-01T00:00:00.000Z");
				expect(record.updatedAt).toBe("2026-09-01T00:00:00.000Z");
				expect(record.removedAt).toBeNull();
				expect(record.deletedAt).toBeNull();
				expect(record.dirty).toBe(1);
				expect(record.serverVersion).toBe(0);
				expect(record.rev.t).toBeGreaterThan(0);
			} finally {
				await harness.dispose();
			}
		});

		it("reopening adds no row, keeps createdAt and updates updatedAt and the title", async () => {
			const harness = await options.create();
			try {
				const first = await harness.store.touch({
					storyId: "story-1",
					title: "first title",
					now: "2026-09-01T00:00:00.000Z",
				});
				const second = await harness.store.touch({
					storyId: "story-1",
					title: "edited title",
					now: "2026-09-02T00:00:00.000Z",
				});
				expect(second.id).toBe(first.id);
				expect(second.createdAt).toBe("2026-09-01T00:00:00.000Z");
				expect(second.updatedAt).toBe("2026-09-02T00:00:00.000Z");
				expect(second.title).toBe("edited title");
				/**
				 * Two writes in the same millisecond share t, and c increases. Compare them by the HLC total
				 * order.
				 */
				expect(revisionAdvanced(first.rev, second.rev)).toBe(true);
				expect(await harness.store.list()).toHaveLength(1);
			} finally {
				await harness.dispose();
			}
		});

		it("an open that doesn't know the title clears the known title", async () => {
			const harness = await options.create();
			try {
				await harness.store.touch({
					storyId: "story-1",
					title: "known title",
					now: "a",
				});
				const record = await harness.store.touch({
					storyId: "story-1",
					title: null,
					now: "b",
				});
				expect(record.title).toBe("known title");
			} finally {
				await harness.dispose();
			}
		});

		it("the list is by recent activity, with id descending on ties", async () => {
			const harness = await options.create();
			try {
				await harness.store.touch({ storyId: "a", title: "A", now: "t1" });
				await harness.store.touch({ storyId: "c", title: "C", now: "t2" });
				await harness.store.touch({ storyId: "b", title: "B", now: "t2" });
				expect((await harness.store.list()).map((r) => r.storyId)).toEqual([
					"c",
					"b",
					"a",
				]);
			} finally {
				await harness.dispose();
			}
		});

		it("removing takes the row out of the list but keeps the record, and reopening revives it with the same identity", async () => {
			const harness = await options.create();
			try {
				const opened = await harness.store.touch({
					storyId: "story-1",
					title: "story",
					now: "t1",
				});
				const removed = await harness.store.remove({
					storyId: "story-1",
					now: "t2",
				});
				expect(removed?.id).toBe(opened.id);
				expect(removed?.removedAt).toBe("t2");
				/** Not a protocol tombstone. It must stay restorable (see the conversation.ts header). */
				expect(removed?.deletedAt).toBeNull();
				expect(removed?.dirty).toBe(1);
				expect(
					removed !== null && revisionAdvanced(opened.rev, removed.rev),
				).toBe(true);
				expect(await harness.store.list()).toEqual([]);
				expect((await harness.store.get("story-1"))?.removedAt).toBe("t2");

				const revived = await harness.store.touch({
					storyId: "story-1",
					title: null,
					now: "t3",
				});
				expect(revived.id).toBe(opened.id);
				expect(revived.removedAt).toBeNull();
				expect(revived.createdAt).toBe(opened.createdAt);
				expect(revived.title).toBe("story");
				expect((await harness.store.list()).map((r) => r.id)).toEqual([
					opened.id,
				]);
			} finally {
				await harness.dispose();
			}
		});

		it("removing a missing row does nothing", async () => {
			const harness = await options.create();
			try {
				expect(
					await harness.store.remove({ storyId: "story-1", now: "t" }),
				).toBeNull();
				expect(await harness.store.get("story-1")).toBeNull();
			} finally {
				await harness.dispose();
			}
		});

		it("survives reopening: durability is a property of the medium", async () => {
			const harness = await options.create();
			try {
				await harness.store.touch({
					storyId: "story-1",
					title: "a lasting row",
					now: "t1",
				});
				const reopened = await harness.reopen();
				expect((await reopened.get("story-1"))?.title).toBe("a lasting row");
				expect(await reopened.list()).toHaveLength(1);
			} finally {
				await harness.dispose();
			}
		});
	});
}
