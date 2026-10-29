import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import type { ChatSeed } from "./model.ts";
import {
	CHAT_ROOM_TITLE_MAX_LENGTH,
	ChatRoomTitleError,
	chatTextLength,
	checkRoomTitle,
	compareRoomsByRecency,
	createMessageRecord,
	createRoomRecord,
	isLiveChatRecord,
	markCascadeDeleted,
	markLocalDelete,
	markLocalUpdate,
	normalizeRoomTitle,
	planRoomRename,
	requireRoomTitle,
} from "./model.ts";

/**
 * Model tests pin down the meaning of the user's persistent data.
 *
 * Failures here are silent. If a new record's sync metadata differs by one field, existing stored
 * records look the same, so nothing shows on screen. The difference surfaces only at the first
 * sync, as a conversation that never uploads.
 */

const rev = (t: number, c = 0, d = "device-a") => ({ t, c, d });
const CREATED_REV = rev(1_767_225_600_000);
const NOW = "2026-01-01T00:00:00.000Z";
/**
 * An opaque value that does not overlap with room ids. It is deterministic, so the same room always
 * gets the same value, yet no room id appears anywhere in it. The fixture shows the key is not
 * derived from the room id.
 */
const routingFixture = (id: string): string =>
	`0f1e2d3c-${[...id]
		.reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 65_536, 7)
		.toString(16)
		.padStart(4, "0")}`;

const stamp = (id: string, now = NOW, revision = CREATED_REV) => ({
	id,
	routingSessionId: routingFixture(id),
	now,
	rev: revision,
});

const seed = (): ChatSeed =>
	StoryChatSeedDto.parse({
		version: 1,
		storyId: "story-1",
		title: "테스트 작품",
		adult: false,
		promptProtected: false,
	});

const room = () =>
	createRoomRecord({ originStoryId: "story-1", seed: seed() }, stamp("room-1"));

const message = () =>
	createMessageRecord(
		{ roomId: "room-1", role: "user", content: "안녕" },
		stamp("msg-1"),
	);

describe("sync metadata of new records", () => {
	it("rooms and messages are born dirty, at server version 0, and live", () => {
		for (const record of [room(), message()]) {
			expect(record.dirty).toBe(1);
			expect(record.serverVersion).toBe(0);
			expect(record.deletedAt).toBeNull();
			// Revisions are not made up: the value the storage took from its clock is carried through
			// unchanged.
			expect(record.rev).toEqual(CREATED_REV);
			expect(isLiveChatRecord(record)).toBe(true);
		}
	});

	it("an omitted title uses the snapshot title; an empty one uses the placeholder", () => {
		expect(
			createRoomRecord({ originStoryId: null, seed: seed() }, stamp("room-1"))
				.title,
		).toBe("테스트 작품");
		expect(
			createRoomRecord(
				{ originStoryId: null, seed: seed(), title: "   " },
				stamp("room-1"),
			).title,
		).toBe("Untitled conversation");
	});
});

