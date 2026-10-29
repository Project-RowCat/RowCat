import type { ChatStore } from "@rowcat/chat";
import { ROOM_LIBRARY_PAGE_SIZE } from "@rowcat/chat";
import { describe, expect, it } from "vitest";
import {
	expandRoomRevealWindow,
	initialRoomRevealWindow,
	type RoomRevealWindow,
	reconcileRoomRevealWindow,
	roomRevealKey,
} from "./room-reveal.ts";

/**
 * Pins the **owner and lifetime** of the reveal window by value.
 *
 * This test exists because the symptom of getting it wrong is quiet. A window that survives when it
 * should not raises no error; the list just opens expanded by amounts the person never pressed for.
 * That state is only noticeable on accounts with hundreds of rooms.
 *
 * React is not rendered (the web test convention in this repository). So what the screen does is
 * imitated **as transitions**: when the condition changes, `reconcile`; when `Show more` is pressed,
 * `expand`. Passing each result to the next transition is the point. Re-passing an untouched old
 * window every time would reproduce exactly the defect this file exists to catch, since that
 * judgment alone always passes.
 */

/** Only the store's identity is used; this check does not look inside it. */
const storeOf = (name: string): ChatStore => ({ name }) as unknown as ChatStore;

const alice = storeOf("alice");
const bob = storeOf("bob");

/** What the screen does when the condition changes: rendering picks the window for that list. */
const visit = (
	reveal: RoomRevealWindow,
	store: ChatStore | null,
	key: string,
): RoomRevealWindow => reconcileRoomRevealWindow(reveal, store, key);

/** `Show more` always widens the window of the list currently shown. */
const showMore = (
	reveal: RoomRevealWindow,
	store: ChatStore | null,
	key: string,
): RoomRevealWindow => expandRoomRevealWindow(visit(reveal, store, key));

const RECENT = roomRevealKey("", "recent");
const TITLE = roomRevealKey("", "title");
const LIBRARY = roomRevealKey("library", "recent");

describe("the revealed window survives only under the same conditions", () => {
	it("same store and conditions keep as many presses", () => {
		let reveal = initialRoomRevealWindow(alice, RECENT);
		reveal = showMore(reveal, alice, RECENT);
		reveal = showMore(reveal, alice, RECENT);
		reveal = showMore(reveal, alice, RECENT);
		expect(reveal.count).toBe(ROOM_LIBRARY_PAGE_SIZE * 4);
		expect(visit(reveal, alice, RECENT).count).toBe(ROOM_LIBRARY_PAGE_SIZE * 4);
	});

	/**
	 * The window must be **the same object** when it is unchanged. Callers decide whether to write
	 * state based on that identity (`use-room-reveal.ts`); creating a new object each time would turn
	 * an ordinary re-render into a render loop.
	 */
	it("unchanged conditions keep the window identity", () => {
		const reveal = initialRoomRevealWindow(alice, RECENT);
		expect(visit(reveal, alice, RECENT)).toBe(reveal);
	});

	it("a changed query starts over", () => {
		const reveal = showMore(
			initialRoomRevealWindow(alice, RECENT),
			alice,
			RECENT,
		);
		expect(visit(reveal, alice, LIBRARY).count).toBe(ROOM_LIBRARY_PAGE_SIZE);
	});

	it("a changed sort starts over too", () => {
		const reveal = showMore(
			initialRoomRevealWindow(alice, RECENT),
			alice,
			RECENT,
		);
		expect(visit(reveal, alice, TITLE).count).toBe(ROOM_LIBRARY_PAGE_SIZE);
	});

	/** An edit that only changes whitespace is the same query. Collapsing the window here would reset the list on a single space. */
	it("surrounding whitespace does not change the conditions", () => {
		let reveal = initialRoomRevealWindow(alice, LIBRARY);
		reveal = showMore(reveal, alice, LIBRARY);
		expect(reveal.count).toBe(ROOM_LIBRARY_PAGE_SIZE * 2);
		expect(
			visit(reveal, alice, roomRevealKey(" library ", "recent")).count,
		).toBe(ROOM_LIBRARY_PAGE_SIZE * 2);
	});

	/** `Show more` widens **the list currently shown**, not the window you left. */
	it("`Show more` right after changing conditions widens the new list", () => {
		let reveal = initialRoomRevealWindow(alice, RECENT);
		reveal = showMore(reveal, alice, RECENT);
		reveal = showMore(reveal, alice, RECENT);
		reveal = showMore(reveal, alice, RECENT);

		reveal = showMore(reveal, alice, LIBRARY);
		expect(reveal.key).toBe(LIBRARY);
		expect(reveal.count).toBe(ROOM_LIBRARY_PAGE_SIZE * 2);
	});
});

/**
 * The window ends when you leave its condition. This group is why this file was rewritten.
 *
 * The old check kept the saved window and only answered "if it is not this list's, the initial
 * value". So clearing the search or restoring the sort brought back a screen expanded by amounts
 * the person had never pressed for in that list. There is no memory per condition: only one live
 * window exists at a time.
 */
