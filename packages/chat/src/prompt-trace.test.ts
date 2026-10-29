import {
	StoryChatSeedDto,
	type StoryChatSeedInput,
} from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import {
	buildChatGenerationRequest,
	buildChatGenerationRequestTraced,
} from "./context.ts";
import { deliveredChatSystem } from "./guards.ts";
import type { ChatMessage, ChatRoom, ChatSeed } from "./model.ts";
import { createMessageRecord, createRoomRecord } from "./model.ts";
import {
	CHAT_PROMPT_BLOCK_IDS,
	CHAT_PROMPT_BLOCK_LABEL,
	CHAT_PROMPT_BLOCK_SOURCE,
	chatSystemPromptText,
	safeChatRequestDebug,
} from "./prompt-trace.ts";

/**
 * Enabling instrumentation must not change the outgoing request. The first block asserts that. The
 * other tests cover structure: joining the blocks must yield the text actually sent, the allow-list
 * must be narrow, and assembled blocks must fall within the block vocabulary.
 */

const REV = { t: 1_767_225_600_000, c: 0, d: "test-device" };
type SeedInput = Partial<StoryChatSeedInput>;

const seed = (overrides: SeedInput = {}): ChatSeed =>
	StoryChatSeedDto.parse({
		version: 1,
		storyId: "story-1",
		title: "테스트 작품",
		adult: false,
		promptProtected: false,
		scenario: "비 내리는 항구 도시.",
		firstScene: "그녀가 우산을 접으며 들어왔다.",
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

const message = (
	role: ChatMessage["role"],
	content: string,
	index = 0,
): ChatMessage =>
	createMessageRecord(
		{ roomId: "room-1", role, content },
		{
			id: `m-${index}`,
			now: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
			rev: { ...REV, c: index },
		},
	);

const FIXTURES = [
	{
		name: "가장 단순한 방",
		input: () => ({ room: room(), messages: [], allAges: true }),
	},
	{
		name: "성인 · 로어 · 인물 · 히스토리",
		input: () => ({
			room: room({
				adult: true,
				characters: [
					{
						name: "카이",
						description: "",
						personality: "",
						speechStyle: "",
						exampleDialogue: "",
						prompt: "말수가 적다",
					},
				],
				lore: [
					{
						keys: ["항구"],
						content: "항구는 밤에 닫힌다",
						constant: false,
						order: 3,
						position: "system_top" as const,
					},
					{
						keys: [],
						content: "언제나 비가 온다",
						constant: true,
						order: 0,
						position: "system_bottom" as const,
					},
				],
				playGuide: "천천히 진행하세요.",
			}),
			messages: [
				message("user", "항구로 갔다", 0),
				message("assistant", "그녀가 웃는다", 1),
			],
			allAges: false,
			userInput: "다시 항구로",
		}),
	},
	{
		name: "이어쓰기",
		input: () => ({
			room: room(),
			messages: [message("assistant", "잘린 문장", 0)],
			allAges: true,
			continuation: true,
		}),
	},
] as const;

describe("instrumentation does not change the request", () => {
	it.each(
		FIXTURES,
	)("$name: the traced and plain versions build the same request", ({
		input,
	}) => {
		const plain = buildChatGenerationRequest(input());
		const traced = buildChatGenerationRequestTraced(input()).request;
		expect(traced).toEqual(plain);
		expect(traced.system).toBe(plain.system);
	});
});

describe("block structure", () => {
	it("joining the blocks gives the system prompt the model receives", () => {
		for (const fixture of FIXTURES) {
			const { request, trace } = buildChatGenerationRequestTraced(
				fixture.input(),
			);
			expect(chatSystemPromptText(trace.blocks)).toBe(
				deliveredChatSystem(request),
			);
		}
	});

	it("every block the assembler stands is in the vocabulary, in the vocabulary's order", () => {
		const { trace } = buildChatGenerationRequestTraced(FIXTURES[1].input());
		const order = trace.blocks.map((block) =>
			CHAT_PROMPT_BLOCK_IDS.indexOf(block.id),
		);
		expect(order.every((index) => index >= 0)).toBe(true);
		expect([...order]).toEqual([...order].sort((a, b) => a - b));
	});

	it("empty blocks do not stand", () => {
		const { trace } = buildChatGenerationRequestTraced({
			room: room({ scenario: "", firstScene: "", playGuide: "" }),
			messages: [],
			allAges: true,
		});
		expect(trace.blocks.some((block) => block.text.trim() === "")).toBe(false);
		expect(trace.blocks.map((block) => block.id)).not.toContain("play-guide");
	});

	it("safety guards wrap creator content **at both ends**", () => {
		const { trace } = buildChatGenerationRequestTraced(FIXTURES[1].input());
		const sources = trace.blocks.map(
			(block) => CHAT_PROMPT_BLOCK_SOURCE[block.id],
		);
		expect(sources[0]).toBe("platform");
		expect(sources[sources.length - 1]).toBe("platform");
	});

	it("labels and sources cover the whole vocabulary", () => {
		for (const id of CHAT_PROMPT_BLOCK_IDS) {
			expect(CHAT_PROMPT_BLOCK_LABEL[id]).toBeTruthy();
			expect(CHAT_PROMPT_BLOCK_SOURCE[id]).toBeTruthy();
		}
	});

	it("lore decisions hold both active and inactive, and carry the scanned text", () => {
		const { trace } = buildChatGenerationRequestTraced(FIXTURES[1].input());
		expect(trace.lore).toHaveLength(2);
		expect(trace.lore.filter((decision) => decision.active)).toHaveLength(2);
		expect(trace.loreScanText).toContain("다시 항구로");
	});
});

describe("safe projection", () => {
	it("the key set is exactly the allowlist", () => {
		const { request } = buildChatGenerationRequestTraced(FIXTURES[1].input());
		expect(Object.keys(safeChatRequestDebug(request)).sort()).toEqual([
			"continuation",
			"hasRoutingSession",
			"maxOutputTokens",
			"messages",
			"reasoningEffort",
			"requestedMode",
			"system",
			"toolCount",
		]);
	});

	it("the routing key rides as **presence, not value**", () => {
		const { request } = buildChatGenerationRequestTraced({
			room: room(),
			messages: [],
			allAges: true,
			routingSessionId: "5b1c9a2e-0000-4000-8000-000000000000",
		});
		const projected = safeChatRequestDebug(request);
		expect(projected.hasRoutingSession).toBe(true);
		expect(JSON.stringify(projected)).not.toContain("5b1c9a2e");
	});

	it("message rows carry only role, body and tool name", () => {
		const { request } = buildChatGenerationRequestTraced(FIXTURES[1].input());
		for (const line of safeChatRequestDebug(request).messages)
			expect(Object.keys(line).sort()).toEqual([
				"content",
				"role",
				"toolCallName",
			]);
	});
});
