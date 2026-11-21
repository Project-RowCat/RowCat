import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	AFTERSTATE_BRIDGE_BIN,
	hasAfterstateBridge,
	type StdioAfterstate,
	spawnAfterstate,
} from "./afterstate-stdio.test.helper.ts";
import {
	buildChatGenerationRequest,
	CHAT_MEMORY_CONTEXT_CHAR_BUDGET,
	type ChatRuntimeRoom,
	recallBlock,
} from "./context.ts";
import {
	type AfterstatePort,
	CHAT_RECALL_CONTEXT_CHAR_BUDGET,
	type ChatRecalledPassage,
	type ConversationMemorySource,
	conversationMemoryHooks,
	createLongTermLoader,
	createMaintainer,
	eraseConversation,
	isBridgeId,
	type MemoryEngineEvent,
	memoryStatusFor,
	messageItem,
	noteItem,
	passageStillLive,
	recallForTurn,
	recallQuery,
	recallRequestFor,
	reconcileConversation,
	selectRecallForContext,
	summaryItem,
	sweepConversations,
} from "./conversation-memory.ts";
import type { ChatMemory } from "./memory.ts";
import { type ChatMessage, createRoomRecord } from "./model.ts";
import { type ChatSummary, summaryIdFor } from "./summary.ts";

let clock = 1_700_000_000_000;
const rev = () => ({ t: clock++, c: 0, d: "dev-a" });

function message(
	roomId: string,
	id: string,
	role: "user" | "assistant",
	content: string,
	speaker = role === "user" ? "로완" : "카이",
): ChatMessage {
	const at = new Date(clock).toISOString();
	return {
		id,
		roomId,
		role,
		speaker,
		content,
		createdAt: at,
		updatedAt: at,
		dirty: 0,
		serverVersion: 0,
		rev: rev(),
		deletedAt: null,
	} as unknown as ChatMessage;
}

function memory(
	roomId: string,
	id: string,
	content: string,
	source: "user" | "auto" = "user",
	pinned = false,
): ChatMemory {
	const at = new Date(clock).toISOString();
	return {
		id,
		roomId,
		content,
		source,
		originAt: null,
		pinned,
		createdAt: at,
		updatedAt: at,
		dirty: 0,
		serverVersion: 0,
		rev: rev(),
		deletedAt: null,
	} as unknown as ChatMemory;
}

/** A store double with the two reads the indexer and the loader use. */
class Rooms implements ConversationMemorySource {
	messages = new Map<string, ChatMessage[]>();
	memories = new Map<string, ChatMemory[]>();
	async listAllMessages(roomId: string) {
		return [...(this.messages.get(roomId) ?? [])];
	}
	async listMemories(roomId: string) {
		return [...(this.memories.get(roomId) ?? [])];
	}
	add(m: ChatMessage) {
		const list = this.messages.get(m.roomId) ?? [];
		list.push(m);
		this.messages.set(m.roomId, list);
		return m;
	}
	edit(roomId: string, id: string, content: string) {
		const list = this.messages.get(roomId) ?? [];
		const i = list.findIndex((m) => m.id === id);
		list[i] = { ...list[i], content, rev: rev() } as ChatMessage;
	}
	remove(roomId: string, id: string) {
		this.messages.set(
			roomId,
			(this.messages.get(roomId) ?? []).filter((m) => m.id !== id),
		);
	}
}

const room: ChatRuntimeRoom = createRoomRecord(
	{
		originStoryId: "story-1",
		seed: StoryChatSeedDto.parse({
			version: 1,
			storyId: "story-1",
			title: "등대",
			adult: false,
			promptProtected: false,
			scenario: "비 내리는 항구 도시.",
		}),
	},
	{
		id: "room-1",
		routingSessionId: "0f1e2d3c-4b5a",
		now: "2026-01-01T00:00:00.000Z",
		rev: { t: 1, c: 0, d: "dev-a" },
	},
);

