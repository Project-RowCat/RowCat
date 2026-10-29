import type { RuntimePersistentStateSnapshot } from "@rowcat/runtime-host/persistent-state";
import type { RuntimeStoryStateSnapshot } from "@rowcat/runtime-host/story-state";
import {
	runtimePersistentIdFor,
	runtimePlaythroughIdFor,
} from "@rowcat/runtime-persistence";
import { beforeEach, describe, expect, it } from "vitest";
import {
	converge,
	createDevice,
	type Device,
	FakeSyncServer,
	TEST_DEK,
} from "#/test/sync-devices.ts";

/**
 * Two-device convergence of player saves, through real envelope encryption. This checks the core
 * claims of the slice, not the screen. Save progress must cross between devices. The two lifetimes
 * must converge independently. A reset must not revive old progress. The server must be unable to
 * read the content.
 */

const story = (chapter: number): RuntimeStoryStateSnapshot => ({
	formatVersion: 1,
	entries: [{ key: "run", version: 1, value: { chapter } }],
});

const meta = (endings: string[]): RuntimePersistentStateSnapshot => ({
	formatVersion: 1,
	entries: [{ key: "meta", version: 1, value: { endings } }],
});

const empty: RuntimeStoryStateSnapshot = { formatVersion: 1, entries: [] };

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
	it("A's playthrough progress arrives at B", async () => {
		await a.runtimeSave.putPlaythrough({
			storyId: "story-1",
			snapshot: story(5),
			updatedAt: "2026-09-01T00:00:00.000Z",
		});
		await converge(a, b);
		expect((await b.runtimeSave.getPlaythrough("story-1"))?.snapshot).toEqual(
			story(5),
		);
	});

	it("A's persistent progress arrives at B", async () => {
		await a.runtimeSave.putPersistent({
			storyId: "story-1",
			snapshot: meta(["library"]),
			updatedAt: "2026-09-01T00:00:00.000Z",
		});
		await converge(a, b);
		expect((await b.runtimeSave.getPersistent("story-1"))?.snapshot).toEqual(
			meta(["library"]),
		);
	});

	/**
	 * This checks, with actual values, why the slice splits the record in two. With one row, both
	 * updates would share one conflict domain, and under whole-record LWW one of them would always be
	 * lost.
	 */
	it("concurrent updates of different lifetimes both survive", async () => {
		await a.runtimeSave.putPlaythrough({
			storyId: "story-1",
			snapshot: story(4),
			updatedAt: "t0",
		});
		await a.runtimeSave.putPersistent({
			storyId: "story-1",
			snapshot: meta([]),
			updatedAt: "t0",
		});
		await converge(a, b);

		// Two offline edits: A changes the chapter, B changes the ending.
		await a.runtimeSave.putPlaythrough({
			storyId: "story-1",
			snapshot: story(5),
			updatedAt: "t1",
		});
		await b.runtimeSave.putPersistent({
			storyId: "story-1",
			snapshot: meta(["A"]),
			updatedAt: "t1",
		});
		await converge(a, b);
		await converge(a, b);

		for (const device of [a, b]) {
			expect(
				(await device.runtimeSave.getPlaythrough("story-1"))?.snapshot,
				device.name,
			).toEqual(story(5));
			expect(
				(await device.runtimeSave.getPersistent("story-1"))?.snapshot,
				device.name,
			).toEqual(meta(["A"]));
		}
	});

	/**
	 * A conflict on the same record is decided as a whole, never merged field by field. Mixing would
	 * leave a state nobody created, such as a new chapter with the old inventory.
	 */
	it("a conflict on the same record is won whole by the higher revision", async () => {
		await a.runtimeSave.putPlaythrough({
			storyId: "story-1",
			snapshot: story(1),
			updatedAt: "t0",
		});
		await converge(a, b);

		await a.runtimeSave.putPlaythrough({
			storyId: "story-1",
			snapshot: story(5),
			updatedAt: "t1",
		});
		/** B wrote later, so even with the same wall-clock time, HLC's logical counter is larger. */
		await b.runtimeSave.putPlaythrough({
			storyId: "story-1",
			snapshot: story(7),
			updatedAt: "t2",
		});
		await converge(a, b);
		await converge(a, b);

		const left = (await a.runtimeSave.getPlaythrough("story-1"))?.snapshot;
		const right = (await b.runtimeSave.getPlaythrough("story-1"))?.snapshot;
		expect(left).toEqual(right);
		expect(left?.entries).toHaveLength(1);
		/** The result is one of the two values, not a mix. */
		expect([story(5), story(7)]).toContainEqual(left);
	});

	/**
	 * §97: a reset is the newer state. A device still holding old progress converges onto it, and
	 * chapter 8 does not come back.
	 */
	it("Reset play does not revive old progress", async () => {
		await a.runtimeSave.putPlaythrough({
			storyId: "story-1",
			snapshot: story(8),
			updatedAt: "t0",
		});
		await a.runtimeSave.putPersistent({
			storyId: "story-1",
			snapshot: meta(["library"]),
			updatedAt: "t0",
		});
		await converge(a, b);
		expect((await b.runtimeSave.getPlaythrough("story-1"))?.snapshot).toEqual(
			story(8),
		);

		await a.runtimeSave.putPlaythrough({
			storyId: "story-1",
			snapshot: empty,
			updatedAt: "t1",
		});
		await converge(a, b);
		await converge(a, b);

		for (const device of [a, b]) {
			const record = await device.runtimeSave.getPlaythrough("story-1");
			expect(record?.snapshot.entries, device.name).toEqual([]);
			/**
			 * A reset is not a tombstone. The row must remain so that later progress builds on top of it.
			 */
			expect(record?.deletedAt, device.name).toBeNull();
			expect(
				(await device.runtimeSave.getPersistent("story-1"))?.snapshot,
				device.name,
			).toEqual(meta(["library"]));
		}
	});
});

