import {
	StoryChatSeedDto,
	type StoryChatSeedInput,
} from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import { buildChatGenerationRequest } from "./context.ts";
import { deliveredChatSystem } from "./guards.ts";
import type { ChatRoom, ChatSeed } from "./model.ts";
import { createMessageRecord, createRoomRecord } from "./model.ts";
import { openingMessage } from "./opening.ts";
import {
	CHAT_PERSONA_DESCRIPTION_MAX_LENGTH,
	CHAT_PERSONA_NAME_MAX_LENGTH,
	type ChatPersona,
	ChatPersonaNameError,
	chatPersonaOrigin,
	checkPersonaDescription,
	checkPersonaName,
	createPersonaRecord,
	effectiveChatPersona,
	effectiveChatUserName,
	personaSnapshotOf,
	planPersonaSave,
	requirePersonaName,
	samePersonaSnapshot,
	sortPersonas,
} from "./persona.ts";
import { CHAT_DEFAULT_USER_NAME, chatPlaceholderNames } from "./placeholder.ts";

/**
 * Pure persona rules. Three things are checked: priority (room override, then work suggestion, then
 * default name), snapshot independence (editing or deleting the library does not disturb a room),
 * and whether the priority actually reaches the prompt and {{user}}. The first two end in value
 * comparisons. The last must pass through the assembler too. A test that only checks storage cannot
 * show whether the settings screen does anything.
 */

const REV = { t: 1_767_225_600_000, c: 0, d: "test-device" };

const seed = (overrides: Partial<StoryChatSeedInput> = {}): ChatSeed =>
	StoryChatSeedDto.parse({
		version: 1,
		storyId: "story-1",
		title: "테스트 작품",
		adult: false,
		promptProtected: false,
		scenario: "비 내리는 항구 도시.",
		...overrides,
	});

const room = (
	overrides: Partial<StoryChatSeedInput> = {},
	persona?: { name: string; description: string } | null,
): ChatRoom =>
	createRoomRecord(
		{
			originStoryId: "story-1",
			seed: seed(overrides),
			...(persona !== undefined ? { persona } : {}),
		},
		{
			id: "room-1",
			routingSessionId: "0f1e2d3c-4b5a",
			now: "2026-01-01T00:00:00.000Z",
			rev: REV,
		},
	);

const persona = (
	name: string,
	description = "",
	stamp: Partial<{ id: string; now: string }> = {},
): ChatPersona =>
	createPersonaRecord(
		{ name, description },
		{
			id: stamp.id ?? "persona-1",
			now: stamp.now ?? "2026-01-01T00:00:00.000Z",
			rev: REV,
		},
	);

describe("name and description rules", () => {
	it("an empty name is refused rather than folded to the default", () => {
		expect(checkPersonaName("   ")).toEqual({ ok: false, reason: "empty" });
		expect(() => requirePersonaName("")).toThrow(ChatPersonaNameError);
	});

	it("length counts code points: one emoji is one", () => {
		const emoji = "🙂".repeat(CHAT_PERSONA_NAME_MAX_LENGTH);
		expect(checkPersonaName(emoji)).toEqual({ ok: true, name: emoji });
		expect(checkPersonaName(`${emoji}🙂`)).toEqual({
			ok: false,
			reason: "too_long",
		});
	});

	it("the description may be empty and inner line breaks remain", () => {
		const body = "대학생.\n\n조용한 성격이며 추리소설을 좋아한다.";
		expect(checkPersonaDescription("")).toEqual({ ok: true, description: "" });
		expect(checkPersonaDescription(`  ${body}  `)).toEqual({
			ok: true,
			description: body,
		});
	});

	it("the description cap is in code points too", () => {
		expect(
			checkPersonaDescription("가".repeat(CHAT_PERSONA_DESCRIPTION_MAX_LENGTH))
				.ok,
		).toBe(true);
		expect(
			checkPersonaDescription(
				"가".repeat(CHAT_PERSONA_DESCRIPTION_MAX_LENGTH + 1),
			),
		).toEqual({ ok: false, reason: "too_long" });
	});

	it("the factory re-applies the rules: no record is built without validation", () => {
		expect(() =>
			createPersonaRecord(
				{ name: " " },
				{ id: "p", now: "2026-01-01T00:00:00.000Z", rev: REV },
			),
		).toThrow(ChatPersonaNameError);
	});
});

describe("form decisions", () => {
	it("writes nothing when nothing changed: an edit is activity", () => {
		const current = { name: "지훈", description: "대학생." };
		expect(
			planPersonaSave({ name: " 지훈 ", description: "대학생." }, current),
		).toEqual({ kind: "unchanged" });
	});

	it("creating never yields unchanged", () => {
		expect(planPersonaSave({ name: "지훈", description: "" })).toEqual({
			kind: "save",
			name: "지훈",
			description: "",
		});
	});

	it("checks the name first: when both fields are wrong, focus has one destination", () => {
		const plan = planPersonaSave({
			name: "",
			description: "가".repeat(CHAT_PERSONA_DESCRIPTION_MAX_LENGTH + 1),
		});
		expect(plan).toEqual({ kind: "invalid", field: "name", reason: "empty" });
	});
});

