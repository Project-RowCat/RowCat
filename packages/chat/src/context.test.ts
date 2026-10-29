import {
	StoryChatSeedDto,
	type StoryChatSeedInput,
} from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import type { ChatCharacter } from "./character.ts";
import {
	buildChatGenerationRequest,
	CHAT_HISTORY_LIMIT,
	resolveAllAges,
	selectLore,
} from "./context.ts";
import {
	ABSOLUTE_GUARD,
	ADULT_GUARD,
	ADULT_TAIL,
	ALL_AGES_GUARD,
	ALL_AGES_TAIL,
	deliveredChatSystem,
	MINOR_PRESENT_GUARD,
} from "./guards.ts";
import type { ChatMemory } from "./memory.ts";
import { createMemoryRecord } from "./memory.ts";
import type { ChatMessage, ChatRoom, ChatSeed } from "./model.ts";
import { createMessageRecord, createRoomRecord } from "./model.ts";
import { CHAT_USER_NOTE_MAX_LENGTH } from "./user-note.ts";

/**
 * Context-assembler tests. What is checked is order and inclusion, not wording. Specifically: the
 * safety guard sits before and after the creator content, the opening stays on the system side
 * rather than in history, and history does not exceed its limit. These can break silently, and the
 * screen alone would not reveal it.
 */

/**
 * Snapshot fixture. It takes the contract's input type, so tests need not write every defaulted
 * field, and typos still surface as type errors.
 */
type SeedInput = Partial<StoryChatSeedInput>;

/**
 * The assembler does not read revisions. This only fills the slots needed to construct a record.
 */
const REV = { t: 1_767_225_600_000, c: 0, d: "test-device" };

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

describe("resolveAllAges", () => {
	it("an all-ages story stays all-ages for adult viewers too", () => {
		// The work's age rating takes priority. Looking only at the user's setting would make the
		// creator's rating meaningless.
		expect(resolveAllAges({ adult: false }, { adultAllowed: true })).toBe(true);
	});

	it("an adult story opens in adult mode only with entitlement", () => {
		expect(resolveAllAges({ adult: true }, { adultAllowed: true })).toBe(false);
		expect(resolveAllAges({ adult: true }, { adultAllowed: false })).toBe(true);
	});
});

/**
 * The guard is added by the transport layer (applyPlatformSafetyPolicy), not by the assembler. What
 * is checked here is the prompt that reaches the model: whether the assembler's verdicts (rating,
 * minors) arrive in the right place.
 */
describe("buildChatGenerationRequest: safety guards", () => {
	it("the absolute guard always stands at the very top", () => {
		const request = buildChatGenerationRequest({
			room: room(),
			messages: [],
			allAges: true,
		});
		expect(deliveredChatSystem(request).startsWith(ABSOLUTE_GUARD)).toBe(true);
	});

	it("the all-ages and adult guards are exclusive", () => {
		const allAges = deliveredChatSystem(
			buildChatGenerationRequest({ room: room(), messages: [], allAges: true }),
		);
		expect(allAges).toContain(ALL_AGES_GUARD);
		expect(allAges).not.toContain(ADULT_GUARD);

		const adult = deliveredChatSystem(
			buildChatGenerationRequest({
				room: room({ adult: true }),
				messages: [],
				allAges: false,
			}),
		);
		expect(adult).toContain(ADULT_GUARD);
		expect(adult).not.toContain(ALL_AGES_GUARD);
	});

	it("the tail guard follows creator content", () => {
		/**
		 * This order is the reason the guard exists. If world setting or characters came after the tail,
		 * they would sit closer to the generation point, by recency, and effectively override the safety
		 * rules.
		 */
		const request = buildChatGenerationRequest({
			room: room({ scenario: "SCENARIO_MARKER" }),
			messages: [],
			allAges: true,
		});
		expect(deliveredChatSystem(request).indexOf(ALL_AGES_TAIL)).toBeGreaterThan(
			deliveredChatSystem(request).indexOf("SCENARIO_MARKER"),
		);
	});

	it("the expression-limit tail attaches in adult mode too", () => {
		const request = buildChatGenerationRequest({
			room: room({ adult: true }),
			messages: [],
			allAges: false,
		});
		expect(deliveredChatSystem(request)).toContain(ADULT_TAIL);
	});

	it("a dedicated guard attaches in adult mode when a character reads as a minor", () => {
		const request = buildChatGenerationRequest({
			room: room({
				adult: true,
				characters: [{ name: "하나", description: "고등학생" }],
			}),
			messages: [],
			allAges: false,
		});
		expect(deliveredChatSystem(request)).toContain(MINOR_PRESENT_GUARD);
	});

	it("all-ages mode does not attach the minor guard twice", () => {
		// Sexual description is already banned outright, so restating it would only waste tokens.
		const request = buildChatGenerationRequest({
			room: room({ characters: [{ name: "하나", description: "고등학생" }] }),
			messages: [],
			allAges: true,
		});
		expect(deliveredChatSystem(request)).not.toContain(MINOR_PRESENT_GUARD);
	});
});

