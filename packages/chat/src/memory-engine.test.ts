import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	AFTERSTATE_BRIDGE_BIN,
	hasAfterstateBridge,
	type StdioAfterstate,
	spawnAfterstate,
} from "./afterstate-stdio.test.helper.ts";
import { buildChatGenerationRequest, consolidatedText } from "./context.ts";
import {
	type ChatConsolidatedSnapshot,
	type ConversationMemorySource,
	consolidateConversation,
	consolidatedForTurn,
	conversationMemoryHooks,
	createLongTermLoader,
	memoryStatusFor,
	recallForTurn,
	recallRequestFor,
	reconcileConversation,
} from "./conversation-memory.ts";
import { chatHistoryWindow } from "./history-window.ts";
import type { ChatMemory } from "./memory.ts";
import { type ChatMessage, createRoomRecord } from "./model.ts";
import { scopePromptInput } from "./prompt-scope.ts";
import {
	type ChatScene,
	type ChatSceneAudience,
	resolveMessageAudiences,
} from "./scene.ts";
import { type ChatSummary, summaryIdFor } from "./summary.ts";

/*
 * Long-term memory is afterstate's alone (Phase 13). These tests run the real engine
 * (`afterstate-bridge`) through RowCat's own adapter and assembler:
 *
 * - consolidated episodes never carry a scene to a character who did not witness it, and never mix
 *   two audiences in one episode;
 * - editing or deleting a source retires its episode;
 * - a person's restricted or unresolved note is never quoted back through recall where the memory
 *   block withholds it;
 * - Memory V2's historical summary reaches recall only in rooms without scenes, attributed, and
 *   never as a summary block;
 * - with no engine, the turn says `unavailable` and carries nothing long-term — no V2 stands in;
 * - rebuilding the index gives the same episodes (determinism).
 */

const ROOM = "room-m";
const at = (n: number) =>
	new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + n * 60_000).toISOString();

const message = (
	id: string,
	n: number,
	role: "user" | "assistant",
	content: string,
	rev = 0,
): ChatMessage =>
	({
		id,
		roomId: ROOM,
		role,
		speaker: role === "user" ? "Rowan" : "",
		content,
		createdAt: at(n),
		updatedAt: at(n),
		dirty: 0,
		serverVersion: 0,
		rev: { t: 1000 + n + rev * 10_000, c: 0, d: "a" },
		deletedAt: null,
	}) as ChatMessage;

let sceneRev = 0;
const scene = (
	id: string,
	startId: string,
	n: number,
	audience: ChatSceneAudience,
): ChatScene => ({
	id,
	roomId: ROOM,
	startAt: { createdAt: at(n), messageId: startId },
	audience,
	createdAt: at(n),
	updatedAt: at(n),
	deletedAt: null,
	dirty: 0,
	serverVersion: 0,
	rev: { t: 9000 + sceneRev++, c: 0, d: "a" },
});

const P = (...members: string[]): ChatSceneAudience => ({
	kind: "participants",
	members: members.sort(),
});

const room = createRoomRecord(
	{
		originStoryId: null,
		seed: StoryChatSeedDto.parse({
			version: 1,
			storyId: "s",
			title: "Harbor",
			adult: false,
			promptProtected: false,
			scenario: "A harbor town.",
		}),
	},
	{ id: ROOM, routingSessionId: "r", now: at(0), rev: { t: 1, c: 0, d: "a" } },
);
const cast = [
	{ id: "mira", name: "Mira" },
	{ id: "kael", name: "Kael" },
];

const memory = (
	id: string,
	content: string,
	audience?: ChatSceneAudience,
): ChatMemory =>
	({
		id,
		roomId: ROOM,
		content,
		pinned: false,
		source: "user",
		originAt: null,
		createdAt: at(0),
		updatedAt: at(0),
		deletedAt: null,
		dirty: 0,
		serverVersion: 0,
		rev: { t: 2, c: 0, d: "a" },
		...(audience ? { audience } : {}),
	}) as ChatMemory;

/**
 * 120 messages in four scenes: everyone (0–39), Rowan with Mira alone (40–59: the vault code),
 * Rowan with Kael alone (60–79: the ship Heron), then all three (80–119). The history window holds
 * the last 40, so everything secret lies before it.
 */
