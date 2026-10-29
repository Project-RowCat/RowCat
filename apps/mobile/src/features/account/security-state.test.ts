import type { AccountSession } from "@rowcat/domain";
import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import {
	securityListView,
	sessionListView,
	VISIBLE_OTHER_SESSIONS,
} from "./security-state.ts";

const apiError = (code: string) =>
	new RowCatApiError({ status: 403, code, message: "" });

const view = (patch: Partial<Parameters<typeof securityListView>[0]>) =>
	securityListView({
		isPaused: false,
		isError: false,
		error: undefined,
		hasData: false,
		...patch,
	});

describe("securityListView", () => {
	it("loading while the first lookup runs", () => {
		expect(view({})).toEqual({ state: "loading", retryable: false });
	});

	// Paused is still `isPending`; it must precede error/loading or offline users see an endless
	// placeholder.
	it("a paused lookup is offline, not loading", () => {
		expect(view({ isPaused: true })).toEqual({
			state: "offline",
			retryable: true,
		});
	});

	it("a failure with no held value is an error", () => {
		expect(view({ isError: true, error: apiError("internal") })).toEqual({
			state: "error",
			retryable: true,
		});
	});

	// Needing a fresh login is guidance, not failure: `retryable` is false because asking again gets
	// the same answer.
	it("a fresh-session requirement isn't an error but its own cell", () => {
		expect(
			view({ isError: true, error: apiError("recent_login_required") }),
		).toEqual({ state: "recent_login", retryable: false });
	});

	it("Better Auth's fresh-session code is the same cell", () => {
		for (const code of ["SESSION_NOT_FRESH", "SESSION_EXPIRED"])
			expect(view({ isError: true, error: { code } }).state).toBe(
				"recent_login",
			);
	});

	it("draws when there is a held value", () => {
		expect(view({ hasData: true })).toEqual({
			state: "ready",
			retryable: false,
		});
	});

	// A failed background refresh keeps the list (erasing reads as sessions/passkeys vanishing) and
	// states staleness.
	it("a failed background refresh doesn't erase the held value", () => {
		expect(
			view({ hasData: true, isError: true, error: apiError("x") }),
		).toEqual({ state: "ready", retryable: true });
		expect(view({ hasData: true, isPaused: true })).toEqual({
			state: "ready",
			retryable: true,
		});
	});

	// A held value survives a fresh-session requirement too.
	it("a held value comes before the fresh-session requirement", () => {
		expect(
			view({
				hasData: true,
				isError: true,
				error: apiError("recent_login_required"),
			}).state,
		).toBe("ready");
	});
});

const session = (id: string, current = false): AccountSession => ({
	id,
	current,
	createdAt: "2026-08-01T00:00:00.000Z",
	expiresAt: "2026-09-01T00:00:00.000Z",
});

describe("sessionListView", () => {
	it("draws every other device when they're within the cap", () => {
		const sessions = [session("a", true), session("b"), session("c")];
		expect(sessionListView({ sessions, expanded: false })).toEqual({
			rows: sessions,
			hidden: 0,
			others: 2,
		});
	});

	// The current device is always visible regardless of the cap; a front-trim could cut it if server
	// ordering changes.
	it("the current device isn't cut even at the end of the list", () => {
		const others = Array.from({ length: 9 }, (_, i) => session(`o${i}`));
		const sessions = [...others, session("me", true)];
		const list = sessionListView({ sessions, expanded: false });

		expect(list.rows).toHaveLength(VISIBLE_OTHER_SESSIONS + 1);
		expect(list.rows.some((row) => row.current)).toBe(true);
		expect(list.hidden).toBe(9 - VISIBLE_OTHER_SESSIONS);
		expect(list.others).toBe(9);
	});

	it("folded rows are drawn from the front", () => {
		const sessions = [
			session("me", true),
			...Array.from({ length: 6 }, (_, i) => session(`o${i}`)),
		];
		const list = sessionListView({ sessions, expanded: false });
		expect(list.rows.map((row) => row.id)).toEqual([
			"me",
			"o0",
			"o1",
			"o2",
			"o3",
		]);
	});

	it("expanding draws everything and the hidden count is 0", () => {
		const sessions = [
			session("me", true),
			...Array.from({ length: 6 }, (_, i) => session(`o${i}`)),
		];
		const list = sessionListView({ sessions, expanded: true });
		expect(list.rows).toHaveLength(7);
		expect(list.hidden).toBe(0);
		// The total is independent of expansion; `Sign out all` counts it.
		expect(list.others).toBe(6);
	});

	it("with only the current device there's nothing to cut", () => {
		const list = sessionListView({
			sessions: [session("me", true)],
			expanded: false,
		});
		expect(list.others).toBe(0);
		expect(list.hidden).toBe(0);
	});

	// An empty list is a normal state, separate from failure (`securityListView` owns that axis).
	it("invents nothing from an empty list", () => {
		expect(sessionListView({ sessions: [], expanded: false })).toEqual({
			rows: [],
			hidden: 0,
			others: 0,
		});
	});
});
