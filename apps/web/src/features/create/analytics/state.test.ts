import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	type CreatorAnalyticsQueryView,
	creatorAnalyticsMetrics,
	creatorAnalyticsPanelView,
	creatorAnalyticsRowView,
	formatConversion,
	formatMetric,
	METRIC_ORDER,
	metricLabel,
	metricLabelFor,
	summaryCaption,
} from "./state.ts";

/**
 * Locks in the panel state rules that are not visible to the eye. Three things are guarded.
 *
 * 1. A failure must not render as zeros. Showing `Views 0 · Favorites 0 · Comments 0` on a network error
 *    claims nobody viewed the work, which we cannot know. The defect looks normal on screen, so
 *    review misses it.
 * 2. A failure must not render as empty. `No stories to analyze yet` reads as data loss to a creator who
 *    has published ten works.
 * 3. A stopped query must not read as loading. Offline still reports `isPending`, so swapping
 *    the order leaves a placeholder that never ends. Endless waiting is worse than an error.
 */

const view = (
	patch: Partial<CreatorAnalyticsQueryView> = {},
): CreatorAnalyticsQueryView => ({
	isPaused: false,
	isError: false,
	isPending: false,
	hasData: true,
	workCount: 2,
	...patch,
});

describe("with no held values", () => {
	it("no connection is paused, not loading", () => {
		expect(
			creatorAnalyticsPanelView(
				view({ isPaused: true, isPending: true, hasData: false, workCount: 0 }),
			),
		).toEqual({ state: "offline", retryable: true });
	});

	it("a failure is a failure, not an empty state", () => {
		expect(
			creatorAnalyticsPanelView(
				view({ isError: true, hasData: false, workCount: 0 }),
			),
		).toEqual({ state: "error", retryable: true });
	});

	it("the first fetch is loading", () => {
		expect(
			creatorAnalyticsPanelView(
				view({ isPending: true, hasData: false, workCount: 0 }),
			),
		).toEqual({ state: "loading", retryable: false });
	});

	/**
	 * Stopped comes before failed, because users must do different things: wait, versus press again.
	 */
	it("paused wins when paused and failed overlap", () => {
		expect(
			creatorAnalyticsPanelView(
				view({
					isPaused: true,
					isError: true,
					hasData: false,
					workCount: 0,
				}),
			).state,
		).toBe("offline");
	});
});

describe("with held values", () => {
	it("draws rows when there are rows", () => {
		expect(creatorAnalyticsPanelView(view())).toEqual({
			state: "ready",
			retryable: false,
		});
	});

	/**
	 * The most important assertion in this file. A failed background refresh must not clear the held
	 * metrics. Those numbers are still server-confirmed, and covering them with an error screen would
	 * make the user lose their results for nothing. Only a retry path is added.
	 */
	it("a failed background refresh keeps the values and only adds a retry", () => {
		expect(creatorAnalyticsPanelView(view({ isError: true }))).toEqual({
			state: "ready",
			retryable: true,
		});
		expect(creatorAnalyticsPanelView(view({ isPaused: true }))).toEqual({
			state: "ready",
			retryable: true,
		});
	});

	/**
	 * When the server reports zero works, that is a fact. Unlike a failure, the empty state is
	 * correct.
	 */
	it("zero counted by the server is the empty state", () => {
		expect(creatorAnalyticsPanelView(view({ workCount: 0 }))).toEqual({
			state: "empty",
			retryable: false,
		});
	});
});

describe("metric formatting", () => {
	/** No abbreviation: 12,400 and 12,449 must not render as the same text. */
	it("writes the exact number with thousands separators", () => {
		expect(formatMetric(0)).toBe("0");
		expect(formatMetric(7)).toBe("7");
		expect(formatMetric(1000)).toBe("1,000");
		expect(formatMetric(12450)).toBe("12,450");
		expect(formatMetric(1000000)).toBe("1,000,000");
	});

	it("does not abbreviate", () => {
		for (const n of [12450, 1000000, 999999999]) {
			const text = formatMetric(n);
			expect(text).not.toMatch(/[KMB]/);
			expect(text).not.toContain(".");
		}
	});

	/**
	 * The contract already prevents this, but if it leaked here, users would read it as our
	 * calculation having failed.
	 */
	it("values that cannot be represented never reach the screen", () => {
		expect(formatMetric(Number.NaN)).toBe("0");
		expect(formatMetric(Number.POSITIVE_INFINITY)).toBe("0");
		expect(formatMetric(-5)).toBe("0");
		expect(formatMetric(3.7)).toBe("3");
	});
});

describe("metric vocabulary", () => {
	/**
	 * The order is the table's column order. The total, column headers, and rows all iterate this same
	 * array. If it flipped here, another metric's value would sit under each heading. Every number
	 * would still be valid, so the screen would look normal, and a creator would read their favorites
	 * count as views.
	 */
	it("the order is views · play starts · favorites · comments", () => {
		expect(METRIC_ORDER).toEqual([
			"views",
			"playStarts",
			"favorites",
			"comments",
		]);
	});

	/**
	 * Labels are not broadened: `Traffic` and `Engagement` cover more than we measure.
	 */
	it("uses concrete names as they are", () => {
		expect(METRIC_ORDER.map(metricLabel)).toEqual([
			"Views",
			"Play starts",
			"Favorites",
			"Comments",
		]);
	});
});