function corpus(): ChatMessage[] {
	const out: ChatMessage[] = [];
	const add = (id: string, n: number, text: string) =>
		out.push(message(id, n, n % 2 ? "assistant" : "user", text));
	for (let i = 0; i < 40; i++)
		add(`pub${i}`, i, `The harbor bell rang ${i} times over the fish market.`);
	for (let i = 40; i < 60; i++)
		add(
			`mira${i}`,
			i,
			`Mira whispers the vault code seven seven four to Rowan, turn ${i}.`,
		);
	for (let i = 60; i < 80; i++)
		add(`kael${i}`, i, `Kael admits he sank the ship Heron, turn ${i}.`);
	for (let i = 80; i < 120; i++)
		add(`both${i}`, i, `Everyone shares supper at the lantern inn, turn ${i}.`);
	return out;
}

const baseScenes = (): ChatScene[] => [
	scene("s-pub", "pub0", 0, { kind: "room" }),
	scene("s-mira", "mira40", 40, P("user", "char:mira")),
	scene("s-kael", "kael60", 60, P("user", "char:kael")),
	scene("s-both", "both80", 80, P("user", "char:mira", "char:kael")),
];

const source = (
	messages: () => ChatMessage[],
	scenes: () => ChatScene[],
	memories: () => ChatMemory[] = () => [],
	summary: () => ChatSummary | null = () => null,
): ConversationMemorySource => ({
	listAllMessages: async () => messages(),
	listMemories: async () => memories(),
	listScenes: async () => scenes(),
	getSummary: async () => summary(),
});

async function index(
	engine: StdioAfterstate,
	src: ConversationMemorySource,
): Promise<void> {
	for (let i = 0; i < 4; i++) {
		const r = await reconcileConversation(engine, src, ROOM);
		if (r.complete) break;
	}
	await consolidateConversation(engine, ROOM, { calls: 16 });
}

const episodesFor = (
	engine: StdioAfterstate,
	messages: ChatMessage[],
	scenes: ChatScene[],
) =>
	consolidatedForTurn(engine, {
		roomId: ROOM,
		messages,
		windowLength: chatHistoryWindow(messages).length,
		scenes,
	});

const text = (s: ChatConsolidatedSnapshot) => consolidatedText(s);

