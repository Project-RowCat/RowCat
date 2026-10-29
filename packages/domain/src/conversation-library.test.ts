import { describe, expect, it } from "vitest";
import {
	activeConversationEntryId,
	mergeConversationLibrary,
} from "./conversation-library.ts";

/**
 * Merging the unified library: two kinds mixed on one activity axis. Search, sort, truncation, and
 * picking the most recent rows run through two functions in
 * @rowcat/chat
 * that read only type arguments, so they are not re-tested here (the assembly point's test covers
 * that join). What this file pins is the one rule it owns: the order.
 */

const room = (id: string, title: string, updatedAt: string) => ({
	id,
	title,
	updatedAt,
	adult: false,
});
const runtime = (id: string, title: string, updatedAt: string) => ({
	id: `runtime-conversation:${id}:default`,
	storyId: id,
	title,
	updatedAt,
});

describe("merging", () => {
	it("a runtime row stands between two conversations by activity time", () => {
		const merged = mergeConversationLibrary(
			[
				room("a", "Chat A", "2026-09-04T12:00:00Z"),
				room("c", "Chat C", "2026-09-04T11:00:00Z"),
			],
			[runtime("b", "Runtime B", "2026-09-04T13:00:00Z")],
		);
		expect(merged.map((entry) => entry.title)).toEqual([
			"Runtime B",
			"Chat A",
			"Chat C",
		]);
		expect(merged.map((entry) => entry.kind)).toEqual([
			"runtime",
			"chat",
			"chat",
		]);
	});

	it("does not rely on input order", () => {
		const forward = mergeConversationLibrary(
			[room("a", "A", "t1"), room("b", "B", "t3")],
			[runtime("r", "R", "t2")],
		);
		const reversed = mergeConversationLibrary(
			[room("b", "B", "t3"), room("a", "A", "t1")],
			[runtime("r", "R", "t2")],
		);
		expect(forward.map((e) => e.id)).toEqual(reversed.map((e) => e.id));
		expect(forward.map((e) => e.id)).toEqual([
			"b",
			"runtime-conversation:r:default",
			"a",
		]);
	});

	it("equal times sort by descending id, so refreshes do not reshuffle", () => {
		const merged = mergeConversationLibrary(
			[room("a", "A", "t"), room("z", "Z", "t")],
			[runtime("m", "M", "t")],
		);
		expect(merged.map((e) => e.id)).toEqual([
			"z",
			"runtime-conversation:m:default",
			"a",
		]);
	});

	it("a row holds its original record; each kind's operations read it", () => {
		const [entry] = mergeConversationLibrary([], [runtime("s", "S", "t")]);
		expect(entry?.kind).toBe("runtime");
		if (entry?.kind !== "runtime") return;
		expect(entry.storyId).toBe("s");
		expect(entry.conversation.title).toBe("S");
	});
});

describe("active row", () => {
	it("an open room is the room, an open runtime is its row, otherwise none", () => {
		expect(
			activeConversationEntryId({
				activeRoomId: "room",
				activeRuntimeConversationId: null,
			}),
		).toBe("room");
		expect(
			activeConversationEntryId({
				activeRoomId: null,
				activeRuntimeConversationId: "runtime-conversation:s:default",
			}),
		).toBe("runtime-conversation:s:default");
		expect(
			activeConversationEntryId({
				activeRoomId: null,
				activeRuntimeConversationId: null,
			}),
		).toBeNull();
	});
});
