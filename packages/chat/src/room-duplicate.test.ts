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
import { createSceneRecord, resolveMessageAudiences } from "./scene.ts";

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
		scenes: [
			createSceneRecord(
				{
					roomId: "room-1",
					startAt: { createdAt: at(2), messageId: "m2" },
					audience: { kind: "participants", members: ["user", "char:char-1"] },
				},
				{ id: "scene-1", now: at(5), rev: rev(45) },
			),
			markLocalDelete(
				createSceneRecord(
					{
						roomId: "room-1",
						startAt: { createdAt: at(1), messageId: "m1" },
						audience: { kind: "narrator" },
					},
					{ id: "scene-gone", now: at(5), rev: rev(46) },
				),
				at(9),
				rev(97),
			),
		],
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
			...original.scenes.map((s) => s.id),
		]);
		const after = [
			copy.room.id,
			...copy.messages.map((m) => m.id),
			...copy.memories.map((m) => m.id),
			...copy.characters.map((c) => c.id),
			...copy.scenes.map((s) => s.id),
		];
		for (const id of after) expect(before.has(id), id).toBe(false);

		const revs = [
			copy.room.rev,
			...copy.messages.map((m) => m.rev),
			...copy.memories.map((m) => m.rev),
			...copy.characters.map((c) => c.rev),
			...copy.scenes.map((s) => s.rev),
		];
		expect(new Set(revs.map((r) => JSON.stringify(r))).size).toBe(revs.length);
		expect(revs.length).toBe(chatRoomDuplicateRecordCount(original));
	});

	it("never copies memory V2's historical summary (no new V2 records)", () => {
		const copy = plan(source());
		expect("summary" in copy).toBe(false);
	});

	it("copies live scenes onto the copied start message and remaps character members", () => {
		const copy = plan(source());
		const m2 = copy.messages.find((m) => m.content === "m2 내용");
		const librarian = copy.characters[0];
		expect(copy.scenes).toHaveLength(1);
		expect(copy.scenes[0]).toMatchObject({
			roomId: copy.room.id,
			startAt: { createdAt: at(2), messageId: m2?.id },
			audience: {
				kind: "participants",
				members: [`char:${librarian?.id}`, "user"].sort(),
			},
			deletedAt: null,
			dirty: 1,
			serverVersion: 0,
		});
		expect(copy.scenes[0]?.id).not.toBe("scene-1");
	});

	it("keeps every copied message under the audience it had in the original", () => {
		const original = source();
		const m4 = createMessageRecord(
			{ roomId: "room-1", role: "assistant", content: "m4 내용" },
			{ id: "m4", now: at(4), rev: rev(14) },
		);
		original.messages = [...original.messages, m4];
		original.scenes = [
			...original.scenes,
			/* Starts at the deleted m3: moves to m4, the first message it covered. */
			createSceneRecord(
				{
					roomId: "room-1",
					startAt: { createdAt: at(3), messageId: "m3" },
					audience: { kind: "narrator" },
				},
				{ id: "scene-3", now: at(5), rev: rev(47) },
			),
			/* Starts after the last message: covers nothing, so it does not travel. */
			createSceneRecord(
				{
					roomId: "room-1",
					startAt: { createdAt: at(8), messageId: "m9" },
					audience: { kind: "room" },
				},
				{ id: "scene-9", now: at(5), rev: rev(48) },
			),
		];
		const copy = plan(original);
		expect(copy.scenes).toHaveLength(2);
		const before = resolveMessageAudiences(
			original.messages.filter((m) => m.deletedAt === null),
			original.scenes,
		);
		const after = resolveMessageAudiences(copy.messages, copy.scenes);
		const kinds = (audiences: typeof before, ids: string[]) =>
			ids.map((id) => audiences.get(id)?.kind);
		expect(
			kinds(
				after,
				copy.messages.map((m) => m.id),
			),
		).toEqual(kinds(before, ["m1", "m2", "m4"]));
		expect(
			kinds(
				after,
				copy.messages.map((m) => m.id),
			),
		).toEqual(["unknown", "participants", "narrator"]);
		expect(copy.scenes.map((s) => s.rev).length).toBe(2);
		expect(chatRoomDuplicateRecordCount(original)).toBe(1 + 3 + 1 + 1 + 2);
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