describe("edit and deletion marks", () => {
	const LATER = "2026-02-02T00:00:00.000Z";
	const NEXT = rev(1_767_225_600_001);

	it("a local edit raises time and revision but leaves the server version alone", () => {
		const stored = { ...message(), dirty: 0 as const, serverVersion: 7 };

		const updated = markLocalUpdate(stored, LATER, NEXT);

		expect(updated.updatedAt).toBe(LATER);
		expect(updated.dirty).toBe(1);
		expect(updated.rev).toEqual(NEXT);
		expect(updated.serverVersion).toBe(7);
	});

	it("a second deletion does not push the first deletion time into the future", () => {
		const first = markLocalDelete(message(), LATER, NEXT);
		const second = markLocalDelete(first, "2026-03-03T00:00:00.000Z", rev(2));

		expect(second.deletedAt).toBe(LATER);
		expect(second.updatedAt).toBe("2026-03-03T00:00:00.000Z");
		expect(isLiveChatRecord(second)).toBe(false);
	});

	it("messages swept by a room deletion get neither dirty nor a revision", () => {
		/**
		 * A room can hold thousands of messages. Marking each one dirty on delete would turn one room
		 * deletion into thousands of pushes, which defeats the decision to send a single room tombstone
		 * instead.
		 */
		const clean = { ...message(), dirty: 0 as const, serverVersion: 4 };

		const cascaded = markCascadeDeleted(clean, LATER);

		expect(cascaded.deletedAt).toBe(LATER);
		expect(cascaded.dirty).toBe(0);
		expect(cascaded.serverVersion).toBe(4);
		expect(cascaded.rev).toEqual(CREATED_REV);
		expect(cascaded.updatedAt).toBe(NOW);
	});

	it("already deleted messages keep their time under the cascade", () => {
		const deleted = markLocalDelete(message(), LATER, NEXT);
		expect(
			markCascadeDeleted(deleted, "2026-03-03T00:00:00.000Z").deletedAt,
		).toBe(LATER);
	});
});

/**
 * Routing-friendly key: **not derived from the room id, and different for each room**.
 *
 * If derived, this value would be just another representation of the room id, and the fact that the
 * server has no such room would collapse on the routing axis. If it were not per room, different
 * conversations would compete for the same cache locality, which is the opposite of what this axis
 * is for.
 */
describe("routing session", () => {
	it("a new room carries the stamp's value as is", () => {
		expect(room().routingSessionId).toBe(routingFixture("room-1"));
	});

	it("not derived from the room id", () => {
		const record = room();
		expect(record.routingSessionId).not.toBe(record.id);
		expect(record.routingSessionId).not.toContain(record.id);
	});

	it("different rooms get different values", () => {
		const a = createRoomRecord(
			{ originStoryId: null, seed: seed() },
			stamp("room-a"),
		);
		const b = createRoomRecord(
			{ originStoryId: null, seed: seed() },
			stamp("room-b"),
		);
		expect(a.routingSessionId).not.toBe(b.routingSessionId);
	});

	/**
	 * Stays the same across title and role changes. If it shifted, the room's cache locality would
	 * reset, which defeats the reason the axis exists. The contract that repository operations only
	 * layer a patch on top is the substance of this guarantee; here the test confirms the factory has
	 * no place to produce a new value.
	 */
	it("the title-folding rule does not touch this value", () => {
		const titled = createRoomRecord(
			{ originStoryId: null, seed: seed(), title: "다른 제목" },
			stamp("room-1"),
		);
		expect(titled.routingSessionId).toBe(room().routingSessionId);
	});
});

describe("sorting", () => {
	it("the room list is by recent activity, with id on ties", () => {
		const older = createRoomRecord(
			{ originStoryId: null, seed: seed() },
			stamp("a", "2026-01-01T00:00:00.000Z"),
		);
		const newer = createRoomRecord(
			{ originStoryId: null, seed: seed() },
			stamp("b", "2026-02-01T00:00:00.000Z"),
		);
		expect([older, newer].sort(compareRoomsByRecency).map((r) => r.id)).toEqual(
			["b", "a"],
		);
	});
});

