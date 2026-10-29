import type { ChatRoom, ChatSeed, ChatStore } from "@rowcat/chat";
import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it, vi } from "vitest";
import { startStoryChat } from "./start-story-chat.ts";

/**
 * Start-order tests. What they check is when the irreversible things happen.
 *
 * Room creation and navigation cannot be undone. If acquisition fails and the room is still
 * created, the user keeps an empty conversation. If navigation happens without a room, the address
 * exists and the room does not. So on the failure path, what was not called matters more than what
 * was called on success.
 *
 * The component is not rendered. The order is unrelated to markup, and rendering would make this
 * test break whenever a button label changes.
 */

const seed = (): ChatSeed =>
	StoryChatSeedDto.parse({
		version: 1,
		storyId: "story-1",
		title: "Test story",
		adult: false,
		promptProtected: false,
	});

interface Overrides {
	store?: ChatStore | null;
	play?: () => Promise<ChatSeed>;
	createRoom?: () => Promise<ChatRoom>;
	navigate?: () => Promise<void>;
	/** Default: the store still belongs to the active scope. Only the ownership tests replace this. */
	stillOwnsStore?: (store: ChatStore) => boolean;
	/** Simulates a telemetry failure. The start must still succeed. */
	recordPlayStart?: "reject";
	/**
	 * The persona for this conversation. The screen makes the choice; what arrives here is one value.
	 */
	persona?: { name: string; description: string } | null;
}

/**
 * Builds one whole start. The call order is recorded as one line (`calls`). Per-step spies show
 * that both were called, but not which came first, and the order is exactly what is easy to get
 * wrong here.
 *
 * `lock` is a single shared object on purpose. The two calls in the duplicate-start test must share
 * one lock, or the race cannot be reproduced.
 */
function harness(overrides: Overrides = {}) {
	const calls: string[] = [];
	const lock = { current: false };

	const createRoom = vi.fn(async (_input: unknown) => {
		calls.push("createRoom");
		if (overrides.createRoom) return overrides.createRoom();
		return { id: "room-1" } as ChatRoom;
	});
	const store = { createRoom } as unknown as ChatStore;

	const ensureStore = vi.fn(async () => {
		calls.push("ensureStore");
		return overrides.store === undefined ? store : overrides.store;
	});
	const play = vi.fn(async (_storyId: string) => {
		calls.push("play");
		if (overrides.play) return overrides.play();
		return seed();
	});
	const navigate = vi.fn(async (_roomId: string) => {
		calls.push("navigate");
		await overrides.navigate?.();
	});
	const stillOwnsStore = vi.fn(
		(candidate: ChatStore) => overrides.stillOwnsStore?.(candidate) ?? true,
	);
	const recordPlayStart = vi.fn(async (_roomId: string) => {
		calls.push("recordPlayStart");
		if (overrides.recordPlayStart === "reject")
			throw new Error("telemetry down");
	});

	return {
		calls,
		lock,
		/**
		 * The store the active scope opened. The ownership tests use it as the reference for 'currently
		 * mine'.
		 */
		store,
		ensureStore,
		play,
		createRoom,
		navigate,
		stillOwnsStore,
		recordPlayStart,
		run: () =>
			startStoryChat({
				storyId: "story-1",
				lock,
				ensureStore,
				stillOwnsStore,
				play,
				navigate,
				recordPlayStart,
				...(overrides.persona !== undefined
					? { persona: overrides.persona }
					: {}),
			}),
	};
}