describe("library order", () => {
	it("most recently edited first, with id breaking ties deterministically", () => {
		const older = persona("A", "", {
			id: "a",
			now: "2026-01-01T00:00:00.000Z",
		});
		const newer = persona("B", "", {
			id: "b",
			now: "2026-01-02T00:00:00.000Z",
		});
		const tie = persona("C", "", { id: "c", now: "2026-01-02T00:00:00.000Z" });
		expect(sortPersonas([older, newer, tie]).map((p) => p.id)).toEqual([
			"c",
			"b",
			"a",
		]);
		expect(sortPersonas([tie, older, newer]).map((p) => p.id)).toEqual([
			"c",
			"b",
			"a",
		]);
	});

	it("does not touch the source array", () => {
		const list = [persona("A", "", { id: "a" }), persona("B", "", { id: "b" })];
		sortPersonas(list);
		expect(list.map((p) => p.id)).toEqual(["a", "b"]);
	});
});

describe("effective persona precedence", () => {
	const suggested = { name: "방문자", description: "작품이 제안한 역할." };
	const chosen = { name: "지훈", description: "대학생." };

	it("room override + story suggestion → room override", () => {
		const target = room({ persona: suggested }, chosen);
		expect(effectiveChatPersona(target)).toEqual(chosen);
		expect(effectiveChatUserName(target)).toBe("지훈");
	});

	it("no override + story suggestion → story suggestion", () => {
		const target = room({ persona: suggested });
		expect(effectiveChatPersona(target)).toEqual(suggested);
		expect(effectiveChatUserName(target)).toBe("방문자");
	});

	it("a room whose override was cleared returns to the story suggestion: null is not 'no role'", () => {
		const target: ChatRoom = { ...room({ persona: suggested }), persona: null };
		expect(effectiveChatPersona(target)).toEqual(suggested);
	});

	it("null when both are absent, and the name is the product default", () => {
		const target = room();
		expect(effectiveChatPersona(target)).toBeNull();
		expect(effectiveChatUserName(target)).toBe(CHAT_DEFAULT_USER_NAME);
	});

	it("tells the three layers apart", () => {
		const suggested = { name: "방문자", description: "" };
		const chosen = { name: "지훈", description: "" };
		expect(chatPersonaOrigin(room({ persona: suggested }, chosen))).toBe(
			"room",
		);
		expect(chatPersonaOrigin(room({ persona: suggested }))).toBe("story");
		expect(chatPersonaOrigin(room())).toBe("default");
	});

	it("a whitespace-only name folds to the default name", () => {
		const target = room({}, { name: "   ", description: "설명." });
		expect(effectiveChatUserName(target)).toBe(CHAT_DEFAULT_USER_NAME);
	});
});

describe("snapshot independence", () => {
	it("copies only the value from the library row: the id does not follow", () => {
		const saved = persona("지훈", "대학생.");
		expect(personaSnapshotOf(saved)).toEqual({
			name: "지훈",
			description: "대학생.",
		});
		expect(Object.keys(personaSnapshotOf(saved)).sort()).toEqual([
			"description",
			"name",
		]);
	});

	it("editing the library leaves rooms already chosen unchanged", () => {
		const saved = persona("지훈", "대학생.");
		const target = room({}, personaSnapshotOf(saved));

		const edited: ChatPersona = { ...saved, name: "지훈(수정)" };

		expect(effectiveChatUserName(target)).toBe("지훈");
		expect(effectiveChatPersona(target)).not.toEqual(personaSnapshotOf(edited));
	});

	it("choosing again brings in the new value then", () => {
		const edited = persona("지훈(수정)", "대학원생.");
		const target: ChatRoom = { ...room(), persona: personaSnapshotOf(edited) };
		expect(effectiveChatUserName(target)).toBe("지훈(수정)");
	});

	it("a room still opens with a role deleted from the library: there is nothing to trace back", () => {
		const saved = persona("지훈", "대학생.");
		const target = room({}, personaSnapshotOf(saved));
		expect(effectiveChatPersona(target)).toEqual({
			name: "지훈",
			description: "대학생.",
		});
	});

	it("whether two snapshots are the same role is judged by value", () => {
		expect(
			samePersonaSnapshot(
				{ name: "지훈", description: "대학생." },
				{ name: "지훈", description: "대학생." },
			),
		).toBe(true);
		expect(samePersonaSnapshot(null, null)).toBe(true);
		expect(samePersonaSnapshot({ name: "지훈", description: "" }, null)).toBe(
			false,
		);
	});
});