describe("a window from conditions left behind does not come back", () => {
	it("changing the query and back does not revive the earlier expansion", () => {
		let reveal = initialRoomRevealWindow(alice, RECENT);
		reveal = showMore(reveal, alice, RECENT);
		reveal = showMore(reveal, alice, RECENT);
		reveal = showMore(reveal, alice, RECENT);
		expect(reveal.count).toBe(ROOM_LIBRARY_PAGE_SIZE * 4);

		// Type "library": the earlier window ends here, even without pressing `Show more`.
		reveal = visit(reveal, alice, LIBRARY);
		expect(reveal.count).toBe(ROOM_LIBRARY_PAGE_SIZE);

		// Clear the query. Same condition as before, but this is a **new visit**.
		reveal = visit(reveal, alice, RECENT);
		expect(reveal.count).toBe(ROOM_LIBRARY_PAGE_SIZE);
	});

	it("changing the sort and back does not revive the earlier expansion", () => {
		let reveal = initialRoomRevealWindow(alice, RECENT);
		reveal = showMore(reveal, alice, RECENT);
		reveal = showMore(reveal, alice, RECENT);
		reveal = showMore(reveal, alice, RECENT);

		reveal = visit(reveal, alice, TITLE);
		reveal = visit(reveal, alice, RECENT);
		expect(reveal.count).toBe(ROOM_LIBRARY_PAGE_SIZE);
	});

	/** Confirms over several round trips that this is not per-condition memory. */
	it("after moving across several conditions, the returned list starts over", () => {
		let reveal = initialRoomRevealWindow(alice, RECENT);
		reveal = showMore(reveal, alice, RECENT);
		reveal = showMore(reveal, alice, RECENT);
		reveal = showMore(reveal, alice, RECENT);

		reveal = visit(reveal, alice, LIBRARY);
		reveal = visit(reveal, alice, roomRevealKey("library night", "recent"));
		reveal = visit(reveal, alice, RECENT);
		expect(reveal.count).toBe(ROOM_LIBRARY_PAGE_SIZE);
	});

	/** The same once you return with the same query: that window has already ended. */
	it("returning to the same query is not the old window", () => {
		let reveal = initialRoomRevealWindow(alice, LIBRARY);
		reveal = showMore(reveal, alice, LIBRARY);
		expect(reveal.count).toBe(ROOM_LIBRARY_PAGE_SIZE * 2);

		reveal = visit(reveal, alice, roomRevealKey("library night", "recent"));
		reveal = visit(reveal, alice, LIBRARY);
		expect(reveal.count).toBe(ROOM_LIBRARY_PAGE_SIZE);
	});
});

/**
 * The account axis.
 *
 * The point is that the query condition does not change at all. Judgments that only looked at the
 * condition passed every case here, and what they passed was a window from another person's list
 * applied to this one.
 */
describe("the window does not cross accounts", () => {
	const expanded = (store: ChatStore | null): RoomRevealWindow => {
		let reveal = initialRoomRevealWindow(store, RECENT);
		reveal = showMore(reveal, store, RECENT);
		reveal = showMore(reveal, store, RECENT);
		reveal = showMore(reveal, store, RECENT);
		return reveal;
	};

	it("a changed account starts over even with the same conditions", () => {
		expect(visit(expanded(alice), bob, RECENT).count).toBe(
			ROOM_LIBRARY_PAGE_SIZE,
		);
	});

	/**
	 * A path that would pass if the member id were compared. The same person signing in again closes
	 * and reopens the database connection, which makes a different object.
	 */
	it("the same member signing in again on a new instance starts over", () => {
		const reopened = storeOf("alice");
		expect(visit(expanded(alice), reopened, RECENT).count).toBe(
			ROOM_LIBRARY_PAGE_SIZE,
		);
	});

	/**
	 * While the scope is closed (sign-out or account switch) there is no store. The screen shows a
	 * placeholder meanwhile, but the window must not stay alive at that moment: it is not yet known
	 * whose database will open next.
	 */
	it("closing the scope folds the window", () => {
		expect(visit(expanded(alice), null, RECENT).count).toBe(
			ROOM_LIBRARY_PAGE_SIZE,
		);
	});

	/**
	 * **Round-tripping the state must not revive a window.** This is where the old check was really
	 * wrong: status goes `ready → activating → ready`, so after sign-out the key matched the key from
	 * before it.
	 */
	it("returning after sign-out does not revive the previous person's window", () => {
		let reveal = expanded(alice);
		// While the scope is closed the screen is a placeholder, and the earlier window ends here.
		reveal = visit(reveal, null, RECENT);
		expect(reveal.count).toBe(ROOM_LIBRARY_PAGE_SIZE);
		// The next account opens. The query condition is unchanged.
		reveal = visit(reveal, bob, RECENT);
		expect(reveal.count).toBe(ROOM_LIBRARY_PAGE_SIZE);
	});

	/** `null` is not the owner of the next store to open, even if the same person opens it again. */
	it("a window from the closed gap does not attach to the newly opened database", () => {
		const reopened = storeOf("alice");
		let reveal = expanded(alice);
		reveal = visit(reveal, null, RECENT);
		reveal = showMore(reveal, null, RECENT);
		expect(visit(reveal, reopened, RECENT).count).toBe(ROOM_LIBRARY_PAGE_SIZE);
	});
});
