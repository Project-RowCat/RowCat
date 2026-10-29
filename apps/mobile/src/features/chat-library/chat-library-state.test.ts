import { describe, expect, it } from "vitest";
import type { LocalLiveStatus } from "../../lib/local-data/live.ts";
import type { MobileAppPhase } from "../../lib/session-state.ts";
import {
	type ChatLibraryState,
	resolveChatLibraryState,
} from "./chat-library-state.ts";

/**
 * What the conversation list draws, checked without rendering. Every wrong answer is silent: no
 * error, the screen still draws, only the fact the user reads is wrong (someone with conversations
 * sees "no conversations yet", someone never signed out gets a sign-in button, an offline user sees
 * a placeholder that never ends).
 */

const state = (
	phase: MobileAppPhase,
	rooms: {
		status?: LocalLiveStatus;
		total?: number;
		matched?: number;
		searching?: boolean;
	} = {},
): ChatLibraryState =>
	resolveChatLibraryState({
		phase,
		rooms: {
			status: rooms.status ?? "ready",
			total: rooms.total ?? 3,
			matched: rooms.matched ?? 3,
			searching: rooms.searching ?? false,
		},
	});

describe("identity and storage come first", () => {
	/**
	 * Even if list results already arrived: on an account switch there is a real render where the
	 * previous member's rooms remain in state, drawing someone else's conversation titles.
	 */
	it.each<[MobileAppPhase, ChatLibraryState["kind"]]>([
		["booting", "booting"],
		["opening", "booting"],
		["guest", "guest"],
		["unavailable", "unavailable"],
		["local-error", "storage-error"],
	])("with %s it is %s even when the list is ready", (phase, kind) => {
		expect(state(phase, { status: "ready", total: 12 }).kind).toBe(kind);
	});

	/**
	 * Guest and `unavailable` are different facts: the server answered "no member" versus we could not
	 * ask. Folding the latter into guest pushes a sign-in button on someone whose stored session is
	 * intact.
	 */
	it("a guest and a failed check aren't the same cell", () => {
		expect(state("guest").kind).not.toBe(state("unavailable").kind);
	});
});

describe("unknown and zero are different", () => {
	it("doesn't draw the empty state while reading", () => {
		expect(state("ready", { status: "loading", total: 0 }).kind).toBe(
			"loading",
		);
	});

	/** A read failure drawn as 0 rows becomes "no conversations yet", a claim we did not verify; the user reads it as conversations gone. */
	it("a read failure with no held value states the failure", () => {
		expect(state("ready", { status: "error", total: 0 }).kind).toBe(
			"read-error",
		);
	});

	/** A held value is not erased: emptying a drawn list on a failed background refresh makes conversations look gone while storage is fine (same as `live.ts`). */
	it("even with a read failure, the list already received is drawn as is", () => {
		expect(state("ready", { status: "error", total: 9, matched: 9 }).kind).toBe(
			"list",
		);
	});

	/** Storage-open and list-read failures retry different things. */
	it("a scope failure and a read failure are different cells", () => {
		expect(state("local-error").kind).toBe("storage-error");
		expect(state("ready", { status: "error", total: 0 }).kind).toBe(
			"read-error",
		);
	});
});

describe("there are two empty states", () => {
	it("no conversations at all is the first-visit empty state", () => {
		expect(state("ready", { total: 0, matched: 0 }).kind).toBe("empty");
	});

	it("conversations exist but the search finds nothing is a different screen", () => {
		expect(
			state("ready", { total: 12, matched: 0, searching: true }).kind,
		).toBe("search-empty");
	});

	/** "No search results" explains nothing to someone with no rooms: with total 0 the first-visit empty state wins even with a query (same order as the web). */
	it("a total of 0 is the first-visit empty state regardless of search", () => {
		expect(state("ready", { total: 0, matched: 0, searching: true }).kind).toBe(
			"empty",
		);
	});

	/** With a non-zero match count it is a list even while searching. */
	it("with a search on, results still make a list", () => {
		expect(
			state("ready", { total: 12, matched: 2, searching: true }).kind,
		).toBe("list");
	});
});
