import { z } from "zod";
import { StoryVisibility } from "./publication.ts";

/**
 * Owner's view of their own works' performance, returned by GET /v2/me/creator-analytics. It is a
 * separate file from CreatorWorkDto (creator-work.ts) because the two endpoints answer different
 * questions:
 * - GET /v2/me/stories: which works does the server hold for me? (management)
 * - GET /v2/me/creator-analytics: how are those works being read? (performance)
 *
 * Metrics were not added to the works list. That list is read by every screen that shows works, and
 * publish invalidation is wired to it. Metrics have a different data cost and lifetime. Comment
 * counts add a join, and the values change through other people's actions without the owner doing
 * anything. One response would make the works manager run the aggregation every time it opens, and
 * refetching metrics would mean refetching the whole list.
 *
 * The three metrics have different natures:
 * - views: cumulative count of detail views, deduplicated by (work, viewer, UTC date). The
 *   owner's own views are not counted (recordView in services/social.ts).
 * - favorites: current state. It counts the members holding the work now, not cumulative events.
 * - comments: current state. Deleted comments are not counted. Showing the three side by side is
 *   honest because all are current absolute values. A time window would make that false. views has
 *   a log (story_view_log), but favorites and comments have no history, so 'favorites in the last 7
 *   days' cannot be answered. V1 therefore has no period, trend, or delta.
 *
 * Not included:
 * - downloads. The column, log table, and recordDownload exist, but no live code path calls it.
 *   Having a stored value is not a reason to make it a metric, and labelling 0 as `Play` or `Start conversation`
 *   would claim to measure something unmeasured.
 * - chatStarts. It is replaced by playStarts, which is not the 200 of /play. Starting a chat is
 *   GET /stories/:id/play, then creating a room in device IndexedDB, then navigating. The server
 *   cannot know whether the local step succeeded (storage can fail, and the account can change in
 *   between). Counting the 200 would overcount by an unknown amount. So the device reports an event
 *   after the local room or runtime session actually exists (story-telemetry.ts, POST
 *   /stories/:id/play-starts).
 * - Anything non-aggregated: no viewer identities, favoriters, commenters, comment text, play
 *   payloads, covers, descriptions, tags, owner id, or moderation reasons. This resource answers
 *   how many, not who.
 */

/**
 * Totals cover all works the viewer owns, not the page currently shown. Mixing the two would make
 * 'total views' grow each time 'load more' is pressed, and the user would read that as new views.
 * The server sums across every owned work and answers in one go.
 *
 * With no works all three are 0, not null. 'Unknown' is handled by not drawing anything on a failed
 * fetch. A 0 the server counted is a fact.
 */
/**
 * Period window. It applies only to views and play starts, the two metrics that have an event
 * ledger. The vocabulary and meaning match CREATOR_ANALYTICS_WINDOWS in @rowcat/domain, and a test
 * at the assembly point keeps them equal.
 */
export const CreatorAnalyticsWindow = z.enum(["all", "day", "week", "month"]);
export type CreatorAnalyticsWindow = z.infer<typeof CreatorAnalyticsWindow>;

export const CreatorAnalyticsSummary = z.object({
	views: z.number().int().nonnegative(),
	favorites: z.number().int().nonnegative(),
	comments: z.number().int().nonnegative(),
	/**
	 * Cumulative play starts. Counts events the device sends after it has actually created the local
	 * session (room or VM), not the 200 from /play. The owner's own plays are excluded. The count
	 * covers only the time since this ledger started; earlier plays were never recorded, so 0 is
	 * correct before then.
	 */
	playStarts: z.number().int().nonnegative(),
	/** Views counted inside the requested window. Same as views when window is all. */
	windowViews: z.number().int().nonnegative(),
	/** Play starts counted inside the window. Same as playStarts when window is all. */
	windowPlayStarts: z.number().int().nonnegative(),
});
export type CreatorAnalyticsSummary = z.infer<typeof CreatorAnalyticsSummary>;

