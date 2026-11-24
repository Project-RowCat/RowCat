import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	hasAfterstateBridge,
	spawnAfterstate,
} from "./afterstate-stdio.test.helper.ts";
import {
	type AfterstateOp,
	type AfterstatePort,
	type ConversationMemorySource,
	conversationMemoryHooks,
	createLongTermLoader,
	memoryStatusFor,
	recallForTurn,
	recallRequestFor,
	verifyPromptSnapshot,
} from "./conversation-memory.ts";
import type { ChatMessage } from "./model.ts";
import { type ChatScene, createSceneRecord } from "./scene.ts";

const ROOM = "default-character-room";
const at = (i: number) => new Date(1700000000000 + i * 60000).toISOString();
const message = (i: number, text: string, roomId = ROOM): ChatMessage =>
	({
		id: `m${i.toString().padStart(4, "0")}`,
		roomId,
		role: "assistant",
		speaker: "서윤",
		content: text,
		createdAt: at(i),
		updatedAt: at(i),
		deletedAt: null,
		dirty: 0,
		serverVersion: 0,
		rev: { t: i + 1, c: 0, d: "device" },
	}) as ChatMessage;
const scene = (id: string, i: number, members: string[]): ChatScene =>
	createSceneRecord(
		{
			roomId: ROOM,
			startAt: { createdAt: at(i), messageId: message(i, "").id },
			audience: { kind: "participants", members },
		},
		{ id, now: at(i), rev: { t: i + 1, c: 0, d: "device" } },
	);
function history(n = 1000) {
	return Array.from({ length: n }, (_, i) =>
		message(
			i,
			i === 400
				? "빨간 목도리는 내가 고쳐 주겠다고 약속할게."
				: i === 401
					? "안쪽에 작은 별도 수놓아 줘. 우리만 알아보게."
					: "창틀의 물기를 닦고 조용히 찻잔을 내려놓았다.",
		),
	);
}
function fixture(initial: ChatMessage[]) {
	let messages = initial;
	let scenes: ChatScene[] = [];
	const source: ConversationMemorySource = {
		listAllMessages: vi.fn(async (room) =>
			messages.filter((m) => m.roomId === room && !m.deletedAt),
		),
		listFollowingMessages: async (room, id, limit) => {
			const live = messages.filter((m) => m.roomId === room && !m.deletedAt);
			const index = live.findIndex((m) => m.id === id);
			return index < 0 ? [] : live.slice(index + 1, index + 1 + limit);
		},
		getMessagesByIds: async (room, ids) =>
			messages.filter(
				(m) => m.roomId === room && ids.includes(m.id) && !m.deletedAt,
			),
		listRecentMessages: async (room, { limit }) =>
			messages.filter((m) => m.roomId === room && !m.deletedAt).slice(-limit),
		listMemories: async () => [],
		listScenes: async () => scenes,
	};
	return {
		source,
		get messages() {
			return messages;
		},
		set messages(value: ChatMessage[]) {
			messages = value;
		},
		get scenes() {
			return scenes;
		},
		set scenes(value: ChatScene[]) {
			scenes = value;
		},
	};
}
const request = (messages: ChatMessage[], query = "빨간 목도리 약속") => ({
	...recallRequestFor(messages.slice(-40), []),
	query,
});
async function ready(runtime: { port: AfterstatePort }) {
	await vi.waitFor(() => expect(memoryStatusFor(runtime, ROOM)).toBe("ready"), {
		timeout: 15000,
		interval: 20,
	});
}

