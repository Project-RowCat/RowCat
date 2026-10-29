import type {
	ChatPersonaSnapshot,
	ChatRoom,
	ChatSeed,
	ChatStore,
} from "@rowcat/chat";
import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it, vi } from "vitest";
import { seed } from "../../test/fixtures.ts";
import { startStoryChat } from "./start-story-chat.ts";

/**
 * Start-order tests. What they check is **when the irreversible things happen**.
 *
 * Creating a room and navigating to it cannot be undone. If acquisition fails but the room was
 * created, the user is left with an empty conversation; if navigation happens without a room, the
 * address exists and the room does not. So on the failure paths, **what was not called** matters
 * more than the success path.
 *
 * The screen is not rendered. This order is unrelated to markup, and mounting a renderer would
 * break these tests every time a button's copy changed (and this app's test environment has no
 * renderer).
 */

interface Overrides {
	store?: ChatStore | null;
	play?: () => Promise<ChatSeed>;
	createRoom?: () => Promise<ChatRoom>;
	navigate?: () => Promise<void>;
	/** Default is "still mine". Only the ownership tests swap this out. */
	stillOwnsStore?: (store: ChatStore) => boolean;
	/** Simulates a telemetry failure; the start must still succeed. */
	recordPlayStart?: "reject";
	/** Role chosen before starting. Omitted means start without an override (the work's suggestion applies). */
	persona?: ChatPersonaSnapshot | null;
}

/**
 * Builds one whole start.
 *
 * The point is to record the call order as one line (`calls`). Per-step spies alone show that "both
 * were called" but not **which came first**, and that exact order is what is easy to get wrong
 * here.
 *
 * Keeping a single `lock` is intentional too: the two calls in the duplicate-start test must share
 * one lock for the race to reproduce.
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
		return seed("Test story");
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
		/** The store the active scope handed over; the ownership tests use it as the reference for "still mine". */
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
				...(overrides.persona === undefined
					? {}
					: { persona: overrides.persona }),
			}),
	};
}

