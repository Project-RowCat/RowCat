import {
	StoryChatSeedDto,
	type StoryChatSeedInput,
} from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import type { ChatCharacter } from "./character.ts";
import { createCharacterRecord } from "./character.ts";
import { buildChatGenerationRequest } from "./context.ts";
import type { ChatMemory } from "./memory.ts";
import { createMemoryRecord } from "./memory.ts";
import type { ChatSeed } from "./model.ts";
import { openingMessage } from "./opening.ts";
import {
	CHAT_DEFAULT_USER_NAME,
	chatPlaceholderNames,
	resolveChatPlaceholders,
	resolveSeedPlaceholders,
} from "./placeholder.ts";

/**
 * Name substitution tests. They check which notations are accepted, what is kept when the name is
 * unknown, and where substitution applies and where it does not. The last point is why this file
 * exists. Substituting stored records too would make the screen, search, copy and edit diverge from
 * the saved text. Compilation and type checks would not catch that; only a user searching for a
 * word would notice.
 */

type SeedInput = Partial<StoryChatSeedInput>;

const seed = (overrides: SeedInput = {}): ChatSeed =>
	StoryChatSeedDto.parse({
		version: 1,
		storyId: "story-1",
		title: "테스트 작품",
		adult: false,
		promptProtected: false,
		...overrides,
	});

const named = (overrides: SeedInput = {}): ChatSeed =>
	seed({
		persona: { name: "지훈", description: "" },
		characters: [{ name: "세라" }],
		...overrides,
	});

const NAMES = { char: "세라", user: "지훈" };

/**
 * A character added to this conversation. It is a child record of the room, not a character card
 * from the seed.
 */
const cast = (name: string, index = 0): ChatCharacter =>
	createCharacterRecord(
		{ roomId: "room-1", name },
		{
			id: `character-${index}`,
			now: "2026-01-01T00:00:00.000Z",
			rev: { t: 1, c: index, d: "test-device" },
		},
	);

describe("notation", () => {
	it("accepts both double and single braces", () => {
		expect(
			resolveChatPlaceholders("{{char}} {char} {{user}} {user}", NAMES),
		).toBe("세라 세라 지훈 지훈");
	});

	it("ignores case and inner whitespace", () => {
		expect(resolveChatPlaceholders("{{Char}} {{ USER }} { char }", NAMES)).toBe(
			"세라 지훈 세라",
		);
	});

	/*
	 * Loose matching would turn unpaired braces into names in text that really uses braces, such as
	 * quoted code or JSON in worldbuilding. Only balanced pairs are accepted.
	 */
	it("unbalanced braces pass through", () => {
		expect(resolveChatPlaceholders("{{char} {char}} {{charr}}", NAMES)).toBe(
			"{{char} {char}} {{charr}}",
		);
	});

	/*
	 * Macros such as `{{time}}` and `{{random}}` are deliberately not accepted, for determinism. Their
	 * values would break the prompt prefix on every request and expose the clock and random numbers to
	 * the assembler.
	 */
	it("the vocabulary is only two", () => {
		expect(resolveChatPlaceholders("{{time}} {{random}} {{bot}}", NAMES)).toBe(
			"{{time}} {{random}} {{bot}}",
		);
	});

	/*
	 * Substituting already-substituted text must change nothing. That is what lets the two code paths
	 * run side by side.
	 */
	it("is idempotent", () => {
		const once = resolveChatPlaceholders("{{char}}와 {{user}}", NAMES);
		expect(resolveChatPlaceholders(once, NAMES)).toBe(once);
	});
});

describe("names", () => {
	it("the first character card is char", () => {
		const names = chatPlaceholderNames(
			seed({ characters: [{ name: "세라" }, { name: "도윤" }] }),
		);
		expect(names.char).toBe("세라");
	});

	it("without a persona, user equals the name the assembler uses", () => {
		expect(chatPlaceholderNames(seed()).user).toBe(CHAT_DEFAULT_USER_NAME);
	});

	/*
	 * Removing the placeholder would silently drop the sentence's subject (`{{char}} smiles` becomes
	 * ` smiles`). That is worse than a visible placeholder, because the author cannot find the cause.
	 */
	it("without characters the char placeholder stays", () => {
		const names = chatPlaceholderNames(seed({ characters: [] }));
		expect(resolveChatPlaceholders("{{char}}가 웃는다", names)).toBe(
			"{{char}}가 웃는다",
		);
	});

	/**
	 * Warning: in v2 works, `{{char}}` was never substituted at this point. The publish assembler
	 * always sends an empty `play.characters`, so seed character cards are always empty in v2 works.
	 * The only source of the name is then the character added to this conversation. While that list
	 * went unread, placeholders in scenario, lore and narration packs reached the model literally, and
	 * the model copied them.
	 */
	it("without seed characters, the character added to this conversation is char", () => {
		const names = chatPlaceholderNames(seed({ characters: [] }), null, [
			cast("유진"),
			cast("도윤", 1),
		]);
		expect(names.char).toBe("유진");
	});

	/* Same order as the cast block in the prompt: the work's own characters come first. */
	it("with seed characters, they win", () => {
		expect(
			chatPlaceholderNames(seed({ characters: [{ name: "세라" }] }), null, [
				cast("유진"),
			]).char,
		).toBe("세라");
	});

	/*
	 * The save boundary rejects whitespace-only names, but older records and replay snapshots skipped
	 * that check. A blank first entry would shadow a valid character behind it, and the symptom would
	 * again be no substitution.
	 */
	it("a card whose name is only whitespace counts as absent", () => {
		expect(
			chatPlaceholderNames(seed({ characters: [{ name: "   " }] }), null, [
				cast("유진"),
			]).char,
		).toBe("유진");
	});
});

