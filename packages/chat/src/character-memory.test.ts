import { describe, expect, it } from "vitest";
import {
	hasAfterstateBridge,
	spawnAfterstate,
} from "./afterstate-stdio.test.helper.ts";
import {
	type AfterstateOp,
	type AfterstatePort,
	recallForTurn,
} from "./conversation-memory.ts";
import type { ChatMessage } from "./model.ts";
import { createSceneRecord } from "./scene.ts";

const time = (n: number) => new Date(1700000000000 + n * 60000).toISOString();
const message = (id: string, n: number, content: string): ChatMessage =>
	({
		id,
		roomId: "scarf-room",
		role: "assistant",
		speaker: "서윤",
		content,
		createdAt: time(n),
		updatedAt: time(n),
		deletedAt: null,
		dirty: 0,
		serverVersion: 0,
		rev: { t: n + 1, c: 0, d: "device" },
	}) as ChatMessage;
const scene = (id: string, messageId: string, n: number) =>
	createSceneRecord(
		{
			roomId: "scarf-room",
			startAt: { createdAt: time(n), messageId },
			audience: { kind: "participants", members: ["user", "char:seoyun"] },
		},
		{ id, now: time(n), rev: { t: n + 1, c: 0, d: "device" } },
	);
const messages = [
	message("m1", 1, "빨간 목도리는 내가 고쳐 주겠다고 약속해."),
	message("m2", 2, "안쪽에 작은 별도 수놓아 줘. 우리만 알아보게."),
	message("m3", 3, "다음 봄의 찻집에서 새로 주문한 건 보리차였어."),
];
const evidence = (m: ChatMessage) => ({
	layer: "story",
	record: "message",
	id: m.id,
	passage: 0,
	text: m.content,
	author: { role: "character", name: m.speaker },
	at_ms: Date.parse(m.createdAt),
	score: 1,
	matched: [],
	audience: "participants",
});
const input = (scenes: ReturnType<typeof scene>[]) => ({
	roomId: "scarf-room",
	query: "빨간 목도리 약속",
	messages,
	scenes,
	windowLength: 0,
	windowIds: [],
	memories: [],
	memoryIdsInContext: new Set<string>(),
	supersession: false,
	characterPolicy: false as const,
});
const port: AfterstatePort = {
	async call<T>(op: AfterstateOp) {
		if (op === "status")
			return {
				protocol: "afterstate-bridge/1",
				capabilities: ["character_context/1"],
			} as T;
		return { evidence: [evidence(messages[0])] } as T;
	},
};

describe("character episode continuity", () => {
	it("keeps the supporting Korean reply within its scene", async () => {
		const r = await recallForTurn(port, input([scene("winter", "m1", 1)]));
		expect(r.passages.map((p) => p.id)).toContain("m2");
	});
	it("stops at a new scene with exactly the same participants", async () => {
		const r = await recallForTurn(
			port,
			input([scene("winter", "m1", 1), scene("spring", "m3", 3)]),
		);
		expect(r.passages.map((p) => p.id)).toEqual(["m1", "m2"]);
	});
	it("fails closed when an opted-in bridge omits its bounded packet", async () => {
		await expect(
			recallForTurn(port, {
				...input([scene("winter", "m1", 1)]),
				characterPolicy: { tokenBudget: 8192, beforeMs: Date.parse(time(10)) },
			}),
		).rejects.toThrow("invalid character evidence packet");
	});
	it.skipIf(!hasAfterstateBridge())(
		"validates native selected sources against live edits, deletion and witnesses",
		async () => {
			const native = await spawnAfterstate();
			try {
				await native.call("ingest", {
					items: messages.map((m, i) => ({
						conversation: "scarf-room",
						record: "message",
						id: m.id,
						revision: "1",
						text: m.content,
						author: { role: "character", name: m.speaker },
						at_ms: Date.parse(m.createdAt),
						scene: i < 2 ? "winter" : "spring",
						audience: {
							kind: "participants",
							members: ["user", "char:seoyun"],
						},
					})),
				});
				const args = {
					...input([scene("winter", "m1", 1), scene("spring", "m3", 3)]),
					characterPolicy: {
						tokenBudget: 8192,
						beforeMs: Date.parse(time(10)),
					},
				};
				const r = await recallForTurn(native, args);
				expect(r.passages.map((p) => p.id)).toEqual(["m1", "m2"]);
				const edited = messages.map((m) =>
					m.id === "m2" ? { ...m, content: "그 이야기는 지웠어." } : m,
				);
				const fresh = await recallForTurn(native, {
					...args,
					messages: edited,
				});
				expect(JSON.stringify(fresh)).not.toContain("안쪽에 작은 별도");
				expect(fresh.passages.find((p) => p.id === "m2")?.text).toBe(
					"그 이야기는 지웠어.",
				);
				const deleted = await recallForTurn(native, {
					...args,
					messages: messages.filter((m) => m.id !== "m2"),
				});
				expect(deleted.passages.map((p) => p.id)).not.toContain("m2");
				const privateScene = {
					...scene("winter", "m1", 1),
					audience: { kind: "participants" as const, members: ["char:seoyun"] },
				};
				const hidden = await recallForTurn(native, {
					...args,
					scenes: [privateScene, scene("spring", "m3", 3)],
				});
				expect(hidden.passages.map((p) => p.id)).not.toContain("m1");
				expect(hidden.passages.map((p) => p.id)).not.toContain("m2");
			} finally {
				await native.close();
			}
		},
	);
});