/**
 * Owner projection of one work's performance, built from an allow-list. The status fields
 * (visibility, hidden) are included because metrics alone cannot explain a row. Zero views could
 * mean a public work nobody has seen yet, a private work that cannot be seen at all, or a work
 * hidden by an operator. These are different facts with different owner actions.
 *
 * Omitted: adult, promptProtected, and originDraftId. Authoring settings and the link to the draft
 * belong to the works management card; this screen draws no actions. Also omitted is why a work is
 * hidden, which lives in /v2/me/moderation.
 */
export const CreatorAnalyticsWorkDto = z.object({
	id: z.string(),
	title: z.string(),
	/** Owner-chosen exposure. Do not fold public and archived into a boolean. */
	visibility: StoryVisibility,
	/** Operator hide. An axis independent of the owner's visibility. */
	hidden: z.boolean(),

	views: z.number().int().nonnegative(),
	favorites: z.number().int().nonnegative(),
	comments: z.number().int().nonnegative(),
	/** Deduplicated by session identity. The owner's own plays are excluded. */
	playStarts: z.number().int().nonnegative(),
	windowViews: z.number().int().nonnegative(),
	windowPlayStarts: z.number().int().nonnegative(),

	/** ISO 8601. */
	updatedAt: z.iso.datetime(),
});
export type CreatorAnalyticsWorkDto = z.infer<typeof CreatorAnalyticsWorkDto>;

/**
 * Not shared with the works list's page size (20), even though both sit on the same screen. Row
 * height differs here (three metrics are added), and changing one page size gives no reason to move
 * the other.
 */
export const CREATOR_ANALYTICS_PAGE_SIZE = 24;
export const CREATOR_ANALYTICS_MAX_PAGE_SIZE = 100;

/**
 * Page number only. No sort, search, or status filter in V1. Most importantly, there is no slot for
 * a target member: no ownerId, memberId, creatorId, or viewerId. A caller that passes one is
 * blocked at the type level. The owner is always the member the session resolves.
 */
export const CreatorAnalyticsQuery = z.object({
	/**
	 * Window. A value outside the vocabulary is a 400. It is not silently mapped to the default,
	 * because that would make the screen draw a different window than the one requested.
	 */
	window: CreatorAnalyticsWindow.default("all"),
	page: z.number().int().min(1).default(1),
	pageSize: z
		.number()
		.int()
		.min(1)
		.max(CREATOR_ANALYTICS_MAX_PAGE_SIZE)
		.default(CREATOR_ANALYTICS_PAGE_SIZE),
});
export type CreatorAnalyticsQuery = z.infer<typeof CreatorAnalyticsQuery>;

export function toCreatorAnalyticsSearchParams(
	q: CreatorAnalyticsQuery,
): URLSearchParams {
	const sp = new URLSearchParams();
	if (q.window !== "all") sp.set("window", q.window);
	if (q.page !== 1) sp.set("page", String(q.page));
	if (q.pageSize !== CREATOR_ANALYTICS_PAGE_SIZE)
		sp.set("pageSize", String(q.pageSize));
	return sp;
}

/**
 * The summary repeats on every page, by design. Its value is the same whichever page arrives first,
 * because it sums across all owned works. The client therefore holds an authoritative total from
 * whichever response arrives first. A second endpoint for totals is not needed, and the screen
 * never has to sum the rows it has loaded.
 */
export const CreatorAnalyticsPage = z.object({
	/**
	 * The window this page counted. The server echoes the request so the screen does not have to
	 * remember it.
	 */
	window: CreatorAnalyticsWindow,
	/** Start of the window (UTC midnight). null when window is all. */
	since: z.iso.datetime().nullable(),
	summary: CreatorAnalyticsSummary,
	items: z.array(CreatorAnalyticsWorkDto),
	total: z.number().int().nonnegative(),
	page: z.number().int().min(1),
	pageSize: z.number().int().min(1),
	pageCount: z.number().int().min(1),
});
export type CreatorAnalyticsPage = z.infer<typeof CreatorAnalyticsPage>;
