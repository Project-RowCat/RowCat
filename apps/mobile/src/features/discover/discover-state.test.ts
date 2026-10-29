import { DEFAULT_GALLERY_FILTERS, type GalleryFilters } from "@rowcat/domain";
import { describe, expect, it } from "vitest";
import type { MobileLocalScopeStatus } from "../../lib/local-data/activation.ts";
import type { SessionPhase } from "../../lib/session-state.ts";
import {
	discoverTotalLabel,
	type GallerySnapshot,
	resolveDiscoverState,
} from "./discover-state.ts";

/**
 * The most important test of this slice. The rule is that reading public stories never hangs on
 * Better Auth or SQLite. The rule exists only as an unwritten condition, so it cannot be verified
 * by reading code and breaks silently when someone adds a line. Hence all 4 session x 4 storage
 * combinations are run and must give the same result.
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

const READY: GallerySnapshot = {
	status: "success",
	paused: false,
	storyCount: 24,
};

const base = {
	gallery: READY,
	filters: DEFAULT_GALLERY_FILTERS,
	followsNobody: false,
};

const withFilters = (patch: Partial<GalleryFilters>): GalleryFilters => ({
	...DEFAULT_GALLERY_FILTERS,
	...patch,
});

describe("public surfaces don't hang on identity or device storage", () => {
	for (const session of ALL_SESSIONS)
		for (const localScope of ALL_SCOPES)
			it(`draws the list even with session ${session} · storage ${localScope}`, () => {
				expect(
					resolveDiscoverState({ ...base, context: { session, localScope } }),
				).toEqual({ kind: "stories" });
			});

	it("only a failed gallery lookup makes a failure", () => {
		// The converse check: above, bad identity still yields a list; here, only a bad list yields
		// failure. Together they show the decision hangs on the gallery axis alone.
		for (const session of ALL_SESSIONS)
			expect(
				resolveDiscoverState({
					...base,
					context: { session, localScope: "ready" },
					gallery: { status: "error", paused: false, storyCount: 0 },
				}),
			).toEqual({ kind: "failed" });
	});
});

describe("lookup cells", () => {
	const context = { session: "guest", localScope: "idle" } as const;

	it("the first lookup is a wait", () => {
		expect(
			resolveDiscoverState({
				...base,
				context,
				gallery: { status: "pending", paused: false, storyCount: 0 },
			}),
		).toEqual({ kind: "loading" });
	});

	it("tells paused from running", () => {
		// With no network Query pauses retries while `status` stays `pending`; ignoring that shows
		// offline users an endless placeholder.
		expect(
			resolveDiscoverState({
				...base,
				context,
				gallery: { status: "pending", paused: true, storyCount: 0 },
			}),
		).toEqual({ kind: "offline" });
	});

	it("draws the list already received even when a background refresh fails", () => {
		// With a value already held, `status` stays `success`; that case is not folded into failure.
		expect(
			resolveDiscoverState({
				...base,
				context,
				gallery: { status: "success", paused: true, storyCount: 12 },
			}),
		).toEqual({ kind: "stories" });
	});
});

describe("three branches of an empty list", () => {
	const context = { session: "authenticated", localScope: "ready" } as const;
	const empty: GallerySnapshot = {
		status: "success",
		paused: false,
		storyCount: 0,
	};

	it("with no conditions there are no stories yet", () => {
		expect(resolveDiscoverState({ ...base, context, gallery: empty })).toEqual({
			kind: "empty",
			filtered: false,
			followsNobody: false,
		});
	});

	it("with conditions on, no stories match them", () => {
		// Folding into one copy would tell a zero-result searcher `No stories yet`, and they would not
		// suspect their own filter.
		expect(
			resolveDiscoverState({
				...base,
				context,
				gallery: empty,
				filters: withFilters({ query: "Cat" }),
			}),
		).toMatchObject({ kind: "empty", filtered: true });
	});

	it("an empty following feed with nobody followed is the third branch", () => {
		expect(
			resolveDiscoverState({
				...base,
				context,
				gallery: empty,
				filters: withFilters({ followingOnly: true }),
				followsNobody: true,
			}),
		).toMatchObject({ kind: "empty", followsNobody: true });
	});

	it("with people followed it isn't the third branch", () => {
		// Someone who already follows several creators is never told `You don't follow any creators`.
		expect(
			resolveDiscoverState({
				...base,
				context,
				gallery: empty,
				filters: withFilters({ followingOnly: true }),
				followsNobody: false,
			}),
		).toMatchObject({ kind: "empty", followsNobody: false });
	});

	it("with the following filter off it doesn't go to that branch", () => {
		expect(
			resolveDiscoverState({
				...base,
				context,
				gallery: empty,
				followsNobody: true,
			}),
		).toMatchObject({ followsNobody: false });
	});
});

/**
 * Unknown and zero must not draw the same text. The screen once passed `0` while the value was
 * unresolved, and `0 stories` stood as fact. This pins that split by meaning, not by style string.
 */
describe("discoverTotalLabel", () => {
	it("unknown means no text — not `0 stories`", () => {
		expect(discoverTotalLabel(null)).toBeNull();
	});

	it("a server answer of zero is 0 stories as is", () => {
		expect(discoverTotalLabel(0)).toBe("0 stories");
	});

	it("writes the server's count as is, unabbreviated", () => {
		expect(discoverTotalLabel(1)).toBe("1 story");
		expect(discoverTotalLabel(1234)).toBe("1,234 stories");
		expect(discoverTotalLabel(1_247_017)).toBe("1,247,017 stories");
	});

	// Pins that the two states are different values, so a change folding them cannot pass green.
	it("unknown and zero aren't the same value", () => {
		expect(discoverTotalLabel(null)).not.toBe(discoverTotalLabel(0));
	});
});