describe.skipIf(!hasAfterstateBridge())(
	"default-on character memory, real native bridge",
	() => {
		it("opens existing ordinary history, indexes saved character messages, and recalls supporting replies with no policy options", async () => {
			const native = await spawnAfterstate();
			const calls: { op: string; params: object }[] = [];
			const port: AfterstatePort = {
				async call<T>(op: AfterstateOp, params: object) {
					calls.push({ op, params });
					return native.call<T>(op, params);
				},
			};
			const runtime = { port };
			const f = fixture(history());
			try {
				const hooks = conversationMemoryHooks(runtime, f.source, ROOM);
				await ready(runtime);
				const before = vi.mocked(f.source.listAllMessages).mock.calls.length;
				const snapshot = await hooks.loadLongTermMemory(request(f.messages));
				expect(snapshot.status).toBe("ready");
				const ids = snapshot.recall?.passages.map((p) => p.id) ?? [];
				expect(ids).toContain(message(400, "").id);
				expect(ids).toContain(message(401, "").id);
				const params = calls.find((c) => c.op === "recall")?.params as {
					character_policy: { token_budget: number; before_ms: number };
					perspective: { unknown: string };
				};
				expect(params.character_policy).toEqual({
					token_budget: 8192,
					before_ms: Date.parse(at(999)),
				});
				expect(params.perspective.unknown).toBe("exclude");
				const indexed = calls
					.filter((c) => c.op === "ingest")
					.flatMap(
						(c) =>
							(
								c.params as {
									items: {
										author: { role: string };
										audience: { kind: string };
										narrative?: unknown;
									}[];
								}
							).items,
					);
				expect(indexed.some((i) => i.author.role === "character")).toBe(true);
				expect(
					indexed.every(
						(i) => i.audience.kind === "room" && i.narrative === undefined,
					),
				).toBe(true);
				expect(vi.mocked(f.source.listAllMessages).mock.calls.length).toBe(
					before,
				);
				await snapshot.verifySources?.();
				// Ordinary saved assistant replies use the existing after-save maintainer.
				f.messages = [
					...f.messages,
					message(1000, "별을 수놓고 수선을 마쳤어. 빨간 목도리를 돌려줄게."),
				];
				hooks.maintain?.();
				await ready(runtime);
				expect(
					calls
						.filter((c) => c.op === "ingest")
						.some((c) =>
							(c.params as { items: { id: string }[] }).items.some(
								(i) => i.id === message(1000, "").id,
							),
						),
				).toBe(true);
				// Recent-window sources are deliberately not repeated in long-term recall.
				expect(
					(
						await hooks.loadLongTermMemory(
							request(f.messages, "빨간 목도리 수선"),
						)
					).recall?.passages.some((p) => p.id === message(1000, "").id),
				).toBe(false);
				f.messages = [
					...f.messages,
					...Array.from({ length: 41 }, (_, n) =>
						message(1001 + n, "창밖의 비가 그치고 있었다."),
					),
				];
				hooks.maintain?.();
				await ready(runtime);
				expect(
					(
						await hooks.loadLongTermMemory(
							request(f.messages, "빨간 목도리 수선"),
						)
					).recall?.passages.some((p) => p.id === message(1000, "").id),
				).toBe(true);
			} finally {
				await native.close();
			}
		});
		it("restarts, catches up edits/deletion on reopen, rejects stale snapshots and never crosses rooms", async () => {
			const directory = await mkdtemp(
				join(tmpdir(), "rowcat-character-default-"),
			);
			const open = { store: { user: { dir: directory, user: "member" } } };
			const f = fixture(history(500));
			let native = await spawnAfterstate(open);
			try {
				let runtime = { port: native };
				let hooks = conversationMemoryHooks(runtime, f.source, ROOM);
				await ready(runtime);
				expect(
					(
						await hooks.loadLongTermMemory(request(f.messages))
					).recall?.passages.some((p) => p.id === message(400, "").id),
				).toBe(true);
				await native.close();
				native = await spawnAfterstate(open);
				runtime = { port: native };
				hooks = conversationMemoryHooks(runtime, f.source, ROOM);
				await ready(runtime);
				const captured = await hooks.loadLongTermMemory(request(f.messages));
				expect(
					captured.recall?.passages.some((p) => p.id === message(400, "").id),
				).toBe(true);
				f.messages = f.messages.map((m) =>
					m.id === message(400, "").id
						? {
								...m,
								content: "파란 장갑은 내가 고쳐 줄게.",
								rev: { ...m.rev, t: 90000 },
							}
						: m,
				);
				await expect(captured.verifySources?.()).rejects.toThrow(
					"source changed",
				);
				hooks = conversationMemoryHooks(runtime, f.source, ROOM);
				await ready(runtime);
				expect(
					JSON.stringify(
						(await hooks.loadLongTermMemory(request(f.messages, "파란 장갑")))
							.recall,
					),
				).toContain("파란 장갑");
				f.messages = f.messages.filter((m) => m.id !== message(400, "").id);
				hooks = conversationMemoryHooks(runtime, f.source, ROOM);
				await ready(runtime);
				expect(
					(
						await hooks.loadLongTermMemory(request(f.messages, "파란 장갑"))
					).recall?.passages.some((p) => p.id === message(400, "").id),
				).toBe(false);
				const foreign = conversationMemoryHooks(
					runtime,
					f.source,
					"other-room",
				);
				expect(
					(await foreign.loadLongTermMemory(request(f.messages, "파란 장갑")))
						.recall?.passages ?? [],
				).toEqual([]);
				await vi.waitFor(
					() => expect(memoryStatusFor(runtime, "other-room")).toBe("ready"),
					{ timeout: 10000 },
				);
			} finally {
				await native.close();
				await rm(directory, { recursive: true, force: true });
			}
		});
		it("uses the authorized multi-character witness intersection and withholds unknown pre-scene history", async () => {
			const native = await spawnAfterstate();
			const runtime = { port: native };
			const messages = Array.from({ length: 140 }, (_, i) =>
				message(
					i,
					i === 0
						? "미분류 비밀은 고래석이야."
						: i === 20
							? "금고 번호는 7281이야."
							: i === 75
								? "보라 우산 안쪽에 별을 수놓았어."
								: "조용히 찻잔을 내려놓았다.",
				),
			);
			const f = fixture(messages);
			f.scenes = [
				scene("a-private", 1, ["user", "char:a"]),
				scene("b-private", 60, ["user", "char:b"]),
			];
			try {
				let hooks = conversationMemoryHooks(runtime, f.source, ROOM);
				await ready(runtime);
				expect(
					JSON.stringify(
						(
							await hooks.loadLongTermMemory(
								request(messages, "금고 번호 미분류 비밀"),
							)
						).recall,
					),
				).not.toMatch(/7281|고래석/);
				const before = await hooks.loadLongTermMemory(
					request(messages, "보라 우산"),
				);
				expect(JSON.stringify(before.recall)).toContain("보라 우산");
				f.scenes = [
					...f.scenes,
					scene("b-and-c", 100, ["user", "char:b", "char:c"]),
				];
				await expect(
					verifyPromptSnapshot(
						{
							loadHistory: async () => messages.slice(-40),
							loadMemories: async () => [],
							loadScenes: async () => f.scenes,
						},
						{
							history: messages.slice(-40),
							memories: [],
							scenes: f.scenes.slice(0, -1),
							longTerm: before,
						},
					),
				).rejects.toThrow("changed");
				hooks = conversationMemoryHooks(runtime, f.source, ROOM);
				await ready(runtime);
				expect(
					JSON.stringify(
						(await hooks.loadLongTermMemory(request(messages, "보라 우산")))
							.recall,
					),
				).not.toContain("보라 우산");
			} finally {
				await native.close();
			}
		});
		it("uses the requested live history cutoff, excluding a later stored source without wall-clock defaults", async () => {
			const native = await spawnAfterstate();
			const runtime = { port: native };
			const old = history(500);
			const f = fixture([
				...old,
				message(1000, "청동 상자의 비밀 암호는 9917이야."),
			]);
			try {
				const hooks = conversationMemoryHooks(runtime, f.source, ROOM);
				await ready(runtime);
				const snapshot = await hooks.loadLongTermMemory(
					request(old, "청동 상자 비밀 암호"),
				);
				expect(JSON.stringify(snapshot.recall)).not.toContain("9917");
			} finally {
				await native.close();
			}
		});
		it("does not leak a later user-derived story fact around the history cutoff", async () => {
			const native = await spawnAfterstate();
			const runtime = { port: native };
			const old = history(500);
			const future = {
				...message(1000, "I live in Seoul."),
				role: "user" as const,
				speaker: "Rowan",
			};
			const f = fixture([...old, future]);
			try {
				const hooks = conversationMemoryHooks(runtime, f.source, ROOM);
				await ready(runtime);
				const raw = await native.call("facts", {
					conversation: ROOM,
					perspective: { kind: "room", unknown: "exclude" },
					limit: 64,
				});
				expect(JSON.stringify(raw)).toMatch(/seoul/i);
				const snapshot = await hooks.loadLongTermMemory(
					request(old, "Where do I live?"),
				);
				expect(
					JSON.stringify({
						recall: snapshot.recall,
						facts: snapshot.facts,
						consolidated: snapshot.consolidated,
					}),
				).not.toMatch(/seoul/i);
			} finally {
				await native.close();
			}
		});
	},
);

