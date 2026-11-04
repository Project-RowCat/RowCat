import type { Rev } from "@rowcat/contracts/sync";
import { describe, expect, it } from "vitest";
import { createCharacterRecord } from "./character.ts";
import { createMemoryRecord } from "./memory.ts";
import {
	CHAT_ROOM_TITLE_MAX_LENGTH,
	type ChatSeed,
	checkRoomTitle,
	createMessageRecord,
	createRoomRecord,
	markLocalDelete,
} from "./model.ts";
import {
	type ChatRoomDuplicateSource,
	chatRoomDuplicateRecordCount,
	duplicateRoomTitle,
	planRoomDuplicate,
} from "./room-duplicate.ts";
import { createSummaryRecord } from "./summary.ts";

/**
 * A copy that loses a child is a conversation that answers differently from its original with no
 * error anywhere, and a copy that shares an id fights its original for one server row. Both are
 * pinned by value here, once, for both stores.
 */

const rev = (n: number): Rev => ({ t: n, c: 0, d: "device-a" });
const at = (second: number) =>
	`2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z`;

const seed = {
	title: "밤의 도서관",
	adult: false,
	promptProtected: false,
	characters: [],
} as unknown as ChatSeed;

const source = (): ChatRoomDuplicateSource => {
	const room = {
		...createRoomRecord(
			{
				originStoryId: "story-1",
				seed,
				persona: { name: "하린", description: "" },
			},
			{ id: "room-1", routingSessionId: "route-1", now: at(0), rev: rev(1) },
		),
		userNote: "존댓말을 써 줘",
		intensity: "softened" as const,
		dirty: 0 as const,
		serverVersion: 7,
	};
	const message = (id: string, second: number, role: "user" | "assistant") =>
		createMessageRecord(
			{ roomId: "room-1", role, content: `${id} 내용` },
			{ id, now: at(second), rev: rev(second + 10) },
		);
	return {
		room,
		messages: [
			message("m1", 1, "user"),
			message("m2", 2, "assistant"),
			markLocalDelete(message("m3", 3, "user"), at(9), rev(99)),
		],
		memories: [
			createMemoryRecord(
				{
					roomId: "room-1",
					content: "열쇠를 받았다",
					source: "auto",
					originAt: at(2),
				},
				{ id: "mem-1", now: at(4), rev: rev(30) },
			),
			markLocalDelete(
				createMemoryRecord(
					{ roomId: "room-1", content: "지운 기억" },
					{ id: "mem-2", now: at(4), rev: rev(31) },
				),
				at(9),
				rev(98),
			),
		],
		characters: [
			createCharacterRecord(
				{ roomId: "room-1", name: "사서", prompt: "조용하다" },
				{ id: "char-1", now: at(5), rev: rev(40) },
			),
		],
		summary: createSummaryRecord(
			{
				roomId: "room-1",
				summary: "도서관에 들어갔다",
				frontier: { createdAt: at(2), messageId: "m2" },
				epoch: 2,
			},
			{ now: at(6), rev: rev(50) },
		),
	};
};

const plan = (input: ChatRoomDuplicateSource) => {
	let next = 0;
	const count = chatRoomDuplicateRecordCount(input);
	return planRoomDuplicate(input, {
		title: "밤의 도서관 (사본)",
		now: at(30),
		newId: () => `new-${++next}`,
		revs: Array.from({ length: count }, (_, i) => rev(1000 + i)),
	});
};

