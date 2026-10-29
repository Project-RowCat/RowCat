import type { AuthoringStore, StoryPublicationSource } from "@rowcat/authoring";
import { createStoryDraftRecord } from "@rowcat/authoring";
import { describe, expect, it } from "vitest";
import { startDraftPlaytest } from "./start-draft-playtest.ts";

/**
 * Checks the **order** of the playtest start, without rendering.
 *
 * The mistakes this guards against are all silent. Reading the draft without flushing autosave runs
 * the test on a version missing the sentence just typed, and the creator reads it as their edits
 * not being reflected — but the save is still pending, so there is no way to find the cause.
 *
 * So half of the assertions are that something was **not called**: if the flush fails, the store is
 * not read; if the draft is missing, there is no navigation; if the account changed, there is no
 * navigation.
 */

const NOW = "2026-01-01T00:00:00.000Z";
const REV = { t: 1_767_225_600_000, c: 0, d: "test-device" };

const source = (): StoryPublicationSource => ({
	draft: createStoryDraftRecord(
		{
			title: "The Night Library",
			prompt: "A library where the books talk to you.",
		},
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
	it("flush → storage → draft read → navigation", async () => {
		const { steps, run } = scene();
		const outcome = await run();

		expect(steps).toEqual(["flush", "store", "load", "navigate"]);
		expect(outcome.status).toBe("started");
		if (outcome.status !== "started") return;
		expect(outcome.snapshot.draftId).toBe("draft-1");
		expect(outcome.snapshot.seed.scenario).toBe(
			"A library where the books talk to you.",
		);
	});

	/**
	 * **Reads the draft and its children at once.** Reading twice could mix in an autosave that lands
	 * between the reads, and the prompt would come from the new version while the lore comes from the
	 * old one.
	 */
	it("reads the draft only once", async () => {
		const { steps, run } = scene();
		await run();
		expect(steps.filter((step) => step === "load")).toHaveLength(1);
	});
});

describe("where it stops", () => {
	/**
	 * **If the pending edit could not be written, the store is not read either.** Continuing would
	 * start the test on a version different from what the screen shows, and the difference only
	 * surfaces after the response goes wrong.
	 */
	it("if the flush fails it doesn't read the draft", async () => {
		const { steps, run } = scene({ flush: async () => false });
		const outcome = await run();

		expect(steps).toEqual(["flush"]);
		expect(outcome).toEqual({ status: "failed", reason: "autosave" });
	});

	it("if the flush throws it stops at the same place", async () => {
		const { steps, run } = scene({
			flush: async () => {
				throw new Error("SQLite died");
			},
		});
		const outcome = await run();

		expect(steps).toEqual(["flush"]);
		expect(outcome).toEqual({ status: "failed", reason: "autosave" });
	});

	/** Guest, or the scope could not open. There is no draft to read. */
	it("doesn't navigate without storage", async () => {
		const { steps, run } = scene({ store: null });
		const outcome = await run();

		expect(steps).toEqual(["flush", "store"]);
		expect(outcome).toEqual({ status: "failed", reason: "storage" });
	});

	/** A deletion from another device arrived mid-edit. Navigating would show an empty draft on arrival. */
	it("doesn't navigate if the draft disappeared", async () => {
		const { steps, run } = scene({ loadSource: async () => null });
		const outcome = await run();

		expect(steps).toEqual(["flush", "store", "load"]);
		expect(outcome).toEqual({ status: "failed", reason: "storage" });
	});

	/**
	 * The account changed during the read. **Not an error** — it is the result of what the user just
	 * did, and nothing is wrong with the draft or the server. Nothing is left behind either (nothing
	 * was ever sent to the server).
	 */
	it("if the scope changed it doesn't navigate and is stale", async () => {
		const { steps, run } = scene({ owns: () => false });
		const outcome = await run();

		expect(steps).toEqual(["flush", "store", "load"]);
		expect(outcome).toEqual({ status: "stale" });
	});

	/**
	 * **Ownership is asked after the read.** Asking only before the read misses an account switch
	 * during it, and the arrived screen would open a draft that is not in the current account.
	 */
	it("the ownership check comes after the draft read", async () => {
		let loaded = false;
		let askedAfterLoad = false;
		const store = {
			loadPublicationSource: async () => {
				loaded = true;
				return source();
			},
		} as unknown as AuthoringStore;

		await startDraftPlaytest({
			draftId: "draft-1",
			lock: { current: false },
			flushAutosave: async () => true,
			ensureStore: async () => store,
			stillOwnsStore: () => {
				askedAfterLoad = loaded;
				return true;
			},
			navigate: async () => undefined,
		});

		expect(askedAfterLoad).toBe(true);
	});
});

describe("nothing goes to the server", () => {
	/**
	 * The arguments to this function include **no publish and no playback.** That fact is in the
	 * signature and is the basis for this check. Here the actual run is checked by value: it calls
	 * nothing but those four.
	 */
	it("calls nothing but the four ports", async () => {
		const calls: string[] = [];
		const store = new Proxy(
			{},
			{
				get(_target, property: string) {
					/** Checks whether `await` is probing the value for thenable — this is not an operation call. */
					if (property === "then") return undefined;
					calls.push(property);
					if (property === "loadPublicationSource") return async () => source();
					return () => {
						throw new Error(
							`an operation that must not be called: ${property}`,
						);
					};
				},
			},
		) as AuthoringStore;

		await startDraftPlaytest({
			draftId: "draft-1",
			lock: { current: false },
			flushAutosave: async () => true,
			ensureStore: async () => store,
			stillOwnsStore: () => true,
			navigate: async () => undefined,
		});

		expect(calls).toEqual(["loadPublicationSource"]);
	});
});

describe("duplicate runs", () => {
	/**
	 * Two presses in the same tick. React state cannot block this (it is reflected only at the next
	 * render), so a synchronous lock is used — the second call stops before the first `await`.
	 */
	it("does nothing if already in progress", async () => {
		const { steps, lock, run } = scene();
		lock.current = true;

		expect(await run()).toEqual({ status: "busy" });
		expect(steps).toEqual([]);
	});

	/** Called twice in the same tick: starts **once** and navigates **once**. */
	it("two calls in the same tick fold into one start", async () => {
		const { steps, run } = scene();
		const [first, second] = await Promise.all([run(), run()]);

		expect(steps.filter((step) => step === "navigate")).toHaveLength(1);
		expect([first.status, second.status].sort()).toEqual(["busy", "started"]);
	});

	it("releases the lock when done — even on failure", async () => {
		const { lock, run } = scene({ flush: async () => false });
		await run();
		expect(lock.current).toBe(false);
	});
});