describe("success", () => {
	it("scope → acquire → room → navigate, each once in order", async () => {
		const t = harness();

		const outcome = await t.run();

		expect(outcome).toEqual({
			status: "started",
			roomId: "room-1",
			navigated: true,
		});
		expect(t.calls).toEqual([
			"ensureStore",
			"play",
			"createRoom",
			"recordPlayStart",
			"navigate",
		]);
		expect(t.ensureStore).toHaveBeenCalledTimes(1);
		expect(t.play).toHaveBeenCalledTimes(1);
		expect(t.createRoom).toHaveBeenCalledTimes(1);
		expect(t.navigate).toHaveBeenCalledTimes(1);
	});

	it("navigation goes to the room just created", async () => {
		const t = harness({
			createRoom: async () => ({ id: "room-42" }) as ChatRoom,
		});

		await t.run();

		expect(t.navigate).toHaveBeenCalledWith("room-42");
	});

	it("copies the snapshot into the room as is", async () => {
		const payload = seed();
		const t = harness({ play: async () => payload });

		await t.run();

		expect(t.createRoom).toHaveBeenCalledWith({
			originStoryId: "story-1",
			seed: payload,
		});
	});

	it("the chosen role rides on the call that creates the room", async () => {
		const payload = seed();
		const t = harness({
			play: async () => payload,
			persona: { name: "Alex", description: "A student." },
		});

		await t.run();

		expect(t.createRoom).toHaveBeenCalledWith({
			originStoryId: "story-1",
			seed: payload,
			persona: { name: "Alex", description: "A student." },
		});
	});

	/**
	 * If no persona was chosen, the key is not created at all. There must be one way to express 'no
	 * override' (`applyRoomPersona`). Passing `persona: null` would make rooms created before this
	 * feature look different.
	 */
	it("without a choice the key is absent", async () => {
		const payload = seed();
		const t = harness({ play: async () => payload, persona: null });

		await t.run();

		expect(t.createRoom).toHaveBeenCalledWith({
			originStoryId: "story-1",
			seed: payload,
		});
	});
});

describe("navigation failure", () => {
	/**
	 * The output of this action is the room, not the navigation. If a navigation failure were reported
	 * as `failed`, the screen would show `Please try again`. A user who follows that creates a second room
	 * for the same work. The start path has no deduplication, and should not: several conversations
	 * with one work are normal.
	 */
	it("a navigation failure is not a start failure — the room was created", async () => {
		const bench = harness({
			navigate: () => Promise.reject(new Error("router")),
		});

		const outcome = await bench.run();

		expect(outcome).toEqual({
			status: "started",
			roomId: "room-1",
			navigated: false,
		});
	});

	it("does not delete a room whose navigation failed — it stays in the list", async () => {
		const deleteRoom = vi.fn();
		const bench = harness({
			navigate: () => Promise.reject(new Error("router")),
		});
		Object.assign(bench.store, { deleteRoom });

		await bench.run();

		expect(bench.createRoom).toHaveBeenCalledTimes(1);
		expect(deleteRoom).not.toHaveBeenCalled();
	});

	it("a successful navigation records that fact as a value", async () => {
		const outcome = await harness().run();

		expect(outcome).toEqual({
			status: "started",
			roomId: "room-1",
			navigated: true,
		});
	});

	it("releases the lock even when navigation fails", async () => {
		const bench = harness({
			navigate: () => Promise.reject(new Error("router")),
		});

		await bench.run();

		expect(bench.lock.current).toBe(false);
	});
});

describe("acquisition failure", () => {
	it("without a playback payload there is no room and no navigation", async () => {
		/**
		 * The server's only distinguishing reason (`story_play_unavailable`). Do not invent an empty
		 * snapshot to create the room. That would leave a room with no scenario and no character on the
		 * user's device, and nothing would reveal which works had not yet been migrated.
		 */
		const t = harness({
			play: async () => {
				throw new RowCatApiError({
					status: 409,
					code: "story_play_unavailable",
					message: "A conversation can't be started for this story yet.",
				});
			},
		});

		const outcome = await t.run();

		expect(outcome).toEqual({ status: "failed", reason: "play_unavailable" });
		expect(t.createRoom).not.toHaveBeenCalled();
		expect(t.navigate).not.toHaveBeenCalled();
	});

	it("a 404 does not reveal the reason", async () => {
		const t = harness({
			play: async () => {
				throw new RowCatApiError({
					status: 404,
					code: "not_found",
					message: "Story not found.",
				});
			},
		});

		const outcome = await t.run();

		expect(outcome).toEqual({ status: "failed", reason: "unknown" });
		expect(t.createRoom).not.toHaveBeenCalled();
		expect(t.navigate).not.toHaveBeenCalled();
	});

	it("a network failure creates no room either", async () => {
		const t = harness({
			play: async () => {
				throw new TypeError("Failed to fetch");
			},
		});

		const outcome = await t.run();

		expect(outcome).toEqual({ status: "failed", reason: "unknown" });
		expect(t.createRoom).not.toHaveBeenCalled();
		expect(t.navigate).not.toHaveBeenCalled();
	});
});