describe("success", () => {
	it("scope → acquisition → room → navigation each happen once, in order", async () => {
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

	it("navigation goes to the room just made", async () => {
		const t = harness({
			createRoom: async () => ({ id: "room-42" }) as ChatRoom,
		});

		await t.run();

		expect(t.navigate).toHaveBeenCalledWith("room-42");
	});

	it("copies the snapshot into the room as is", async () => {
		const payload = seed("Test story");
		const t = harness({ play: async () => payload });

		await t.run();

		expect(t.createRoom).toHaveBeenCalledWith({
			originStoryId: "story-1",
			seed: payload,
		});
	});

	/**
	 * **The chosen role is pinned in the same transaction as the room.**
	 *
	 * If it were applied after creation, the first frame where the opening is drawn would show the
	 * work's default role, and anyone who sent a first turn in that gap would start a conversation
	 * where the name on screen differs from the name the model received. The guarantee is that no call
	 * comes after `createRoom`.
	 */
	it("the chosen role goes into the room creation arguments", async () => {
		const persona: ChatPersonaSnapshot = {
			name: "Lynn",
			description: "Chronicler",
		};
		const payload = seed("Test story");
		const t = harness({ play: async () => payload, persona });

		await t.run();

		expect(t.createRoom).toHaveBeenCalledWith({
			originStoryId: "story-1",
			seed: payload,
			persona,
		});
		/** There is no second write applied **after** the room is created. */
		expect(t.calls).toEqual([
			"ensureStore",
			"play",
			"createRoom",
			"recordPlayStart",
			"navigate",
		]);
	});

	/**
	 * **No override is the absence of the key.** `undefined` and `null` mean the same thing, but if
	 * both shapes live in storage, the same fact becomes two different objects, and the difference
	 * surfaces only as "applying the same page twice gives different results".
	 */
	it("without a chosen role, that key isn't passed", async () => {
		const payload = seed("Test story");
		for (const persona of [undefined, null] as const) {
			const t = harness({ play: async () => payload, persona });
			await t.run();
			expect(t.createRoom).toHaveBeenCalledWith({
				originStoryId: "story-1",
				seed: payload,
			});
		}
	});

	/**
	 * The room's identity is **made by the device**. Pin by value that the only argument sent to the
	 * server is the work id: once a room id starts riding along, a room list on the server is only a
	 * matter of time.
	 */
	it("the only thing sent to `/play` is the story id", async () => {
		const t = harness();

		await t.run();

		expect(t.play).toHaveBeenCalledWith("story-1");
		expect(t.play.mock.calls[0]).toHaveLength(1);
	});
});

describe("navigation failure", () => {
	/**
	 * The product of this operation is the **room**, not the navigation.
	 *
	 * If a navigation failure is folded into `failed`, the screen shows "please try again", and a user
	 * who follows that creates one more room for the same work. The start path has no deduplication,
	 * and it should not: having several conversations with the same work is normal.
	 */
	it("a navigation failure isn't a start failure — the room was made", async () => {
		const t = harness({ navigate: () => Promise.reject(new Error("router")) });

		expect(await t.run()).toEqual({
			status: "started",
			roomId: "room-1",
			navigated: false,
		});
	});

	it("doesn't delete a room whose navigation failed — it stays in the conversation list", async () => {
		const deleteRoom = vi.fn();
		const t = harness({ navigate: () => Promise.reject(new Error("router")) });
		Object.assign(t.store, { deleteRoom });

		await t.run();

		expect(t.createRoom).toHaveBeenCalledTimes(1);
		expect(deleteRoom).not.toHaveBeenCalled();
	});

	it("releases the lock even when navigation fails", async () => {
		const t = harness({ navigate: () => Promise.reject(new Error("router")) });

		await t.run();

		expect(t.lock.current).toBe(false);
	});
});

describe("acquisition failure", () => {
	it("without a playback payload there's neither room nor navigation", async () => {
		/**
		 * The one reason the server splits out (`story_play_unavailable`). Do not fabricate an empty
		 * snapshot to create a room: that would leave a room with no scenario and no characters on the
		 * user's device.
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

		expect(await t.run()).toEqual({
			status: "failed",
			reason: "play_unavailable",
		});
		expect(t.createRoom).not.toHaveBeenCalled();
		expect(t.navigate).not.toHaveBeenCalled();
	});

	it("404 doesn't reveal the reason", async () => {
		/**
		 * The server gives the same 404 for a nonexistent work and for one that cannot be viewed
		 * (private, archived, operator-hidden, adult gate, blocked). If the screen unpacked that, anyone
		 * could check someone else's private work just by scanning ids, so there must be a single branch
		 * here too.
		 */
		const t = harness({
			play: async () => {
				throw new RowCatApiError({
					status: 404,
					code: "not_found",
					message: "The story couldn't be found.",
				});
			},
		});

		expect(await t.run()).toEqual({ status: "failed", reason: "unknown" });
		expect(t.createRoom).not.toHaveBeenCalled();
		expect(t.navigate).not.toHaveBeenCalled();
	});

	it("a network failure doesn't create a room either", async () => {
		const t = harness({
			play: async () => {
				throw new TypeError("Network request failed");
			},
		});

		expect(await t.run()).toEqual({ status: "failed", reason: "unknown" });
		expect(t.createRoom).not.toHaveBeenCalled();
		expect(t.navigate).not.toHaveBeenCalled();
	});
});

describe("local storage failure", () => {
	it("if the scope can't open it doesn't acquire either", async () => {
		/**
		 * This is why the order runs in this direction. If the snapshot were fetched first and the store
		 * turned out to be missing, the body would be downloaded for nothing that could stay on the
		 * device, costing time and data. A guest's press also lands on this branch (there is no database
		 * to open).
		 *
		 * The reason is not `play_unavailable`: nothing is wrong with the work data.
		 */
		const t = harness({ store: null });

		expect(await t.run()).toEqual({ status: "failed", reason: "storage" });
		expect(t.play).not.toHaveBeenCalled();
		expect(t.createRoom).not.toHaveBeenCalled();
		expect(t.navigate).not.toHaveBeenCalled();
	});

	it("if the room can't be written it doesn't navigate", async () => {
		/**
		 * Do not fall back to memory or AsyncStorage here. A room created that way vanishes when the app
		 * restarts, and the user believes they started a conversation. That is worse than having none.
		 */
		const t = harness({
			createRoom: async () => {
				throw new Error("SQLITE_FULL");
			},
		});

		expect(await t.run()).toEqual({ status: "failed", reason: "storage" });
		expect(t.navigate).not.toHaveBeenCalled();
	});
});

describe("duplicate starts", () => {
	it("a second call in the same tick doesn't create a room", async () => {
		/**
		 * A double press. React state cannot stop it: `setState` takes effect on the next render, so when
		 * two events land in the same tick, both see "not in progress".
		 *
		 * The point is to call twice with no `await` between. With one, the first call would already hold
		 * the lock by the time the second runs, and this race would not reproduce.
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

	it("releases the lock when done — it can retry after failing", async () => {
		/**
		 * If the lock is not released, a work that failed once cannot be started again until the app
		 * restarts. This is why it is checked on the failure path (the success path navigates away, so
		 * nothing shows).
		 */
		let attempt = 0;
		const t = harness({
			play: async () => {
				attempt += 1;
				if (attempt === 1) throw new TypeError("Network request failed");
				return seed("Test story");
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
 * A race where ownership changes **after the start**.
 *
 * The store `ensureStore()` returned is only a fact as of the moment it finished. Two more waits
 * follow (acquisition and write), so a logout or account switch can land in between, and the store
 * that the old closure holds is then another account's or a closed connection.
 *
 * One thing is checked here: **after ownership is lost, nothing commits.** The symptom is silent
 * (returning to the previous account shows one more room that was never started), so it is pinned
 * by value.
 */
describe("ownership change", () => {
	it("if the account switches while waiting for acquisition, no room is made", async () => {
		/** Alice starts; while `/play` is pending, the account switches to Bob; then the request arrives. */
		const bobStore = {} as ChatStore;
		let current: ChatStore | null = null;
		const t = harness({
			play: async () => {
				current = bobStore;
				return seed("Test story");
			},
			stillOwnsStore: (candidate) => candidate === current,
		});
		current = t.store;

		expect(await t.run()).toEqual({ status: "stale" });
		expect(t.play).toHaveBeenCalledTimes(1);
		expect(t.createRoom).not.toHaveBeenCalled();
		expect(t.navigate).not.toHaveBeenCalled();
	});

	it("even signing in again as the same member doesn't revive the old store", async () => {
		/**
		 * `Alice → sign out → Alice again`. The member id is the same, but in between the connection was
		 * closed and reopened, so a write aimed at the old instance goes to a closed connection. The
		 * verdict therefore cannot look at the member id alone, and this test passes only in an
		 * implementation that asks the predicate about the **instance**.
		 */
		const reopened = { createRoom: vi.fn() } as unknown as ChatStore;
		let current: ChatStore | null = null;
		const t = harness({
			play: async () => {
				current = reopened;
				return seed("Test story");
			},
			stillOwnsStore: (candidate) => candidate === current,
		});
		current = t.store;

		expect(await t.run()).toEqual({ status: "stale" });
		expect(t.createRoom).not.toHaveBeenCalled();
		expect(t.navigate).not.toHaveBeenCalled();
	});

	it("if it changes while writing the room, it doesn't navigate to that room", async () => {
		/**
		 * The last and narrowest window. There is no way to make the local write and the navigation one
		 * transaction, so this window cannot be removed; instead **navigation alone** is blocked. Opening
		 * a previous account's room address for whoever is now signed in would send them looking for a
		 * room outside their scope, ending on "a missing conversation".
		 */
		let owns = true;
		const t = harness({
			createRoom: async () => {
				owns = false;
				return { id: "room-1" } as ChatRoom;
			},
			stillOwnsStore: () => owns,
		});

		expect(await t.run()).toEqual({ status: "stale" });
		expect(t.createRoom).toHaveBeenCalledTimes(1);
		expect(t.navigate).not.toHaveBeenCalled();
	});

	it("releases the lock even when ownership is lost", async () => {
		// Without releasing it, after an account switch this work cannot be started until the app
		// restarts.
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
		 * Two checks is the contract. With one, the remaining window stays as it is; checking at every
		 * step would wedge the verdict into pure computation and blur "when is it valid".
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
 * Play-start telemetry: **when it fires** is the definition of this metric.
 *
 * Only after the room is created and ownership is confirmed, once, keyed by the room id. Successful
 * acquisition is not that event (counting `/play`'s 200 would give a number larger than reality),
 * and a telemetry failure is not a start failure.
 */
describe("recording play starts", () => {
	it("after the room is made and before navigating, uploads once with the room id", async () => {
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

	it("doesn't upload if acquisition fails — a 200 response isn't a start", async () => {
		const t = harness({
			play: async () => {
				throw new Error("play failed");
			},
		});
		await t.run();
		expect(t.recordPlayStart).not.toHaveBeenCalled();
	});

	it("doesn't upload if the local write fails", async () => {
		const t = harness({
			createRoom: async () => {
				throw new Error("quota");
			},
		});
		await t.run();
		expect(t.recordPlayStart).not.toHaveBeenCalled();
	});

	it("doesn't upload if the account switched while writing the room", async () => {
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

	it("a telemetry failure isn't a start failure", async () => {
		const t = harness({ recordPlayStart: "reject" });
		const outcome = await t.run();
		expect(outcome).toEqual({
			status: "started",
			roomId: "room-1",
			navigated: true,
		});
	});
});
