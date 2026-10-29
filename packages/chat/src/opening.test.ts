import {
	StoryChatSeedDto,
	type StoryChatSeedInput,
} from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import { buildChatGenerationRequest } from "./context.ts";
import type { ChatRoom, ChatSeed } from "./model.ts";
import { createRoomRecord } from "./model.ts";
import {
	conversationRowActions,
	isOpeningMessage,
	OPENING_MESSAGE_ID,
	openingMessage,
	resolveOpeningScene,
} from "./opening.ts";

/**
 * Opening tests. Two things are checked: what is drawn (explicit opening, candidate, or nothing),
 * and whether that is the same text actually sent to the model. The second is why this file exists.
 * The two can diverge without a compile error, and the symptom appears only as the model continuing
 * a scene that is not on screen.
 */

type SeedInput = Partial<StoryChatSeedInput>;

const REV = { t: 1_767_225_600_000, c: 0, d: "test-device" };

const seed = (overrides: SeedInput = {}): ChatSeed =>
	StoryChatSeedDto.parse({
		version: 1,
		storyId: "story-1",
		title: "테스트 작품",
		adult: false,
		promptProtected: false,
		scenario: "비 내리는 항구 도시.",
		...overrides,
	});

const room = (overrides: SeedInput = {}): ChatRoom =>
	createRoomRecord(
		{ originStoryId: "story-1", seed: seed(overrides) },
		{
			id: "room-1",
			routingSessionId: "0f1e2d3c-4b5a",
			now: "2026-01-01T00:00:00.000Z",
			rev: REV,
		},
	);

describe("choosing the opening", () => {
	it("uses the explicit opening", () => {
		const opening = openingMessage(
			seed({ firstScene: "그녀가 우산을 접으며 들어왔다." }),
		);
		expect(opening?.content).toBe("그녀가 우산을 접으며 들어왔다.");
	});

	it("uses the first candidate when the opening is empty", () => {
		const opening = openingMessage(
			seed({
				firstScene: "",
				startScenes: [
					{ title: "부두", content: "부두에는 아무도 없었다." },
					{ title: "선술집", content: "문이 열렸다." },
				],
			}),
		);
		expect(opening?.content).toBe("부두에는 아무도 없었다.");
	});

	it("an explicit opening beats the candidates", () => {
		const opening = openingMessage(
			seed({
				firstScene: "명시된 장면.",
				startScenes: [{ title: "부두", content: "후보 장면." }],
			}),
		);
		expect(opening?.content).toBe("명시된 장면.");
	});

	it("a whitespace-only opening counts as absent", () => {
		expect(openingMessage(seed({ firstScene: "   \n  " }))).toBeNull();
		expect(
			openingMessage(
				seed({
					firstScene: "",
					startScenes: [{ title: "빈 장면", content: "  " }],
				}),
			),
		).toBeNull();
	});

	it("draws nothing with neither opening nor candidates", () => {
		expect(
			openingMessage(seed({ firstScene: "", startScenes: [] })),
		).toBeNull();
	});

	it("a prompt-protected copy still draws the opening", () => {
		const opening = openingMessage(
			seed({ promptProtected: true, firstScene: "보호본의 도입부." }),
		);
		expect(opening?.content).toBe("보호본의 도입부.");
	});

	it("does not invent a speaker", () => {
		const opening = openingMessage(seed({ firstScene: "장면." }));
		expect(opening).toEqual({
			id: OPENING_MESSAGE_ID,
			role: "assistant",
			speaker: "",
			content: "장면.",
		});
	});

	it("the identity does not collide with stored messages", () => {
		expect(isOpeningMessage(OPENING_MESSAGE_ID)).toBe(true);
		expect(isOpeningMessage("0f9a2c1b4d5e6f708192a3b4c5d6e7f8")).toBe(false);
		expect(OPENING_MESSAGE_ID).toContain(":");
	});
});

describe("the drawn text and the text sent", () => {
	const cases: { name: string; overrides: SeedInput }[] = [
		{ name: "명시된 도입부", overrides: { firstScene: "명시된 장면." } },
		{
			name: "후보로만 들어온 도입부",
			overrides: {
				firstScene: "",
				startScenes: [{ title: "부두", content: "후보 장면." }],
			},
		},
		{
			name: "앞뒤 공백이 붙은 도입부",
			overrides: { firstScene: "  다듬어야 하는 장면.  " },
		},
	];

	for (const { name, overrides } of cases) {
		it(`${name} matches the system prompt's`, () => {
			const target = room(overrides);
			const opening = openingMessage(target.seed);
			const request = buildChatGenerationRequest({
				room: target,
				messages: [],
				allAges: true,
				userInput: "안녕",
			});

			expect(opening).not.toBeNull();
			expect(request.system).toContain(opening?.content);
		});
	}

	it("without an opening the system has no opening scene block either", () => {
		const target = room({ firstScene: "", startScenes: [] });
		expect(openingMessage(target.seed)).toBeNull();
		expect(
			buildChatGenerationRequest({
				room: target,
				messages: [],
				allAges: true,
				userInput: "안녕",
			}).system,
		).not.toContain("# 시작 장면");
	});

	it("does not ride in the history", () => {
		const request = buildChatGenerationRequest({
			room: room({ firstScene: "그녀가 우산을 접으며 들어왔다." }),
			messages: [],
			allAges: true,
			userInput: "안녕",
		});
		for (const message of request.messages)
			expect(message.content).not.toContain("우산을 접으며");
	});

	it("the rule for choosing the opening is the assembler's", () => {
		const target = seed({
			firstScene: "",
			startScenes: [{ title: "부두", content: "후보 장면." }],
		});
		expect(resolveOpeningScene(target)).toBe("후보 장면.");
	});
});

describe("opening actions", () => {
	it("copy only", () => {
		expect(
			conversationRowActions({ id: OPENING_MESSAGE_ID, role: "assistant" }),
		).toEqual(["copy"]);
	});

	it("stored rows follow the per-role table as is", () => {
		expect(conversationRowActions({ id: "m1", role: "user" })).toEqual([
			"copy",
			"edit",
			"delete-from",
		]);
		expect(conversationRowActions({ id: "m2", role: "assistant" })).toEqual([
			"copy",
			"edit",
			"regenerate",
			"report",
			"delete-from",
		]);
	});
});
