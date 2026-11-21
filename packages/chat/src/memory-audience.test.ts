import { describe, expect, it } from "vitest";
import type {
	ChatMemory,
	ChatScene,
	ChatSceneAudience,
	ChatSeed,
} from "./index.ts";
import {
	memoryVisibility,
	memoryVisibilityOptions,
	unresolvedMemoryCount,
} from "./memory-audience.ts";

/** Visibility of human-written memories in rooms with scenes, and the classification choices. */

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
	characters: [{ id: "c1", name: "서윤", deletedAt: null }],
};

const memory = (
	patch: Partial<Pick<ChatMemory, "source" | "audience">> = {},
): Pick<ChatMemory, "source" | "audience"> => ({ source: "user", ...patch });

const minaOnly: ChatSceneAudience = {
	kind: "participants",
	members: ["seed:0", "user"],
};

describe("memoryVisibility", () => {
	it("is not applicable without a live scene, or for an automatic memory", () => {
		expect(memoryVisibility(memory(), [], cast)).toEqual({
			state: "not-applicable",
		});
		expect(
			memoryVisibility(
				memory(),
				[scene("2026-01-01", minaOnly, "2026-01-02")],
				cast,
			),
		).toEqual({ state: "not-applicable" });
		expect(
			memoryVisibility(
				memory({ source: "auto" }),
				[scene("2026-01-01", minaOnly)],
				cast,
			),
		).toEqual({ state: "not-applicable" });
	});

	it("absent is unresolved — blocking only where a scene is narrower than the room", () => {
		expect(
			memoryVisibility(memory(), [scene("2026-01-01", { kind: "room" })], cast),
		).toEqual({ state: "unresolved", blocking: false });
		expect(
			memoryVisibility(memory(), [scene("2026-01-01", minaOnly)], cast),
		).toEqual({ state: "unresolved", blocking: true });
	});

	it("reads explicit audiences with display names", () => {
		const scenes = [scene("2026-01-01", minaOnly)];
		expect(
			memoryVisibility(memory({ audience: { kind: "room" } }), scenes, cast),
		).toEqual({
			state: "shared",
		});
		expect(
			memoryVisibility(
				memory({ audience: { kind: "narrator" } }),
				scenes,
				cast,
			),
		).toEqual({ state: "narrator" });
		expect(
			memoryVisibility(
				memory({
					audience: { kind: "participants", members: ["char:c1", "user"] },
				}),
				scenes,
				cast,
			),
		).toEqual({ state: "restricted", names: ["서윤", "나"] });
	});
});

describe("memoryVisibilityOptions", () => {
	it("offers share, the current scene, choose and narrator for an unresolved memory", () => {
		const options = memoryVisibilityOptions(
			memory(),
			[scene("2026-01-01", minaOnly)],
			cast,
		);
		expect(options.map((o) => o.kind)).toEqual([
			"share",
			"current-scene",
			"choose",
			"narrator",
		]);
		const current = options.find((o) => o.kind === "current-scene");
		expect(current).toMatchObject({
			audience: minaOnly,
			names: ["미나", "나"],
		});
	});

	it("never offers the value a memory already has", () => {
		const scenes = [scene("2026-01-01", minaOnly)];
		expect(
			memoryVisibilityOptions(
				memory({ audience: { kind: "room" } }),
				scenes,
				cast,
			).map((o) => o.kind),
		).not.toContain("share");
		expect(
			memoryVisibilityOptions(memory({ audience: minaOnly }), scenes, cast).map(
				(o) => o.kind,
			),
		).not.toContain("current-scene");
	});

	it("offers nothing where visibility does not apply", () => {
		expect(memoryVisibilityOptions(memory(), [], cast)).toEqual([]);
		expect(
			memoryVisibilityOptions(
				memory({ source: "auto" }),
				[scene("2026-01-01", minaOnly)],
				cast,
			),
		).toEqual([]);
	});
});

describe("unresolvedMemoryCount", () => {
	const memories = [
		memory(),
		memory(),
		memory({ audience: { kind: "room" } }),
		memory({ audience: minaOnly }),
		memory({ source: "auto" }),
	];

	it("counts human-written memories with no audience, only where a scene is narrower", () => {
		expect(
			unresolvedMemoryCount(memories, [scene("2026-01-01", minaOnly)]),
		).toBe(2);
		expect(
			unresolvedMemoryCount(memories, [scene("2026-01-01", { kind: "room" })]),
		).toBe(0);
		expect(unresolvedMemoryCount(memories, [])).toBe(0);
	});
});
