import type { DraftConflictRecovery, StoryDraft } from "@rowcat/authoring";
import { restoreDraftConflict } from "@rowcat/authoring";
import { compareRev } from "@rowcat/sync";
import { afterEach, describe, expect, it } from "vitest";
import {
	converge,
	createDevice,
	type Device,
	FakeSyncServer,
	TEST_DEK,
} from "#/test/sync-devices.ts";
import { createDraftRecoveryStore } from "./store.ts";

/**
 * Save and restore of recovery copies, run against real Dexie. The pure rules are tested in
 * @rowcat/authoring. This file checks what those rules leave in the real store: whether a restore
 * gets a new revision, whether the record becomes dirty, and whether other groups stay untouched.
 * The pure layer cannot check these, because the store issues the values.
 */

let devices: Device[] = [];
const spawn = (server: FakeSyncServer, name: string): Device => {
	const device = createDevice(name, server);
	devices.push(device);
	return device;
};

afterEach(() => {
	for (const device of devices) device.close();
	devices = [];
});

/**
 * Creates a fork in which device A loses its prompt, and A also fixes the title in the meantime.
 * The title is there on purpose: checking that restore works per group needs a value that must not
 * be reverted. It has to change after the copy exists, because the slice promises that restore does
 * not revert a later title.
 */
async function preparedConflict(): Promise<{
	device: Device;
	draftId: string;
	recovery: DraftConflictRecovery;
}> {
	const server = new FakeSyncServer();
	const a = spawn(server, "a");
	const b = spawn(server, "b");

	const draft = await a.authoring.createDraft({
		prompt: "Original",
		title: "Original title",
	});
	await converge(a, b);

	await a.authoring.updateDraft(draft.id, { prompt: "A's prompt" });
	const clock = await b.db.syncState.get("state");
	if (clock) await b.db.syncState.put({ ...clock, hlcT: clock.hlcT + 2000 });
	await b.authoring.updateDraft(draft.id, { prompt: "B's prompt" });
	await b.engine.run(TEST_DEK);
	await a.engine.run(TEST_DEK);

	const [recovery] = await createDraftRecoveryStore(a.db).list();
	if (!recovery) throw new Error("no copy was made");
	return { device: a, draftId: draft.id, recovery };
}

const restore = (device: Device, recovery: DraftConflictRecovery) =>
	restoreDraftConflict(
		{
			authoring: device.authoring,
			recovery: createDraftRecoveryStore(device.db),
		},
		recovery,
	);

describe("restore", () => {
	it("the recovered value goes in as **a new edit**; the old revision does not revive", async () => {
		const { device, draftId, recovery } = await preparedConflict();
		const before = (await device.authoring.getDraft(draftId)) as StoryDraft;

		const outcome = await restore(device, recovery);
		expect(outcome.status).toBe("restored");

		const after = (await device.authoring.getDraft(draftId)) as StoryDraft;
		expect(after.prompt).toBe("A's prompt");
		/**
		 * Expects a new revision. Reviving the old revision recorded on the copy would send the record
		 * with a clock behind what the server knows. The other device would ignore it as a replay, and
		 * the recovered text would exist only on this device.
		 */
		expect(compareRev(after.fieldRev.body, before.fieldRev.body)).toBe(1);
		expect(compareRev(after.fieldRev.body, recovery.losingRev)).toBe(1);
		// Restored content goes back up like an ordinary edit.
		expect(after.dirty).toBe(1);
	});

	it("**only that group** changes; other later edits stay", async () => {
		const { device, draftId, recovery } = await preparedConflict();
		await device.authoring.updateDraft(draftId, {
			title: "Title written later",
		});
		const before = (await device.authoring.getDraft(draftId)) as StoryDraft;

		await restore(device, recovery);

		const after = (await device.authoring.getDraft(draftId)) as StoryDraft;
		expect(after.title).toBe("Title written later");
		expect(after.prompt).toBe("A's prompt");
		expect(after.fieldRev.meta).toEqual(before.fieldRev.meta);
		expect(after.fieldRev.rating).toEqual(before.fieldRev.rating);
		expect(after.fieldRev.defaults).toEqual(before.fieldRev.defaults);
		expect(after.fieldRev.publication).toEqual(before.fieldRev.publication);
		expect(after.publishedStoryId).toBe(before.publishedStoryId);
	});

	it("success clears the copy", async () => {
		const { device, recovery } = await preparedConflict();
		await restore(device, recovery);
		expect(await createDraftRecoveryStore(device.db).list()).toEqual([]);
	});

	it("without the draft it restores nothing and **the copy stays**", async () => {
		const { device, draftId, recovery } = await preparedConflict();
		await device.authoring.deleteDraft(draftId);

		const outcome = await restore(device, recovery);
		expect(outcome.status).toBe("missing");
		/**
		 * Does not rebuild the draft in place. The copy holds one group's value only, so a draft made
		 * from it would have every other part empty. The content must still be readable as-is.
		 */
		expect(await createDraftRecoveryStore(device.db).list()).toHaveLength(1);
		expect(await device.authoring.getDraft(draftId)).toBeNull();
	});
});

describe("discard", () => {
	it("only the copy goes; the canonical draft does not change a character", async () => {
		const { device, draftId, recovery } = await preparedConflict();
		const before = (await device.authoring.getDraft(draftId)) as StoryDraft;

		await createDraftRecoveryStore(device.db).discard(recovery.id);

		expect(await createDraftRecoveryStore(device.db).list()).toEqual([]);
		expect(await device.authoring.getDraft(draftId)).toEqual(before);
	});

	it("discarding a missing copy succeeds", async () => {
		const { device } = await preparedConflict();
		await expect(
			createDraftRecoveryStore(device.db).discard("missing copy"),
		).resolves.toBeUndefined();
	});
});

describe("reads", () => {
	it("returns only that draft's copies", async () => {
		const { device, draftId } = await preparedConflict();
		const store = createDraftRecoveryStore(device.db);
		expect(await store.listForDraft(draftId)).toHaveLength(1);
		expect(await store.listForDraft("other-draft")).toEqual([]);
	});
});