describe("generation context", () => {
	const chosen = { name: "지훈", description: "대학생. 추리소설을 좋아한다." };
	const suggested = { name: "방문자", description: "작품이 제안한 역할." };

	const build = (target: ChatRoom, userInput = "안녕") =>
		buildChatGenerationRequest({
			room: target,
			messages: [],
			userInput,
			allAges: true,
		});

	it("the room's role rides in the system prompt's counterpart block", () => {
		const request = build(room({ persona: suggested }, chosen));
		expect(request.system).toContain("- 이름: 지훈");
		expect(request.system).toContain("- 설명: 대학생. 추리소설을 좋아한다.");
		expect(request.system).not.toContain("방문자");
	});

	it("without an override the story's suggested counterpart rides as is", () => {
		const request = build(room({ persona: suggested }));
		expect(request.system).toContain("- 이름: 방문자");
	});

	it("the counterpart block still precedes the safety tail guard", () => {
		const system = deliveredChatSystem(build(room({}, chosen)));
		const personaAt = system.indexOf("# 유저(상대역)");
		const tailAt = system.lastIndexOf("\n\n");
		expect(personaAt).toBeGreaterThan(-1);
		expect(personaAt).toBeLessThan(tailAt);
	});

	it("the speaker prefix of user turns is the effective persona's name", () => {
		const request = build(room({ persona: suggested }, chosen));
		const last = request.messages[request.messages.length - 1];
		expect(last).toEqual({ role: "user", content: "지훈: 안녕" });
	});

	it("with no role at all, the product default name is attached", () => {
		const last = build(room()).messages.at(-1);
		expect(last?.content).toBe(`${CHAT_DEFAULT_USER_NAME}: 안녕`);
	});

	it("`{{user}}` is substituted with the effective persona", () => {
		const request = build(
			room(
				{
					scenario: "{{user}}는 항구에 도착했다.",
					persona: suggested,
				},
				chosen,
			),
		);
		expect(request.system).toContain("지훈는 항구에 도착했다.");
		expect(request.system).not.toContain("{{user}}");
	});

	it("`{{char}}` is substituted inside an overridden role's description too", () => {
		const request = build(
			room(
				{ characters: [{ name: "세라" }] },
				{
					name: "지훈",
					description: "{{char}}의 오랜 친구.",
				},
			),
		);
		expect(request.system).toContain("- 설명: 세라의 오랜 친구.");
	});

	it("stored speakers stay when the role changes", () => {
		const earlier = createMessageRecord(
			{ roomId: "room-1", role: "user", content: "안녕", speaker: "지훈" },
			{ id: "m1", now: "2026-01-01T00:00:00.000Z", rev: REV },
		);
		/* The user changed the role in the meantime, so only new utterances take the new name. */
		const request = buildChatGenerationRequest({
			room: { ...room(), persona: { name: "레이", description: "" } },
			messages: [earlier],
			userInput: "다음으로 가자",
			allAges: true,
		});
		expect(request.messages.map((m) => m.content)).toEqual([
			"지훈: 안녕",
			"레이: 다음으로 가자",
		]);
	});

	it("only old turns with an empty speaker fold to the current name", () => {
		const legacy = createMessageRecord(
			{ roomId: "room-1", role: "user", content: "안녕" },
			{ id: "m1", now: "2026-01-01T00:00:00.000Z", rev: REV },
		);
		const request = buildChatGenerationRequest({
			room: { ...room(), persona: { name: "레이", description: "" } },
			messages: [legacy],
			allAges: true,
		});
		expect(request.messages[0]?.content).toBe("레이: 안녕");
	});

	it("same input, same prompt: personas do not break determinism", () => {
		const target = room({ persona: suggested }, chosen);
		expect(build(target).system).toBe(build(target).system);
	});
});

describe("opening", () => {
	it("the opening's `{{user}}` uses the effective persona too", () => {
		const target = room(
			{
				firstScene: "{{user}}가 문을 열었다.",
				persona: { name: "방문자", description: "" },
			},
			{ name: "지훈", description: "" },
		);
		const opening = openingMessage(target.seed, effectiveChatPersona(target));
		expect(opening?.content).toBe("지훈가 문을 열었다.");
	});

	it("without passing one, the story suggestion stands: the branch the authoring tool uses", () => {
		const target = room({
			firstScene: "{{user}}가 문을 열었다.",
			persona: { name: "방문자", description: "" },
		});
		expect(openingMessage(target.seed)?.content).toBe("방문자가 문을 열었다.");
	});
});

describe("placeholder names", () => {
	it("a passed role beats the seed's counterpart", () => {
		const target = seed({
			persona: { name: "방문자", description: "" },
			characters: [{ name: "세라" }],
		});
		expect(
			chatPlaceholderNames(target, { name: "지훈", description: "" }),
		).toEqual({ char: "세라", user: "지훈" });
	});

	it("passing `null` means no role, not no override", () => {
		const target = seed({ persona: { name: "방문자", description: "" } });
		/*
		 * Callers always pass an already-resolved value (effectiveChatPersona). So null here means
		 * neither exists, and the default name applies. That this function does not restate the priority
		 * rules is locked by this one line.
		 */
		expect(chatPlaceholderNames(target, null).user).toBe(
			CHAT_DEFAULT_USER_NAME,
		);
	});
});
