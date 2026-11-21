import { describe, expect, it } from "vitest";
import type {
	ChatMemory,
	ChatScene,
	ChatSceneAudience,
	ChatSeed,
} from "./index.ts";
import {
	memoryAudienceControl,
	unmarkedMemoryCount,
} from "./memory-audience.ts";

/**
 * Which audience control a memory row draws.
 */

const scene = (
	at: string,
	audience: ChatSceneAudience,
	deletedAt: string | null = null,
): ChatScene =>
	({
		id: `scene-${at}`,
		roomId: "r",
		startAt: { createdAt: at, messageId: `m-${at}` },
		audience,
		createdAt: at,
		updatedAt: at,
		deletedAt,
	}) as ChatScene;

const cast = {
	room: {
		seed: {
			characters: [{ name: "미나" }, { name: "준" }],
			persona: null,
		} as unknown as ChatSeed,
		persona: { name: "나", description: "" },
	},
	characters: [{ id: "c1", name: "서윤" }],
};

const memory = (
	patch: Partial<Pick<ChatMemory, "source" | "audience">> = {},
): Pick<ChatMemory, "source" | "audience"> => ({ source: "user", ...patch });

const minaOnly: ChatSceneAudience = {
	kind: "participants",
	members: ["seed:0", "user"],
};

describe("memoryAudienceControl", () => {
	it("draws nothing in a room without a live scene", () => {
		expect(memoryAudienceControl(memory(), [], cast)).toBeNull();
		expect(
			memoryAudienceControl(
				memory(),
				[scene("2026-01-01", minaOnly, "2026-01-02")],
				cast,
			),
		).toBeNull();
	});

	it("draws nothing on an automatic memory", () => {
		expect(
			memoryAudienceControl(
				memory({ source: "auto" }),
				[scene("2026-01-01", minaOnly)],
				cast,
			),
		).toBeNull();
	});

	it("offers the current scene's audience to a shared memory", () => {
		const scenes = [
			scene("2026-01-01", { kind: "narrator" }),
			scene("2026-01-02", minaOnly),
		];
		const expected = { kind: "restrict", audience: minaOnly };
		expect(memoryAudienceControl(memory(), scenes, cast)).toEqual(expected);
		// An explicit `room` is shared too.
		expect(
			memoryAudienceControl(
				memory({ audience: { kind: "room" } }),
				scenes,
				cast,
			),
		).toEqual(expected);
	});

	it("offers nothing to a shared memory when the current scene is the whole room", () => {
		expect(
			memoryAudienceControl(
				memory(),
				[scene("2026-01-01", { kind: "room" })],
				cast,
			),
		).toBeNull();
	});

	it("names who may know a restricted memory, through the room's cast", () => {
		expect(
			memoryAudienceControl(
				memory({
					audience: {
						kind: "participants",
						members: ["char:c1", "seed:1", "user"],
					},
				}),
				[scene("2026-01-01", { kind: "room" })],
				cast,
			),
		).toEqual({ kind: "share", names: ["서윤", "준", "나"], narrator: false });
		expect(
			memoryAudienceControl(
				memory({ audience: { kind: "narrator" } }),
				[scene("2026-01-01", minaOnly)],
				cast,
			),
		).toEqual({ kind: "share", names: [], narrator: true });
	});
});

describe("unmarkedMemoryCount", () => {
	const shared: ChatSceneAudience = { kind: "room" };
	const memories = [
		memory(),
		memory({ audience: shared }),
		memory({ audience: minaOnly }),
		memory({ source: "auto" }),
	];

	it("counts only unmarked human-written memories, once a scene is narrower than the room", () => {
		expect(unmarkedMemoryCount(memories, [scene("2026-01-01", minaOnly)])).toBe(
			1,
		);
	});

	it("says nothing where sharing withholds nothing", () => {
		expect(unmarkedMemoryCount(memories, [])).toBe(0);
		expect(unmarkedMemoryCount(memories, [scene("2026-01-01", shared)])).toBe(
			0,
		);
		expect(
			unmarkedMemoryCount(memories, [
				scene("2026-01-01", minaOnly, "2026-01-02"),
			]),
		).toBe(0);
	});

	it("still counts after the room returns to a shared scene", () => {
		expect(
			unmarkedMemoryCount(memories, [
				scene("2026-01-01", minaOnly),
				scene("2026-01-03", shared),
			]),
		).toBe(1);
	});
});
