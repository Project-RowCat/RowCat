import type { ChatSeed } from "@rowcat/chat";
import { CHAT_SEED_VERSION } from "@rowcat/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildEntries,
	converge,
	createDevice,
	type Device,
	FakeSyncServer,
	TEST_DEK,
} from "#/test/sync-devices.ts";

/**
 * Two-device round trips, the core of the protocol. Each test checks that the user's draft
 * survives, not just that the code runs. Silent breakage here shows nothing on screen. It surfaces
 * later as a lost draft when two devices meet, by which point it is too late.
 */

const seed = (title: string): ChatSeed => ({
	version: CHAT_SEED_VERSION,
	storyId: "story-1",
	title,
	tagline: "",
	adult: false,
	promptProtected: false,
	scenario: "Scenario",
	firstScene: "",
	playGuide: "",
	persona: null,
	characters: [],
	lore: [],
	startScenes: [],
	sceneImages: [],
});

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

describe("basic propagation", () => {
	it("a room A made arrives at B as is", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");

		const room = await a.chat.createRoom({
			originStoryId: "story-1",
			seed: seed("The Night Library"),
			title: "The Night Library",
		});
		await converge(a, b);

		const mirrored = await b.chat.getRoom(room.id);
		expect(mirrored).not.toBeNull();
		expect(mirrored?.title).toBe("The Night Library");
		// The playthrough snapshot is carried over too. A room must be self-contained.
		expect(mirrored?.seed).toEqual(room.seed);
		expect(mirrored?.createdAt).toBe(room.createdAt);
	});

	it("messages arrive and the room's activity time rises with them", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Conversation"),
		});
		await converge(a, b);
		const before = (await b.chat.getRoom(room.id))?.updatedAt;

		await a.chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "hello",
		});
		await converge(a, b);

		const messages = await b.chat.listRecentMessages(room.id);
		expect(messages.map((m) => m.content)).toEqual(["hello"]);
		// If the list sort key does not follow the update, B keeps the room that was just used in its old
		// position.
		expect((await b.chat.getRoom(room.id))?.updatedAt).not.toBe(before);
	});

	it("generation metadata (cache accounting included) crosses over as is", async () => {
		/**
		 * The screen never reads this value, so a drop here causes no visible symptom. Only the other
		 * device's copy of the same message loses its basis, which surfaces later when billing is
		 * attached.
		 *
		 * This also tests the claim that adding an optional field does not break compatibility. The codec
		 * version stays at 1.
		 */
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Accounting"),
		});

		await a.chat.appendMessage({
			roomId: room.id,
			role: "assistant",
			content: "Response",
			model: "anthropic/claude-sonnet-5",
			inputTokens: 7_100,
			cachedInputTokens: 5_000,
			cacheWriteInputTokens: 2_000,
			outputTokens: 250,
		});
		await converge(a, b);

		const [mirrored] = await b.chat.listRecentMessages(room.id);
		expect(mirrored).toMatchObject({
			model: "anthropic/claude-sonnet-5",
			inputTokens: 7_100,
			cachedInputTokens: 5_000,
			cacheWriteInputTokens: 2_000,
			outputTokens: 250,
		});
	});

	it("a message without cache accounting does not gain that axis", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("No accounting"),
		});

		await a.chat.appendMessage({
			roomId: room.id,
			role: "assistant",
			content: "Response",
			model: "test/model",
			outputTokens: 12,
		});
		await converge(a, b);

		const [mirrored] = await b.chat.listRecentMessages(room.id);
		expect(mirrored).not.toHaveProperty("cachedInputTokens");
		expect(mirrored).not.toHaveProperty("cacheWriteInputTokens");
		expect(mirrored).not.toHaveProperty("inputTokens");
	});

	it("a draft and two kinds of children cross over as a graph", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");

		const draft = await a.authoring.createDraft({ title: "Manuscript" });
		await a.authoring.createLore(draft.id, { content: "World" });
		await a.authoring.createStartScene(draft.id, { title: "Opening" });
		await converge(a, b);

		expect((await b.authoring.getDraft(draft.id))?.title).toBe("Manuscript");
		expect(await b.authoring.listLore(draft.id)).toHaveLength(1);
		expect(
			(await b.authoring.listStartScenes(draft.id)).map((s) => s.title),
		).toEqual(["Opening"]);
		// The first scene, set as the default opening, carries over too.
		const mirrored = await b.authoring.getDraft(draft.id);
		expect(mirrored?.defaultStartSceneId).not.toBeNull();
	});

	it("the edit applies and the receiver ends clean", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const draft = await a.authoring.createDraft({ title: "First" });
		await converge(a, b);

		await a.authoring.updateDraft(draft.id, { title: "Edited" });
		await converge(a, b);

		expect((await b.authoring.getDraft(draft.id))?.title).toBe("Edited");
		const row = await b.db.storyDrafts.get(draft.id);
		expect(row?.dirty).toBe(0);
		expect(row?.serverVersion).toBeGreaterThan(0);
	});

	it("a clean record is not pushed again", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		await a.chat.createRoom({ originStoryId: null, seed: seed("Only once") });
		await a.engine.run(TEST_DEK);
		const pushesAfterFirst = server.pushes.length;

		await a.engine.run(TEST_DEK);
		await a.engine.run(TEST_DEK);
		expect(server.pushes.length).toBe(pushesAfterFirst);
	});

	it("a propagated deletion disappears from B's normal reads", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Room to delete"),
		});
		await a.chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Text",
		});
		await converge(a, b);
		expect(await b.chat.getRoom(room.id)).not.toBeNull();

		await a.chat.deleteRoom(room.id);
		await converge(a, b);

		expect(await b.chat.getRoom(room.id)).toBeNull();
		expect(await b.chat.listRooms()).toHaveLength(0);
		// Children are hidden too: one room tombstone stands in for the whole subtree.
		expect(await b.chat.listRecentMessages(room.id)).toHaveLength(0);
	});

	it("deleting a room uploads **only one** tombstone", async () => {
		/**
		 * A room can hold thousands of messages. A tombstone per message would turn one delete into
		 * thousands of pushed records. The receiving device re-running the same cascade is the other half
		 * of the design.
		 */
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Big room"),
		});
		for (let i = 0; i < 5; i++)
			await a.chat.appendMessage({
				roomId: room.id,
				role: "user",
				content: `${i}`,
			});
		await a.engine.run(TEST_DEK);
		server.pushes.length = 0;

		await a.chat.deleteRoom(room.id);
		await a.engine.run(TEST_DEK);

		const pushed = server.pushes.flat();
		expect(pushed).toHaveLength(1);
		expect(pushed[0]).toMatchObject({
			type: "chat.room",
			deleted: true,
			ciphertext: null,
		});
	});
});

