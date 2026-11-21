import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The native index handle is shared per member (`native-memory.ts`): the chat screen and a room
 * deletion use one engine, so the bridge's erase fence and write lock cover both. A deleted room is
 * erased from the index at once, through that handle or a temporary one.
 */

const calls: { handle: number; op: string; params: unknown }[] = [];
const events: string[] = [];
let nextHandle = 1;

vi.mock("../../../modules/afterstate-memory/index.ts", () => ({
	hasNativeAfterstate: () => true,
	openNativeAfterstate: async (member: string) => {
		const handle = nextHandle++;
		events.push(`open ${member} #${handle}`);
		return {
			call: async (op: string, params: object) => {
				calls.push({ handle, op, params });
				return { erased_passages: 3 };
			},
			close: async () => {
				events.push(`close #${handle}`);
			},
			destroy: async () => undefined,
		};
	},
}));

const { eraseRoomMemory, openMemoryRuntime } = await import(
	"./native-memory.ts"
);

beforeEach(() => {
	vi.unstubAllEnvs();
	calls.length = 0;
	events.length = 0;
});

describe("the member's native index", () => {
	it("opens with no build setting: the retired backend switch is not read", async () => {
		// A build that still sets the retired switch to the old engine gets afterstate anyway; there is
		// no value that turns long-term memory into anything else.
		vi.stubEnv("EXPO_PUBLIC_MEMORY_BACKEND", "legacy");
		const opened = await openMemoryRuntime("carol");
		expect(opened?.runtime.port).toBeDefined();
		expect(Object.keys(opened?.runtime ?? {})).toEqual(["port"]);
		await opened?.close();
	});

	it("is opened once and shared; it closes when the last user closes", async () => {
		const a = await openMemoryRuntime("alice");
		const b = await openMemoryRuntime("alice");
		expect(events.filter((e) => e.startsWith("open"))).toHaveLength(1);
		// One port object for both openers: per-room state (maintenance, indexing status) is keyed by it.
		expect(a?.runtime.port).toBe(b?.runtime.port);
		await a?.close();
		await a?.close(); // closing twice releases once
		expect(events.some((e) => e.startsWith("close"))).toBe(false);
		await b?.close();
		expect(events.filter((e) => e.startsWith("close"))).toHaveLength(1);
	});

	it("erases a deleted room through the screen's open handle", async () => {
		const screen = await openMemoryRuntime("alice");
		const opened = events.length;
		await eraseRoomMemory("alice", "room-1");
		expect(events.length).toBe(opened); // no second engine
		expect(calls).toEqual([
			{
				handle: calls[0]?.handle,
				op: "erase",
				params: { conversation: "room-1" },
			},
		]);
		await screen?.close();
	});

	it("opens a temporary handle when no screen holds one, and closes it", async () => {
		await eraseRoomMemory("bob", "room-2");
		expect(events).toEqual([
			expect.stringMatching(/^open bob/),
			expect.stringMatching(/^close/),
		]);
		expect(calls.map((c) => c.op)).toEqual(["erase"]);
	});

	it("does nothing without a member scope", async () => {
		await eraseRoomMemory(null, "room-3");
		expect(events).toEqual([]);
	});
});
