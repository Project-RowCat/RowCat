import type { Story } from "@rowcat/domain";
import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import type { MobileLocalScopeStatus } from "../../lib/local-data/activation.ts";
import type { SessionPhase } from "../../lib/session-state.ts";
import { resolveStoryState } from "./story-state.ts";

/**
 * The two guarantees of the work detail.
 *
 * ```text
 * a public work does not wait for identity or SQLite
 * a 404 does **not** say why
 * ```
 *
 * The second one breaks quietly. The server returns the same 404 for a missing work and for one the
 * viewer cannot see, and the moment a screen string guesses the reason, that response becomes an
 * existence detector — anyone walking through ids could check other people's private lists.
 */

const ALL_SESSIONS: SessionPhase[] = [
	"booting",
	"guest",
	"authenticated",
	"unavailable",
];

const ALL_SCOPES: MobileLocalScopeStatus[] = [
	"idle",
	"opening",
	"ready",
	"error",
];

const STORY = {
	id: "story-1",
	title: "Cat Tower",
	description: "",
	author: "",
	coverUrl: null,
	orientation: null,
	adult: false,
	visibility: "public",
	promptProtected: false,
	tags: [],
	favorites: 0,
	creator: null,
	/** A published work whose owner is gone — the server projection always returns false in this combination. */
	playMode: "chat",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	sizeBytes: 0,
} satisfies Story;

const apiError = (status: number, requestId?: string) =>
	new RowCatApiError({
		status,
		code: "not_found",
		message: "not found",
		requestId,
	});

describe("public stories don't hang on identity or device storage", () => {
	for (const session of ALL_SESSIONS)
		for (const localScope of ALL_SCOPES)
			it(`draws the story even with session ${session} · storage ${localScope}`, () => {
				expect(
					resolveStoryState({
						context: { session, localScope },
						story: {
							status: "success",
							paused: false,
							error: null,
							data: STORY,
						},
					}),
				).toEqual({ kind: "story", story: STORY });
			});
});

describe("a 404 doesn't state the reason", () => {
	const state = resolveStoryState({
		context: { session: "authenticated", localScope: "ready" },
		story: {
			status: "error",
			paused: false,
			error: apiError(404, "req-1"),
			data: undefined,
		},
	});

	it("expressed with one cell only", () => {
		expect(state).toEqual({ kind: "missing" });
	});

	it("there's no slot for a reason", () => {
		/**
		 * Careful wording is not enough — **once a field exists, someone eventually fills it.** Even the
		 * request id is absent from this branch, because it is a "missing work" rather than a failed
		 * fetch.
		 */
		expect(Object.keys(state)).toEqual(["kind"]);
		for (const forbidden of [
			"private",
			"adult",
			"blocked",
			"hidden",
			"banned",
			"reason",
		])
			expect(JSON.stringify(state)).not.toContain(forbidden);
	});
});

describe("other failures", () => {
	const context = { session: "guest", localScope: "idle" } as const;

	it("keeps only the request id", () => {
		expect(
			resolveStoryState({
				context,
				story: {
					status: "error",
					paused: false,
					error: apiError(500, "req-9"),
					data: undefined,
				},
			}),
		).toEqual({ kind: "failed", requestId: "req-9" });
	});

	it("without an API error there's no request id", () => {
		expect(
			resolveStoryState({
				context,
				story: {
					status: "error",
					paused: false,
					error: new Error("network down"),
					data: undefined,
				},
			}),
		).toEqual({ kind: "failed", requestId: null });
	});

	it("not every 4xx becomes 404", () => {
		expect(
			resolveStoryState({
				context,
				story: {
					status: "error",
					paused: false,
					error: apiError(403),
					data: undefined,
				},
			}),
		).toMatchObject({ kind: "failed" });
	});
});

describe("the two waiting cells", () => {
	const context = { session: "guest", localScope: "idle" } as const;

	it("running means waiting", () => {
		expect(
			resolveStoryState({
				context,
				story: {
					status: "pending",
					paused: false,
					error: null,
					data: undefined,
				},
			}),
		).toEqual({ kind: "loading" });
	});

	it("paused means offline", () => {
		// Without this branch it would be a placeholder that never finishes (`status` is still pending).
		expect(
			resolveStoryState({
				context,
				story: {
					status: "pending",
					paused: true,
					error: null,
					data: undefined,
				},
			}),
		).toEqual({ kind: "offline" });
	});
});
