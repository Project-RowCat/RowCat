import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import { createRoomRecord } from "./model.ts";
import type { ChatScene, ChatSceneAudience } from "./scene.ts";
import {
	activeScene,
	HISTORY_ADOPTION_CHOICES,
	HISTORY_ADOPTION_DEFAULT,
	historyAdoptionNeeded,
	planCorrectScene,
	planEndScene,
	planHistoryAdoption,
	planStartScene,
	sceneCast,
	startAfter,
	unclassifiedHistory,
} from "./scene-controls.ts";

const ROOM = "room-sc";
const at = (n: number) =>
	new Date(Date.UTC(2026, 0, 1) + n * 60_000).toISOString();
const msg = (id: string, n: number) => ({ id, createdAt: at(n) });

const room = createRoomRecord(
	{
		originStoryId: null,
		seed: StoryChatSeedDto.parse({
			version: 1,
			storyId: "s",
			title: "Harbor",
			adult: false,
			promptProtected: false,
			characters: [{ name: "Mira" }, { name: "  " }],
		}),
	},
	{ id: ROOM, routingSessionId: "r", now: at(0), rev: { t: 1, c: 0, d: "a" } },
);

let r = 0;
const scene = (
	id: string,
	start: { id: string; createdAt: string },
	audience: ChatSceneAudience,
	extra: Partial<ChatScene> = {},
): ChatScene => ({
	id,
	roomId: ROOM,
	startAt: { createdAt: start.createdAt, messageId: start.id },
	audience,
	createdAt: start.createdAt,
	updatedAt: at(1000 + r),
	deletedAt: null,
	dirty: 0,
	serverVersion: 0,
	rev: { t: 100 + r++, c: 0, d: "a" },
	...extra,
});

const P = (...members: string[]): ChatSceneAudience => ({
	kind: "participants",
	members: members.sort(),
});

describe("the cast the picker offers", () => {
	it("lists the user's role, the work's named characters, then live added ones", () => {
		const cast = sceneCast(room, [
			{ id: "k", name: "Kael", deletedAt: null },
			{ id: "gone", name: "Old", deletedAt: at(5) },
		]);
		expect(cast.map((c) => [c.ref, c.kind])).toEqual([
			["user", "user"],
			["seed:0", "seed"],
			["char:k", "char"],
		]);
	});
});

describe("the scene in effect", () => {
	const last = msg("m3", 3);

	it("is nothing in a room without scenes", () => {
		expect(activeScene([], { ...room, characters: [] }, last)).toBeNull();
	});

	it("names the participants and says whether anything was said in it", () => {
		const scenes = [scene("s1", msg("m1", 1), P("user", "seed:0"))];
		const view = activeScene(scenes, { ...room, characters: [] }, last);
		expect(view?.names).toContain("Mira");
		expect(view?.empty).toBe(false);
		const fresh = [
			...scenes,
			scene("s2", startAfter(last, at(4)) as never, { kind: "room" }),
		];
		const after = activeScene(
			[
				...scenes,
				{
					...scene("s2", msg("x", 4), { kind: "room" }),
					startAt: startAfter(last, at(4)),
				},
			],
			{ ...room, characters: [] },
			last,
		);
		expect(fresh.length).toBe(2);
		expect(after?.audience).toEqual({ kind: "room" });
		expect(after?.empty).toBe(true);
	});
});