describe("conflicts", () => {
	it("editing different records separately **keeps both**", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const first = await a.authoring.createDraft({ title: "One" });
		const second = await a.authoring.createDraft({ title: "Two" });
		await converge(a, b);

		await a.authoring.updateDraft(first.id, { title: "Edited by A" });
		await b.authoring.updateDraft(second.id, { title: "Edited by B" });
		await converge(a, b);
		await converge(a, b);

		for (const device of [a, b]) {
			expect((await device.authoring.getDraft(first.id))?.title).toBe(
				"Edited by A",
			);
			expect((await device.authoring.getDraft(second.id))?.title).toBe(
				"Edited by B",
			);
		}
	});

	it("A edits the title, B the prompt: **both survive** (field groups)", async () => {
		/**
		 * This test covers all of field-group merging. With record-level LWW, one of two concurrent edits
		 * would silently disappear. A draft is the hardest asset in this product to restore.
		 */
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const draft = await a.authoring.createDraft({
			title: "Original",
			prompt: "Original",
		});
		await converge(a, b);

		// Both devices edited the same draft offline.
		await a.authoring.updateDraft(draft.id, {
			title: "Title edited on the phone",
		});
		await b.authoring.updateDraft(draft.id, {
			prompt: "Prompt written on the laptop",
		});

		await converge(a, b);
		await converge(a, b);

		for (const device of [a, b]) {
			const merged = await device.authoring.getDraft(draft.id);
			expect(merged?.title).toBe("Title edited on the phone");
			expect(merged?.prompt).toBe("Prompt written on the laptop");
		}
	});

	it("concurrent edits to the same group converge to one winner and leave a diagnostic", async () => {
		/**
		 * Here one side's value is really lost. v1 accepts that loss but records a diagnostic so it can
		 * be shown on screen. The discarded value stays as a local copy. Its rules and limits are covered
		 * in `recovery.test.ts`. This test only checks that the canonical value converges to a single
		 * result.
		 */
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const draft = await a.authoring.createDraft({ prompt: "Original" });
		await converge(a, b);

		/**
		 * B edits first and A edits later. When `converge` pushes A first, B is still dirty when the
		 * remote change arrives, so it takes the merge path. Reversing the order makes B's copy newer, so
		 * it falls into the stale-inbound path instead. There the signal comes from the protocol, not the
		 * domain codec. Both are checked below.
		 */
		await b.authoring.updateDraft(draft.id, { prompt: "B's prompt" });
		/**
		 * Advance A's logical clock by one second. Both devices share the same process wall clock. If
		 * they edit in the same millisecond, the winner is decided by the random device UUID and the test
		 * becomes flaky. The test checks whether a diagnostic is recorded, not who wins, so the clock
		 * axis is fixed.
		 */
		const clock = await a.db.syncState.get("state");
		if (clock) await a.db.syncState.put({ ...clock, hlcT: clock.hlcT + 1000 });
		await a.authoring.updateDraft(draft.id, { prompt: "A's prompt" });
		await converge(a, b);
		await converge(a, b);

		const fromA = (await a.authoring.getDraft(draft.id))?.prompt;
		const fromB = (await b.authoring.getDraft(draft.id))?.prompt;
		expect(fromA).toBe(fromB);
		expect(["A's prompt", "B's prompt"]).toContain(fromA);
		/**
		 * The point is that the diagnostic is recorded. A draft was really lost, so this counter reports
		 * how often such events happen. Restoring the lost value is done by a separate path next to it
		 * (`docs/sync/ARCHITECTURE.md` §19.5).
		 */
		const notes = [...a.diagnostics, ...b.diagnostics].filter(
			(event) => event.kind === "note",
		);
		expect(notes.map((event) => event.code)).toContain(
			"authoring_draft_group_conflict",
		);
	});

	it("a complete message beats an incomplete one **regardless of HLC**", async () => {
		/**
		 * Only one realistic case has two devices writing the same message id: one device's stream is cut
		 * off and saved as `incomplete`, while the other device produces a complete copy. In that case
		 * the longer, complete version is correct. This rule must sit above HLC, because the cut-off may
		 * be finalized later.
		 */
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
		});
		const message = await a.chat.appendMessage({
			roomId: room.id,
			role: "assistant",
			content: "This is a complete answer",
		});
		await converge(a, b);

		// B finalizes the incomplete version later, so under HLC B wins.
		await b.chat.updateMessage(message.id, {
			content: "Cut",
			incomplete: true,
		});
		await converge(a, b);
		await converge(a, b);

		for (const device of [a, b]) {
			const [stored] = await device.chat.listRecentMessages(room.id);
			expect(stored.content).toBe("This is a complete answer");
			expect(stored.incomplete).toBeUndefined();
		}
	});

	it("the same message complete on both sides converges to one HLC winner", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
		});
		const message = await a.chat.appendMessage({
			roomId: room.id,
			role: "assistant",
			content: "Original",
		});
		await converge(a, b);

		await a.chat.updateMessage(message.id, { content: "A's version" });
		await b.chat.updateMessage(message.id, { content: "B's version" });
		await converge(a, b);
		await converge(a, b);

		const fromA = (await a.chat.listRecentMessages(room.id))[0].content;
		const fromB = (await b.chat.listRecentMessages(room.id))[0].content;
		expect(fromA).toBe(fromB);
		expect(["A's version", "B's version"]).toContain(fromA);
	});

	it("a room's immutable fields stay the first writer's and only the title competes", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const room = await a.chat.createRoom({
			originStoryId: "story-1",
			seed: seed("Original snapshot"),
			title: "Original title",
		});
		await converge(a, b);

		await b.chat.appendMessage({ roomId: room.id, role: "user", content: "b" });
		await converge(a, b);
		await converge(a, b);

		const mirrored = await a.chat.getRoom(room.id);
		// `seed` is a self-contained snapshot fixed at acquisition time. It is therefore excluded from
		// the conflict surface entirely.
		expect(mirrored?.seed).toEqual(room.seed);
		expect(mirrored?.originStoryId).toBe("story-1");
		expect(mirrored?.createdAt).toBe(room.createdAt);
	});

	it("**deletion beats an offline edit**; there is no resurrection", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const draft = await a.authoring.createDraft({
			title: "Manuscript to delete",
		});
		await converge(a, b);

		await a.authoring.deleteDraft(draft.id);
		// B keeps editing without knowing about that.
		await b.authoring.updateDraft(draft.id, { title: "B keeps writing" });

		await converge(a, b);
		await converge(a, b);

		for (const device of [a, b]) {
			expect(await device.authoring.getDraft(draft.id)).toBeNull();
			expect(await device.authoring.listDrafts()).toHaveLength(0);
		}
		// The local row stays, so the device can never judge the id as 'never seen before'.
		expect((await b.db.storyDrafts.get(draft.id))?.deletedAt).not.toBeNull();
	});

	/**
	 * A remote tombstone also discards this device's pending draft cover. Pre-publish covers are not
	 * synced (`local-authoring/draft-cover.ts`), so this row exists only on device B. If it is not
	 * dropped when A's deletion tombstone arrives, the cover the user believes they deleted stays
	 * forever in B's IndexedDB. No screen can show it, since the draft is gone and there is nothing to
	 * open, and sync does not know the table. No test or screen would reveal this kind of leak.
	 */
	it("a remotely deleted draft's pending cover disappears with it", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const draft = await a.authoring.createDraft({
			title: "Manuscript with a chosen cover",
		});
		await converge(a, b);

		// Only B picked a cover on this device. Covers are not synced, so A has none.
		await b.db.draftCovers.put({
			draftId: draft.id,
			version: 1,
			blob: new Blob(["Cover"], { type: "image/png" }),
			mime: "image/png",
			size: 6,
			updatedAt: new Date().toISOString(),
		});
		expect(await b.db.draftCovers.get(draft.id)).toBeDefined();
		expect(await a.db.draftCovers.get(draft.id)).toBeUndefined();

		await a.authoring.deleteDraft(draft.id);
		await converge(a, b);

		expect(await b.authoring.getDraft(draft.id)).toBeNull();
		expect(await b.db.draftCovers.get(draft.id)).toBeUndefined();
	});

	it("both devices deleting at once is idempotent", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const draft = await a.authoring.createDraft({ title: "Deleted by both" });
		await converge(a, b);

		await a.authoring.deleteDraft(draft.id);
		await b.authoring.deleteDraft(draft.id);
		await converge(a, b);
		await converge(a, b);

		for (const device of [a, b])
			expect(await device.authoring.getDraft(draft.id)).toBeNull();
	});

	it("a late message of a deleted room stays hidden and does not revive the room", async () => {
		/**
		 * Deleting a room uploads only one tombstone. The server keeps the room's message ciphertexts as
		 * they are. A device that has not yet received those messages can still get them later, through a
		 * real path.
		 */
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
		});
		await converge(a, b);

		// A posts a message and deletes the room right away. B has received neither yet.
		await a.chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Late text",
		});
		await a.chat.deleteRoom(room.id);
		await a.engine.run(TEST_DEK);
		await b.engine.run(TEST_DEK);

		expect(await b.chat.getRoom(room.id)).toBeNull();
		expect(await b.chat.listRecentMessages(room.id)).toHaveLength(0);
		expect(await b.chat.listRooms()).toHaveLength(0);
	});

	it("a new device that never saw the room does not keep a deleted room's children **alive**", async () => {
		/**
		 * Room children are deleted without their own tombstones. The server keeps their ciphertexts as
		 * live rows. A new device's bootstrap receives them before the room tombstone (lower seq). If the
		 * tombstone were skipped because the room row is missing, the plaintext of the deleted
		 * conversation would survive on that device alone.
		 */
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Deleted room"),
		});
		await a.chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Deleted text",
		});
		await a.chat.createMemory({ roomId: room.id, content: "Deleted memory" });
		await a.chat.createCharacter({
			roomId: room.id,
			name: "Deleted character",
		});
		await a.engine.run(TEST_DEK);
		await a.chat.deleteRoom(room.id);
		await a.engine.run(TEST_DEK);

		const c = spawn(server, "c");
		await c.engine.run(TEST_DEK);

		expect(await c.db.rooms.get(room.id)).toBeUndefined();
		const children = [
			...(await c.db.messages.where("roomId").equals(room.id).toArray()),
			...(await c.db.chatMemories.where("roomId").equals(room.id).toArray()),
			...(await c.db.chatCharacters.where("roomId").equals(room.id).toArray()),
		];
		expect(children).toHaveLength(3);
		for (const child of children) {
			expect(child.deletedAt).not.toBeNull();
			// The cascade does not raise `dirty`. Raising it would re-upload the content of the deleted
			// room.
			expect(child.dirty).toBe(0);
		}
		expect((await c.sync.collectOutbound({ limit: 50 })).records).toHaveLength(
			0,
		);
	});

	it("a child arriving before its parent is stored safely and shows once the parent arrives", async () => {
		/**
		 * The legacy code solved this with a topological sort and a quarantine queue. That queue, capped
		 * at 1000 items and 50 attempts, could actually lose data. Here local ids are sync ids, so there
		 * is no remapping and the child can simply be stored. It stays invisible only because lookups go
		 * through the parent.
		 */
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const draft = await a.authoring.createDraft({ title: "Parent" });
		const child = await a.authoring.createLore(draft.id, { content: "Child" });
		await a.engine.run(TEST_DEK);

		// B receives only the child first, simulating a page that skipped the parent's seq.
		const childOnly = server
			.pull(0, 100)
			.records.find((r) => r.id === child.id);
		expect(childOnly).toBeDefined();
		await b.sync.applyPull({
			entries: [],
			cursor: 0,
		});
		// Reverse the real pull order so the child arrives first.
		await b.engine.run(TEST_DEK);
		expect(
			(await b.authoring.listLore(draft.id)).map((l) => l.content),
		).toEqual(["Child"]);
		expect(await b.authoring.getDraft(draft.id)).not.toBeNull();
	});

	it("`publishedStoryId` is monotonic; it never returns to null", async () => {
		/**
		 * If the publish state reverted, the user would lose the ability to update-publish the work and
		 * would publish the same manuscript twice.
		 */
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const draft = await a.authoring.createDraft({
			title: "Manuscript to publish",
		});
		await converge(a, b);

		await a.authoring.markPublished(draft.id, "story-99");
		// B edits a different group later without knowing about the publish. Under HLC, B wins.
		await b.authoring.updateDraft(draft.id, { title: "Title edited by B" });
		await converge(a, b);
		await converge(a, b);

		for (const device of [a, b]) {
			const merged = await device.authoring.getDraft(draft.id);
			expect(merged?.publishedStoryId).toBe("story-99");
			expect(merged?.title).toBe("Title edited by B");
		}
	});

	it("concurrent reordering converges to the same final order with no overlapping positions", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const draft = await a.authoring.createDraft({ title: "Order" });
		const one = await a.authoring.createLore(draft.id, { content: "1" });
		const two = await a.authoring.createLore(draft.id, { content: "2" });
		const three = await a.authoring.createLore(draft.id, { content: "3" });
		await converge(a, b);

		await a.authoring.reorderLore(draft.id, [three.id, one.id, two.id]);
		await b.authoring.reorderLore(draft.id, [two.id, three.id, one.id]);
		await converge(a, b);
		await converge(a, b);

		const fromA = (await a.authoring.listLore(draft.id)).map((l) => l.id);
		const fromB = (await b.authoring.listLore(draft.id)).map((l) => l.id);
		expect(fromA).toEqual(fromB);
		const positions = (await a.authoring.listLore(draft.id)).map(
			(l) => l.positionIndex,
		);
		// Normalization reassigns 0..n-1. There are no duplicates and no gaps.
		expect(positions).toEqual([0, 1, 2]);
	});

	it("order normalization makes nothing dirty; no endless round trip", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const draft = await a.authoring.createDraft({ title: "Order" });
		const one = await a.authoring.createLore(draft.id, { content: "1" });
		const two = await a.authoring.createLore(draft.id, { content: "2" });
		await converge(a, b);
		await a.authoring.reorderLore(draft.id, [two.id, one.id]);
		await converge(a, b);
		await converge(a, b);

		server.pushes.length = 0;
		await a.engine.run(TEST_DEK);
		await b.engine.run(TEST_DEK);
		await a.engine.run(TEST_DEK);
		expect(server.pushes.flat()).toHaveLength(0);
	});
});