describe("local store failure", () => {
	it("no acquisition when the scope cannot open", async () => {
		/**
		 * A missing store is reported as `storage`, not `play_unavailable`: the work data itself has no
		 * problem.
		 */
		const t = harness({ store: null });

		const outcome = await t.run();

		expect(outcome).toEqual({ status: "failed", reason: "storage" });
		expect(t.play).not.toHaveBeenCalled();
		expect(t.createRoom).not.toHaveBeenCalled();
		expect(t.navigate).not.toHaveBeenCalled();
	});

	it("no navigation when the room cannot be written", async () => {
		const t = harness({
			createRoom: async () => {
				throw new Error("QuotaExceededError");
			},
		});

		const outcome = await t.run();

		expect(outcome).toEqual({ status: "failed", reason: "storage" });
		expect(t.navigate).not.toHaveBeenCalled();
	});
});

describe("duplicate start", () => {
	it("a second call in the same tick creates no room", async () => {
		/**
		 * This is a double click. React state cannot prevent it: `setState` applies only on the next
		 * render, so two events in the same tick both see 'not in progress'. The two calls are made back
		 * to back with no `await` between them, on purpose. An `await` would let the first call take the
		 * lock before the second starts, and the race would not reproduce.
		 */
		const t = harness();

		const [first, second] = await Promise.all([t.run(), t.run()]);

		expect(first).toEqual({
			status: "started",
			roomId: "room-1",
			navigated: true,
		});
		expect(second).toEqual({ status: "busy" });
		expect(t.ensureStore).toHaveBeenCalledTimes(1);
		expect(t.play).toHaveBeenCalledTimes(1);
		expect(t.createRoom).toHaveBeenCalledTimes(1);
		expect(t.navigate).toHaveBeenCalledTimes(1);
	});

	it("releases the lock when done — retry is possible after failure", async () => {
		/**
		 * If the lock is not released, a work that failed once cannot be started again until a refresh.
		 * This is why the failure path is checked: the success path navigates away, so the stuck state
		 * would not show.
		 */
		let attempt = 0;
		const t = harness({
			play: async () => {
				attempt += 1;
				if (attempt === 1) throw new TypeError("Failed to fetch");
				return seed();
			},
		});

		expect(await t.run()).toEqual({ status: "failed", reason: "unknown" });
		expect(t.lock.current).toBe(false);
		expect(await t.run()).toEqual({
			status: "started",
			roomId: "room-1",
			navigated: true,
		});
	});
});

/**
 * Ownership changing during the start (a race).
 *
 * `ensureStore()` returns a store that is valid only at the moment it resolves. Two more waits
 * follow (acquire, write), so a logout or account switch can happen in between. The closure then
 * holds a store that now belongs to another account or is a closed connection.
 *
 * What is checked is one thing: nothing is committed after ownership is lost. This is not
 * cross-account data leakage, since scopes are separate and that cannot happen. It is an
 * unrequested write, and the symptom is silent: returning to the earlier account shows one extra
 * room that was never started.
 */