describe("planRoomDuplicate", () => {
	it("copies the room's settings and acquisition fields under a new identity", () => {
		const original = source();
		const copy = plan(original);
		expect(copy.room).toMatchObject({
			title: "밤의 도서관 (사본)",
			originStoryId: "story-1",
			seed,
			persona: { name: "하린", description: "" },
			userNote: "존댓말을 써 줘",
			intensity: "softened",
			createdAt: at(30),
			updatedAt: at(30),
			deletedAt: null,
			dirty: 1,
			serverVersion: 0,
		});
		expect(copy.room.id).not.toBe(original.room.id);
		/* A shared routing key would tell upstream the two conversations are one. */
		expect(copy.room.routingSessionId).toBeDefined();
		expect(copy.room.routingSessionId).not.toBe(original.room.routingSessionId);
		expect(copy.room.routingSessionId).not.toBe(copy.room.id);
	});

	it("copies live children only, re-parented, keeping their times", () => {
		const copy = plan(source());
		expect(copy.messages.map((m) => [m.content, m.createdAt])).toEqual([
			["m1 내용", at(1)],
			["m2 내용", at(2)],
		]);
		expect(copy.memories.map((m) => [m.content, m.originAt])).toEqual([
			["열쇠를 받았다", at(2)],
		]);
		expect(copy.characters.map((c) => c.name)).toEqual(["사서"]);
		for (const child of [
			...copy.messages,
			...copy.memories,
			...copy.characters,
		]) {
			expect(child.roomId).toBe(copy.room.id);
			expect(child.dirty).toBe(1);
			expect(child.serverVersion).toBe(0);
		}
	});

	it("never shares an id with the original, and never repeats a revision", () => {
		const original = source();
		const copy = plan(original);
		const before = new Set([
			original.room.id,
			...original.messages.map((m) => m.id),
			...original.memories.map((m) => m.id),
			...original.characters.map((c) => c.id),
			original.summary?.id,
		]);
		const after = [
			copy.room.id,
			...copy.messages.map((m) => m.id),
			...copy.memories.map((m) => m.id),
			...copy.characters.map((c) => c.id),
			copy.summary?.id,
		];
		for (const id of after) expect(before.has(id), id).toBe(false);

		const revs = [
			copy.room.rev,
			...copy.messages.map((m) => m.rev),
			...copy.memories.map((m) => m.rev),
			...copy.characters.map((c) => c.rev),
			copy.summary?.rev,
		];
		expect(new Set(revs.map((r) => JSON.stringify(r))).size).toBe(revs.length);
		expect(revs.length).toBe(chatRoomDuplicateRecordCount(original));
	});

	it("moves the summary frontier onto the copied message", () => {
		const copy = plan(source());
		const m2 = copy.messages.find((m) => m.content === "m2 내용");
		expect(copy.summary).toMatchObject({
			id: `chat-summary:${copy.room.id}`,
			roomId: copy.room.id,
			summary: "도서관에 들어갔다",
			frontier: { createdAt: at(2), messageId: m2?.id },
		});
	});

	it("drops a summary whose frontier message is gone rather than guessing", () => {
		const original = source();
		if (!original.summary) throw new Error("fixture has a summary");
		original.summary = {
			...original.summary,
			frontier: { createdAt: at(3), messageId: "m3" },
		};
		expect(plan(original).summary).toBeNull();
		expect(chatRoomDuplicateRecordCount(original)).toBe(1 + 2 + 1 + 1);
	});

	it("refuses to reuse a revision when they run short", () => {
		expect(() =>
			planRoomDuplicate(source(), {
				title: "t",
				now: at(30),
				newId: () => "x",
				revs: [rev(1)],
			}),
		).toThrow();
	});
});

describe("duplicateRoomTitle", () => {
	it("appends the suffix", () => {
		expect(duplicateRoomTitle("밤의 도서관", "(사본)")).toBe(
			"밤의 도서관 (사본)",
		);
	});

	it("cuts the original, not the suffix, and always passes the title rule", () => {
		const long = "가".repeat(CHAT_ROOM_TITLE_MAX_LENGTH);
		const title = duplicateRoomTitle(long, "(사본)");
		expect(title.endsWith(" (사본)")).toBe(true);
		expect(checkRoomTitle(title).ok).toBe(true);
		/* Counted in code points: an emoji title still fits. */
		const emoji = duplicateRoomTitle(
			"🌙".repeat(CHAT_ROOM_TITLE_MAX_LENGTH),
			"(copy)",
		);
		expect([...emoji].length).toBeLessThanOrEqual(CHAT_ROOM_TITLE_MAX_LENGTH);
		expect(checkRoomTitle(emoji).ok).toBe(true);
	});
});