describe("protocol robustness", () => {
	it("with a lost response, a retry with the same idempotency key does not change the server twice", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
		});
		// The first push fails with a 5xx. This simulates the server applying the change while the
		// response is lost.
		server.failNextPush = { status: 503, code: "unavailable" };
		await a.engine.run(TEST_DEK);

		const row = server.row(room.id);
		expect(row?.version).toBe(1);
		// If the retry used the same key, the server version was bumped only once.
		await a.engine.run(TEST_DEK);
		expect(server.row(room.id)?.version).toBe(1);
	});

	it("converges even on a server without idempotency (slow but correct)", async () => {
		/**
		 * Without an idempotency key, a retry after a lost ack shows up as a conflict. The client then
		 * pulls and receives its own just-pushed record. Since `rev` matches, it recognizes its own write
		 * and only updates the version. The result is correct, but it costs an extra round trip. That
		 * difference is what the idempotency table is worth.
		 */
		const server = new FakeSyncServer({ idempotency: false });
		const a = spawn(server, "a");
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
		});
		server.failNextPush = { status: 503, code: "unavailable" };
		await a.engine.run(TEST_DEK);
		await a.engine.run(TEST_DEK);

		const stored = await a.db.rooms.get(room.id);
		expect(stored?.dirty).toBe(0);
		expect(stored?.serverVersion).toBe(server.row(room.id)?.version);
	});

	it("if the apply transaction aborts **the cursor does not advance** and a retry is safe", async () => {
		/**
		 * The worst defect of the legacy code was here. If the cursor was committed before the page was
		 * applied and the apply failed, that page's records never arrive again. The user then loses
		 * conversations that existed only on one device.
		 */
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
			title: "First",
		});
		const message = await a.chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "First text",
		});
		await converge(a, b);
		const settled = await b.sync.readState();

		// A edits both. The next page carries the room and the message together.
		await a.chat.updateMessage(message.id, { content: "Edited text" });
		await a.engine.run(TEST_DEK);
		const page = server.pull(settled.cursor, 100);
		expect(page.records.length).toBeGreaterThan(1);

		const entries = await buildEntries(b, page);
		// The last entry throws during the merge. The entries before it were already written.
		const exploding = entries.map((entry, index) =>
			index === entries.length - 1 && entry.kind === "record"
				? {
						...entry,
						merge: (): never => {
							throw new Error("failed mid-apply");
						},
					}
				: entry,
		);
		await expect(
			b.sync.applyPull({ entries: exploding, cursor: page.cursor }),
		).rejects.toThrow();

		// Even the earlier entries rolled back, and the cursor is unchanged.
		const messages = await b.chat.listRecentMessages(room.id);
		expect(messages[0].content).toBe("First text");
		expect((await b.sync.readState()).cursor).toBe(settled.cursor);

		// Re-receiving and applying the same page brings everything in.
		await b.engine.run(TEST_DEK);
		expect((await b.chat.listRecentMessages(room.id))[0].content).toBe(
			"Edited text",
		);
		expect((await b.sync.readState()).cursor).toBe(page.cursor);
	});

	it("applying the same page twice gives the same final state", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
		});
		await a.engine.run(TEST_DEK);
		const page = server.pull(0, 100);

		await b.sync.applyPull({
			entries: await buildEntries(b, page),
			cursor: page.cursor,
		});
		const first = await b.db.rooms.get(room.id);
		await b.sync.applyPull({
			entries: await buildEntries(b, page),
			cursor: page.cursor,
		});
		const second = await b.db.rooms.get(room.id);
		expect(second).toEqual(first);
	});

	it.each([
		["an unknown type", { type: "future.thing" }],
		["an unknown envelope version", { envelope: 99 }],
		[
			"corrupt ciphertext",
			{ ciphertext: '{"v":1,"iv":"AAAAAAAAAAAAAAAA","ct":"AAAA"}' },
		],
	])("%s is ignored and **the cursor advances**", async (_label, patch) => {
		/**
		 * This failure cannot be fixed by retrying. If the cursor were blocked, that one record would
		 * stop this device's sync forever. Skipping is by design, not data loss.
		 */
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Normal"),
		});
		await a.engine.run(TEST_DEK);

		server.seed({
			id: "broken-record-0001",
			type: "chat.room",
			ciphertext:
				'{"v":1,"iv":"AAAAAAAAAAAAAAAA","ct":"AAAAAAAAAAAAAAAAAAAAAAAA"}',
			envelope: 1,
			version: 1,
			deleted: false,
			...patch,
		});

		await b.engine.run(TEST_DEK);
		// Valid records came in. The malformed one left no trace.
		expect(await b.chat.getRoom(room.id)).not.toBeNull();
		expect(await b.db.rooms.get("broken-record-0001")).toBeUndefined();
		// The cursor moved past that record, so the next run does not fetch it again.
		const state = await b.sync.readState();
		expect(state.cursor).toBeGreaterThanOrEqual(2);
		expect(b.diagnostics.some((event) => event.kind === "ignored")).toBe(true);
	});

	it("a higher payload schema version is ignored", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		await a.chat.createRoom({ originStoryId: null, seed: seed("Normal") });
		await a.engine.run(TEST_DEK);

		const { encryptRecord } = await import("@rowcat/sync");
		const { nobleAead } = await import("@rowcat/sync");
		const future = await encryptRecord(
			TEST_DEK,
			{
				owner: "0123456789abcdef0123456789abcdef",
				recordId: "future-schema-01",
				type: "chat.room",
			},
			{
				schemaVersion: 99,
				rev: { t: 1, c: 0, d: "x" },
				deletedAt: null,
				data: {},
			},
			nobleAead,
		);
		server.seed({
			id: "future-schema-01",
			type: "chat.room",
			ciphertext: future,
			envelope: 1,
			version: 1,
			deleted: false,
		});

		await b.engine.run(TEST_DEK);
		expect(await b.db.rooms.get("future-schema-01")).toBeUndefined();
		expect(
			b.diagnostics.some(
				(event) =>
					event.kind === "ignored" && event.reason === "unknown_schema",
			),
		).toBe(true);
	});

	it("the final graph is right even when parent and child straddle a page boundary", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const draft = await a.authoring.createDraft({ title: "Parent" });
		for (let i = 0; i < 4; i++)
			await a.authoring.createLore(draft.id, { content: `${i}` });
		await a.engine.run(TEST_DEK);

		// Apply one record at a time, so parent and child land in separate transactions.
		let since = 0;
		for (;;) {
			const page = server.pull(since, 1);
			if (page.records.length === 0) break;
			await b.sync.applyPull({
				entries: await buildEntries(b, page),
				cursor: page.cursor,
			});
			since = page.cursor;
		}
		expect(
			(await b.authoring.listLore(draft.id)).map((l) => l.content),
		).toEqual(["0", "1", "2", "3"]);
	});
});