describe.skipIf(!hasAfterstateBridge())(
	`long-term memory through the real engine (${AFTERSTATE_BRIDGE_BIN})`,
	() => {
		let engine: StdioAfterstate;
		let messages: ChatMessage[];
		let scenes: ChatScene[];
		beforeAll(async () => {
			engine = await spawnAfterstate();
			messages = corpus();
			scenes = baseScenes();
			await index(
				engine,
				source(
					() => messages,
					() => scenes,
				),
			);
		});
		afterAll(async () => {
			await engine?.close();
		});

		it("an episode never mixes two audiences", async () => {
			const listed = await engine.call<{
				digests: { id: string; sources: string[] }[];
			}>("digests", { conversation: ROOM, limit: 64 });
			expect(listed.digests.length).toBeGreaterThan(3);
			const audiences = resolveMessageAudiences(messages, scenes);
			for (const d of listed.digests) {
				const kinds = new Set(
					d.sources.map((id) => JSON.stringify(audiences.get(id))),
				);
				expect(kinds.size, d.id).toBe(1);
			}
		});

		it("with both present, neither private scene reaches the episodes or the request", async () => {
			const snapshot = await episodesFor(engine, messages, scenes);
			const block = text(snapshot);
			// Gold: the shared history before the window is still there.
			expect(block).toContain("harbor bell");
			// Forbidden: what only one of them witnessed.
			expect(block).not.toContain("seven seven four");
			expect(block).not.toContain("Heron");
			const window = chatHistoryWindow(messages);
			const req = buildChatGenerationRequest({
				room,
				messages: window,
				allAges: true,
				consolidated: block,
				scenes: { scenes, cast },
			});
			const all = JSON.stringify(req);
			expect(all).toContain("harbor bell");
			expect(all).not.toContain("seven seven four");
			expect(all).not.toContain("Heron");
		});

		it("Mira alone with Rowan gets her own scene back, and never Kael's", async () => {
			const miraNow = [
				...scenes,
				scene("s-m2", "both119", 119, P("user", "char:mira")),
			];
			const snapshot = await episodesFor(engine, messages, miraNow);
			const block = text(snapshot);
			expect(block).toContain("seven seven four");
			expect(block).not.toContain("Heron");
		});

		it("re-checks scenes the index has not caught up with", async () => {
			// The person corrected the Mira scene to Kael's eyes only; the index still has the old
			// audience. The adapter's own check drops the episode before it reaches the prompt.
			const corrected = scenes.map((s) =>
				s.id === "s-mira" ? { ...s, audience: P("user", "char:kael") } : s,
			);
			const kaelNow = [
				...corrected,
				scene("s-k2", "both119", 119, P("user", "char:mira")),
			];
			const snapshot = await episodesFor(engine, messages, kaelNow);
			expect(text(snapshot)).not.toContain("seven seven four");
		});

		it("episodes are dated, in story order, and never repeat the window", async () => {
			const snapshot = await episodesFor(engine, messages, [
				...scenes,
				scene("s-m2", "both119", 119, P("user", "char:mira")),
			]);
			const window = new Set(chatHistoryWindow(messages).map((m) => m.id));
			let last = "";
			for (const e of snapshot.episodes) {
				expect(e.from).not.toBeNull();
				expect(e.sources.every((id) => window.has(id))).toBe(false);
				expect((e.from ?? "") >= last).toBe(true);
				last = e.from ?? "";
			}
			expect(text(snapshot)).toMatch(/\[기록 2026-01-01/);
		});

		it("editing or deleting a source retires its episode", async () => {
			const own = await spawnAfterstate();
			try {
				let msgs = corpus();
				const sc = baseScenes();
				const src = source(
					() => msgs,
					() => sc,
				);
				await index(own, src);
				const miraNow = [
					...sc,
					scene("s-m3", "both119", 119, P("user", "char:mira")),
				];
				expect(text(await episodesFor(own, msgs, miraNow))).toContain(
					"seven seven four",
				);
				// The person rewrites every line of the Mira scene; the code is gone from the story.
				msgs = msgs.map((m) =>
					m.id.startsWith("mira")
						? message(
								m.id,
								Number(m.id.slice(4)),
								m.role as "user" | "assistant",
								`Mira hums an old sea song, turn ${m.id.slice(4)}.`,
								1,
							)
						: m,
				);
				await index(own, src);
				const after = text(await episodesFor(own, msgs, miraNow));
				expect(after).not.toContain("seven seven four");
				expect(after).toContain("sea song");
				// Deleting the whole stretch removes it from long-term memory too.
				msgs = msgs.filter((m) => !m.id.startsWith("mira"));
				await index(own, src);
				expect(text(await episodesFor(own, msgs, miraNow))).not.toContain(
					"sea song",
				);
			} finally {
				await own.close();
			}
		});

		it("rebuilding the index gives the same episodes", async () => {
			const fresh = await spawnAfterstate();
			try {
				await index(
					fresh,
					source(
						() => messages,
						() => scenes,
					),
				);
				const a = await episodesFor(engine, messages, scenes);
				const b = await episodesFor(fresh, messages, scenes);
				expect(b.episodes.map((e) => [e.id, e.excerpts])).toEqual(
					a.episodes.map((e) => [e.id, e.excerpts]),
				);
			} finally {
				await fresh.close();
			}
		});
	},
);

describe.skipIf(!hasAfterstateBridge())(
	"notes and the historical summary through recall",
	() => {
		const restricted = memory(
			"note-private",
			"Mira hid the brass key under the third stone of the pier.",
			P("user", "char:mira"),
		);
		const unresolved = memory(
			"note-unresolved",
			"Rowan keeps a silver compass hidden in his boot.",
		);
		const historical: ChatSummary = {
			id: summaryIdFor(ROOM),
			roomId: ROOM,
			summary: "Earlier, Rowan lost the copper lantern in the storm.",
			frontier: { createdAt: at(30), messageId: "pub30" },
			epoch: 0,
			createdAt: at(30),
			updatedAt: at(30),
			deletedAt: null,
			dirty: 0,
			serverVersion: 0,
			rev: { t: 3, c: 0, d: "a" },
		} as ChatSummary;

		const turn = async (
			engine: StdioAfterstate,
			messages: ChatMessage[],
			scenes: ChatScene[],
			memories: ChatMemory[],
			query: string,
		) =>
			recallForTurn(engine, {
				roomId: ROOM,
				query,
				messages,
				windowLength: chatHistoryWindow(messages).length,
				memories,
				memoryIdsInContext: new Set(),
				scenes,
				summary: historical,
			});

		it("a restricted note is never quoted to a character outside its audience", async () => {
			const engine = await spawnAfterstate();
			try {
				const messages = corpus();
				const scenes = baseScenes();
				const memories = [restricted, unresolved];
				await index(
					engine,
					source(
						() => messages,
						() => scenes,
						() => memories,
						() => historical,
					),
				);
				// Both present: Kael never saw the note's audience.
				const both = await turn(
					engine,
					messages,
					scenes,
					memories,
					"Where did Mira hide the brass key?",
				);
				expect(JSON.stringify(both)).not.toContain("third stone");
				// An unresolved note is withheld in a room with a narrower scene, in recall as in the block.
				const compass = await turn(
					engine,
					messages,
					scenes,
					memories,
					"Where is the silver compass?",
				);
				expect(JSON.stringify(compass)).not.toContain("silver compass hidden");
				// The historical summary is never recalled in a room with scenes.
				const lantern = await turn(
					engine,
					messages,
					scenes,
					memories,
					"What happened to the copper lantern?",
				);
				expect(JSON.stringify(lantern)).not.toContain(
					"copper lantern in the storm",
				);
			} finally {
				await engine.close();
			}
		});

		it("in a room without scenes the historical summary is recalled, attributed as model-written", async () => {
			const engine = await spawnAfterstate();
			try {
				const messages = corpus();
				await index(
					engine,
					source(
						() => messages,
						() => [],
						() => [],
						() => historical,
					),
				);
				const r = await turn(
					engine,
					messages,
					[],
					[],
					"What happened to the copper lantern?",
				);
				const hit = r.passages.find((p) => p.kind === "summary");
				expect(hit?.text).toContain("copper lantern");
				expect(hit?.automatic).toBe(true);
			} finally {
				await engine.close();
			}
		});
	},
);

describe("without an engine", () => {
	it("says unavailable, carries nothing long-term, and no V2 summary stands in", async () => {
		const messages = corpus();
		const stored: ChatSummary = {
			id: summaryIdFor(ROOM),
			roomId: ROOM,
			summary: "V2 SUMMARY TEXT that must never reach a prompt.",
			frontier: { createdAt: at(100), messageId: "both100" },
			epoch: 0,
			createdAt: at(100),
			updatedAt: at(100),
			deletedAt: null,
			dirty: 0,
			serverVersion: 0,
			rev: { t: 3, c: 0, d: "a" },
		} as ChatSummary;
		const getSummary = vi.fn(async () => stored);
		const src: ConversationMemorySource = {
			listAllMessages: async () => messages,
			listMemories: async () => [],
			getSummary,
		};
		const hooks = conversationMemoryHooks(null, src, ROOM);
		expect(hooks.maintain).toBeUndefined();
		expect(memoryStatusFor(null, ROOM)).toBe("unavailable");
		const window = chatHistoryWindow(messages);
		const snapshot = await hooks.loadLongTermMemory(
			recallRequestFor(window, []),
		);
		expect(snapshot).toEqual({
			recall: null,
			consolidated: null,
			status: "unavailable",
		});
		// The store was never asked for the summary: nothing reads it on the turn path.
		expect(getSummary).not.toHaveBeenCalled();
		const req = buildChatGenerationRequest({
			room,
			messages: window,
			allAges: true,
			consolidated: consolidatedText(snapshot.consolidated),
		});
		expect(JSON.stringify(req)).not.toContain("V2 SUMMARY TEXT");
		// And the chat still works on its recent window.
		expect(req.messages.length).toBeGreaterThan(0);
	});

	it("a failing engine degrades the turn without throwing", async () => {
		const broken = {
			port: {
				call: async () => {
					throw new Error("engine crashed");
				},
			},
		};
		const load = createLongTermLoader(
			broken,
			{
				listAllMessages: async () => corpus(),
				listMemories: async () => [],
			},
			ROOM,
		);
		const snapshot = await load(recallRequestFor(corpus().slice(-40), []));
		expect(snapshot.recall).toBeNull();
		expect(snapshot.status).toBe("degraded");
	});

	it("scoping a request built without long-term memory changes nothing", () => {
		const window = chatHistoryWindow(corpus());
		const scoped = scopePromptInput({
			messages: window,
			scenes: { scenes: [] },
		});
		expect(scoped.input.messages).toBe(window);
	});
});

describe.skipIf(!hasAfterstateBridge())(
	"migration of an existing install into the index",
	() => {
		const v2Summary = (text: string, epoch = 0): ChatSummary =>
			({
				id: summaryIdFor(ROOM),
				roomId: ROOM,
				summary: text,
				frontier: text ? { createdAt: at(30), messageId: "pub30" } : null,
				epoch,
				createdAt: at(30),
				updatedAt: at(30 + epoch),
				deletedAt: null,
				dirty: 0,
				serverVersion: 0,
				rev: { t: 3 + epoch, c: 0, d: "a" },
			}) as ChatSummary;
		const auto = (id: string, content: string): ChatMemory =>
			({
				...memory(id, content),
				source: "auto",
				originAt: at(20),
			}) as ChatMemory;

		it("is idempotent, resumes when interrupted, and never resurrects what was deleted", async () => {
			const engine = await spawnAfterstate();
			try {
				// A long room from an older install: 2,500 messages, V2's summary, one auto memory and
				// one note the person wrote.
				const messages: ChatMessage[] = [];
				for (let i = 0; i < 2_500; i++)
					messages.push(
						message(
							`x${i}`,
							i,
							i % 2 ? "assistant" : "user",
							`Line ${i} about the tide tables and the ferry schedule.`,
						),
					);
				let memories: ChatMemory[] = [
					auto("auto-1", "Rowan is afraid of the lighthouse stairs."),
					memory("user-1", "Rowan's sister is called Ilse.", { kind: "room" }),
				];
				let summary: ChatSummary | null = v2Summary(
					"Earlier, Rowan lost the copper lantern in the storm.",
				);
				const src = source(
					() => messages,
					() => [],
					() => memories,
					() => summary,
				);

				// Interrupted: the first run stops at its item cap and says so.
				const first = await reconcileConversation(engine, src, ROOM, {
					maxItems: 1_000,
				});
				expect(first.complete).toBe(false);
				// The next runs continue from where it stopped, then settle.
				let runs = 0;
				let last = first;
				while (!last.complete && runs++ < 10)
					last = await reconcileConversation(engine, src, ROOM, {
						maxItems: 1_000,
					});
				expect(last.complete).toBe(true);
				// `missing` is what that run found; it ingested all of it.
				expect(last.messages.ingested).toBe(last.messages.missing);
				// Running it again changes nothing.
				const again = await reconcileConversation(engine, src, ROOM);
				expect(
					again.messages.ingested +
						again.notes.ingested +
						again.summaries.ingested,
				).toBe(0);
				expect(again.messages.current).toBe(2_500);

				const ask = (query: string) =>
					recallForTurn(engine, {
						roomId: ROOM,
						query,
						messages,
						windowLength: chatHistoryWindow(messages).length,
						memories,
						memoryIdsInContext: new Set(),
						scenes: [],
						summary,
					});
				expect(
					JSON.stringify(await ask("What did Rowan lose in the storm?")),
				).toContain("copper lantern");
				expect(JSON.stringify(await ask("What is Rowan afraid of?"))).toContain(
					"lighthouse stairs",
				);

				// The person deletes the auto memory; a rewind retires the summary (empty, epoch raised).
				memories = memories.filter((m) => m.id !== "auto-1");
				summary = v2Summary("", 1);
				await reconcileConversation(engine, src, ROOM);
				expect(
					JSON.stringify(await ask("What did Rowan lose in the storm?")),
				).not.toContain("copper lantern");
				expect(
					JSON.stringify(await ask("What is Rowan afraid of?")),
				).not.toContain("lighthouse stairs");
				// The person's own note is still there.
				expect(
					JSON.stringify(await ask("What is Rowan's sister called?")),
				).toContain("Ilse");
			} finally {
				await engine.close();
			}
		});
	},
);
