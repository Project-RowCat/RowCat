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
 * The seen-fact rules, checked by value without a storage medium.
 *
 * This app's tests do not render screens or open a simulator. The rules sit on the port
 * (`seen-store.ts`) and the native wiring stays in a one-key file, so everything that runs here is
 * the full set of rules that also runs on a device.
 */

function memory(initial: string | null = null) {
	let value = initial;
	const writes: string[] = [];
	const storage: UpdateNoteSeenStorage = {
		read: () => value,
		write: async (next) => {
			writes.push(next);
			value = next;
		},
	};
	return { storage, writes, current: () => value };
}

describe("reading is lenient", () => {
	it("no record means never seen", () => {
		expect(createUpdateNoteSeenStore(memory().storage).lastSeenId()).toBeNull();
	});

	/**
	 * Trusting an arbitrary string would let it sort lexically above the newest announcement date
	 * (`zzz`), and then no announcement would ever show on that device.
	 */
	it("non-date values fold to never seen", () => {
		for (const broken of ["", "zzz", "2026-02-30", "0.13.0", "2026/08/30"])
			expect(parseSeenUpdateNoteId(broken), broken).toBeNull();
	});

	it("the app doesn't stop even when reading throws", () => {
		const store = createUpdateNoteSeenStore({
			read: () => {
				throw new Error("the store doesn't open");
			},
			write: async () => {},
		});
		expect(store.lastSeenId()).toBeNull();
	});

	it("returns dates as is", () => {
		expect(
			createUpdateNoteSeenStore(memory("2026-08-30").storage).lastSeenId(),
		).toBe("2026-08-30");
	});
});

describe("writing is monotonic", () => {
	it("records the closed note", async () => {
		const { storage, current } = memory();
		await createUpdateNoteSeenStore(storage).markSeen("2026-08-30");
		expect(current()).toBe("2026-08-30");
	});

	/**
	 * However an old announcement was reopened, if closing it rolled back a newer announcement already
	 * recorded as seen, that newer announcement would show again.
	 */
	it("doesn't go back if a newer note was already seen", async () => {
		const { storage, writes, current } = memory("2026-09-15");
		await createUpdateNoteSeenStore(storage).markSeen("2026-08-30");
		expect(writes).toEqual([]);
		expect(current()).toBe("2026-09-15");
	});

	it("closing the same note again doesn't write", async () => {
		const { storage, writes } = memory("2026-08-30");
		await createUpdateNoteSeenStore(storage).markSeen("2026-08-30");
		expect(writes).toEqual([]);
	});

	/** Does not create an irreversible lock: a non-date value is never stored. */
	it("doesn't record non-date values", async () => {
		const { storage, writes } = memory();
		await createUpdateNoteSeenStore(storage).markSeen("0.13.0");
		expect(writes).toEqual([]);
	});

	it("doesn't throw even when saving fails", async () => {
		const store = createUpdateNoteSeenStore({
			read: () => null,
			write: async () => {
				throw new Error("The disk is full");
			},
		});
		await expect(store.markSeen("2026-08-30")).resolves.toBeUndefined();
	});
});

describe("key", () => {
	/**
	 * The device store also holds the appearance preference. A shared name would let one overwrite the
	 * other, and the symptom ("changing the theme re-shows the update note") is hard to trace back to
	 * its cause.
	 */
	it("holds no member id and has its own namespace", () => {
		expect(UPDATE_NOTE_SEEN_KEY).toBe("rowcat.updates.lastSeen");
		expect(UPDATE_NOTE_SEEN_KEY).not.toMatch(/viewer|member|user/i);
	});
});

describe("opening an old history row keeps the latest marker", () => {
	/**
	 * Opening an older history row became an ordinary operation. If that operation rolled the record
	 * back, the newest announcement not yet read would be marked as seen, and the user would never be
	 * shown that release again.
	 *
	 * This app has one more reason: writes are asynchronous, so the screen cannot re-read storage. A
	 * merge function that follows the same rule moves the screen's value too.
	 */
	const records = [
		{ releasedAt: "2026-08-30", inApp: { fixes: ["Fixed."] } },
		{ releasedAt: "2026-08-16", inApp: { fixes: ["Fixed."] } },
		{ releasedAt: "2026-08-02", inApp: { fixes: ["Fixed."] } },
	];

	it("opening an old row moves the record only up to that row", async () => {
		const store = memory();
		await createUpdateNoteSeenStore(store.storage).markSeen("2026-08-02");
		expect(store.current()).toBe("2026-08-02");
		expect(unseenUpdateNoteId("mobile", store.current(), records)).toBe(
			"2026-08-30",
		);
	});

	it("opening an old row after the latest doesn't go back", async () => {
		const store = memory();
		const seen = createUpdateNoteSeenStore(store.storage);
		await seen.markSeen("2026-08-30");
		await seen.markSeen("2026-08-02");
		expect(store.current()).toBe("2026-08-30");
		expect(unseenUpdateNoteId("mobile", store.current(), records)).toBeNull();
	});

	/** The screen, which does not wait for the write, gets the same answer; that is why this function exists. */
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