describe("bootstrap, clock and account", () => {
	it("with data both locally and on the server the result is the **union**", async () => {
		/**
		 * This is the case the investigation worried about most. Neither side overwrites the other, for
		 * two reasons. Record ids are UUIDs and do not collide across devices. And bootstrap runs PUSH
		 * ALL first. If pull ran first, a device holding data from before sync existed would never upload
		 * it.
		 */
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");

		const fromA = await a.authoring.createDraft({ title: "A's manuscript" });
		await a.engine.run(TEST_DEK);
		// B already has its own draft before sync is turned on.
		const fromB = await b.authoring.createDraft({ title: "B's manuscript" });

		await converge(a, b);
		for (const device of [a, b]) {
			const titles = (await device.authoring.listDrafts()).map((d) => d.title);
			expect(titles.sort()).toEqual(["A's manuscript", "B's manuscript"]);
		}
		expect(await a.authoring.getDraft(fromB.id)).not.toBeNull();
		expect(await b.authoring.getDraft(fromA.id)).not.toBeNull();
	});

	it("bootstrap uploads records that are not dirty too", async () => {
		/**
		 * Databases migrated from v1 and v2 can contain rows with `dirty=0` that never existed on the
		 * server. A first sync that only looks at `dirty` would skip them forever.
		 */
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Hidden room"),
		});
		// Simulates the migration bug: the row was never uploaded but is marked clean.
		await a.db.rooms.update(room.id, { dirty: 0 });

		await a.engine.run(TEST_DEK);
		expect(server.row(room.id)).toBeDefined();
	});

	it("`initialSyncDone` is set **in the same transaction** as the last page", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		expect((await a.sync.readState()).initialSyncDone).toBe(false);
		await a.chat.createRoom({ originStoryId: null, seed: seed("Room") });
		await a.engine.run(TEST_DEK);
		const state = await a.sync.readState();
		expect(state.initialSyncDone).toBe(true);
		expect(state.cursor).toBeGreaterThan(0);
	});

	it("a full resync rewinds only the cursor and **keeps local changes**", async () => {
		/**
		 * Clearing local data and re-downloading from the server is data destruction, not a full resync.
		 * PUSH ALL runs first so local data goes up to the server, and only then does pull run.
		 */
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const draft = await a.authoring.createDraft({ title: "Manuscript" });
		await converge(a, b);

		await b.authoring.updateDraft(draft.id, { title: "Title edited by B" });
		await b.sync.resetCursor();
		const reset = await b.sync.readState();
		expect(reset.cursor).toBe(0);
		expect(reset.protocolEpoch).toBe(2);

		await b.engine.run(TEST_DEK);
		expect((await b.authoring.getDraft(draft.id))?.title).toBe(
			"Title edited by B",
		);
		await a.engine.run(TEST_DEK);
		expect((await a.authoring.getDraft(draft.id))?.title).toBe(
			"Title edited by B",
		);
	});

	it("causal order is kept even with a remote clock far ahead", async () => {
		/**
		 * Without absorption, this happens. B's clock is two hours ahead, and A edits after seeing B's
		 * edit. If A's revision is lower than B's, A's later edit loses to B's earlier one. The user sees
		 * the text they just wrote disappear.
		 */
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const draft = await a.authoring.createDraft({ title: "Manuscript" });
		await converge(a, b);

		const state = await b.db.syncState.get("state");
		if (state)
			await b.db.syncState.put({
				...state,
				hlcT: state.hlcT + 2 * 60 * 60 * 1000,
			});
		await b.authoring.updateDraft(draft.id, { title: "Future B" });
		await converge(a, b);
		expect((await a.authoring.getDraft(draft.id))?.title).toBe("Future B");

		// A edits after seeing it. If absorption worked, A's revision must be higher.
		await a.authoring.updateDraft(draft.id, { title: "A after that" });
		await converge(a, b);
		await converge(a, b);
		for (const device of [a, b])
			expect((await device.authoring.getDraft(draft.id))?.title).toBe(
				"A after that",
			);
	});

	it("once ownership moves, a late response **does not write to the new scope**", async () => {
		/**
		 * Both `Alice → sign out → Bob` and `Alice → sign out → Alice` arrive here. The second case has
		 * the same member id, so an id comparison alone would miss it. The check must compare storage
		 * instances.
		 */
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const draft = await a.authoring.createDraft({ title: "Manuscript" });
		await a.engine.run(TEST_DEK);

		let owns = true;
		const stale = createDevice("stale", server, { ownsStore: () => owns });
		devices.push(stale);
		// A scope switch happens in the middle of the round trip.
		owns = false;
		const result = await stale.engine.run(TEST_DEK);

		expect(result.abandoned).toBe(true);
		expect(await stale.authoring.getDraft(draft.id)).toBeNull();
		expect((await stale.sync.readState()).cursor).toBe(0);
	});

	it("a wrong recovery code opens no data", async () => {
		/**
		 * A failed unlock must not touch local data. The failure comes from the AEAD tag check, and at
		 * that point the store has not read anything yet.
		 */
		const { createKeyring, generateDek, nobleAead, unlockWithRecovery } =
			await import("@rowcat/sync");
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		await a.authoring.createDraft({ title: "Manuscript that stays" });

		const owner = "0123456789abcdef0123456789abcdef";
		const created = await createKeyring(owner, generateDek(), nobleAead);
		const wrong = await createKeyring(owner, generateDek(), nobleAead);
		await expect(
			unlockWithRecovery(owner, created.keyring, wrong.recoveryCode, nobleAead),
		).rejects.toThrow();
		expect(await a.authoring.listDrafts()).toHaveLength(1);
	});
});