describe("seed", () => {
	it("substitutes all authored text", () => {
		const resolved = resolveSeedPlaceholders(
			named({
				scenario: "{{char}}는 {{user}}를 기다린다.",
				firstScene: "{{char}}가 문을 연다.",
				playGuide: "{{user}}를 대신해 말하지 않는다.",
				persona: { name: "지훈", description: "{{char}}의 동료." },
				characters: [{ name: "세라", prompt: "{{user}}에게만 웃는다." }],
				lore: [{ keys: ["{{char}}"], content: "{{char}}의 고향." }],
				startScenes: [{ title: "후보", content: "{{user}}가 도착한다." }],
			}),
		);

		expect(resolved.scenario).toBe("세라는 지훈를 기다린다.");
		expect(resolved.firstScene).toBe("세라가 문을 연다.");
		expect(resolved.playGuide).toBe("지훈를 대신해 말하지 않는다.");
		expect(resolved.persona?.description).toBe("세라의 동료.");
		expect(resolved.characters[0]?.prompt).toBe("지훈에게만 웃는다.");
		expect(resolved.lore[0]?.content).toBe("세라의 고향.");
		expect(resolved.startScenes[0]?.content).toBe("지훈가 도착한다.");
	});

	/*
	 * Lore keys are matched against recent conversation (`selectLore`). A key left as `{{char}}` would
	 * never match, the opposite of what the author intended.
	 */
	it("substitutes lore keys too", () => {
		const resolved = resolveSeedPlaceholders(
			named({ lore: [{ keys: ["{{char}}"], content: "설정." }] }),
		);
		expect(resolved.lore[0]?.keys).toEqual(["세라"]);
	});

	/*
	 * Names are the source of substitution. Substituting within them would form a cycle that replaces
	 * itself.
	 */
	it("leaves the names themselves alone", () => {
		const resolved = resolveSeedPlaceholders(
			named({
				persona: { name: "{{char}}", description: "" },
				characters: [{ name: "{{user}}" }],
			}),
		);
		expect(resolved.persona?.name).toBe("{{char}}");
		expect(resolved.characters[0]?.name).toBe("{{user}}");
	});

	/* Editing the room record in place would push substituted text into storage. */
	it("does not mutate the original", () => {
		const original = named({ scenario: "{{char}}." });
		resolveSeedPlaceholders(original);
		expect(original.scenario).toBe("{{char}}.");
	});
});

describe("assembler and screen", () => {
	const memory = (content: string): ChatMemory =>
		createMemoryRecord(
			{ roomId: "room-1", content },
			{
				id: "memory-1",
				now: "2026-01-01T00:00:00.000Z",
				rev: { t: 1, c: 0, d: "test-device" },
			},
		);

	const request = (overrides: SeedInput = {}, memories: ChatMemory[] = []) =>
		buildChatGenerationRequest({
			room: { seed: named(overrides) },
			messages: [{ role: "user", speaker: "", content: "{{char}}?" }],
			memories,
			allAges: true,
		});

	it("no placeholder remains in the system prompt", () => {
		const built = request({
			scenario: "{{char}}는 {{user}}를 안다.",
			firstScene: "{{char}}가 웃는다.",
			playGuide: "{{user}}를 존중한다.",
			lore: [{ keys: [], constant: true, content: "{{char}}의 규칙." }],
		});
		expect(built.system).toContain("세라는 지훈를 안다.");
		expect(built.system).toContain("세라가 웃는다.");
		expect(built.system).not.toContain("{{char}}");
		expect(built.system).not.toContain("{{user}}");
	});

	/*
	 * The on-screen opening and the opening folded into the prompt must use the same name. If they
	 * diverge there is no error; the model simply calls the partner by a name the screen does not
	 * show.
	 */
	it("the screen's opening and the prompt's opening are the same text", () => {
		const target = named({ firstScene: "{{char}}가 {{user}}를 부른다." });
		const opening = openingMessage(target);
		expect(opening?.content).toBe("세라가 지훈를 부른다.");
		expect(
			buildChatGenerationRequest({
				room: { seed: target },
				messages: [],
				allAges: true,
			}).system,
		).toContain(opening?.content ?? "__없음__");
	});

	/*
	 * Stored records are not substituted. Search scans stored bodies, copy takes the stored original,
	 * and the edit form loads stored values. If only the screen showed substituted text, a word the
	 * user searched for would not appear, and they would edit text they did not write.
	 */
	it("messages and memories ride as stored", () => {
		const built = request({}, [memory("{{user}}는 왼손잡이다.")]);
		expect(built.messages.at(-1)?.content).toContain("{{char}}?");
		expect(built.system).toContain("{{user}}는 왼손잡이다.");
	});

	/**
	 * The assembler reads the conversation's own characters as the name source. Seed characters are
	 * always empty in v2 works, so without this line every prompt in such a work would carry a literal
	 * `{{char}}`.
	 */
	it("the system prompt is substituted with the added character's name", () => {
		const built = buildChatGenerationRequest({
			room: { seed: seed({ scenario: "{{char}}는 문 앞에 선다." }) },
			messages: [],
			characters: [cast("유진")],
			allAges: true,
		});
		expect(built.system).toContain("유진는 문 앞에 선다.");
		expect(built.system).not.toContain("{{char}}");
	});

	/*
	 * The on-screen opening reads the same source. If the two diverge, the first line shows a raw
	 * placeholder.
	 */
	it("the opening is substituted with the added character's name too", () => {
		const target = seed({ firstScene: "{{char}}가 문을 연다." });
		expect(openingMessage(target, null, [cast("유진")])?.content).toBe(
			"유진가 문을 연다.",
		);
	});
});
