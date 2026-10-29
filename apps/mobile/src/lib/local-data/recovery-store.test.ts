import type { AuthoringStore, StoryDraft } from "@rowcat/authoring";
import { restoreDraftConflict } from "@rowcat/authoring";
import type { SyncStore } from "@rowcat/sync";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { wireEntry } from "../../test/inbound.ts";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../test/sqlite-node.ts";
import type { LocalScopeController } from "./activation.ts";
import { createMobileDraftRecoveryStore } from "./recovery-store.ts";
import type { MobileDatabase } from "./sqlite.ts";

/**
 * Checks the SQLite implementation of the recovery copy: that it fills **the same contract as the
 * web Dexie implementation**.
 *
 * The rules belong to the shared package (what is kept, what restore does). What this file checks
 * is only this platform's persistence: it survives reopening the file, the same loss does not
 * become two rows, and **it is invisible once the account changes.**
 */

let temp: ReturnType<typeof createTempDirectory>;
let controller: LocalScopeController;
let authoring: AuthoringStore;
let sync: SyncStore;
let db: MobileDatabase;

beforeEach(async () => {
	temp = createTempDirectory();
	controller = createTestScopeController(
		temp.path,
		createMemorySecureStorage(),
	);
	const scope = await controller.activate("alice");
	authoring = scope.stores.authoring;
	sync = scope.stores.sync;
	db = scope.db;
});

afterEach(async () => {
	await controller.release();
	temp.dispose();
});

const later = (rev: StoryDraft["rev"], ms: number): StoryDraft["rev"] => ({
	t: rev.t + ms,
	c: 0,
	d: "device-b",
});

/**
 * Builds a version where another device **edited the same group concurrently**.
 *
 * Written by hand because this app has no two-device harness (the web's `sync-devices.ts` fills
 * that role). What is checked here is not the protocol but **what this repository leaves behind
 * from that event**. The inbound entry is built through the real codec (`wireEntry`).
 */
async function divergedRemote(): Promise<{
	draft: StoryDraft;
	remote: StoryDraft;
}> {
	const created = await authoring.createDraft({ prompt: "Original" });
	// This device edits; the change is not uploaded yet (dirty).
	const draft = (await authoring.updateDraft(created.id, {
		prompt: "This device's prompt",
	})) as StoryDraft;
	const remoteRev = later(draft.rev, 5000);
	return {
		draft,
		remote: {
			...draft,
			prompt: "Another device's prompt",
			fieldRev: { ...draft.fieldRev, body: remoteRev },
			rev: remoteRev,
			updatedAt: "2099-01-01T00:00:00.000Z",
		},
	};
}

const applyRemote = (remote: StoryDraft, version: number, cursor: number) =>
	sync.applyPull({
		entries: [wireEntry({ type: "authoring.draft", record: remote, version })],
		cursor,
	});

describe("archive", () => {
	it("the losing group's value remains and the canonical value converges to remote", async () => {
		const { draft, remote } = await divergedRemote();
		const result = await applyRemote(remote, 1, 1);

		expect(result.recovered).toBe(1);
		expect((await authoring.getDraft(draft.id))?.prompt).toBe(
			"Another device's prompt",
		);

		const preserved = await createMobileDraftRecoveryStore(db).list();
		expect(preserved).toHaveLength(1);
		expect(preserved[0]).toMatchObject({
			draftId: draft.id,
			group: "body",
			values: { prompt: "This device's prompt" },
		});
	});

	it("reapplying the same page still leaves one copy", async () => {
		const { remote } = await divergedRemote();
		const first = await applyRemote(remote, 1, 1);
		const second = await applyRemote(remote, 1, 1);

		expect(first.recovered).toBe(1);
		expect(second.recovered).toBe(0);
		expect(await createMobileDraftRecoveryStore(db).list()).toHaveLength(1);
	});

	it("closing and reopening the connection keeps the copy", async () => {
		const { remote } = await divergedRemote();
		await applyRemote(remote, 1, 1);
		const before = await createMobileDraftRecoveryStore(db).list();

		await controller.release();
		const scope = await controller.activate("alice");
		const after = await createMobileDraftRecoveryStore(scope.db).list();
		expect(after).toEqual(before);
	});
});

describe("account isolation", () => {
	it("switching accounts hides the previous person's copy", async () => {
		const { remote } = await divergedRemote();
		await applyRemote(remote, 1, 1);
		expect(await createMobileDraftRecoveryStore(db).list()).toHaveLength(1);

		/**
		 * Each member has its own file. If the copy lived outside member scope (AsyncStorage, global
		 * state), the person who switches accounts would see the previous person's manuscript. This
		 * checks that absence by value.
		 */
		const bob = await controller.activate("bob");
		expect(await createMobileDraftRecoveryStore(bob.db).list()).toEqual([]);
	});
});

describe("restore and discard", () => {
	it("restore goes through the ordinary authoring write path and clears the copy", async () => {
		const { draft, remote } = await divergedRemote();
		await applyRemote(remote, 1, 1);
		const store = createMobileDraftRecoveryStore(db);
		const [recovery] = await store.list();

		const outcome = await restoreDraftConflict(
			{ authoring, recovery: store },
			recovery,
		);
		expect(outcome.status).toBe("restored");

		const restored = (await authoring.getDraft(draft.id)) as StoryDraft;
		expect(restored.prompt).toBe("This device's prompt");
		// Takes a new revision and goes up again. It is not an old revision brought back.
		expect(restored.fieldRev.body.t).toBeGreaterThanOrEqual(remote.rev.t);
		expect(restored.dirty).toBe(1);
		expect(await store.list()).toEqual([]);
	});

	it("the copy stays readable even when the draft disappears", async () => {
		const { draft, remote } = await divergedRemote();
		await applyRemote(remote, 1, 1);
		await authoring.deleteDraft(draft.id);

		const store = createMobileDraftRecoveryStore(db);
		const [recovery] = await store.list();
		expect(recovery.values.prompt).toBe("This device's prompt");

		const outcome = await restoreDraftConflict(
			{ authoring, recovery: store },
			recovery,
		);
		expect(outcome.status).toBe("missing");
		expect(await store.list()).toHaveLength(1);
	});

	it("discard deletes only the copy", async () => {
		const { draft, remote } = await divergedRemote();
		await applyRemote(remote, 1, 1);
		const store = createMobileDraftRecoveryStore(db);
		const [recovery] = await store.list();
		const before = await authoring.getDraft(draft.id);

		await store.discard(recovery.id);

		expect(await store.list()).toEqual([]);
		expect(await authoring.getDraft(draft.id)).toEqual(before);
	});
});