describe("starting, changing and ending", () => {
	const last = msg("m9", 9);

	it("a new scene starts after the last message, so what was said keeps its audience", () => {
		const plan = planStartScene({
			roomId: ROOM,
			scenes: [],
			lastMessage: last,
			audience: P("user", "seed:0"),
			nowIso: at(5),
		});
		expect(plan.remove).toEqual([]);
		expect(plan.set).toHaveLength(1);
		// The clock is behind the last message: the start still follows it.
		expect(plan.set[0]?.startAt).toEqual({
			createdAt: last.createdAt,
			messageId: "~",
		});
	});

	it("starting what is already in effect writes nothing", () => {
		const scenes = [scene("s1", msg("m1", 1), P("user", "seed:0"))];
		expect(
			planStartScene({
				roomId: ROOM,
				scenes,
				lastMessage: last,
				audience: P("seed:0", "user"),
				nowIso: at(20),
			}),
		).toEqual({ set: [], remove: [] });
	});

	it("changing an empty scene edits it in place instead of stacking another", () => {
		const empty = {
			...scene("s2", msg("x", 10), P("user")),
			startAt: startAfter(last, at(10)),
		};
		const plan = planStartScene({
			roomId: ROOM,
			scenes: [scene("s1", msg("m1", 1), { kind: "room" }), empty],
			lastMessage: last,
			audience: P("user", "seed:0"),
			nowIso: at(11),
		});
		expect(plan.set).toEqual([
			{ roomId: ROOM, startAt: empty.startAt, audience: P("user", "seed:0") },
		]);
	});

	it("refuses an audience with nobody in it", () => {
		expect(() =>
			planStartScene({
				roomId: ROOM,
				scenes: [],
				lastMessage: last,
				audience: { kind: "participants", members: [] },
				nowIso: at(20),
			}),
		).toThrow();
	});

	it("ending makes everyone present again; with no scene there is nothing to end", () => {
		expect(
			planEndScene({
				roomId: ROOM,
				scenes: [],
				lastMessage: last,
				nowIso: at(20),
			}),
		).toEqual({ set: [], remove: [] });
		const plan = planEndScene({
			roomId: ROOM,
			scenes: [scene("s1", msg("m1", 1), P("user", "seed:0"))],
			lastMessage: last,
			nowIso: at(20),
		});
		expect(plan.set[0]?.audience).toEqual({ kind: "room" });
	});

	it("correcting rewrites the scene at its own start, and only when it changes", () => {
		const s = scene("s1", msg("m1", 1), P("user", "seed:0"));
		expect(planCorrectScene(s, P("seed:0", "user"))).toEqual({
			set: [],
			remove: [],
		});
		expect(planCorrectScene(s, P("user")).set).toEqual([
			{ roomId: ROOM, startAt: s.startAt, audience: P("user") },
		]);
	});
});

describe("earlier history", () => {
	const messages = [msg("m1", 1), msg("m2", 2), msg("m3", 3)];

	it("asks only when a room with messages gains its first scene", () => {
		expect(historyAdoptionNeeded(messages, [])).toBe(true);
		expect(historyAdoptionNeeded([], [])).toBe(false);
		expect(
			historyAdoptionNeeded(messages, [
				scene("s1", msg("m3", 3), { kind: "room" }),
			]),
		).toBe(false);
	});

	it("the default is the conservative one", () => {
		expect(HISTORY_ADOPTION_CHOICES).toEqual(["shared", "private", "review"]);
		expect(HISTORY_ADOPTION_DEFAULT).toBe("review");
	});

	it("shared and private write a scene at the first message; review writes nothing", () => {
		const first = messages[0] ?? null;
		expect(
			planHistoryAdoption({
				roomId: ROOM,
				choice: "shared",
				firstMessage: first,
			}).set[0],
		).toEqual({
			roomId: ROOM,
			startAt: { createdAt: at(1), messageId: "m1" },
			audience: { kind: "room" },
		});
		expect(
			planHistoryAdoption({
				roomId: ROOM,
				choice: "private",
				firstMessage: first,
			}).set[0]?.audience,
		).toEqual({ kind: "narrator" });
		expect(
			planHistoryAdoption({
				roomId: ROOM,
				choice: "review",
				firstMessage: first,
			}),
		).toEqual({ set: [], remove: [] });
	});

	it("counts what no scene classifies yet", () => {
		const later = [scene("s1", msg("m3", 3), P("user"))];
		expect(unclassifiedHistory(messages, later)).toEqual({
			count: 2,
			first: messages[0],
		});
		expect(unclassifiedHistory(messages, []).count).toBe(0);
		const adopted = [...later, scene("s0", msg("m1", 1), { kind: "narrator" })];
		expect(unclassifiedHistory(messages, adopted).count).toBe(0);
	});
});