describe("ownership change", () => {
	it("no room when the account changes while acquiring", async () => {
		/**
		 * Alice starts. While the `/play` request is pending, the user switches to Bob, and then the
		 * response arrives.
		 *
		 * The room must not be created. If it were, that room would stay in Alice's on-device database,
		 * and removing it would need code that reopens another scope that is already closed.
		 */
		/** Bob's scope opened this store. It is a different instance from Alice's. */
		const bobStore = {} as ChatStore;
		let current: ChatStore | null = null;
		const t = harness({
			play: async () => {
				// The account switched to Bob just before the response arrived.
				current = bobStore;
				return seed();
			},
			stillOwnsStore: (candidate) => candidate === current,
		});
		// Alice's store is the active one when the start begins.
		current = t.store;

		const outcome = await t.run();

		expect(outcome).toEqual({ status: "stale" });
		expect(t.play).toHaveBeenCalledTimes(1);
		expect(t.createRoom).not.toHaveBeenCalled();
		expect(t.navigate).not.toHaveBeenCalled();
	});

	it("signing in again as the same member does not revive the old store", async () => {
		/**
		 * `Alice → log out → Alice again`. The member id is the same, but the connection was closed and
		 * reopened in between. A write aimed at the old instance would go to a closed connection.
		 *
		 * So the judgement must not rely on the member id alone. This test passes only for an
		 * implementation that asks the predicate about the instance itself, the same distinction
		 * `ownsScope` keeps in the generation turn.
		 */
		const reopened = { createRoom: vi.fn() } as unknown as ChatStore;
		let current: ChatStore | null = null;
		const t = harness({
			play: async () => {
				// Logged out and back into the same account. The connection was reopened.
				current = reopened;
				return seed();
			},
			stillOwnsStore: (candidate) => candidate === current,
		});
		current = t.store;

		const outcome = await t.run();

		expect(outcome).toEqual({ status: "stale" });
		expect(t.createRoom).not.toHaveBeenCalled();
		expect(t.navigate).not.toHaveBeenCalled();
	});

	it("no navigation to the room if ownership changed while writing it", async () => {
		let owns = true;
		const t = harness({
			createRoom: async () => {
				owns = false;
				return { id: "room-1" } as ChatRoom;
			},
			stillOwnsStore: () => owns,
		});

		const outcome = await t.run();

		expect(outcome).toEqual({ status: "stale" });
		expect(t.createRoom).toHaveBeenCalledTimes(1);
		expect(t.navigate).not.toHaveBeenCalled();
	});

	it("releases the lock even after losing ownership", async () => {
		// Not releasing the lock would leave this work unstartable after an account change, until a
		// refresh.
		let owns = false;
		const t = harness({ stillOwnsStore: () => owns });

		expect(await t.run()).toEqual({ status: "stale" });
		expect(t.lock.current).toBe(false);

		owns = true;
		expect(await t.run()).toEqual({
			status: "started",
			roomId: "room-1",
			navigated: true,
		});
	});

	it("asks right before each irreversible step — not in between", async () => {
		/**
		 * Checking ownership twice is the contract. With one check, the window between the check and the
		 * write stays open. Asking at every step would also put checks between pure calculations, which
		 * blurs when the answer is valid.
		 */
		const t = harness();

		await t.run();

		expect(t.stillOwnsStore).toHaveBeenCalledTimes(2);
		expect(t.calls).toEqual([
			"ensureStore",
			"play",
			"createRoom",
			"recordPlayStart",
			"navigate",
		]);
	});
});

/**
 * Play-start telemetry. When it fires defines the metric. It fires once, keyed by the room id,
 * after the room has been created and ownership confirmed. Acquisition success is not the event:
 * counting `/play` 200s would overstate it. A telemetry failure is not a start failure.
 */
describe("play start reporting", () => {
	it("reports once with the room id, after the room exists and before navigation", async () => {
		const t = harness({
			createRoom: async () => ({ id: "room-7" }) as ChatRoom,
		});
		await t.run();
		expect(t.calls).toEqual([
			"ensureStore",
			"play",
			"createRoom",
			"recordPlayStart",
			"navigate",
		]);
		expect(t.recordPlayStart).toHaveBeenCalledTimes(1);
		expect(t.recordPlayStart).toHaveBeenCalledWith("room-7");
	});

	it("no report when acquisition fails — a 200 is not a start", async () => {
		const t = harness({
			play: async () => {
				throw new Error("play failed");
			},
		});
		await t.run();
		expect(t.recordPlayStart).not.toHaveBeenCalled();
	});

	it("no report when the local write fails", async () => {
		const t = harness({
			createRoom: async () => {
				throw new Error("quota");
			},
		});
		await t.run();
		expect(t.recordPlayStart).not.toHaveBeenCalled();
	});

	it("no report if the account changed while writing the room", async () => {
		let checks = 0;
		const t = harness({
			stillOwnsStore: () => {
				checks += 1;
				return checks < 2;
			},
		});
		const outcome = await t.run();
		expect(outcome.status).toBe("stale");
		expect(t.recordPlayStart).not.toHaveBeenCalled();
	});

	it("a telemetry failure is not a start failure", async () => {
		const t = harness({ recordPlayStart: "reject" });
		const outcome = await t.run();
		expect(outcome).toEqual({
			status: "started",
			roomId: "room-1",
			navigated: true,
		});
	});
});
