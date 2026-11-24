import {
	type AfterstateOp,
	type AfterstatePort,
	type ChatMessage,
	conversationMemoryHooks,
	memoryStatusFor,
	recallRequestFor,
} from "@rowcat/chat";
import { Afterstate } from "afterstate-wasm/node";
import { describe, expect, it, vi } from "vitest";
import { createMemoryWorkerHandler } from "./memory-worker.ts";

describe("browser WASM default character memory", () => {
	it("uses the normal hooks without policy configuration and rebuilds after worker restart", async () => {
		const messages = Array.from(
			{ length: 180 },
			(_, i) =>
				({
					id: `w${i}`,
					roomId: "browser-character",
					role: "assistant",
					speaker: "서윤",
					content:
						i === 100
							? "빨간 목도리를 고쳐 주겠다고 약속할게."
							: i === 101
								? "안쪽에 작은 별도 수놓아 줘."
								: "조용히 창밖의 빗소리를 들었다.",
					createdAt: new Date(1700000000000 + i * 60000).toISOString(),
					updatedAt: new Date(1700000000000 + i * 60000).toISOString(),
					deletedAt: null,
					dirty: 0,
					serverVersion: 0,
					rev: { t: i + 1, c: 0, d: "browser" },
				}) as ChatMessage,
		);
		const source = {
			listAllMessages: async () => messages,
			listMemories: async () => [],
			listScenes: async () => [],
			getMessagesByIds: async (_room: string, ids: readonly string[]) =>
				messages.filter((m) => ids.includes(m.id)),
			listFollowingMessages: async (
				_room: string,
				id: string,
				limit: number,
			) => {
				const i = messages.findIndex((m) => m.id === id);
				return i < 0 ? [] : messages.slice(i + 1, i + limit + 1);
			},
			listRecentMessages: async (_room: string, { limit }: { limit: number }) =>
				messages.slice(-limit),
		};
		for (let restart = 0; restart < 2; restart++) {
			const engine = new Afterstate();
			const handle = createMemoryWorkerHandler(async () => engine);
			let id = 0;
			const requests: { op: AfterstateOp; params: object }[] = [];
			const port: AfterstatePort = {
				async call<T>(op: AfterstateOp, params: object) {
					requests.push({ op, params });
					const response = (await handle({ id: ++id, op, params })) as {
						ok: boolean;
						result: T;
						error?: { message: string };
					};
					if (!response.ok)
						throw Error(response.error?.message ?? "worker error");
					return response.result;
				},
			};
			try {
				const runtime = { port };
				const hooks = conversationMemoryHooks(
					runtime,
					source,
					"browser-character",
				);
				await vi.waitFor(
					() =>
						expect(memoryStatusFor(runtime, "browser-character")).toBe("ready"),
					{ timeout: 15000 },
				);
				const snapshot = await hooks.loadLongTermMemory({
					...recallRequestFor(messages.slice(-40), []),
					query: "빨간 목도리 약속",
				});
				expect(snapshot.status).toBe("ready");
				expect(snapshot.recall?.passages.map((p) => p.id)).toContain("w100");
				expect(snapshot.recall?.passages.map((p) => p.id)).toContain("w101");
				expect(
					requests.some(
						(r) => r.op === "recall" && "character_policy" in r.params,
					),
				).toBe(true);
				await snapshot.verifySources?.();
			} finally {
				engine.free();
			}
		}
	});
});
