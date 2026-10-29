import { describe, expect, it } from "vitest";
import {
	analyticsWindowFromSearch,
	CREATE_VIEWS,
	createSearchForAnalyticsWindow,
	createSearchForNavigation,
	createSearchForView,
	createViewFromSearch,
	DEFAULT_CREATE_VIEW,
	validateCreateSearch,
} from "./create-search.ts";

/**
 * Locks in that the workspace tab lives in the address. Three properties meet here:
 * - The default tab is drafts. It renders without a server, so a default of published works would
 *   show an error to offline users who open /create.
 * - The default is not written to the address. Otherwise the same screen gets two addresses,
 *   which become separate back-history entries.
 * - A hand-edited address must not break the screen. Drafts stay on the device, and the user
 *   would otherwise read them as lost.
 */

describe("vocabulary", () => {
	/**
	 * There are exactly four tabs. Adding a value here must ship together with the screen that renders
	 * it. A value that exists only in the vocabulary becomes a tab that opens nothing, and users read
	 * it as a feature that is coming soon.
	 */
	it("there are four tabs: drafts, published, analytics, comments", () => {
		expect([...CREATE_VIEWS]).toEqual([
			"drafts",
			"published",
			"analytics",
			"comments",
		]);
	});
});

describe("address → tab", () => {
	it("omitted means drafts", () => {
		expect(createViewFromSearch({})).toBe("drafts");
		expect(DEFAULT_CREATE_VIEW).toBe("drafts");
	});

	it("the address states the published tab", () => {
		expect(createViewFromSearch({ view: "published" })).toBe("published");
	});

	it("the address states the analytics tab", () => {
		expect(createViewFromSearch({ view: "analytics" })).toBe("analytics");
	});

	it("the address states the comments tab", () => {
		expect(createViewFromSearch({ view: "comments" })).toBe("comments");
	});
});

describe("validation", () => {
	it("passes values in the vocabulary", () => {
		expect(validateCreateSearch({ view: "published" })).toEqual({
			view: "published",
		});
		expect(validateCreateSearch({ view: "analytics" })).toEqual({
			view: "analytics",
		});
	});

	/**
	 * The default value is left out of the address, so `?view=drafts` and `/create` must be the same
	 * screen.
	 */
	it("the default tab is not kept in the address", () => {
		expect(validateCreateSearch({ view: "drafts" })).toEqual({});
	});

	/**
	 * A single typo in a hand-edited URL must not turn the whole workspace into an error screen. Only
	 * that parameter falls back to its default. `analytics` and `comments` were removed from this list
	 * when they entered the vocabulary. Their place is taken by values that must stay outside the
	 * vocabulary: a tab name that does not exist yet (`settings`) and a typo. If the list were empty,
	 * this test would protect nothing.
	 */
	it("an unknown value falls to the default tab", () => {
		expect(validateCreateSearch({ view: "settings" })).toEqual({});
		expect(validateCreateSearch({ view: "comment" })).toEqual({});
		expect(validateCreateSearch({ view: "analytic" })).toEqual({});
		expect(validateCreateSearch({ view: "Analytics" })).toEqual({});
		expect(validateCreateSearch({ view: 42 })).toEqual({});
		expect(validateCreateSearch({})).toEqual({});
	});

	/**
	 * Parameters carried over from other screens may be mixed in, so only this screen's parameters are
	 * read.
	 */
	it("unknown keys are ignored", () => {
		expect(validateCreateSearch({ q: "query", view: "published" })).toEqual({
			view: "published",
		});
	});
});

describe("tab → address", () => {
	it("only non-default tabs carry the axis", () => {
		expect(createSearchForView("published")).toEqual({ view: "published" });
		expect(createSearchForView("analytics")).toEqual({ view: "analytics" });
		expect(createSearchForView("comments")).toEqual({ view: "comments" });
		expect(createSearchForView("drafts")).toEqual({});
	});

	/** An address built by a link must parse back to the same tab (round-trip stability). */
	it("reading back a built address gives the same tab", () => {
		for (const view of CREATE_VIEWS) {
			// The router passes a loose object from before parsing, so the round trip reproduces that shape.
			const raw: Record<string, unknown> = { ...createSearchForView(view) };
			expect(createViewFromSearch(validateCreateSearch(raw))).toBe(view);
		}
	});
});

describe("links in the navigation row", () => {
	/**
	 * Link active state compares the search exactly. After the period is changed on the analytics tab,
	 * that tab must still point at the current address's search, or `aria-current` is lost.
	 */
	it("on the analytics tab the analytics link carries the current period", () => {
		const current = validateCreateSearch({ view: "analytics", window: "week" });
		expect(createSearchForNavigation("analytics", current)).toEqual(current);
		expect(
			createSearchForNavigation("analytics", { view: "analytics" }),
		).toEqual({ view: "analytics" });
	});

	it("other tabs' links and the analytics link from other tabs carry no period", () => {
		const onAnalytics = validateCreateSearch({
			view: "analytics",
			window: "week",
		});
		expect(createSearchForNavigation("published", onAnalytics)).toEqual({
			view: "published",
		});
		expect(createSearchForNavigation("drafts", onAnalytics)).toEqual({});
		expect(
			createSearchForNavigation("analytics", { view: "published" }),
		).toEqual({ view: "analytics" });
	});
});

describe("analytics window", () => {
	it("the window stays in the address only on the analytics tab", () => {
		expect(validateCreateSearch({ view: "analytics", window: "week" })).toEqual(
			{ view: "analytics", window: "week" },
		);
		// A window on another tab has no meaning, so it is folded out of the address.
		expect(validateCreateSearch({ view: "published", window: "week" })).toEqual(
			{ view: "published" },
		);
		expect(validateCreateSearch({ window: "week" })).toEqual({});
	});

	it("the default window folds out of the address, and an unknown window is the default", () => {
		expect(validateCreateSearch({ view: "analytics", window: "all" })).toEqual({
			view: "analytics",
		});
		expect(validateCreateSearch({ view: "analytics", window: "year" })).toEqual(
			{ view: "analytics" },
		);
		expect(analyticsWindowFromSearch({ view: "analytics" })).toBe("all");
		expect(
			analyticsWindowFromSearch({ view: "analytics", window: "day" }),
		).toBe("day");
	});

	it("an address with a chosen window stays on the analytics tab", () => {
		expect(createSearchForAnalyticsWindow("month")).toEqual({
			view: "analytics",
			window: "month",
		});
		expect(createSearchForAnalyticsWindow("all")).toEqual({
			view: "analytics",
		});
	});
});