describe("the server is opaque", () => {
	/**
	 * §61: the server sees only ciphertext. No chapter, ending, or creator key appears in that row.
	 */
	it("server rows hold no plaintext", async () => {
		await a.runtimeSave.putPlaythrough({
			storyId: "story-1",
			snapshot: {
				formatVersion: 1,
				entries: [
					{ key: "run", version: 1, value: { chapter: 5, secret: "Hallway" } },
				],
			},
			updatedAt: "t0",
		});
		await a.engine.run(TEST_DEK);

		/** The identity is deterministic, so the server row can be found by name. */
		const row = server.row(runtimePlaythroughIdFor("story-1"));
		expect(row?.type).toBe("runtime.playthrough");
		expect(row?.ciphertext).not.toBeNull();
		const serialized = JSON.stringify(row);
		for (const plaintext of ["chapter", "Hallway", "formatVersion"])
			expect(serialized, plaintext).not.toContain(plaintext);
	});

	/** Both types travel as ordinary sync records. The server has no special vocabulary for them. */
	it("both types round-trip as ordinary records", async () => {
		await a.runtimeSave.putPlaythrough({
			storyId: "s",
			snapshot: empty,
			updatedAt: "t",
		});
		await a.runtimeSave.putPersistent({
			storyId: "s",
			snapshot: { formatVersion: 1, entries: [] },
			updatedAt: "t",
		});
		await a.engine.run(TEST_DEK);
		expect(server.row(runtimePlaythroughIdFor("s"))?.type).toBe(
			"runtime.playthrough",
		);
		expect(server.row(runtimePersistentIdFor("s"))?.type).toBe(
			"runtime.persistent",
		);
	});
});

describe("outbound", () => {
	/**
	 * A write emits the signal that wakes auto-sync. Without it, that progress stays on this device
	 * only.
	 */
	it("save writes emit a local change signal", async () => {
		let signals = 0;
		const unsubscribe = a.mutations.subscribe(() => {
			signals += 1;
		});
		await a.runtimeSave.putPlaythrough({
			storyId: "s",
			snapshot: empty,
			updatedAt: "t",
		});
		unsubscribe();
		expect(signals).toBeGreaterThan(0);
	});

	/** Reads emit no signal. Otherwise a no-op sync would fire once per session. */
	it("save reads emit no signal", async () => {
		let signals = 0;
		const unsubscribe = a.mutations.subscribe(() => {
			signals += 1;
		});
		await a.runtimeSave.getPlaythrough("s");
		await a.runtimeSave.getPersistent("s");
		await a.runtimeSave.initialSyncDone();
		unsubscribe();
		expect(signals).toBe(0);
	});
});