/**
 * What conversation management (rename and delete) means across devices. Renaming adds neither a
 * new record type nor a new envelope version. `title` in `chat.room` is already inside the
 * ciphertext, and merging is per-record HLC. So this section checks user-visible results of
 * management actions, not the protocol itself:
 * - whether a new name reaches the other device
 * - whether simultaneous renames converge to one name
 * - whether a deleted conversation is revived by the other device's offline rename
 */
describe("room management", () => {
	it("a name A changed arrives at B", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const room = await a.chat.createRoom({
			originStoryId: "story-1",
			seed: seed("The Night Library"),
		});
		await converge(a, b);

		await a.chat.renameRoom(room.id, "The Day Library");
		await converge(a, b);

		expect((await b.chat.getRoom(room.id))?.title).toBe("The Day Library");
		// The receiving side is clean and has nothing to send back.
		const row = await b.db.rooms.get(room.id);
		expect(row?.dirty).toBe(0);
		// The acquisition snapshot does not change with a rename (immutable field).
		expect(row?.seed).toEqual(room.seed);
		expect(row?.createdAt).toBe(room.createdAt);
	});

	/**
	 * The winner is not chosen by wall clock. Even if the two clocks disagree, the HLC total order
	 * picks one winner. This test only checks that both devices end up with the same title. Which side
	 * wins is not a product rule.
	 */
	it("concurrent renames converge to one title", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Original name"),
		});
		await converge(a, b);

		await a.chat.renameRoom(room.id, "Name given by A");
		await b.chat.renameRoom(room.id, "Name given by B");
		await converge(a, b);
		await converge(a, b);

		const titleA = (await a.chat.getRoom(room.id))?.title;
		const titleB = (await b.chat.getRoom(room.id))?.title;
		expect(titleA).toBe(titleB);
		expect(["Name given by A", "Name given by B"]).toContain(titleA);

		/**
		 * Activity time merges by max. A rename made on the losing side still counts as activity. Taking
		 * only the winner's value would push the conversation the user just touched down the list on that
		 * device.
		 */
		const activityA = (await a.chat.getRoom(room.id))?.updatedAt;
		expect((await b.chat.getRoom(room.id))?.updatedAt).toBe(activityA);
		expect((activityA ?? "") >= room.updatedAt).toBe(true);

		// After convergence neither side has anything to send back, so no endless ping-pong.
		server.pushes.length = 0;
		await converge(a, b);
		expect(server.pushes.flat()).toHaveLength(0);
	});

	/**
	 * This is a P1 issue. If B renames a conversation that A deleted while B is offline and pushes it,
	 * the push overwrites the tombstone. The deleted conversation then comes back on both devices.
	 */
	it("deletion beats an offline rename; there is no resurrection", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Conversation to delete"),
		});
		await a.chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Remaining words",
		});
		await converge(a, b);

		await a.chat.deleteRoom(room.id);
		// B renames it without knowing about the deletion.
		await b.chat.renameRoom(room.id, "New name given by B");

		await converge(a, b);
		await converge(a, b);

		for (const device of [a, b]) {
			expect(await device.chat.getRoom(room.id)).toBeNull();
			expect(await device.chat.listRooms()).toHaveLength(0);
			expect(await device.chat.listRecentMessages(room.id)).toHaveLength(0);
		}
		// The row stays. The fact that it was deleted is itself the basis for the next sync.
		expect((await b.db.rooms.get(room.id))?.deletedAt).not.toBeNull();
	});

	/**
	 * The reverse order holds too: even if the renamed side is pushed first, deletion still takes
	 * precedence.
	 */
	it("deletion wins even if the rename uploads first", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Reversed order"),
		});
		await converge(a, b);

		await b.chat.renameRoom(room.id, "B's name");
		await b.engine.run(TEST_DEK);

		await a.chat.deleteRoom(room.id);
		await converge(a, b);
		await converge(a, b);

		for (const device of [a, b])
			expect(await device.chat.getRoom(room.id)).toBeNull();
	});
});