describe("buildChatGenerationRequest: story content", () => {
	it("the opening folds into the system side, not the history", () => {
		const request = buildChatGenerationRequest({
			room: room(),
			messages: [],
			allAges: true,
		});
		expect(request.system).toContain("# 시작 장면");
		expect(request.system).toContain("그녀가 우산을 접으며 들어왔다.");
		// The history does not hold the opening text. It stays out of history so the opening does not
		// disappear when the window advances.
		expect(
			request.messages.some((m) => m.content.includes("우산을 접으며")),
		).toBe(false);
	});

	it("uses the first candidate when the opening is empty", () => {
		const request = buildChatGenerationRequest({
			room: room({
				firstScene: "",
				startScenes: [{ title: "밤", content: "골목은 조용했다." }],
			}),
			messages: [],
			allAges: true,
		});
		expect(request.system).toContain("골목은 조용했다.");
	});

	it("a card with a free prompt is not converted to the entry format", () => {
		const request = buildChatGenerationRequest({
			room: room({
				characters: [
					{ name: "레이", personality: "무시됨", prompt: "FREE_FORM_CARD" },
				],
			}),
			messages: [],
			allAges: true,
		});
		expect(request.system).toContain("FREE_FORM_CARD");
		expect(request.system).not.toContain("- 성격: 무시됨");
	});
});

describe("selectLore", () => {
	const entries = [
		{ keys: ["항구"], content: "항구 설정", constant: false, order: 0 },
		{ keys: [], content: "상시 설정", constant: true, order: 5 },
		{ keys: ["사막"], content: "사막 설정", constant: false, order: 9 },
	].map((entry) => ({ ...entry, position: "system_bottom" as const }));

	it("always-on entries are chosen regardless of triggers", () => {
		expect(selectLore(entries, "아무 말")).toEqual([
			expect.objectContaining({ content: "상시 설정" }),
		]);
	});

	it("chosen when a key appears, otherwise not", () => {
		const selected = selectLore(entries, "항구에 도착했다");
		expect(selected.map((e) => e.content)).toEqual(["상시 설정", "항구 설정"]);
	});

	it("higher order comes first", () => {
		const selected = selectLore(entries, "항구와 사막");
		expect(selected.map((e) => e.content)).toEqual([
			"사막 설정",
			"상시 설정",
			"항구 설정",
		]);
	});

	it("entries with an empty body are not chosen", () => {
		// Keeps an empty instruction block, with only a heading, out of the prompt.
		expect(
			selectLore(
				[
					{
						keys: [],
						content: "   ",
						constant: true,
						order: 0,
						position: "system_bottom",
					},
				],
				"",
			),
		).toEqual([]);
	});
});

