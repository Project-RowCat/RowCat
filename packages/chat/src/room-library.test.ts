import { describe, expect, it } from "vitest";
import {
	DEFAULT_ROOM_SORT,
	normalizeRoomQuery,
	ROOM_LIBRARY_PAGE_SIZE,
	roomLibraryView,
} from "./room-library.ts";

/**
 * Checks the list rules without rendering. Failures in these rules are not caught by tests that
 * assert class names: search missing matches because of case, trimming before search making known
 * conversations appear absent, or equal-timestamp rooms swapping places on each refresh.
 *
 * This file came over from the web. Once two consumers exist (web `/chats` and the mobile
 * equivalent), the rules and their tests must be one copy. Per-app copies get fixed on one side
 * only, and then the two lists order the same rooms differently.
 */

const room = (id: string, title: string, updatedAt: string) => ({
	id,
	title,
	updatedAt,
});

/** Fixture in the order the repository returns it: most recent activity first. */
const rooms = [
	room("c", "Rei의 방", "2026-03-03T00:00:00.000Z"),
	room("a", "밤의 도서관", "2026-02-02T00:00:00.000Z"),
	room("b", "Alice", "2026-01-01T00:00:00.000Z"),
];

const view = (input: Partial<Parameters<typeof roomLibraryView>[0]> = {}) =>
	roomLibraryView({
		rooms,
		query: "",
		sort: DEFAULT_ROOM_SORT,
		visibleCount: ROOM_LIBRARY_PAGE_SIZE,
		...input,
	});

describe("search", () => {
	it("matches by title substring", () => {
		expect(view({ query: "도서" }).visible.map((r) => r.id)).toEqual(["a"]);
	});

	it("case-insensitive", () => {
		expect(view({ query: "REI" }).visible.map((r) => r.id)).toEqual(["c"]);
		expect(view({ query: "alice" }).visible.map((r) => r.id)).toEqual(["b"]);
	});

	it("surrounding whitespace is not part of the query", () => {
		expect(normalizeRoomQuery("  Rei  ")).toBe("rei");
		expect(view({ query: "   " }).matched).toBe(rooms.length);
	});

	/**
	 * A zero-result search is a different screen from a first-visit empty state. Merging them would
	 * show a user with many conversations, after one typo, the copy `No conversations yet`.
	 */
	it("distinguishes no search results from no conversations", () => {
		const searched = view({ query: "없는 이름" });
		expect(searched.matched).toBe(0);
		expect(searched.emptyBySearch).toBe(true);
		expect(searched.total).toBe(rooms.length);

		const empty = view({ rooms: [] });
		expect(empty.emptyBySearch).toBe(false);
		expect(empty.total).toBe(0);
	});
});

describe("sorting", () => {
	/**
	 * The default keeps the repository's order. If the screen re-sorted, it would disagree with the
	 * sidebar's `Recent chats` section, which reads the same `listRooms`.
	 */
	it("recent activity keeps the received order", () => {
		expect(view().visible).toEqual(rooms);
	});

	it("oldest activity is exactly the reverse", () => {
		expect(view({ sort: "oldest" }).visible.map((r) => r.id)).toEqual([
			"b",
			"a",
			"c",
		]);
	});

	it("name order uses Korean collation rules", () => {
		const mixed = [
			room("1", "Bob", "2026-01-01T00:00:00.000Z"),
			room("2", "alice", "2026-01-02T00:00:00.000Z"),
			room("3", "가나다", "2026-01-03T00:00:00.000Z"),
			room("4", "나다라", "2026-01-04T00:00:00.000Z"),
		];
		const ordered = roomLibraryView({
			rooms: mixed,
			query: "",
			sort: "title",
			visibleCount: 50,
		}).visible.map((r) => r.title);

		// Compared by code point, uppercase `Bob` would sort before lowercase `alice`.
		expect(ordered.indexOf("alice")).toBeLessThan(ordered.indexOf("Bob"));
		expect(ordered.indexOf("가나다")).toBeLessThan(ordered.indexOf("나다라"));
	});

	/** Sorting must not mutate the input. The subscription's array is shared with other screens. */
	it("does not sort the input array in place", () => {
		const source = [...rooms];
		roomLibraryView({
			rooms: source,
			query: "",
			sort: "title",
			visibleCount: 50,
		});
		expect(source).toEqual(rooms);
	});

	describe("the order of equal values does not wobble", () => {
		const tied = [
			room("z", "같은 시각", "2026-01-01T00:00:00.000Z"),
			room("y", "같은 시각", "2026-01-01T00:00:00.000Z"),
		];

		it("oldest-first splits by id", () => {
			expect(
				roomLibraryView({
					rooms: tied,
					query: "",
					sort: "oldest",
					visibleCount: 50,
				}).visible.map((r) => r.id),
			).toEqual(["y", "z"]);
		});

		/**
		 * When titles match, the more recent activity comes first; when that also matches, id decides.
		 * Two rooms with the same name do occur in practice.
		 */
		it("name order splits too", () => {
			expect(
				roomLibraryView({
					rooms: tied,
					query: "",
					sort: "title",
					visibleCount: 50,
				}).visible.map((r) => r.id),
			).toEqual(["z", "y"]);
		});
	});
});

describe("revealing", () => {
	const many = Array.from({ length: 120 }, (_, index) =>
		room(
			`r${index}`,
			index % 2 === 0 ? `짝 ${index}` : `홀 ${index}`,
			`2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
		),
	);

	it("draws up to the window size and says more exist", () => {
		const first = roomLibraryView({
			rooms: many,
			query: "",
			sort: "recent",
			visibleCount: ROOM_LIBRARY_PAGE_SIZE,
		});
		expect(first.visible).toHaveLength(ROOM_LIBRARY_PAGE_SIZE);
		expect(first.matched).toBe(many.length);
		expect(first.hasMore).toBe(true);
	});

	it("widening the window draws that many more, and show more disappears at the end", () => {
		const all = roomLibraryView({
			rooms: many,
			query: "",
			sort: "recent",
			visibleCount: many.length,
		});
		expect(all.visible).toHaveLength(many.length);
		expect(all.hasMore).toBe(false);
	});

	/**
	 * Confirms that trimming happens after search. Trimming first would search only the first 50 rows,
	 * and the user would be told that a conversation they know of does not exist.
	 */
	it("search finds conversations outside the window too", () => {
		const found = roomLibraryView({
			rooms: many,
			query: "홀 119",
			sort: "recent",
			visibleCount: ROOM_LIBRARY_PAGE_SIZE,
		});
		expect(found.visible.map((r) => r.id)).toEqual(["r119"]);
	});
});
