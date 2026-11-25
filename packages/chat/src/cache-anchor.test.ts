import type { ChatGenerationMessage } from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import { chatCacheAnchorIndex } from "./cache-anchor.ts";

const user = (content: string): ChatGenerationMessage => ({
	role: "user",
	content,
});
const assistant = (content: string): ChatGenerationMessage => ({
	role: "assistant",
	content,
});

describe("chatCacheAnchorIndex — the end of the history the next turn resends", () => {
	it("is the answer right before the user's line", () => {
		expect(
			chatCacheAnchorIndex([
				user("a"),
				assistant("b"),
				user("c"),
				assistant("d"),
				user("e"),
			]),
		).toBe(3);
	});

	it("is absent on a first turn, and is the opening when there is one", () => {
		expect(chatCacheAnchorIndex([user("hi")])).toBe(-1);
		expect(chatCacheAnchorIndex([assistant("opening"), user("hi")])).toBe(0);
		expect(chatCacheAnchorIndex([])).toBe(-1);
	});

	/**
	 * The point of the anchor: the request the next turn sends reproduces everything up to it byte for
	 * byte, while the user's line (and the recall in front of it) is this turn's alone.
	 */
	it("lands where the next turn's request is the same", () => {
		const turn = [user("a"), assistant("b"), user("c")];
		const next = [...turn, assistant("d"), user("e")];
		const here = chatCacheAnchorIndex(turn);
		expect(next.slice(0, here + 1)).toEqual(turn.slice(0, here + 1));
		expect(chatCacheAnchorIndex(next)).toBeGreaterThan(here);
	});

	it("stays before the turn's line during a tool round trip", () => {
		expect(
			chatCacheAnchorIndex([
				user("a"),
				assistant("b"),
				user("roll"),
				{
					role: "assistant",
					content: "",
					toolCall: { id: "c1", name: "dice", arguments: {} },
				},
				{ role: "tool", callId: "c1", content: "17" },
			]),
		).toBe(1);
	});

	it("skips over an unanswered user line to the last answer", () => {
		expect(
			chatCacheAnchorIndex([
				user("a"),
				assistant("b"),
				user("failed"),
				user("again"),
			]),
		).toBe(1);
	});

	it("names no block an empty or tool-carrying answer cannot hold", () => {
		expect(chatCacheAnchorIndex([user("a"), assistant(""), user("c")])).toBe(
			-1,
		);
	});
});