describe("window", () => {
	const summary = {
		views: 120,
		playStarts: 30,
		favorites: 5,
		comments: 2,
		windowViews: 12,
		windowPlayStarts: 3,
	};

	it("the screen always reads window values; for all time the server sends them equal to the totals", () => {
		expect(creatorAnalyticsMetrics(summary)).toEqual({
			views: 12,
			playStarts: 3,
			favorites: 5,
			comments: 2,
		});
	});

	it("window wording attaches only to the two metrics with an event ledger", () => {
		expect(metricLabelFor("views", "week")).toBe("Views · Last 7 days");
		expect(metricLabelFor("playStarts", "day")).toBe("Play starts · Today");
		// `Favorites, last 7 days` ('favorites in the last 7 days') is a value we do not have.
		expect(metricLabelFor("favorites", "week")).toBe("Favorites");
		expect(metricLabelFor("comments", "month")).toBe("Comments");
		expect(metricLabelFor("views", "all")).toBe("Views");
	});

	it("conversion uses two numbers from the same window, and no denominator means no line", () => {
		expect(formatConversion(summary)).toBe("25.0%");
		expect(
			formatConversion({ windowViews: 0, windowPlayStarts: 0 }),
		).toBeNull();
		expect(formatConversion({ windowViews: 2, windowPlayStarts: 3 })).toBe(
			"150.0%",
		);
		expect(formatConversion(null)).toBeNull();
	});

	it("the caption states the totals too when a window is applied", () => {
		expect(summaryCaption(summary, "all")).toContain(
			"Cumulative views and play starts",
		);
		const week = summaryCaption(summary, "week");
		expect(week).toContain("Last 7 days");
		expect(week).toContain("Cumulative views 120");
		expect(week).toContain("cumulative play starts 30");
	});
});

describe("a story row's display values", () => {
	const work = (
		patch: Partial<Parameters<typeof creatorAnalyticsRowView>[0]>,
	) =>
		creatorAnalyticsRowView({
			visibility: "public",
			hidden: false,
			updatedAt: "2026-08-23T05:22:00.000Z",
			...patch,
		});

	/**
	 * Visibility and update time share one line. Each removed line would make the table denser.
	 *
	 * The test does not lock the full time string. The AM/PM marker depends on the runtime's ICU data
	 * (reduced builds print `PM`), so asserting it would test the runner's locale data rather than our
	 * rule. Three things are checked: visibility comes first, the date in the product time zone
	 * follows, and the line ends with the update time.
	 */
	it("joins visibility and update time into one line", () => {
		expect(work({}).meta).toMatch(/^Public · Updated August 23, 2026.+$/);
		expect(work({ visibility: "private" }).meta).toMatch(/^Private · /);
		expect(work({ visibility: "archived" }).meta).toMatch(/^Archived · /);
	});

	/** An unreadable time takes no space. Otherwise the line would read `Public · Updated `. */
	it("an unreadable time drops out of the line", () => {
		expect(work({ updatedAt: "not-a-date" }).meta).toBe("Public");
	});

	/**
	 * Moderator hiding is something the creator did not do, and it may explain zero views. Folding it
	 * into quiet text would bury that fact beside the update time.
	 */
	it("operator hiding is not folded away and stays its own axis", () => {
		expect(work({ hidden: true }).moderatorHidden).toBe(true);
		expect(work({ hidden: false }).moderatorHidden).toBe(false);
	});

	/**
	 * A work the user cannot view has no destination. The detail page passes the same viewing boundary
	 * as the list (moderator-hidden or archived works return 404 even to the owner), so such a link
	 * would always end at `Not found` (not found), which looks like a broken product.
	 */
	it("only viewable stories get a link", () => {
		expect(work({}).linked).toBe(true);
		expect(work({ visibility: "private" }).linked).toBe(true);
		expect(work({ visibility: "archived" }).linked).toBe(false);
		expect(work({ hidden: true }).linked).toBe(false);
	});
});

/**
 * The period selector outlives the placeholder, as in `panel.tsx`.
 *
 * Reading the source shape is deliberate. Reverting the change is a one-line edit that produces no
 * error and no type failure, and rendering the panel would require both the router and the query
 * client. The mobile app makes the same decision (`apps/mobile/.../create-boundaries.test.ts`).
 */
describe("the analytics waiting screen", () => {
	const panel = readFileSync(new URL("./panel.tsx", import.meta.url), "utf8");

	const loadingBranch = (): string =>
		panel.slice(
			panel.indexOf('if (panel.state === "loading")'),
			panel.indexOf('if (panel.state === "empty")'),
		);

	it("the loading branch also draws the period picker", () => {
		const branch = loadingBranch();
		expect(branch).not.toBe("");
		expect(branch).toContain("<WindowSelector");
		expect(branch).toContain("<AnalyticsSkeleton />");
	});

	/**
	 * Keeping the previous period's numbers would put old values under the new period's label, which
	 * is worse than a placeholder.
	 */
	it("that branch draws no metrics", () => {
		const branch = loadingBranch();
		expect(branch).not.toContain("CreatorAnalyticsOverview ");
		expect(branch).not.toContain("<CreatorAnalyticsWorkList");
	});
});
