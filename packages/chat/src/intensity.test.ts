import {
	StoryChatSeedDto,
	type StoryChatSeedInput,
} from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import { buildChatGenerationRequest } from "./context.ts";
import {
	ADULT_TAIL,
	ALL_AGES_TAIL,
	applyPlatformSafetyPolicy,
	deliveredChatSystem,
} from "./guards.ts";
import {
	applyRoomIntensity,
	CHAT_INTENSITIES,
	type ChatIntensity,
	chatIntensityBlock,
	chatIntensityChoices,
	isChatIntensity,
	resolveChatIntensity,
	roomChatIntensity,
} from "./intensity.ts";
import { type ChatRoom, type ChatSeed, createRoomRecord } from "./model.ts";

const REV = { t: 1_767_225_600_000, c: 0, d: "test-device" };

const seed = (input: Partial<StoryChatSeedInput> = {}): ChatSeed =>
	StoryChatSeedDto.parse({
		version: 1,
		storyId: "story-1",
		title: "테스트 작품",
		adult: false,
		promptProtected: false,
		scenario: "SCENARIO_MARKER",
		...input,
	});

const room = (over: Partial<ChatRoom> = {}): ChatRoom => ({
	...createRoomRecord(
		{ originStoryId: "story-1", seed: seed() },
		{
			id: "room-1",
			routingSessionId: "0f1e2d3c-4b5a",
			now: "2026-01-01T00:00:00.000Z",
			rev: REV,
		},
	),
	...over,
});

describe("resolveChatIntensity: the rating is the ceiling", () => {
	it("«intense» stands only in adult mode", () => {
		expect(resolveChatIntensity({ intensity: "intense", allAges: false })).toBe(
			"intense",
		);
		/*
		 * In an all-ages turn, setting `Intense` conflicts directly with the tail guard's 'when in doubt, be
		 * conservative'. Contradictory instructions do not raise an error; they show up as results that
		 * sometimes work and sometimes do not.
		 */
		expect(resolveChatIntensity({ intensity: "intense", allAges: true })).toBe(
			null,
		);
	});

	it("«softened» stands in both ratings", () => {
		expect(
			resolveChatIntensity({ intensity: "softened", allAges: false }),
		).toBe("softened");
		expect(resolveChatIntensity({ intensity: "softened", allAges: true })).toBe(
			"softened",
		);
	});

	it("nothing stands when nothing was chosen", () => {
		expect(resolveChatIntensity({ intensity: null, allAges: false })).toBe(
			null,
		);
		expect(resolveChatIntensity({ intensity: undefined, allAges: false })).toBe(
			null,
		);
	});
});

describe("chatIntensityChoices: the values the screen can offer", () => {
	it("all-ages stories have no «intense»", () => {
		expect(chatIntensityChoices(false)).toEqual(["softened"]);
	});

	it("adult stories have both", () => {
		expect(chatIntensityChoices(true)).toEqual([...CHAT_INTENSITIES]);
	});

	/**
	 * The argument is the work's rating, not this turn's effective rating. Before verification the
	 * effective rating is all-ages, but after verification the same room returns as adult. The value
	 * that should be selectable then must not disappear from the screen.
	 */
	it("an adult story keeps the list even without current entitlement", () => {
		expect(chatIntensityChoices(true)).toContain("intense");
	});
});

describe("applyRoomIntensity: default has one representation", () => {
	it("resetting to default removes the key itself", () => {
		const applied = applyRoomIntensity(room(), "softened");
		expect(applied.intensity).toBe("softened");
		const cleared = applyRoomIntensity(applied, null);
		expect("intensity" in cleared).toBe(false);
	});

	/**
	 * Applying it twice gives the same shape. Idempotence matters for round trips between two devices.
	 */
	it("is idempotent", () => {
		const once = applyRoomIntensity(room(), null);
		expect(applyRoomIntensity(once, null)).toEqual(once);
	});

	/**
	 * The merge path selects the stored value as-is, so a value from a newer build that this build
	 * does not know can arrive. Unknown values fold to the default.
	 */
	it("values outside the vocabulary fold to default", () => {
		const record = applyRoomIntensity(
			room(),
			"extreme" as unknown as ChatIntensity,
		);
		expect("intensity" in record).toBe(false);
		expect(roomChatIntensity({ intensity: "extreme" as never })).toBe(null);
		expect(isChatIntensity("extreme")).toBe(false);
	});
});

describe("assembler: where the block stands", () => {
	/** The prompt that reaches the model. The transport layer attaches the tail guard. */
	const build = (over: Partial<ChatRoom>, allAges: boolean) =>
		deliveredChatSystem(
			buildChatGenerationRequest({ room: room(over), messages: [], allAges }),
		);

	it("the «softened» block stands after the user note, before the tail guard", () => {
		const system = build(
			{ intensity: "softened", userNote: "USER_NOTE_MARKER" },
			true,
		);
		expect(system).toContain(chatIntensityBlock("softened"));
		const block = system.indexOf(chatIntensityBlock("softened"));
		expect(block).toBeGreaterThan(system.indexOf("USER_NOTE_MARKER"));
		expect(block).toBeLessThan(system.indexOf(ALL_AGES_TAIL));
	});

	it("an all-ages turn gets no «intense» block", () => {
		expect(build({ intensity: "intense" }, true)).not.toContain(
			chatIntensityBlock("intense"),
		);
	});

	it("an adult turn gets the «intense» block before the tail guard", () => {
		const system = build({ intensity: "intense" }, false);
		/*
		 * Check presence first. If the block is absent, indexOf returns -1 and the order check below
		 * passes trivially, so a missing block would still pass. This trap was hit while building the
		 * slice: a rebuild dropped the axis, and the order-only test still passed.
		 */
		expect(system).toContain(chatIntensityBlock("intense"));
		expect(system.indexOf(chatIntensityBlock("intense"))).toBeLessThan(
			system.indexOf(ADULT_TAIL),
		);
	});

	/**
	 * Byte-for-byte the same as before this axis existed, for rooms that do not choose an intensity
	 * (most of them). The prefix must stay identical so that existing conversations do not rewrite
	 * their cache on the next turn.
	 */
	it("a room with no choice adds not one character to the prompt", () => {
		const { intensity: _drop, ...base } = room({ intensity: "softened" });
		expect(build(base, true)).toBe(build({}, true));
	});
});

/**
 * Wrap integrity: the part of this slice most likely to break silently.
 *
 * applyPlatformSafetyPolicy checks whether the body ends with the fixed tail (endsWith) and passes
 * an already-wrapped request through untouched. If the intensity block went after the tail, that
 * check would fail and every normal request would get the tail twice, with no visible symptom.
 */
describe("platform policy: the intensity block does not break the wrapping", () => {
	it.each([
		["softened", true],
		["softened", false],
		["intense", false],
	] as const)("«%s» · allAges=%s", (intensity, allAges) => {
		const system = buildChatGenerationRequest({
			room: room({ intensity }),
			messages: [],
			allAges,
		}).system;
		const policy = { allAges, houseRules: true };
		const wrapped = applyPlatformSafetyPolicy(system, policy);
		// The intensity block ends the body, and the tail follows it exactly once.
		expect(
			wrapped.endsWith(`${system}\n\n${allAges ? ALL_AGES_TAIL : ADULT_TAIL}`),
		).toBe(true);
		// Wrapping the already-wrapped result again must add no bytes.
		expect(applyPlatformSafetyPolicy(wrapped, policy)).toBe(wrapped);
	});
});
