import {
	StoryChatGenerationRequest,
	StoryChatSeedDto,
	type StoryChatSeedInput,
} from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import {
	type BuildChatGenerationRequestInput,
	buildChatGenerationRequest,
} from "./context.ts";
import { createMemoryRecord } from "./memory.ts";
import { type ChatSeed, createRoomRecord } from "./model.ts";
import {
	planChatGeneration,
	storyAssemblyInput,
	storyChatAssemblyRequest,
} from "./protected-generation.ts";
import { projectProtectedSeed } from "./protected-seed.ts";

const REV = { t: 1_767_225_600_000, c: 0, d: "test-device" };
const NOW = "2026-01-01T00:00:00.000Z";

const seed = (overrides: Partial<StoryChatSeedInput> = {}): ChatSeed =>
	StoryChatSeedDto.parse({
		version: 1,
		storyId: "story-1",
		title: "보호된 작품",
		adult: true,
		promptProtected: true,
		scenario: "SCENARIO 비 내리는 항구 도시.",
		playGuide: "PLAYGUIDE 짧게 진행한다.",
		firstScene: "*문이 열린다.*",
		persona: { name: "카이", description: "{{char}}의 오랜 친구" },
		characters: [{ name: "세레나", prompt: "CARD 학생회장." }],
		lore: [{ keys: ["항구"], content: "LORE 등대가 있다." }],
		...overrides,
	});

/**
 * The arguments the device used to assemble. Every axis is filled, because an axis left out would
 * not prove the round trip.
 */
const assembly = (
	overrides: Partial<BuildChatGenerationRequestInput> = {},
): BuildChatGenerationRequestInput => ({
	room: {
		...createRoomRecord(
			{ originStoryId: "story-1", seed: seed() },
			{ id: "room-1", routingSessionId: "0f1e2d3c-4b5a", now: NOW, rev: REV },
		),
		persona: { name: "레이", description: "편입생" },
		userNote: "반말로 진행.\n",
		intensity: "softened",
	},
	messages: [
		{ role: "user", speaker: "레이", content: "항구로 가자" },
		{ role: "assistant", speaker: "", content: "*바람이 분다.*" },
	],
	userInput: "그리고?",
	memories: [
		createMemoryRecord(
			{ roomId: "room-1", content: "레이는 왼손잡이다.", pinned: true },
			{ id: "m1", now: NOW, rev: REV },
		),
	],
	summary: "지난 이야기",
	allAges: false,
	maxOutputTokens: 1024,
	reasoningEffort: "low",
	continuation: true,
	routingSessionId: "0f1e2d3c-4b5a-6978",
	narration: { text: "PACK {{user}}", writesUser: true },
	characters: [
		{
			id: "c1",
			roomId: "room-1",
			name: "유진",
			prompt: "들인 인물",
			createdAt: NOW,
			updatedAt: NOW,
		} as never,
	],
	...overrides,
});

/** The actual path over the wire: device, then contract parsing, then server. Not a shortcut. */
const roundTrip = (input: BuildChatGenerationRequestInput) =>
	storyAssemblyInput({
		seed: input.room.seed as ChatSeed,
		request: StoryChatGenerationRequest.parse({
			...storyChatAssemblyRequest(input),
			model: "claude-sonnet-5",
		}),
		allAges: input.allAges,
	});

describe("round trip of server-assembled requests", () => {
	it("the server-assembled request equals the one the device used to assemble", () => {
		for (const allAges of [true, false]) {
			const input = assembly({ allAges });
			expect(buildChatGenerationRequest(roundTrip(input))).toEqual(
				buildChatGenerationRequest(input),
			);
		}
	});

	it("missing axes cross as missing: not filled with empty values", () => {
		const bare: BuildChatGenerationRequestInput = {
			room: { seed: seed() },
			messages: [{ role: "user", speaker: "", content: "안녕" }],
			allAges: true,
		};
		expect(buildChatGenerationRequest(roundTrip(bare))).toEqual(
			buildChatGenerationRequest(bare),
		);
	});

	it("the request has not one character of the seed's creative prompt", () => {
		const wire = JSON.stringify(storyChatAssemblyRequest(assembly()));
		for (const marker of ["SCENARIO", "PLAYGUIDE", "CARD", "LORE"])
			expect(wire).not.toContain(marker);
		expect(wire).not.toContain('"system"');
	});

	it("the contract accepts no unknown cells", () => {
		expect(
			StoryChatGenerationRequest.safeParse({
				...storyChatAssemblyRequest(assembly()),
				model: "claude-sonnet-5",
				system: "직접 쓴 프롬프트",
			}).success,
		).toBe(false);
	});
});

describe("planChatGeneration", () => {
	it("protected stories' conversations become server-assembled requests", () => {
		const plan = planChatGeneration({
			assembly: assembly(),
			protectedStoryId: "story-1",
			trace: true,
		});
		expect(plan.kind).toBe("story");
		if (plan.kind === "story") expect(plan.storyId).toBe("story-1");
	});

	it("other conversations are device-assembled: the same request as before", () => {
		const input = assembly();
		const plan = planChatGeneration({
			assembly: input,
			protectedStoryId: null,
			trace: false,
		});
		expect(plan).toEqual({
			kind: "assembled",
			request: buildChatGenerationRequest(input),
			trace: null,
		});
	});

	it("a conversation with the inspector on receives the same request and its structure", () => {
		const input = assembly();
		const plan = planChatGeneration({
			assembly: input,
			protectedStoryId: null,
			trace: true,
		});
		if (plan.kind !== "assembled") throw new Error("기기 조립이어야 한다");
		expect(plan.request).toEqual(buildChatGenerationRequest(input));
		expect(plan.trace).not.toBeNull();
	});
});

describe("projectProtectedSeed", () => {
	it("protected copies blank the creative prompt and keep only what the screen draws", () => {
		const projected = projectProtectedSeed(seed());
		expect(projected.scenario).toBe("");
		expect(projected.playGuide).toBe("");
		expect(projected.lore).toEqual([]);
		expect(projected.characters).toEqual([
			{
				name: "세레나",
				description: "",
				personality: "",
				speechStyle: "",
				exampleDialogue: "",
				prompt: "",
			},
		]);
		expect(projected.firstScene).toBe("*문이 열린다.*");
		expect(projected.persona).toEqual(seed().persona);
		expect(projected.title).toBe("보호된 작품");
	});

	it("the shape stays: already deployed clients read the same contract", () => {
		const projected = projectProtectedSeed(seed());
		expect(Object.keys(projected).sort()).toEqual(Object.keys(seed()).sort());
		expect(StoryChatSeedDto.parse(projected)).toEqual(projected);
	});

	it("leaves non-protected stories untouched", () => {
		const open = seed({ promptProtected: false });
		expect(projectProtectedSeed(open)).toBe(open);
	});
});
