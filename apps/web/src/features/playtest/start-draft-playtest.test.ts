import type { AuthoringStore, StoryPublicationSource } from "@rowcat/authoring";
import { createStoryDraftRecord } from "@rowcat/authoring";
import { describe, expect, it } from "vitest";
import { startDraftPlaytest } from "./start-draft-playtest.ts";

/**
 * The order of starting a playtest, checked without rendering. The mistakes this guards against are
 * all silent. If the draft is read without first flushing pending autosave, the test runs on a
 * revision missing the sentence just typed. The creator then reads their change as not reflected,
 * and there is no way to find the cause, because the save has simply not happened yet.
 *
 * So half the assertions are that something was not called: when the flush fails, storage is not
 * read; when there is no store or no draft, navigation does not happen; when the account changed,
 * navigation does not happen.
 */

const NOW = "2026-01-01T00:00:00.000Z";
const REV = { t: 1_767_225_600_000, c: 0, d: "test-device" };

const source = (): StoryPublicationSource => ({
	draft: createStoryDraftRecord(
		{ title: "The Night Library", prompt: "A library where the books talk." },
		{ id: "draft-1", now: NOW, rev: REV },
	),
	lore: [],
	startScenes: [],
	sceneImages: [],
});

/** Records the steps actually called, in order. That order is what this test verifies. */
function scene(
	over: {
		flush?: () => Promise<boolean>;
		store?: AuthoringStore | null;
		loadSource?: () => Promise<StoryPublicationSource | null>;
		owns?: () => boolean;
	} = {},
) {
	const steps: string[] = [];
	const store = {
		loadPublicationSource: async () => {
			steps.push("load");
			return over.loadSource ? await over.loadSource() : source();
		},
	} as unknown as AuthoringStore;

	const lock = { current: false };
	const run = () =>
		startDraftPlaytest({
			draftId: "draft-1",
			lock,
			flushAutosave: async () => {
				steps.push("flush");
				return over.flush ? await over.flush() : true;
			},
			ensureStore: async () => {
				steps.push("store");
				return over.store === undefined ? store : over.store;
			},
			stillOwnsStore: () => (over.owns ? over.owns() : true),
			navigate: async () => {
				steps.push("navigate");
			},
		});

	return { steps, lock, run };
}

describe("order", () => {
	it("flush → store → read draft → navigate", async () => {
		const { steps, run } = scene();
		const outcome = await run();

		expect(steps).toEqual(["flush", "store", "load", "navigate"]);
		expect(outcome.status).toBe("started");
		if (outcome.status !== "started") return;
		expect(outcome.snapshot.draftId).toBe("draft-1");
		expect(outcome.snapshot.seed.scenario).toBe(
			"A library where the books talk.",
		);
	});
});

describe("where it stops", () => {
	/**
	 * If pending edits could not be written, storage is not read either. Proceeding anyway would start
	 * the test on a revision that differs from what is on screen, and the difference would only show
	 * after responses went strange.
	 */
	it("does not read the draft when the flush fails", async () => {
		const { steps, run } = scene({ flush: async () => false });
		const outcome = await run();

		expect(steps).toEqual(["flush"]);
		expect(outcome).toEqual({ status: "failed", reason: "autosave" });
	});

	it("stops at the same place when the flush throws", async () => {
		const { steps, run } = scene({
			flush: async () => {
				throw new Error("Dexie died");
			},
		});
		const outcome = await run();

		expect(steps).toEqual(["flush"]);
		expect(outcome).toEqual({ status: "failed", reason: "autosave" });
	});

	/** Guest, or the scope could not be opened: there is no draft to read. */
	it("does not navigate without a store", async () => {
		const { steps, run } = scene({ store: null });
		const outcome = await run();

		expect(steps).toEqual(["flush", "store"]);
		expect(outcome).toEqual({ status: "failed", reason: "storage" });
	});

	/**
	 * The draft was deleted in another tab during editing. Navigating would make the arriving screen
	 * draw an empty draft.
	 */
	it("does not navigate if the draft is gone", async () => {
		const { steps, run } = scene({ loadSource: async () => null });
		const outcome = await run();

		expect(steps).toEqual(["flush", "store", "load"]);
		expect(outcome).toEqual({ status: "failed", reason: "storage" });
	});

	/**
	 * The account changed during the read. This is not an error: it is the result of what the user
	 * just did, and neither the draft nor the server has a problem. Nothing is left behind either,
	 * since nothing had been sent to the server.
	 */
	it("does not navigate and is stale when the scope changed", async () => {
		const { steps, run } = scene({ owns: () => false });
		const outcome = await run();

		expect(steps).toEqual(["flush", "store", "load"]);
		expect(outcome).toEqual({ status: "stale" });
	});
});

describe("double run", () => {
	/**
	 * A double-click within the same tick. React state cannot block this (it is reflected only on the
	 * next render), so a synchronous lock is used. The second call stops before the first `await`.
	 */
	it("does nothing when already running", async () => {
		const { steps, lock, run } = scene();
		lock.current = true;

		expect(await run()).toEqual({ status: "busy" });
		expect(steps).toEqual([]);
	});

	it("releases the lock when done, even after a failure", async () => {
		const { lock, run } = scene({ flush: async () => false });
		await run();
		expect(lock.current).toBe(false);
	});
});
