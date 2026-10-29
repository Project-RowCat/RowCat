import { runtimeConversationIdFor } from "@rowcat/runtime-persistence";
import { beforeEach, describe, expect, it } from "vitest";
import {
	converge,
	createDevice,
	type Device,
	FakeSyncServer,
	TEST_DEK,
} from "#/test/sync-devices.ts";

/**
 * Two-device convergence of runtime library rows, through real envelope encryption. This slice
 * makes three claims. A work A opens reaches B's library. Removing an entry from the library
 * propagates without touching progress. Reopening after removal brings the entry back with the same
 * identity on both devices. The last claim is why this record does not use a tombstone (see the
 * header of `conversation.ts`).
 */

let server: FakeSyncServer;
let a: Device;
let b: Device;

beforeEach(() => {
	server = new FakeSyncServer();
	a = createDevice("a", server);
	b = createDevice("b", server);
	return () => {
		a.close();
		b.close();
	};
});

describe("two-device convergence", () => {
	it("a story A opened arrives in B's library", async () => {
		await a.runtimeConversation.touch({
			storyId: "story-1",
			title: "The Rewinding Night Shop",
			now: "2026-09-04T00:00:00.000Z",
		});
		await converge(a, b);
		const row = await b.runtimeConversation.get("story-1");
		expect(row?.title).toBe("The Rewinding Night Shop");
		expect(row?.createdAt).toBe("2026-09-04T00:00:00.000Z");
		expect((await b.runtimeConversation.list()).map((r) => r.id)).toEqual([
			runtimeConversationIdFor("story-1"),
		]);
		/** A library entry does not need a save row. B has neither a playthrough nor a persistent row. */
		expect(await b.runtimeSave.getPlaythrough("story-1")).toBeNull();
		expect(await b.runtimeSave.getPersistent("story-1")).toBeNull();
	});

	it("removal crosses over and progress stays", async () => {
		await a.runtimeSave.putPlaythrough({
			storyId: "story-1",
			snapshot: {
				formatVersion: 1,
				entries: [{ key: "run", version: 1, value: { chapter: 3 } }],
			},
			updatedAt: "t0",
		});
		await a.runtimeConversation.touch({
			storyId: "story-1",
			title: "Story",
			now: "t0",
		});
		await converge(a, b);
		expect(await b.runtimeConversation.list()).toHaveLength(1);

		await a.runtimeConversation.remove({ storyId: "story-1", now: "t1" });
		await converge(a, b);
		await converge(a, b);

		for (const device of [a, b]) {
			expect(await device.runtimeConversation.list(), device.name).toEqual([]);
			expect(
				(await device.runtimeConversation.get("story-1"))?.removedAt,
				device.name,
			).toBe("t1");
			/** Removing an entry from the list does not touch progress, on either device. */
			expect(
				(await device.runtimeSave.getPlaythrough("story-1"))?.snapshot.entries,
				device.name,
			).toEqual([{ key: "run", version: 1, value: { chapter: 3 } }]);
		}
	});

	/**
	 * Why this is a state and not a tombstone matters here. With a tombstone, B's reopen would arrive
	 * at A and be discarded as `keep-deleted`, so the entry would never return to A's library.
	 */
	it("reopened on another device after removal, it comes back with the same identity on both", async () => {
		const opened = await a.runtimeConversation.touch({
			storyId: "story-1",
			title: "Story",
			now: "t0",
		});
		await converge(a, b);
		await a.runtimeConversation.remove({ storyId: "story-1", now: "t1" });
		await converge(a, b);
		await converge(a, b);
		expect(await b.runtimeConversation.list()).toEqual([]);

		const revived = await b.runtimeConversation.touch({
			storyId: "story-1",
			title: null,
			now: "t2",
		});
		expect(revived.id).toBe(opened.id);
		expect(revived.createdAt).toBe("t0");
		await converge(a, b);
		await converge(a, b);

		for (const device of [a, b]) {
			const rows = await device.runtimeConversation.list();
			expect(
				rows.map((r) => r.id),
				device.name,
			).toEqual([opened.id]);
			expect(rows[0]?.removedAt, device.name).toBeNull();
			expect(rows[0]?.title, device.name).toBe("Story");
		}
	});

	it("a conflict on the same row is won whole by the higher revision", async () => {
		await a.runtimeConversation.touch({
			storyId: "s",
			title: "First",
			now: "t0",
		});
		await converge(a, b);
		await a.runtimeConversation.touch({
			storyId: "s",
			title: "A's title",
			now: "t1",
		});
		await b.runtimeConversation.remove({ storyId: "s", now: "t2" });
		await converge(a, b);
		await converge(a, b);
		const left = await a.runtimeConversation.get("s");
		const right = await b.runtimeConversation.get("s");
		expect(left).toEqual(right);
		/**
		 * The result is one of the two values, not a mix. The removed flag and the title do not win
		 * separately.
		 */
		expect(
			[
				{ title: "A's title", removedAt: null },
				{ title: "First", removedAt: "t2" },
			].some(
				(candidate) =>
					candidate.title === left?.title &&
					candidate.removedAt === left?.removedAt,
			),
		).toBe(true);
	});
});

describe("the server is opaque", () => {
	it("no title or timestamp in plaintext in server rows", async () => {
		await a.runtimeConversation.touch({
			storyId: "story-1",
			title: "A secret title",
			now: "2026-09-04T00:00:00.000Z",
		});
		await a.engine.run(TEST_DEK);
		const row = server.row(runtimeConversationIdFor("story-1"));
		expect(row?.type).toBe("runtime.conversation");
		expect(row?.ciphertext).not.toBeNull();
		const serialized = JSON.stringify(row);
		for (const plaintext of ["secret", "title", "2026-09-04", "createdAt"])
			expect(serialized, plaintext).not.toContain(plaintext);
	});
});

describe("outbound", () => {
	it("opening and removing emit local change signals and reading does not", async () => {
		let signals = 0;
		const unsubscribe = a.mutations.subscribe(() => {
			signals += 1;
		});
		await a.runtimeConversation.get("s");
		await a.runtimeConversation.list();
		expect(signals).toBe(0);
		await a.runtimeConversation.touch({ storyId: "s", title: "t", now: "t" });
		expect(signals).toBeGreaterThan(0);
		const afterTouch = signals;
		await a.runtimeConversation.remove({ storyId: "s", now: "t" });
		expect(signals).toBeGreaterThan(afterTouch);
		unsubscribe();
	});
});