describe("default compatibility and fail-closed packets", () => {
	const f = fixture(history(5));
	it("retains six direct hits and two event expansions under the default presentation budget", async () => {
		const sources = Array.from({ length: 8 }, (_, i) =>
			message(i + 1, `장면의 근거 원문 ${i + 1}.`),
		);
		const rows = sources.map((m) => ({
			layer: "story",
			record: "message",
			id: m.id,
			passage: 0,
			revision: "valid",
			text: m.content,
			author: { role: "character", name: m.speaker },
			at_ms: Date.parse(m.createdAt),
			score: 1,
			audience: "room",
			matched: [],
		}));
		const text = JSON.stringify({
			type: "character_memory_evidence",
			items: rows,
		});
		const port: AfterstatePort = {
			async call<T>(op: AfterstateOp) {
				return (
					op === "status"
						? {
								protocol: "afterstate-bridge/1",
								capabilities: ["character_context/1"],
							}
						: {
								evidence: rows.slice(0, 6),
								character_context: {
									items: rows,
									text,
									tokens: Buffer.byteLength(text),
									token_budget: 8192,
									estimator: "utf8-byte-bound",
								},
							}
				) as T;
			},
		};
		const snapshot = await recallForTurn(port, {
			roomId: ROOM,
			query: "근거 원문",
			messages: sources,
			scenes: [],
			windowIds: [],
			windowLength: 0,
			memories: [],
			memoryIdsInContext: new Set(),
		});
		expect(
			snapshot.passages.filter((p) => !p.expanded).map((p) => p.id),
		).toEqual(sources.slice(0, 6).map((m) => m.id));
		expect(snapshot.passages.filter((p) => p.expanded)).toHaveLength(2);
	});

	it("following replies cannot evict a directly retrieved fulfillment", async () => {
		const first = message(1, "우리가 바닷가에서 처음 인사했던 날이야.");
		const firstReply = message(2, "그때 너는 젖은 공책을 들고 있었지.");
		const firstTail = message(3, "처마에서 빗물이 떨어졌어.");
		const promise = message(10, "네 손전등을 수리하겠다고 약속할게.");
		const detail = message(11, "고리에 노란 실을 감아 줘.");
		const promiseTail = message(12, "조용히 작업대를 정리했다.");
		const fulfilled = message(
			100,
			"수리를 마치고 노란 실을 감은 손전등을 돌려줬어.",
		);
		const sources = [
			first,
			firstReply,
			firstTail,
			promise,
			detail,
			promiseTail,
			fulfilled,
		];
		const evidence = (m: ChatMessage) => ({
			layer: "story",
			record: "message",
			id: m.id,
			passage: 0,
			revision: "valid",
			text: m.content,
			author: { role: "character", name: m.speaker },
			at_ms: Date.parse(m.createdAt),
			score: 1,
			audience: "room",
			matched: [],
		});
		const rows = sources.map(evidence);
		const text = JSON.stringify({
			type: "character_memory_evidence",
			items: rows,
		});
		const port: AfterstatePort = {
			async call<T>(op: AfterstateOp) {
				return (
					op === "status"
						? {
								protocol: "afterstate-bridge/1",
								capabilities: ["character_context/1"],
							}
						: {
								evidence: [promise, first, fulfilled].map(evidence),
								character_context: {
									items: rows,
									text,
									tokens: Buffer.byteLength(text),
									token_budget: 8192,
									estimator: "utf8-byte-bound",
								},
							}
				) as T;
			},
		};
		const snapshot = await recallForTurn(port, {
			roomId: ROOM,
			query: "손전등 수리 약속은 아직 미완료야?",
			messages: sources,
			scenes: [],
			windowIds: [],
			windowLength: 0,
			memories: [],
			memoryIdsInContext: new Set(),
		});
		expect(
			snapshot.passages.filter((p) => !p.expanded).map((p) => p.id),
		).toEqual([first, promise, fulfilled].map((m) => m.id));
		expect(
			snapshot.passages.some(
				(p) => p.id === fulfilled.id && p.text === fulfilled.content,
			),
		).toBe(true);
		expect(snapshot.passages.filter((p) => p.expanded)).toHaveLength(2);
	});

	it("does not assume a shared audience when the authoritative scene port is missing", async () => {
		const { listScenes: _missing, ...source } = f.source;
		const port: AfterstatePort = {
			async call<T>() {
				return { evidence: [] } as T;
			},
		};
		const snapshot = await createLongTermLoader(
			{ port },
			source,
			ROOM,
		)(request(f.messages));
		expect(snapshot.status).toBe("degraded");
		expect(snapshot.recall).toBeNull();
	});
	it("enforces Korean/emoji packet budgets when a native host omits TextEncoder", async () => {
		const source = message(1, "빨간 목도리의 별 문양은 우리 약속이야. 🌟");
		const evidence = {
			layer: "story",
			record: "message",
			id: source.id,
			passage: 0,
			revision: "valid",
			text: source.content,
			author: { role: "character", name: source.speaker },
			at_ms: Date.parse(source.createdAt),
			score: 1,
			audience: "room",
			matched: [],
		};
		const text = JSON.stringify({
			type: "character_memory_evidence",
			items: [evidence],
		});
		const port: AfterstatePort = {
			async call<T>(op: AfterstateOp) {
				return (
					op === "status"
						? {
								protocol: "afterstate-bridge/1",
								capabilities: ["character_context/1"],
							}
						: {
								evidence: [evidence],
								character_context: {
									items: [evidence],
									text,
									tokens: Buffer.byteLength(text),
									token_budget: 8192,
									estimator: "utf8-byte-bound",
								},
							}
				) as T;
			},
		};
		vi.stubGlobal("TextEncoder", undefined);
		try {
			const snapshot = await recallForTurn(port, {
				roomId: ROOM,
				query: "빨간 목도리",
				messages: [source],
				scenes: [],
				windowIds: [],
				windowLength: 0,
				memories: [],
				memoryIdsInContext: new Set(),
			});
			expect(snapshot.passages[0]?.text).toContain("🌟");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("degrades unsupported bridges without falling back to their raw evidence", async () => {
		const port: AfterstatePort = {
			async call<T>() {
				return {
					protocol: "afterstate-bridge/1",
					capabilities: [],
					evidence: [{ text: "UNAUTHORIZED" }],
				} as T;
			},
		};
		const snapshot = await createLongTermLoader(
			{ port },
			f.source,
			ROOM,
		)(request(f.messages));
		expect(snapshot.status).toBe("degraded");
		expect(snapshot.recall).toBeNull();
	});
	it("degrades invalid accounting even if an otherwise compatible bridge returns raw evidence", async () => {
		const port: AfterstatePort = {
			async call<T>(op: AfterstateOp) {
				return (
					op === "status"
						? {
								protocol: "afterstate-bridge/1",
								capabilities: ["character_context/1"],
							}
						: {
								evidence: [{ text: "UNAUTHORIZED" }],
								character_context: {
									items: [],
									text: '{"type":"character_memory_evidence","items":[]}',
									tokens: 1,
									token_budget: 8192,
									estimator: "utf8-byte-bound",
								},
							}
				) as T;
			},
		};
		const snapshot = await createLongTermLoader(
			{ port },
			f.source,
			ROOM,
		)(request(f.messages));
		expect(snapshot.status).toBe("degraded");
		expect(snapshot.recall).toBeNull();
	});
	it("keeps an explicit diagnostic disable and protected-room retrieval on the existing path", async () => {
		const calls: object[] = [];
		const port: AfterstatePort = {
			async call<T>(op: AfterstateOp, params: object) {
				if (op === "recall") calls.push(params);
				return { evidence: [], facts: [] } as T;
			},
		};
		const disabled = await createLongTermLoader({ port }, f.source, ROOM, {
			characterPolicy: false,
		})(request(f.messages));
		const protectedRoom = await createLongTermLoader({ port }, f.source, ROOM, {
			protectedRoom: true,
		})(request(f.messages));
		expect(disabled.status).toBe("ready");
		expect(protectedRoom.recall).toBeNull();
		expect(calls).toHaveLength(2);
		expect(calls.every((p) => !("character_policy" in p))).toBe(true);
	});
});
