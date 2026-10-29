import type { ChatRoom } from "@rowcat/chat";
import { describe, expect, it } from "vitest";
import type { MobileAppPhase } from "../../lib/session-state.ts";
import {
	type RoomLookup,
	readRoomIdParam,
	resolveChatScreenState,
} from "./chat-state.ts";

/**
 * The screen's states, checked without rendering. Failures are silent: "room not found" while
 * storage opens, another account's room for a frame after a switch, or an endless spinner offline.
 */

const room = { id: "room-1", title: "The Night Library" } as ChatRoom;

const lookup = (over: Partial<RoomLookup> = {}): RoomLookup => ({
	status: "ready",
	room,
	...over,
});

describe("identity and storage come first", () => {
	/** Most important check: identity wins even when a lookup result is already held (account switch). */
	it.each([
		["guest", "guest"],
		["unavailable", "unavailable"],
		["local-error", "storage-error"],
		["booting", "booting"],
		["opening", "booting"],
	] as const)("with %s the held room isn't drawn", (phase, kind) => {
		expect(
			resolveChatScreenState({
				phase: phase as MobileAppPhase,
				lookup: lookup(),
			}),
		).toEqual({ kind });
	});

	it("**sending** a guest to sign in is the screen's job; here it only answers the cell", () => {
		const state = resolveChatScreenState({
			phase: "guest",
			lookup: lookup({ status: "loading", room: null }),
		});
		expect(state.kind).toBe("guest");
	});

	/** Folding `unavailable` into guest would push a live session to the login screen. */
	it("an uncheckable session and a guest are different cells", () => {
		expect(
			resolveChatScreenState({ phase: "unavailable", lookup: lookup() }).kind,
		).not.toBe("guest");
	});
});

describe("room lookup", () => {
	it("draws the room when found", () => {
		expect(
			resolveChatScreenState({ phase: "ready", lookup: lookup() }),
		).toEqual({ kind: "room", room });
	});

	it("doesn't say it's missing while still looking", () => {
		expect(
			resolveChatScreenState({
				phase: "ready",
				lookup: { status: "loading", room: null },
			}),
		).toEqual({ kind: "loading" });
	});

	it('`missing` only for a confirmed "not there"', () => {
		expect(
			resolveChatScreenState({
				phase: "ready",
				lookup: { status: "ready", room: null },
			}),
		).toEqual({ kind: "missing" });
	});

	/** A failed read must not say "not on this device"; the user would read it as lost data. */
	it("a read failure isn't a missing room", () => {
		expect(
			resolveChatScreenState({
				phase: "ready",
				lookup: { status: "error", room: null },
			}),
		).toEqual({ kind: "loading" });
	});

	/** A failed background refresh does not blank a conversation already being read. */
	it("with a held room it draws even when reading fails", () => {
		expect(
			resolveChatScreenState({
				phase: "ready",
				lookup: { status: "error", room },
			}),
		).toEqual({ kind: "room", room });
	});
});

describe("route parameter", () => {
	it("uses a single string as is", () => {
		expect(readRoomIdParam("room-1")).toBe("room-1");
	});

	/** A repeated key in a deep link arrives as an array; the first value wins. */
	it("an array gives its first value", () => {
		expect(readRoomIdParam(["room-1", "room-2"])).toBe("room-1");
	});

	it.each([undefined, "", "   ", []])("%s isn't a room", (raw) => {
		expect(readRoomIdParam(raw as string | string[] | undefined)).toBeNull();
	});

	/** An empty id must not draw "not found"; `null` makes the route return to the first screen. */
	it("a whitespace-only value isn't a room either", () => {
		expect(readRoomIdParam("\t\n ")).toBeNull();
	});
});