describe("buildChatGenerationRequest: history", () => {
	it("cuts the past beyond the cap", () => {
		const messages = Array.from({ length: CHAT_HISTORY_LIMIT + 10 }, (_, i) =>
			message(i % 2 === 0 ? "user" : "assistant", `turn-${i}`, i),
		);
		const request = buildChatGenerationRequest({
			room: room(),
			messages,
			allAges: true,
		});
		// A nudge may be attached, so the limit plus one is allowed.
		expect(request.messages.length).toBeLessThanOrEqual(CHAT_HISTORY_LIMIT + 1);
		expect(request.messages.some((m) => m.content.includes("turn-0"))).toBe(
			false,
		);
		expect(
			request.messages.some((m) =>
				m.content.includes(`turn-${CHAT_HISTORY_LIMIT + 9}`),
			),
		).toBe(true);
	});

	it("user turns carry the speaker name", () => {
		const request = buildChatGenerationRequest({
			room: room({ persona: { name: "카이", description: "" } }),
			messages: [message("user", "안녕")],
			allAges: true,
		});
		expect(request.messages[0]).toEqual({
			role: "user",
			content: "카이: 안녕",
		});
	});

	it("a user turn stands before a conversation that starts with the assistant", () => {
		// Most providers require a conversation to start with a user message.
		const request = buildChatGenerationRequest({
			room: room(),
			messages: [message("assistant", "…")],
			allAges: true,
		});
		expect(request.messages[0]?.role).toBe("user");
	});

	it("when the last turn is the assistant's, a nudge to continue is attached", () => {
		const request = buildChatGenerationRequest({
			room: room(),
			messages: [message("user", "안녕", 0), message("assistant", "반가워", 1)],
			allAges: true,
		});
		const last = request.messages[request.messages.length - 1];
		expect(last?.role).toBe("user");
		expect(last?.content).toContain("이어서 전개");
	});

	it("the unsaved current input can be appended", () => {
		const request = buildChatGenerationRequest({
			room: room(),
			messages: [message("assistant", "…")],
			userInput: "다음은?",
			allAges: true,
		});
		const last = request.messages[request.messages.length - 1];
		expect(last?.content).toContain("다음은?");
	});

	it("empty messages do not ride on the request", () => {
		// Most providers reject empty messages, which would block the entire turn.
		const request = buildChatGenerationRequest({
			room: room(),
			messages: [message("user", "  ", 0), message("user", "실제 입력", 1)],
			allAges: true,
		});
		expect(
			request.messages.filter((m) => m.content.includes("실제")),
		).toHaveLength(1);
		expect(request.messages).toHaveLength(1);
	});
});

const memory = (content: string, index = 0): ChatMemory =>
	createMemoryRecord(
		{ roomId: "room-1", content, pinned: index === 0 },
		{
			id: `mem-${index}`,
			now: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
			rev: { ...REV, c: index },
		},
	);

/**
 * Checks whether assembly output is reproduced byte for byte. Provider prompt caching is pure
 * prefix matching: one changed character in the system prompt or an earlier message turns
 * everything after it into a cache miss. The damage shows up as cost, not as an error.
 *
 * So this test checks one property: the same input yields the same string. It breaks first if
 * anything nondeterministic enters the assembler, such as Date.now(), random ids, request time, or
 * unstable iteration order.
 *
 * The order is not changed for caching. The positions of lore, memory and the safety tail carry
 * product and safety meaning, and that outweighs the cache hit rate.
 */
/**
 * The routing-affinity key is a property of the request, not of the prompt. The provider's
 * vocabulary (session_id) is deliberately not asserted here. That translation belongs to the server
 * adapter (apps/api/src/services/generation/chat.ts). If this layer knew the provider's name, the
 * assembler would start knowing about providers, which this package avoids.
 */
describe("buildChatGenerationRequest: routing session", () => {
	const build = (routingSessionId?: string) =>
		buildChatGenerationRequest({
			room: room(),
			messages: [message("user", "안녕", 0)],
			allAges: true,
			...(routingSessionId ? { routingSessionId } : {}),
		});

	it("the passed value rides on the request in product vocabulary as is", () => {
		expect(build("0f1e2d3c-4b5a").routingSessionId).toBe("0f1e2d3c-4b5a");
	});

	/**
	 * A conversation that does not set this key (such as a work test) produces a request
	 * byte-identical to the old one.
	 */
	it("absent means no key at all", () => {
		const request = build();
		expect(request).not.toHaveProperty("routingSessionId");
		expect(Object.keys(request)).not.toContain("routingSessionId");
	});

	/**
	 * The prompt is not changed by a single character. Changing it would be a context change, not a
	 * cost optimization. The cache prefix would also split depending on whether the key is present.
	 */
	it("leaves the prompt and history untouched", () => {
		const withKey = build("0f1e2d3c-4b5a");
		const without = build();
		expect(withKey.system).toBe(without.system);
		expect(withKey.messages).toEqual(without.messages);
		expect({ ...withKey, routingSessionId: undefined }).toEqual({
			...without,
			routingSessionId: undefined,
		});
	});
});