/**
 * Convergence of tail rewriting: does a linear conversation end up as one timeline on both devices?
 * V1 creates no branches. So the requirement is not to keep both versions. It is for both devices
 * to reach the same single timeline. Existing rules (tombstone wins, per-record HLC) already decide
 * this. No message-only exception is added.
 */
describe("tail rewrite", () => {
	/** On device A, creates one conversation in which user and assistant turns alternate. */
	async function conversation(device: Device, turns: number) {
		const room = await device.chat.createRoom({
			originStoryId: null,
			seed: seed("Tail"),
		});
		const ids: string[] = [];
		for (let i = 0; i < turns; i++) {
			const user = await device.chat.appendMessage({
				roomId: room.id,
				role: "user",
				content: `user-${i}`,
			});
			const assistant = await device.chat.appendMessage({
				roomId: room.id,
				role: "assistant",
				content: `assistant-${i}`,
			});
			ids.push(user.id, assistant.id);
		}
		return { room, ids };
	}

	const contents = async (device: Device, roomId: string) =>
		(await device.chat.listRecentMessages(roomId, { limit: 100 })).map(
			(message) => message.content,
		);

	it("A's edit and its deletions arrive at B as is", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const { room, ids } = await conversation(a, 3);
		await converge(a, b);
		expect(await contents(b, room.id)).toHaveLength(6);

		await a.chat.editUserMessage(ids[2], "Asking again");
		await converge(a, b);

		expect(await contents(b, room.id)).toEqual([
			"user-0",
			"assistant-0",
			"Asking again",
		]);
		// Each tombstone is pushed on its own. Unlike room deletion, there is no parent tombstone to
		// stand in for them.
		expect((await b.db.messages.get(ids[3]))?.deletedAt).not.toBeNull();
	});

	it("A's `Delete from here` arrives at B", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const { room, ids } = await conversation(a, 3);
		await converge(a, b);

		await a.chat.deleteFromMessage(ids[2]);
		await converge(a, b);

		expect(await contents(b, room.id)).toEqual(["user-0", "assistant-0"]);
	});

	/**
	 * `Regenerate` (regenerate) is a delete plus a new message at the storage level. The point is that the
	 * new response gets a new id and does not overwrite the old row. So on the receiving side, the old
	 * response's tombstone and the new response arrive separately.
	 */
	it("A's regenerate shows as one new answer on B", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const { room, ids } = await conversation(a, 2);
		await converge(a, b);

		await a.chat.deleteFromMessage(ids[3]);
		const fresh = await a.chat.appendMessage({
			roomId: room.id,
			role: "assistant",
			content: "Newly made answer",
		});
		await converge(a, b);

		expect(await contents(b, room.id)).toEqual([
			"user-0",
			"assistant-0",
			"user-1",
			"Newly made answer",
		]);
		expect(fresh.id).not.toBe(ids[3]);
		expect((await b.db.messages.get(ids[3]))?.deletedAt).not.toBeNull();
	});

	/**
	 * While A rewrites the old history, B keeps the conversation going offline. V1 promises only this
	 * much: both devices reach the same single timeline. Messages B writes survive, because they have
	 * new ids that A never deleted. What A deleted is decided by its tombstone. The result may not
	 * match what either user intended, but both sides see the same thing. Keeping both branches would
	 * require forks, which V1's model does not have.
	 */
	it("A's rewrite and B's offline continuation converge into one timeline", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const { room, ids } = await conversation(a, 2);
		await converge(a, b);

		// A edits the first user message. The three messages after it become tombstones.
		await a.chat.editUserMessage(ids[0], "First utterance edited by A");
		// B continues the conversation without knowing that.
		await b.chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Utterance continued by B",
		});

		await converge(a, b);
		await converge(a, b);

		const left = await contents(a, room.id);
		expect(left).toEqual(await contents(b, room.id));
		expect(left).toEqual([
			"First utterance edited by A",
			"Utterance continued by B",
		]);
	});

	/**
	 * Priority between deletion and edit is an existing rule (tombstone precedence in
	 * `decideInbound`). This test locks in that messages get no rule of their own.
	 */
	it("a tail tombstone beats an offline edit of the same message", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const { room, ids } = await conversation(a, 2);
		await converge(a, b);

		await a.chat.deleteFromMessage(ids[2]);
		await b.chat.editUserMessage(ids[2], "Utterance edited by B");

		await converge(a, b);
		await converge(a, b);

		for (const device of [a, b])
			expect(await contents(device, room.id)).toEqual([
				"user-0",
				"assistant-0",
			]);
		expect((await b.db.messages.get(ids[2]))?.deletedAt).not.toBeNull();
	});

	it("two devices rewriting the same spot is idempotent", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const { room, ids } = await conversation(a, 3);
		await converge(a, b);

		await a.chat.deleteFromMessage(ids[4]);
		await b.chat.deleteFromMessage(ids[4]);
		await converge(a, b);
		await converge(a, b);

		for (const device of [a, b])
			expect(await contents(device, room.id)).toEqual([
				"user-0",
				"assistant-0",
				"user-1",
				"assistant-1",
			]);
	});

	/**
	 * Rewriting is also room activity, so the room must move up in the list on the receiving side too.
	 */
	it("a rewritten room's activity time rises on B too", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const { room, ids } = await conversation(a, 2);
		await converge(a, b);
		const before = (await b.chat.getRoom(room.id))?.updatedAt ?? "";

		await a.chat.deleteFromMessage(ids[2]);
		await converge(a, b);

		const after = (await b.chat.getRoom(room.id))?.updatedAt ?? "";
		expect(after.localeCompare(before)).toBeGreaterThan(0);
	});
});
