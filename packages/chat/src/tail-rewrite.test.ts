import { describe, expect, it } from "vitest";
import {
	ChatMessageContentError,
	ChatMessageRoleError,
	canEditMessageRole,
	canRegenerateMessageRole,
	checkMessageContent,
	compareChatMessageOrder,
	requireEditableRole,
	requireMessageContent,
	selectChatTail,
} from "./tail-rewrite.ts";

/**
 * Tail selection is the boundary of an irreversible operation. Off by one here either deletes one
 * message too many (cutting off a response being read), or leaves one too few, so an old response
 * survives on a conversation that has changed. Both look like success on screen, and neither can be
 * undone.
 */

/** Sets createdAt explicitly so the ordering axis matches the repository's. */
const line = (id: string, createdAt: string) => ({ id, createdAt });

const conversation = [
	line("m1", "2026-01-01T00:00:00.000Z"),
	line("m2", "2026-01-01T00:00:01.000Z"),
	line("m3", "2026-01-01T00:00:02.000Z"),
	line("m4", "2026-01-01T00:00:03.000Z"),
	line("m5", "2026-01-01T00:00:04.000Z"),
];

const ids = (rows: { id: string }[] | null) => rows?.map((row) => row.id);

describe("tail selection", () => {
	it("first message: `from` is the whole conversation, `after` everything after it", () => {
		expect(ids(selectChatTail(conversation, "m1", "from"))).toEqual([
			"m1",
			"m2",
			"m3",
			"m4",
			"m5",
		]);
		expect(ids(selectChatTail(conversation, "m1", "after"))).toEqual([
			"m2",
			"m3",
			"m4",
			"m5",
		]);
	});

	it("middle message: the front stays and only the rest is selected", () => {
		expect(ids(selectChatTail(conversation, "m3", "from"))).toEqual([
			"m3",
			"m4",
			"m5",
		]);
		expect(ids(selectChatTail(conversation, "m3", "after"))).toEqual([
			"m4",
			"m5",
		]);
	});

	it("last message: `after` is an empty array (not null)", () => {
		expect(ids(selectChatTail(conversation, "m5", "from"))).toEqual(["m5"]);
		/**
		 * This distinction drives the caller's branching. An empty array means there is nothing to delete
		 * (the last message was edited). null means there is no anchor, so nothing may be done.
		 */
		expect(selectChatTail(conversation, "m5", "after")).toEqual([]);
	});

	it("null without an anchor: not folded into an empty array", () => {
		expect(selectChatTail(conversation, "없는-id", "from")).toBeNull();
		expect(selectChatTail(conversation, "없는-id", "after")).toBeNull();
	});

	it("null in an empty conversation too", () => {
		expect(selectChatTail([], "m1", "from")).toBeNull();
	});

	it("picks the same range for shuffled input and returns it ascending", () => {
		/**
		 * This test shows that the tail is not cut by array position. A screen that loads older messages
		 * can pass an unsorted array at any time.
		 */
		const shuffled = [
			conversation[3],
			conversation[0],
			conversation[4],
			conversation[2],
			conversation[1],
		];
		expect(ids(selectChatTail(shuffled, "m3", "from"))).toEqual([
			"m3",
			"m4",
			"m5",
		]);
	});

	it("id breaks ties at the same time: the same order as the store's compound index", () => {
		const tied = [
			line("b", "2026-01-01T00:00:00.000Z"),
			line("a", "2026-01-01T00:00:00.000Z"),
			line("c", "2026-01-01T00:00:00.000Z"),
		];
		expect(ids(selectChatTail(tied, "b", "from"))).toEqual(["b", "c"]);
		expect(ids(selectChatTail(tied, "b", "after"))).toEqual(["c"]);
		expect(compareChatMessageOrder(tied[1], tied[0])).toBeLessThan(0);
	});

	it("`from` is larger than `after` by exactly the anchor", () => {
		for (const anchor of conversation) {
			const from = selectChatTail(conversation, anchor.id, "from") ?? [];
			const after = selectChatTail(conversation, anchor.id, "after") ?? [];
			expect(from.length).toBe(after.length + 1);
			expect(from[0]?.id).toBe(anchor.id);
		}
	});
});

describe("actions per role", () => {
	it("editing is open to both roles", () => {
		expect(canEditMessageRole("user")).toBe(true);
		expect(canEditMessageRole("assistant")).toBe(true);
	});

	/**
	 * The gate guards which door a message came in through, not whether it is editable. Once both
	 * roles are editable, a predicate asking only that is always true and blocks nothing. What must be
	 * blocked is an assistant response being saved through editUserMessage's rules. Taking the
	 * expected role as an argument pins each operation's role as a value, so a mismatched call cannot
	 * pass silently.
	 */
	it("a message of a different role cannot enter that door", () => {
		expect(() => requireEditableRole("user", "user")).not.toThrow();
		expect(() => requireEditableRole("assistant", "assistant")).not.toThrow();
		expect(() => requireEditableRole("assistant", "user")).toThrow(
			ChatMessageRoleError,
		);
		expect(() => requireEditableRole("user", "assistant")).toThrow(
			ChatMessageRoleError,
		);
	});

	/**
	 * The diagnostic states what the call should have been. Both the received role and the expected
	 * role are kept.
	 */
	it("the refusal carries both the received and the expected role", () => {
		try {
			requireEditableRole("assistant", "user");
			expect.unreachable();
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(ChatMessageRoleError);
			expect((thrown as ChatMessageRoleError).role).toBe("assistant");
			expect((thrown as ChatMessageRoleError).expected).toBe("user");
		}
	});

	it("regenerate applies to assistant responses only", () => {
		expect(canRegenerateMessageRole("assistant")).toBe(true);
		expect(canRegenerateMessageRole("user")).toBe(false);
	});
});

describe("edit content", () => {
	it("saves with surrounding whitespace trimmed: the same rule as sending", () => {
		expect(checkMessageContent("  안녕  ")).toEqual({
			ok: true,
			content: "안녕",
		});
		expect(requireMessageContent("\n안녕\n")).toBe("안녕");
	});

	it("empty and whitespace-only are refused: not quietly folded into deletion", () => {
		expect(checkMessageContent("")).toEqual({ ok: false, reason: "empty" });
		expect(checkMessageContent("   \n ")).toEqual({
			ok: false,
			reason: "empty",
		});
		expect(() => requireMessageContent("  ")).toThrow(ChatMessageContentError);
	});

	it("keeps inner line breaks: in roleplay turns line breaks are content", () => {
		expect(requireMessageContent("첫 줄\n\n둘째 줄")).toBe("첫 줄\n\n둘째 줄");
	});

	it("does not refuse for length: a stored message must not become uneditable", () => {
		const long = "가".repeat(100_000);
		expect(checkMessageContent(long).ok).toBe(true);
	});
});