describe("buildChatGenerationRequest: determinism", () => {
	it("the same input makes a byte-identical prompt", () => {
		const input = {
			room: room({ persona: { name: "카이", description: "탐정" } }),
			messages: [
				message("user", "안녕", 0),
				message("assistant", "반가워", 1),
				message("user", "비 오는 날의 항구", 2),
			],
			memories: [
				memory("페르소나는 왼손잡이다", 0),
				memory("우산을 잃었다", 1),
			],
			allAges: true,
			userInput: "다음은?",
		};

		const first = buildChatGenerationRequest(input);
		const second = buildChatGenerationRequest(input);

		expect(second.system).toBe(first.system);
		expect(JSON.stringify(second.messages)).toBe(
			JSON.stringify(first.messages),
		);
	});

	it("**a different object** holding the same values gives the same result", () => {
		/**
		 * The assertion above alone would pass even if the assembler cached its result. The test builds a
		 * fresh record and passes it in, so 'equal input values give equal output' is actually verified.
		 * A real second turn's prefix is an object re-read from storage.
		 */
		const build = () =>
			buildChatGenerationRequest({
				room: room(),
				messages: [message("user", "안녕", 0)],
				memories: [memory("기억 하나", 0)],
				allAges: false,
			});
		expect(build().system).toBe(build().system);
	});
});

/**
 * Where the narration pack sits in the prompt and what it changes. Three things are checked: its
 * position (after the progress rules, before creator content), placeholder substitution, and that
 * the protective sentence is swapped only together with the pack.
 */
describe("narration packs", () => {
	const PACK = "PACK BODY for {{char}} and {{user}}";
	const seeded = () =>
		room({
			scenario: "세계관",
			characters: [{ name: "세나", prompt: "차분하다" }],
			persona: { name: "이든", description: "{{char}}의 동료" },
		});

	it("without passing one it is **not one character different** from before this axis", () => {
		const target = seeded();
		const base = buildChatGenerationRequest({
			room: target,
			messages: [],
			allAges: true,
		});
		const withNull = buildChatGenerationRequest({
			room: target,
			messages: [],
			allAges: true,
			narration: null,
		});
		expect(withNull.system).toBe(base.system);
		expect(base.system).toContain("대신 묘사하지 마세요");
	});

	it("stands **after** the roleplay rules and **before** creator content", () => {
		const system = deliveredChatSystem(
			buildChatGenerationRequest({
				room: seeded(),
				messages: [],
				allAges: true,
				narration: { text: PACK, writesUser: false },
			}),
		);
		const pack = system.indexOf("PACK BODY");
		expect(pack).toBeGreaterThan(system.indexOf("# 진행 규칙"));
		expect(pack).toBeLessThan(system.indexOf("# 세계관 / 상황"));
		/* The tail guard is still last. The pack does not push it out of that position. */
		expect(pack).toBeLessThan(system.indexOf(ALL_AGES_TAIL));
	});

	/**
	 * The pack body is original work, so placeholders sit in the middle of English sentences. Without
	 * substitution, the name the pack uses for the character would differ from the name the rest of
	 * the prompt uses.
	 */
	it("`{{char}}` and `{{user}}` fold to the same names as the seed", () => {
		const { system } = buildChatGenerationRequest({
			room: seeded(),
			messages: [],
			allAges: true,
			narration: { text: PACK, writesUser: false },
		});
		expect(system).toContain("PACK BODY for 세나 and 이든");
		expect(system).not.toContain("{{char}}");
	});

	/**
	 * This is where the most expensive mistake of this slice is blocked. Under narration delegation,
	 * two sentences are removed and a replacement sentence is added alongside them. Having only one of
	 * these happen is already prevented outside the assembler (narrationInjection), but it is also
	 * checked here by value.
	 */
	it("the protective sentences are replaced only when the delegation decision is true", () => {
		const protectedPrompt = buildChatGenerationRequest({
			room: seeded(),
			messages: [],
			allAges: true,
			narration: { text: PACK, writesUser: false },
		}).system;
		const delegated = buildChatGenerationRequest({
			room: seeded(),
			messages: [],
			allAges: true,
			narration: { text: PACK, writesUser: true },
		}).system;

		expect(protectedPrompt).toContain("대신 묘사하지 마세요");
		expect(protectedPrompt).toContain(
			"유저를 대신해 말하거나 행동하지 않습니다",
		);

		expect(delegated).not.toContain("대신 묘사하지 마세요");
		expect(delegated).not.toContain("유저를 대신해 말하거나 행동하지 않습니다");
		expect(delegated).toContain("대신 서술하세요");
		expect(delegated).toContain("그 인물을 대신 서술합니다");
	});

	/**
	 * Consent is never removed in any scope. Replacing narration is not the same as replacing consent.
	 * If that distinction disappeared under autoplay plus adult mode, no sentence would remain to
	 * guard the user.
	 */
	it("the consent sentence stands in delegating scopes and in adult mode", () => {
		for (const writesUser of [false, true])
			for (const allAges of [false, true]) {
				const { system } = buildChatGenerationRequest({
					room: seeded(),
					messages: [],
					allAges,
					narration: { text: PACK, writesUser },
				});
				expect(system).toContain("**동의**를 넘겨짚지 마세요");
			}
	});
});

