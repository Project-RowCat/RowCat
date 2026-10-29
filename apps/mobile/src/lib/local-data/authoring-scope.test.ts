import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../test/sqlite-node.ts";
import type { LocalScopeController } from "./activation.ts";

/**
 * The facts about local ownership that authoring relies on, on real SQLite.
 *
 * `useAuthoringScope()` is React wiring and this app's tests do not render, so what is checked here
 * is the value that hook reads: there is one store per scope, and reopening the same member yields
 * a **different instance**. The question asked before every irreversible write (`ownsStore`) rests
 * exactly on that fact.
 *
 * It also locks one regression in the read list as a value: if that list is wrong, the editor's
 * subscription becomes an endless loop that wakes **itself**, and that loop raises no error.
 */

let temp: ReturnType<typeof createTempDirectory>;
let controller: LocalScopeController;

beforeEach(() => {
	temp = createTempDirectory();
	controller = createTestScopeController(
		temp.path,
		createMemorySecureStorage(),
	);
});

afterEach(async () => {
	await controller.release();
	temp.dispose();
});

describe("the store's identity", () => {
	it("the same scope is the same store", async () => {
		const first = await controller.activate("alice");
		const again = await controller.activate("alice");
		expect(again.stores.authoring).toBe(first.stores.authoring);
		expect(controller.current()).toBe(first);
	});

	/**
	 * **`Alice → sign out → Alice` is not the same value.**
	 *
	 * Judging ownership by member id would make these two the same, and a write aimed at the old
	 * instance would pass — that instance's connection is already closed. So `ownsStore` compares
	 * instances.
	 */
	it("a reopened scope's store is a different instance", async () => {
		const first = await controller.activate("alice");
		const stale = first.stores.authoring;
		await controller.release();
		const second = await controller.activate("alice");

		expect(second.stores.authoring).not.toBe(stale);
		expect(controller.current()).toBe(second);
		expect(controller.current()?.stores.authoring).not.toBe(stale);
	});

	/** Switching accounts switches the drafts too — there is one file per member. */
	it("different members don't mix drafts", async () => {
		const alice = await controller.activate("alice");
		await alice.stores.authoring.createDraft({ title: "Alice's manuscript" });

		const bob = await controller.activate("bob");
		expect(await bob.stores.authoring.listDrafts()).toEqual([]);

		const back = await controller.activate("alice");
		expect(
			(await back.stores.authoring.listDrafts()).map((draft) => draft.title),
		).toEqual(["Alice's manuscript"]);
	});

	/**
	 * Once withdrawal is confirmed, that member's scope loses ownership **synchronously** — a late
	 * autosave arriving afterwards cannot revive the wiped database.
	 */
	it("an abandoned member's store becomes someone else's right away", async () => {
		const alice = await controller.activate("alice");
		const store = alice.stores.authoring;
		const abandoning = controller.abandon("alice");
		expect(controller.current()).toBeNull();
		await abandoning;
		expect(controller.current()?.stores.authoring).not.toBe(store);
	});
});

describe("write signals", () => {
	const countSignals = (scope: {
		stores: { mutations: { subscribe: (fn: () => void) => () => void } };
	}) => {
		let calls = 0;
		const stop = scope.stores.mutations.subscribe(() => {
			calls++;
		});
		return { calls: () => calls, stop };
	};

	/** Every write to a draft or child emits a signal — that signal wakes the screen subscriptions and auto-sync. */
	it("writes to the draft and children emit signals", async () => {
		const scope = await controller.activate("alice");
		const authoring = scope.stores.authoring;
		const signals = countSignals(scope);

		const draft = await authoring.createDraft();
		await authoring.updateDraft(draft.id, { title: "Title" });
		await authoring.createLore(draft.id);
		await authoring.createStartScene(draft.id);
		await authoring.createSceneImage(draft.id, { assetId: "media-1" });
		expect(signals.calls()).toBe(5);
		signals.stop();
	});

	/**
	 * **Reads emit no signal.**
	 *
	 * `listSceneImages` was missing from this list, and that fact produced no symptom while nothing
	 * read it. The moment the editor subscribes to it, the read emits a signal that wakes itself, and
	 * an endless read → signal → read loop starts — and auto-sync wakes along with every turn of it.
	 */
	it("lookups emit no signals", async () => {
		const scope = await controller.activate("alice");
		const authoring = scope.stores.authoring;
		const draft = await authoring.createDraft();

		const signals = countSignals(scope);
		await authoring.listDrafts();
		await authoring.getDraft(draft.id);
		await authoring.listLore(draft.id);
		await authoring.listStartScenes(draft.id);
		await authoring.listSceneImages(draft.id);
		await authoring.loadPublicationSource(draft.id);
		expect(signals.calls()).toBe(0);
		signals.stop();
	});
});

describe("publish snapshot", () => {
	/**
	 * What publication fetches in **one consistent read**. Reading four times separately would produce
	 * a mixed combination with autosave landing in between: the prompt would be the new version while
	 * the lore was the old, and that snapshot would get published.
	 */
	it("gives the draft and children at once", async () => {
		const scope = await controller.activate("alice");
		const authoring = scope.stores.authoring;
		const draft = await authoring.createDraft({
			title: "Title",
			prompt: "Body",
		});
		await authoring.createLore(draft.id, {
			keys: ["key"],
			content: "Settings",
		});
		const scene = await authoring.createStartScene(draft.id, {
			title: "start",
			content: "Intro",
		});
		await authoring.createSceneImage(draft.id, {
			trigger: "night",
			assetId: "media-1",
		});

		const source = await authoring.loadPublicationSource(draft.id);
		expect(source?.draft.title).toBe("Title");
		expect(source?.lore).toHaveLength(1);
		expect(source?.startScenes).toHaveLength(1);
		expect(source?.sceneImages).toHaveLength(1);
		/** The first scene becomes the default opening — the store owns that invariant. */
		expect(source?.draft.defaultStartSceneId).toBe(scene.id);
	});

	/** Publication does **not consume** the draft — the id stays the same and it can still be edited. */
	it("the draft remains after publishing and its id doesn't change", async () => {
		const scope = await controller.activate("alice");
		const authoring = scope.stores.authoring;
		const draft = await authoring.createDraft({ title: "Title" });

		const published = await authoring.markPublished(draft.id, "story-1");
		expect(published?.id).toBe(draft.id);
		expect(published?.publishedStoryId).toBe("story-1");
		expect((await authoring.listDrafts()).map((d) => d.id)).toEqual([draft.id]);

		await authoring.updateDraft(draft.id, { title: "The fixed title" });
		expect((await authoring.getDraft(draft.id))?.publishedStoryId).toBe(
			"story-1",
		);
	});
});