describe("mapping", () => {
	it("maps messages to sources by id and revision, assistant lines as character speech", () => {
		const u = message("r1", "m1", "user", "안녕");
		const a = message("r1", "m2", "assistant", "나는 이 왕국의 여왕이다.");
		expect(messageItem(u)).toMatchObject({
			conversation: "r1",
			record: "message",
			id: "m1",
			author: { role: "user", name: "로완" },
		});
		expect(messageItem(a)?.author).toEqual({ role: "character", name: "카이" });
		// The person's turns opt into facts; the prefix re-reads records indexed before facts existed.
		expect(messageItem(u)?.revision).toBe(`f1~${u.rev.t}.0.dev-a`);
		expect(messageItem(u)?.facts).toBe(true);
		expect(messageItem({ ...u, id: "bad id/with slash" })).toBeNull();
		expect(isBridgeId("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(true);
		expect(isBridgeId("ABCDEFGHJKMNPQRSTVWXYZ0123")).toBe(true);
	});

	it("maps memories whole, user wording kept, origin as a label", () => {
		const m = memory("r1", "n1", "카이는 왼손잡이다.", "user", true);
		expect(noteItem(m)).toMatchObject({
			record: "note",
			text: "카이는 왼손잡이다.",
			author: { role: "user" },
			labels: ["origin:user", "pinned"],
		});
		expect(noteItem(memory("r1", "n2", "x", "auto"))).toMatchObject({
			author: { role: "model" },
			labels: ["origin:auto"],
		});
	});

	it("imports V2's historical summary as model-written, unknown-audience story evidence", () => {
		const summary: ChatSummary = {
			id: summaryIdFor("r1"),
			roomId: "r1",
			summary: "두 사람은 등대에서 만났다.",
			frontier: { createdAt: "2026-01-02T00:00:00.000Z", messageId: "m9" },
			epoch: 3,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-02T00:00:00.000Z",
			deletedAt: null,
			dirty: 0,
			serverVersion: 1,
			rev: { t: 5, c: 0, d: "dev-a" },
		};
		const item = summaryItem(summary);
		expect(item).toMatchObject({
			record: "summary",
			id: summaryIdFor("r1"),
			author: { role: "model" },
			labels: ["origin:v2-summary"],
			target: { layer: "story" },
		});
		// No audience: unknown, which the bridge never reads as "everyone".
		expect(item && "audience" in item).toBe(false);
		// The epoch is part of the revision: a retirement re-indexes.
		expect(item?.revision).toContain("~e3");
		// Retired (empty) or deleted summaries are not imported.
		expect(summaryItem({ ...summary, summary: "  " })).toBeNull();
		expect(
			summaryItem({ ...summary, deletedAt: "2026-01-03T00:00:00.000Z" }),
		).toBeNull();
	});
});

describe("recall selection and assembly", () => {
	const passage = (
		id: string,
		text: string,
		at: string,
	): ChatRecalledPassage => ({
		id,
		layer: "story",
		text,
		speaker: "카이",
		role: "character",
		at,
	});

	it("packs within budget, skipping what does not fit, then orders by time", () => {
		const chosen = selectRecallForContext([
			passage("b", "두 번째", "2026-02-01T00:00:00Z"),
			passage(
				"big",
				"x".repeat(CHAT_RECALL_CONTEXT_CHAR_BUDGET),
				"2026-01-15T00:00:00Z",
			),
			passage("a", "첫 번째", "2026-01-01T00:00:00Z"),
		]);
		expect(chosen.map((p) => p.id)).toEqual(["a", "b"]);
	});

	it("checks a passage line by line against the live text", () => {
		expect(
			passageStillLive(
				"열쇠를 우물 옆에 묻었다.",
				"우리는 열쇠를 우물 옆에 묻었다. 그리고 떠났다.",
			),
		).toBe(true);
		expect(passageStillLive("A\nB", "A (중략) B")).toBe(true);
		expect(
			passageStillLive("열쇠를 우물 옆에 묻었다.", "열쇠를 강에 던졌다."),
		).toBe(false);
	});

	it("queries with the user's words, adding the reply's end only to a short turn", () => {
		const reply = {
			role: "assistant" as const,
			content: `${"앞".repeat(400)}그 열쇠 기억나?`,
		};
		const short = recallQuery([
			reply,
			{ role: "user", content: "응, 어디 뒀더라" },
		]);
		expect(short.startsWith("응, 어디 뒀더라")).toBe(true);
		expect(short).toContain("그 열쇠 기억나?");
		expect(short.length).toBeLessThan(400);
		const long = recallQuery([
			reply,
			{ role: "user", content: "등대지기가 지난번에 숨긴 열쇠는 어디에 있지?" },
		]);
		expect(long).toBe("등대지기가 지난번에 숨긴 열쇠는 어디에 있지?");
	});

	it("puts recalled passages in the last user turn, never in the system prompt", () => {
		const messages = [
			{ role: "assistant" as const, speaker: "카이", content: "어서 와." },
			{ role: "user" as const, speaker: "로완", content: "그 열쇠 어디 있지?" },
		];
		const base = buildChatGenerationRequest({ room, messages, allAges: true });
		const recall = {
			passages: [
				passage("m1", "열쇠는 우물 옆에 묻었어.", "2026-01-01T00:00:00Z"),
			],
		};
		const withRecall = buildChatGenerationRequest({
			room,
			messages,
			allAges: true,
			recall,
		});
		expect(withRecall.system).toBe(base.system);
		expect(withRecall.messages.slice(0, -1)).toEqual(
			base.messages.slice(0, -1),
		);
		const last = withRecall.messages[withRecall.messages.length - 1];
		expect(last.content).toContain(
			"[기록 2026-01-01 · 카이] 열쇠는 우물 옆에 묻었어.",
		);
		expect(last.content).toContain("사실이라는 보장이 아닙니다");
		expect(last.content.endsWith("로완: 그 열쇠 어디 있지?")).toBe(true);
		// Absent or empty recall: byte-identical to V2.
		expect(
			buildChatGenerationRequest({
				room,
				messages,
				allAges: true,
				recall: { passages: [] },
			}),
		).toEqual(base);
		expect(recallBlock(null)).toBeNull();
	});

	it("gives a continuation nothing", () => {
		const messages = [
			{ role: "user" as const, speaker: "로완", content: "계속" },
			{ role: "assistant" as const, speaker: "카이", content: "그때 우리는" },
		];
		const recall = {
			passages: [passage("m1", "열쇠", "2026-01-01T00:00:00Z")],
		};
		const a = buildChatGenerationRequest({
			room,
			messages,
			allAges: true,
			continuation: true,
			recall,
		});
		const b = buildChatGenerationRequest({
			room,
			messages,
			allAges: true,
			continuation: true,
		});
		expect(a).toEqual(b);
	});
});

describe("one engine: no modes, no V2, honest status", () => {
	const rooms = new Rooms();
	rooms.add(message("r1", "m1", "user", "열쇠"));
	const request = recallRequestFor([{ role: "user", content: "열쇠" }], []);
	const idle = {
		missing: [],
		stale: [],
		orphaned: [],
		erased_passages: 0,
		current: 0,
		episodes: 0,
		written: 0,
		retracted: 0,
		pending: false,
		evidence: [],
		digests: [],
	};

	it("without an engine: no maintenance at all, and the loader says unavailable", async () => {
		for (const runtime of [null, undefined, { port: null }]) {
			const hooks = conversationMemoryHooks(runtime, rooms, "r1");
			expect(hooks.maintain).toBeUndefined();
			await expect(hooks.loadLongTermMemory(request)).resolves.toEqual({
				recall: null,
				consolidated: null,
				facts: null,
				status: "unavailable",
			});
			expect(memoryStatusFor(runtime, "r1")).toBe("unavailable");
		}
	});

	it("with an engine, maintenance is afterstate's index and consolidation, nothing else", async () => {
		const calls: string[] = [];
		const port = {
			call: async (op: string) => {
				calls.push(op);
				return idle;
			},
		} as unknown as AfterstatePort;
		const hooks = conversationMemoryHooks({ port }, rooms, "r1");
		expect(memoryStatusFor({ port }, "r1")).toBe("indexing");
		hooks.maintain?.();
		await new Promise((r) => setTimeout(r, 10));
		expect(new Set(calls)).toEqual(new Set(["reconcile", "consolidate"]));
		expect(memoryStatusFor({ port }, "r1")).toBe("ready");
	});

	it("the session contract has no backend selector and no V2 hook", () => {
		const hooks = conversationMemoryHooks(
			{ port: { call: async () => idle } as unknown as AfterstatePort },
			rooms,
			"r1",
		);
		expect(Object.keys(hooks).sort()).toEqual([
			"loadLongTermMemory",
			"maintain",
		]);
	});

	it("a failing port yields degraded long-term memory, never a throw", async () => {
		const events: MemoryEngineEvent[] = [];
		const port: AfterstatePort = {
			call: async () => {
				throw new Error("native module gone");
			},
		};
		const load = createLongTermLoader(
			{ port, observe: (e) => events.push(e) },
			rooms,
			"r1",
		);
		await expect(load(request)).resolves.toEqual({
			recall: null,
			consolidated: null,
			facts: null,
			status: "degraded",
		});
		expect(events.map((e) => e.kind)).toEqual(["recall-failed"]);
	});

	it("an engine without episodes still recalls (older bridge build)", async () => {
		const port: AfterstatePort = {
			call: async <T>(op: string) => {
				if (op === "digests") throw new Error("unknown_op");
				return { evidence: [] } as T;
			},
		};
		const load = createLongTermLoader({ port }, rooms, "r1");
		await expect(load(request)).resolves.toMatchObject({
			recall: { passages: [] },
			consolidated: { episodes: [] },
		});
	});

	it("a slow port is abandoned", async () => {
		const port: AfterstatePort = {
			call: <T>() =>
				new Promise<T>((resolve) =>
					setTimeout(() => resolve(idle as T), 2_000),
				),
		};
		const events: MemoryEngineEvent[] = [];
		const load = createLongTermLoader(
			{ port, observe: (e) => events.push(e) },
			rooms,
			"r1",
		);
		const started = Date.now();
		await expect(load(request)).resolves.toMatchObject({ status: "degraded" });
		expect(Date.now() - started).toBeLessThan(1_500);
		expect(events[0]?.kind).toBe("recall-timeout");
	});

	it("an observer that throws does not break a turn", async () => {
		const port: AfterstatePort = { call: async () => idle as never };
		const load = createLongTermLoader(
			{
				port,
				observe: () => {
					throw new Error("boom");
				},
			},
			rooms,
			"r1",
		);
		await expect(load(request)).resolves.toMatchObject({
			recall: { passages: [] },
			consolidated: { episodes: [] },
		});
	});

	it("a protected room gets episodes but no recall (the server assembles its prompt)", async () => {
		const ops: string[] = [];
		const port: AfterstatePort = {
			call: async <T>(op: string) => {
				ops.push(op);
				return idle as T;
			},
		};
		const load = createLongTermLoader({ port }, rooms, "r1", {
			protectedRoom: true,
		});
		await expect(load(request)).resolves.toMatchObject({ recall: null });
		expect(ops).toEqual(["digests"]);
	});

	it("maintenance is single-flight per room and never throws", async () => {
		let reconciles = 0;
		let release: () => void = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const port: AfterstatePort = {
			call: async (op) => {
				if (op === "reconcile") {
					reconciles++;
					await gate;
				}
				return idle as never;
			},
		};
		const maintain = createMaintainer({ port }, rooms, "r1");
		maintain?.();
		maintain?.();
		maintain?.();
		await new Promise((r) => setTimeout(r, 10));
		expect(reconciles).toBe(1);
		release();
		await new Promise((r) => setTimeout(r, 20));
		// One run, then exactly one queued follow-up; each reconciles messages, notes and the summary.
		expect(reconciles).toBe(6);
		const failing = createMaintainer(
			{ port: { call: async () => Promise.reject(new Error("x")) } },
			rooms,
			"r2",
		);
		expect(() => failing?.()).not.toThrow();
	});
});

describe.skipIf(!hasAfterstateBridge())(
	`with the real engine (${AFTERSTATE_BRIDGE_BIN})`,
	() => {
		let engine: StdioAfterstate;
		beforeAll(async () => {
			engine = await spawnAfterstate();
		});
		afterAll(async () => {
			await engine.close();
		});

		/** A room with an old planted fact, filler, and a recent window. */
		function plantedRoom(id: string): Rooms {
			const rooms = new Rooms();
			rooms.add(
				message(
					id,
					`${id}-plant`,
					"assistant",
					"카이: 은열쇠는 우물 옆 돌무더기 아래에 묻어 두었어. 아무에게도 말하지 마.",
				),
			);
			for (let i = 0; i < 80; i++)
				rooms.add(
					message(
						id,
						`${id}-f${i}`,
						i % 2 ? "assistant" : "user",
						`시장 골목을 걸었다. 오늘의 일상 ${i}번째 장면.`,
					),
				);
			rooms.add(
				message(id, `${id}-q`, "user", "그 은열쇠 어디에 묻었는지 기억나?"),
			);
			return rooms;
		}

		it("two devices converge: each index follows its own store after sync delivers the same records", async () => {
			// Two devices of one member, each with its own engine and store copy. Sync is modeled as
			// what it delivers: the same records (rev and all) and tombstones as removals.
			const deviceA = await spawnAfterstate();
			const deviceB = await spawnAfterstate();
			try {
				const a = plantedRoom("room-sync");
				const b = plantedRoom("room-sync");
				b.messages.set("room-sync", [...(a.messages.get("room-sync") ?? [])]);
				await reconcileConversation(deviceA, a, "room-sync");
				await reconcileConversation(deviceB, b, "room-sync");
				// Device A: the user deletes the planted scene and rewrites a filler line.
				a.remove("room-sync", "room-sync-plant");
				a.edit(
					"room-sync",
					"room-sync-f3",
					"등대 아래에서 붉은 우산을 잃어버렸다.",
				);
				await reconcileConversation(deviceA, a, "room-sync");
				// Device B was closed meanwhile; sync then delivers A's state (tombstone + new revision).
				b.messages.set("room-sync", [...(a.messages.get("room-sync") ?? [])]);
				const report = await reconcileConversation(deviceB, b, "room-sync");
				expect(report.messages.orphaned).toBe(1);
				expect(report.messages.stale).toBe(1);
				const messages = await a.listAllMessages("room-sync");
				const ask = async (port: AfterstatePort, q: string) =>
					(
						await recallForTurn(port, {
							roomId: "room-sync",
							...recallRequestFor(messages.slice(-40), [], q),
							messages,
						})
					).passages.map((p) => `${p.id}:${p.text}`);
				for (const q of [
					"은열쇠를 묻은 곳이 어디였지?",
					"붉은 우산은 어디서 잃어버렸지?",
				])
					expect(await ask(deviceB, q)).toEqual(await ask(deviceA, q));
				expect(await ask(deviceB, "은열쇠를 묻은 곳이 어디였지?")).toEqual([]);
				expect(
					(await ask(deviceB, "붉은 우산은 어디서 잃어버렸지?"))[0],
				).toContain("room-sync-f3");
			} finally {
				await deviceA.close();
				await deviceB.close();
			}
		});

		it("indexes a room, recalls an event far outside the window, and skips the window", async () => {
			const rooms = plantedRoom("room-a");
			const report = await reconcileConversation(engine, rooms, "room-a");
			expect(report.messages.ingested).toBe(82);
			expect(report.complete).toBe(true);
			const messages = await rooms.listAllMessages("room-a");
			const history = messages.slice(-40);
			const snapshot = await recallForTurn(engine, {
				roomId: "room-a",
				...recallRequestFor(history, []),
				messages,
			});
			expect(snapshot.passages[0]?.id).toBe("room-a-plant");
			expect(snapshot.passages[0]?.role).toBe("character");
			const windowIds = new Set(history.map((m) => m.id));
			expect(snapshot.passages.some((p) => windowIds.has(p.id))).toBe(false);
			// Second run: nothing to do.
			const again = await reconcileConversation(engine, rooms, "room-a");
			expect(again.messages.ingested).toBe(0);
			expect(again.messages.current).toBe(82);
		});

		it("an edit or a deletion is never recalled, even before the index catches up", async () => {
			const rooms = plantedRoom("room-b");
			await reconcileConversation(engine, rooms, "room-b");
			rooms.edit(
				"room-b",
				"room-b-plant",
				"카이: 열쇠 이야기는 없던 걸로 하자.",
			);
			const ask = async () => {
				const messages = await rooms.listAllMessages("room-b");
				return recallForTurn(engine, {
					roomId: "room-b",
					...recallRequestFor(messages.slice(-40), []),
					messages,
				});
			};
			// Index still holds the old wording; the store snapshot rejects it.
			expect((await ask()).passages.map((p) => p.text).join()).not.toContain(
				"돌무더기",
			);
			await reconcileConversation(engine, rooms, "room-b");
			rooms.remove("room-b", "room-b-plant");
			expect((await ask()).passages.some((p) => p.id === "room-b-plant")).toBe(
				false,
			);
			const r = await reconcileConversation(engine, rooms, "room-b");
			expect(r.messages.orphaned).toBe(1);
			expect(r.messages.erasedPassages).toBeGreaterThan(0);
		});

		it("notes already in the memory block are not repeated; others can be recalled", async () => {
			const rooms = plantedRoom("room-c");
			const inBlock = memory(
				"room-c",
				"n-in",
				"로완은 고양이를 키운다.",
				"user",
				true,
			);
			const filler = Array.from({ length: 30 }, (_, i) =>
				memory("room-c", `n-${i}`, `${"가".repeat(180)} 메모 ${i}`, "auto"),
			);
			const relevant = memory(
				"room-c",
				"n-key",
				"은열쇠의 손잡이에는 까마귀 문양이 있다.",
				"auto",
			);
			rooms.memories.set("room-c", [inBlock, ...filler, relevant]);
			await reconcileConversation(engine, rooms, "room-c");
			const memories = await rooms.listMemories("room-c");
			const request = recallRequestFor(
				[{ role: "user", content: "은열쇠 손잡이 문양이 뭐였지?" }],
				memories,
			);
			// The budget really is exceeded, so selection matters.
			expect(
				memories.reduce((n, m) => n + m.content.length, 0),
			).toBeGreaterThan(CHAT_MEMORY_CONTEXT_CHAR_BUDGET);
			expect(request.memoryIdsInContext.has("n-in")).toBe(true);
			const snapshot = await recallForTurn(engine, {
				roomId: "room-c",
				...request,
				messages: await rooms.listAllMessages("room-c"),
			});
			const ids = snapshot.passages.map((p) => p.id);
			if (!request.memoryIdsInContext.has("n-key"))
				expect(ids).toContain("n-key");
			expect(ids).not.toContain("n-in");
		});

		it("rooms are isolated, and erase/sweep remove them", async () => {
			const a = plantedRoom("room-d");
			const b = new Rooms();
			b.add(message("room-e", "e1", "user", "평범한 하루."));
			await reconcileConversation(engine, a, "room-d");
			await reconcileConversation(engine, b, "room-e");
			const fromE = await recallForTurn(engine, {
				roomId: "room-e",
				query: "은열쇠 우물 돌무더기",
				windowLength: 0,
				memories: [],
				memoryIdsInContext: new Set(),
				messages: await b.listAllMessages("room-e"),
			});
			expect(fromE.passages).toEqual([]);
			expect(await eraseConversation(engine, "room-d")).toBeGreaterThan(0);
			const swept = await sweepConversations(engine, [
				"room-a",
				"room-b",
				"room-c",
			]);
			expect(swept.orphaned).toBe(1); // room-e
		});

		it("the session hooks run the whole path and keep only counts", async () => {
			const rooms = plantedRoom("room-f");
			const events: MemoryEngineEvent[] = [];
			const live = conversationMemoryHooks(
				{ port: engine, observe: (e) => events.push(e) },
				rooms,
				"room-f",
			);
			live.maintain?.();
			await new Promise((r) => setTimeout(r, 600));
			const messages = await rooms.listAllMessages("room-f");
			const request = recallRequestFor(messages.slice(-40), []);
			const got = await live.loadLongTermMemory(request);
			expect(got.status).toBe("ready");
			expect(got.recall?.passages[0]?.id).toBe("room-f-plant");
			// Observations carry counts only.
			expect(events.map((e) => e.kind)).toContain("index");
			expect(JSON.stringify(events)).not.toContain("열쇠");
		});
	},
);