/**
 * Where and in what shape characters added in this conversation appear in the prompt. Three things
 * are checked: they share one block with the work's characters, no source tag is attached, and a
 * conversation that adds no characters produces the same prompt as before this axis existed.
 */
describe("characters: those added in this conversation", () => {
	const added = (name: string, prompt = ""): ChatCharacter => ({
		id: name,
		roomId: "room-1",
		name,
		prompt,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		deletedAt: null,
		dirty: 0,
		serverVersion: 1,
		rev: { t: 1, c: 0, d: "device-a" },
	});

	it("without passing one it is **not one character different** from before this axis", () => {
		const target = room({ scenario: "세계관" });
		expect(
			buildChatGenerationRequest({ room: target, messages: [], allAges: true })
				.system,
		).toBe(
			buildChatGenerationRequest({
				room: target,
				messages: [],
				allAges: true,
				characters: [],
			}).system,
		);
	});

	/**
	 * In v2 works the seed's characters are always empty, so in most rooms these added characters are
	 * the entire cast.
	 */
	it("the character block stands even when the seed has no characters", () => {
		const { system } = buildChatGenerationRequest({
			room: room({ scenario: "세계관" }),
			messages: [],
			allAges: true,
			characters: [added("유진", "17세. 무뚝뚝하다.")],
		});
		expect(system).toContain("# 등장인물");
		expect(system).toContain("## 유진\n17세. 무뚝뚝하다.");
	});

	/**
	 * One block. If the cast were split by lore, summary or memory, the answer to 'who is in this
	 * story' would become two answers.
	 */
	it("stands in one block with the story's characters, story first", () => {
		const { system } = buildChatGenerationRequest({
			room: room({
				scenario: "세계관",
				characters: [{ name: "세나", prompt: "차분하다" }],
			}),
			messages: [],
			allAges: true,
			characters: [added("유진")],
		});
		const heading = system.indexOf("# 등장인물");
		const sena = system.indexOf("## 세나");
		const yujin = system.indexOf("## 유진");
		expect(heading).toBeLessThan(sena);
		expect(sena).toBeLessThan(yujin);
		/** No other block sits between them. The check is that the cast title appears exactly once. */
		expect(system.split("# 등장인물")).toHaveLength(2);
	});

	/**
	 * No source is written into the prompt. A tag such as 'added in this conversation' would tell the
	 * model to treat that character as second-tier. The effect shows up as quality, not as an error.
	 */
	it("no provenance tag is attached", () => {
		const { system } = buildChatGenerationRequest({
			room: room({ scenario: "세계관" }),
			messages: [],
			allAges: true,
			characters: [added("유진")],
		});
		expect(system).not.toContain("추가");
		expect(system).not.toContain("이 대화에서");
	});

	/** With no description, only the name appears. That is still a line in the cast list. */
	it("a character without a description stands by name only", () => {
		const { system } = buildChatGenerationRequest({
			room: room({ scenario: "세계관" }),
			messages: [],
			allAges: true,
			characters: [added("유진")],
		});
		expect(system).toContain("## 유진");
	});

	/**
	 * An added character's description is a character card too, so it goes through the same
	 * substitution as work cards. Otherwise the literal {{user}} reaches the model, which then writes
	 * it back as read.
	 */
	it("added characters' descriptions pass name substitution too", () => {
		const { system } = buildChatGenerationRequest({
			room: room({
				scenario: "세계관",
				persona: { name: "카이", description: "" },
			}),
			messages: [],
			allAges: true,
			characters: [added("유진", "{{user}}의 소꿉친구.")],
		});
		expect(system).toContain("## 유진\n카이의 소꿉친구.");
		expect(system).not.toContain("{{user}}");
	});

	/**
	 * In v2 works the seed's characters are always empty. If minor detection looked only at the seed,
	 * rooms whose cast consists of added characters would never trigger this guard.
	 */
	it("when an added character reads as a minor, the minor guard stands in adult mode", () => {
		const system = deliveredChatSystem(
			buildChatGenerationRequest({
				room: room({ adult: true, scenario: "세계관" }),
				messages: [],
				allAges: false,
				characters: [added("유진", "17세 고등학생.")],
			}),
		);
		expect(system).toContain(MINOR_PRESENT_GUARD);
	});

	it("the minor guard stands when the user role's description reads as a minor too", () => {
		const system = deliveredChatSystem(
			buildChatGenerationRequest({
				room: room({
					adult: true,
					scenario: "세계관",
					persona: { name: "카이", description: "17세 고등학생" },
				}),
				messages: [],
				allAges: false,
			}),
		);
		expect(system).toContain(MINOR_PRESENT_GUARD);
	});

	it("without minor indicators the guard does not stand even with added characters", () => {
		const system = deliveredChatSystem(
			buildChatGenerationRequest({
				room: room({ adult: true, scenario: "세계관" }),
				messages: [],
				allAges: false,
				characters: [added("유진", "서른 살 형사.")],
			}),
		);
		expect(system).not.toContain(MINOR_PRESENT_GUARD);
	});

	/** The position is after world setting and before the role. The tail guard still comes last. */
	it("stands after the world and before the tail guard", () => {
		const system = deliveredChatSystem(
			buildChatGenerationRequest({
				room: room({ scenario: "세계관" }),
				messages: [],
				allAges: true,
				characters: [added("유진")],
			}),
		);
		const cast = system.indexOf("# 등장인물");
		expect(cast).toBeGreaterThan(system.indexOf("# 세계관 / 상황"));
		expect(cast).toBeLessThan(system.indexOf(ALL_AGES_TAIL));
	});
});

