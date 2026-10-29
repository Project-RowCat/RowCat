import { recentSidebarRooms, roomLibraryView } from "@rowcat/chat";
import { mergeConversationLibrary } from "@rowcat/domain";
import { describe, expect, it } from "vitest";

/**
 * Checks that the existing rules still hold on the unified library.
 * @rowcat/domain's merge and @rowcat/chat's search, sort, trim and recent-pick functions
 * do not know about each other. Only a file that can import both can verify how they fit, and this
 * is that place. Mobile calls the same two functions.
 */

const room = (id: string, title: string, updatedAt: string) => ({
	id,
	title,
	updatedAt,
});
const runtime = (storyId: string, title: string, updatedAt: string) => ({
	id: `runtime-conversation:${storyId}:default`,
	storyId,
	title,
	updatedAt,
});

const entries = () =>
	mergeConversationLibrary(
		[
			room("a", "Chat A", "2026-09-04T12:00:00Z"),
			room("c", "Chat C", "2026-09-04T11:00:00Z"),
		],
		[runtime("b", "Runtime B", "2026-09-04T13:00:00Z")],
	);

describe("list screen", () => {
	it("recent order follows the merged activity axis", () => {
		const view = roomLibraryView({
			rooms: entries(),
			query: "",
			sort: "recent",
			visibleCount: 50,
		});
		expect(view.visible.map((e) => e.title)).toEqual([
			"Runtime B",
			"Chat A",
			"Chat C",
		]);
		expect(view.total).toBe(3);
		expect(view.matched).toBe(3);
	});

	it("oldest order lines up both kinds too", () => {
		const view = roomLibraryView({
			rooms: entries(),
			query: "",
			sort: "oldest",
			visibleCount: 50,
		});
		expect(view.visible.map((e) => e.title)).toEqual([
			"Chat C",
			"Chat A",
			"Runtime B",
		]);
	});

	it("search scans both kinds of title", () => {
		const byChat = roomLibraryView({
			rooms: entries(),
			query: "chat a",
			sort: "recent",
			visibleCount: 50,
		});
		expect(byChat.visible.map((e) => e.kind)).toEqual(["chat"]);
		expect(byChat.matched).toBe(1);

		const byRuntime = roomLibraryView({
			rooms: entries(),
			query: "runtime",
			sort: "recent",
			visibleCount: 50,
		});
		expect(byRuntime.visible.map((e) => e.kind)).toEqual(["runtime"]);

		const none = roomLibraryView({
			rooms: entries(),
			query: "missing title",
			sort: "recent",
			visibleCount: 50,
		});
		expect(none.matched).toBe(0);
		expect(none.emptyBySearch).toBe(true);
	});

	/**
	 * The reveal window runs over the merged list. Rooms are not trimmed first with the runtime
	 * entries appended afterward.
	 */
	it("the reveal window cuts the merged order", () => {
		const view = roomLibraryView({
			rooms: entries(),
			query: "",
			sort: "recent",
			visibleCount: 2,
		});
		expect(view.visible.map((e) => e.title)).toEqual(["Runtime B", "Chat A"]);
		expect(view.hasMore).toBe(true);
	});
});

describe("recent conversations", () => {
	it("the open room outside the window stays", () => {
		const many = mergeConversationLibrary(
			Array.from({ length: 12 }, (_, i) =>
				room(
					`r${i}`,
					`R${i}`,
					`2026-09-04T${String(20 - i).padStart(2, "0")}:00:00Z`,
				),
			),
			[],
		);
		const rows = recentSidebarRooms(many, "r11");
		expect(rows).toHaveLength(11);
		expect(rows.at(-1)?.id).toBe("r11");
	});

	it("the open runtime row outside the window stays too", () => {
		const many = mergeConversationLibrary(
			Array.from({ length: 12 }, (_, i) =>
				room(
					`r${i}`,
					`R${i}`,
					`2026-09-04T${String(20 - i).padStart(2, "0")}:00:00Z`,
				),
			),
			[runtime("old", "Old Runtime", "2026-09-01T00:00:00Z")],
		);
		const rows = recentSidebarRooms(many, "runtime-conversation:old:default");
		expect(rows).toHaveLength(11);
		expect(rows.at(-1)?.kind).toBe("runtime");
	});
});