describe("room title rules", () => {
	/**
	 * Checked without IndexedDB. The title rule is a pure product decision, and if verifying it
	 * required opening a database, a future mobile client would verify the same rule by a different
	 * method.
	 */
	it("the value saved is trimmed at both ends", () => {
		expect(normalizeRoomTitle("  밤의 도서관  ")).toBe("밤의 도서관");
		expect(checkRoomTitle("\t밤의 도서관\n")).toEqual({
			ok: true,
			title: "밤의 도서관",
		});
	});

	/** Interior whitespace is left alone: what the user typed is predictable. */
	it("inner whitespace is not folded", () => {
		expect(normalizeRoomTitle("밤의  도서관")).toBe("밤의  도서관");
	});

	/**
	 * For an explicit rename, an empty value is an **error**. Folding it to a default title, as
	 * creation does, would leave the user unable to tell why a different phrase appeared where they
	 * had cleared the field.
	 */
	it("an empty title is refused rather than folded to the default", () => {
		expect(checkRoomTitle("")).toEqual({ ok: false, reason: "empty" });
		expect(checkRoomTitle("   ")).toEqual({ ok: false, reason: "empty" });
	});

	it("accepts up to the cap and refuses past it", () => {
		const limit = "가".repeat(CHAT_ROOM_TITLE_MAX_LENGTH);
		expect(checkRoomTitle(limit)).toEqual({ ok: true, title: limit });
		expect(checkRoomTitle(`${limit}가`)).toEqual({
			ok: false,
			reason: "too_long",
		});
	});

	/**
	 * Length is counted in code points. With `String.length`, an emoji counts as 2, so only users who
	 * include emoji would get half the limit.
	 */
	it("one emoji is one character", () => {
		const emoji = "🌙".repeat(CHAT_ROOM_TITLE_MAX_LENGTH);
		expect(emoji.length).toBeGreaterThan(CHAT_ROOM_TITLE_MAX_LENGTH);
		expect(checkRoomTitle(emoji).ok).toBe(true);
		expect(checkRoomTitle(`${emoji}🌙`).ok).toBe(false);
	});

	it("values that break the rules are thrown at the gate", () => {
		expect(requireRoomTitle("  하루  ")).toBe("하루");
		expect(() => requireRoomTitle(" ")).toThrow(ChatRoomTitleError);
		try {
			requireRoomTitle("나".repeat(CHAT_ROOM_TITLE_MAX_LENGTH + 1));
			expect.unreachable();
		} catch (error) {
			// The screen picks its message from this reason. It must not parse the error message string.
			expect((error as ChatRoomTitleError).reason).toBe("too_long");
		}
	});

	/** Creation's folding rule is unchanged; only renaming is an explicit edit. */
	it("creation still folds quietly", () => {
		const fromSeed = createRoomRecord(
			{ originStoryId: null, seed: seed() },
			stamp("r1"),
		);
		expect(fromSeed.title).toBe(seed().title);

		// Whitespace-only input falls back to the default phrase, not the snapshot title, because the
		// field was explicitly cleared.
		const blank = createRoomRecord(
			{ originStoryId: null, seed: seed(), title: "   " },
			stamp("r2"),
		);
		expect(blank.title).toBe("Untitled conversation");
	});
});

describe("rename plan", () => {
	it("saves with surrounding whitespace trimmed", () => {
		expect(planRoomRename("  새 이름  ", "옛 이름")).toEqual({
			kind: "save",
			title: "새 이름",
		});
	});

	/** This is where an unedited conversation is kept from rising to the top of the list. */
	it("writes nothing when nothing changed", () => {
		expect(planRoomRename("같은 이름", "같은 이름")).toEqual({
			kind: "unchanged",
		});
		expect(planRoomRename("  같은 이름 ", "같은 이름")).toEqual({
			kind: "unchanged",
		});
	});

	/** What goes out is the **reason**, not a sentence. The app chooses the wording. */
	it("refusals state their branch", () => {
		expect(planRoomRename("   ", "옛 이름")).toEqual({
			kind: "invalid",
			reason: "empty",
		});
		expect(
			planRoomRename("가".repeat(CHAT_ROOM_TITLE_MAX_LENGTH + 1), "옛"),
		).toEqual({ kind: "invalid", reason: "too_long" });
	});
});

describe("the length the screen counts", () => {
	/** Same unit as storage: a user who includes emoji does not see the count double. */
	it("one emoji is one character", () => {
		expect(chatTextLength("🌙🌙")).toBe(2);
		expect(chatTextLength("  달  ")).toBe(1);
	});
});
