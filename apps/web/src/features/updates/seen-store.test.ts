import { unseenUpdateNoteId } from "@rowcat/domain";
import { describe, expect, it } from "vitest";
import {
	createUpdateNoteSeenStore,
	mergeSeenUpdateNoteId,
	parseSeenUpdateNoteId,
	UPDATE_NOTE_SEEN_KEY,
	type UpdateNoteSeenStorage,
} from "./seen-store.ts";

/**
 * The read-seen rule is checked by value, without a browser. The storage medium is passed in as an
 * argument instead of calling `localStorage` directly. SSR has no such global, and in private
 * browsing both reads and writes throw. Those paths must be verifiable here.
 */

function memory(initial: string | null = null) {
	const map = new Map<string, string>();
	if (initial !== null) map.set(UPDATE_NOTE_SEEN_KEY, initial);
	const writes: string[] = [];
	const storage: UpdateNoteSeenStorage = {
		getItem: (key) => map.get(key) ?? null,
		setItem: (key, value) => {
			writes.push(value);
			map.set(key, value);
		},
	};
	return {
		storage,
		writes,
		current: () => map.get(UPDATE_NOTE_SEEN_KEY) ?? null,
	};
}

describe("reads are lenient", () => {
	it("no record means never seen", () => {
		expect(createUpdateNoteSeenStore(memory().storage).lastSeenId()).toBeNull();
	});

	/**
	 * Trusting a stored string as-is can make it sort lexicographically above the latest note's date
	 * (`zzz`). In that browser, no note would ever appear again.
	 */
	it("a non-date value folds to never seen", () => {
		for (const broken of ["", "zzz", "2026-02-30", "0.13.0", "2026/08/30"])
			expect(parseSeenUpdateNoteId(broken), broken).toBeNull();
	});

	/** This happens in private browsing. Throwing here would stop the app from starting. */
	it("a throwing read does not stop the app", () => {
		const store = createUpdateNoteSeenStore({
			getItem: () => {
				throw new Error("access denied");
			},
			setItem: () => {},
		});
		expect(store.lastSeenId()).toBeNull();
	});

	/**
	 * On the server there is no storage medium. The answer is then 'never seen', and nothing is
	 * thrown.
	 */
	it("no medium quietly means never seen", () => {
		const store = createUpdateNoteSeenStore(null);
		expect(store.lastSeenId()).toBeNull();
		expect(() => store.markSeen("2026-08-30")).not.toThrow();
	});
});

describe("writes are monotonic", () => {
	it("records the note that was closed", () => {
		const { storage, current } = memory();
		createUpdateNoteSeenStore(storage).markSeen("2026-08-30");
		expect(current()).toBe("2026-08-30");
	});

	it("does not roll back when a newer note was already seen", () => {
		const { storage, writes, current } = memory("2026-09-15");
		createUpdateNoteSeenStore(storage).markSeen("2026-08-30");
		expect(writes).toEqual([]);
		expect(current()).toBe("2026-09-15");
	});

	it("closing the same note again writes nothing", () => {
		const { storage, writes } = memory("2026-08-30");
		createUpdateNoteSeenStore(storage).markSeen("2026-08-30");
		expect(writes).toEqual([]);
	});

	/** An irreversible lock is not created: a non-date value is never stored. */
	it("a non-date value is not recorded", () => {
		const { storage, writes } = memory();
		createUpdateNoteSeenStore(storage).markSeen("0.13.0");
		expect(writes).toEqual([]);
	});

	/** Private browsing and quota errors really throw here. The window has already closed by then. */
	it("a failed save does not throw", () => {
		const store = createUpdateNoteSeenStore({
			getItem: () => null,
			setItem: () => {
				throw new Error("no storage space");
			},
		});
		expect(() => store.markSeen("2026-08-30")).not.toThrow();
	});
});

describe("key", () => {
	/**
	 * The key must not include a member id. If it did, a guest's dismissal would have nowhere to be
	 * stored, and the same note would reappear on login. The two apps use the same key on purpose: one
	 * name per value.
	 */
	it("carries no member id and has its own namespace", () => {
		expect(UPDATE_NOTE_SEEN_KEY).toBe("rowcat.updates.lastSeen");
		expect(UPDATE_NOTE_SEEN_KEY).not.toMatch(/viewer|member|user/i);
	});
});

describe("opening an old history row keeps the newest marker", () => {
	/**
	 * Once a history existed, opening an old note became an ordinary action. If that action rolled
	 * back the record, an unread latest note would count as seen, and the person would never be
	 * notified about that release again. That loss cannot be undone, so the store and the screen
	 * follow the same rule (mergeSeenUpdateNoteId).
	 */
	const records = [
		{ releasedAt: "2026-08-30", inApp: { fixes: ["Fixed."] } },
		{ releasedAt: "2026-08-16", inApp: { fixes: ["Fixed."] } },
		{ releasedAt: "2026-08-02", inApp: { fixes: ["Fixed."] } },
	];

	it("opening an old row records only up to that row", () => {
		const store = memory();
		createUpdateNoteSeenStore(store.storage).markSeen("2026-08-02");
		expect(store.current()).toBe("2026-08-02");
		expect(unseenUpdateNoteId("web", store.current(), records)).toBe(
			"2026-08-30",
		);
	});

	it("opening an old row after the newest does not go back", () => {
		const store = memory();
		const seen = createUpdateNoteSeenStore(store.storage);
		seen.markSeen("2026-08-30");
		seen.markSeen("2026-08-02");
		expect(store.current()).toBe("2026-08-30");
		expect(unseenUpdateNoteId("web", store.current(), records)).toBeNull();
	});

	/** The screen uses the same rule, so its answer does not differ before the save finishes. */
	it("the merge rule gives the same answer as the store", () => {
		expect(mergeSeenUpdateNoteId(null, "2026-08-02")).toBe("2026-08-02");
		expect(mergeSeenUpdateNoteId("2026-08-30", "2026-08-02")).toBe(
			"2026-08-30",
		);
		expect(mergeSeenUpdateNoteId("2026-08-02", "2026-08-30")).toBe(
			"2026-08-30",
		);
		expect(mergeSeenUpdateNoteId("2026-08-02", "zzz")).toBe("2026-08-02");
	});
});