describe("user note: the request the user attached to this conversation", () => {
	it("absent, it is **not one character different** from before this axis", () => {
		const target = room({ scenario: "세계관" });
		const { userNote: _drop, ...without } = target;
		expect(
			buildChatGenerationRequest({ room: target, messages: [], allAges: true })
				.system,
		).toBe(
			buildChatGenerationRequest({
				room: without as ChatRoom,
				messages: [],
				allAges: true,
			}).system,
		);
	});

	it("an empty value stands no block either: an empty heading sends the model looking for content", () => {
		const { system } = buildChatGenerationRequest({
			room: { ...room({ scenario: "세계관" }), userNote: "   " },
			messages: [],
			allAges: true,
		});
		expect(system).not.toContain("유저 노트");
	});

	it("when written, the body rides as is", () => {
		const { system } = buildChatGenerationRequest({
			room: { ...room({ scenario: "세계관" }), userNote: "묘사를 짧게 유지." },
			messages: [],
			allAges: true,
		});
		expect(system).toContain("묘사를 짧게 유지.");
	});

	/**
	 * This order is the prompt-injection boundary of this product. Notes are a field where the user
	 * may write anything, so the point of the order is that the note never sits where it could
	 * override the safety rules. Moving the note after the tail guard would open that boundary.
	 */
	it("stands after memories and before the safety tail guard", () => {
		const system = deliveredChatSystem(
			buildChatGenerationRequest({
				room: { ...room({ scenario: "세계관" }), userNote: "반말로 진행." },
				messages: [],
				allAges: true,
				memories: [memory("카이는 왼손잡이다.")],
			}),
		);
		const memoryAt = system.indexOf("카이는 왼손잡이다.");
		const noteAt = system.indexOf("반말로 진행.");
		expect(memoryAt).toBeGreaterThan(-1);
		expect(memoryAt).toBeLessThan(noteAt);
		expect(noteAt).toBeLessThan(system.indexOf(ALL_AGES_TAIL));
	});

	/**
	 * Stored values are not substituted, the same as memory and messages. Substituting would make the
	 * edit form's restore text differ from what the model read, and nothing would reveal the
	 * difference.
	 */
	it("does not substitute `{{user}}` or `{{char}}`", () => {
		const { system } = buildChatGenerationRequest({
			room: {
				...room({ scenario: "세계관" }),
				userNote: "{{char}}는 {{user}}에게 존댓말.",
			},
			messages: [],
			allAges: true,
		});
		expect(system).toContain("{{char}}는 {{user}}에게 존댓말.");
	});

	/**
	 * The save path already rejects this, but the value also arrives through sync. The room record's
	 * decoder does not check length (rejecting would make the whole room vanish), so this is the last
	 * line of defense.
	 */
	it("a note over the cap folds deterministically", () => {
		const { system } = buildChatGenerationRequest({
			room: { ...room({ scenario: "세계관" }), userNote: "가".repeat(5_000) },
			messages: [],
			allAges: true,
		});
		expect(system).toContain("가".repeat(CHAT_USER_NOTE_MAX_LENGTH));
		expect(system).not.toContain("가".repeat(CHAT_USER_NOTE_MAX_LENGTH + 1));
	});
});
