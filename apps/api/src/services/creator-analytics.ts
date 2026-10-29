import {
	type CreatorAnalyticsSummary,
	type CreatorAnalyticsWindow,
	type CreatorAnalyticsWork,
	creatorAnalyticsWindowStart,
	utcCalendarDay,
} from "@rowcat/domain";
import { and, desc, eq, gte, isNull, type SQL, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
	story,
	story_comment,
	story_play_log,
	story_view_log,
} from "../db/schema.ts";

/**
 * Creator analytics: how my works are being read.
 *
 * Metric meaning and window definition live in AGENTS.md (`### Analytics — creator metrics`) and
 * `@rowcat/domain`'s `creator-analytics.ts`; only what is silently violated when editing these
 * queries is kept here.
 *
 * - The predicate is `owner = :ownerId` and does not go through `galleryWhere`: that predicate
 *   asks "is it visible to this viewer", this screen asks "is it mine" (private, archived,
 *   operator-hidden and adult all included). It stays separate from `listOwnedStories` for the same
 *   reason; folding both behind a boolean would make every new axis shake both screens.
 * - Cumulative counters (`views`, `favorites`, `play_starts`) are authoritative on `story` and
 *   are not recounted; drift is fixed on the write path. Only in-window counts read the ledgers:
 *   the view ledger is cut by UTC date string, the play ledger by timestamp, both at the same UTC
 *   midnight (`creatorAnalyticsWindowStart`, `utcCalendarDay`, shared with discovery's popular
 *   ranking via `time-window.ts` so the two screens' last 7 days cannot count different days). For
 *   `all` no ledger is opened and the counters are the window values.
 * - Every derived table is narrowed by owner first; otherwise cost scales with the platform's
 *   whole event count instead of this creator's works.
 * - Totals cover all owned works, not the page, so the queries run in parallel (bounded by the
 *   owner narrowing; sequential would add the latencies).
 * - Conversion is not computed here: the domain's `playStartConversion` derives it from the two
 *   window values, and a server-sent ratio would add a second representation of a zero denominator
 *   (`null`) to the contract.
 */

export interface ReadCreatorAnalyticsOptions {
	/** Only the member the session resolved; no request body or query slot carries this value. */
	ownerId: string;
	window: CreatorAnalyticsWindow;
	page: number;
	pageSize: number;
	/** The clock that sets the window boundary; tests pin it. */
	now?: Date;
}

export interface CreatorAnalyticsResult {
	/** Window start; `null` for `all`. */
	since: Date | null;
	summary: CreatorAnalyticsSummary;
	items: CreatorAnalyticsWork[];
	total: number;
}

/** Analytics projection: does not select the play payload, cover, description, tags, owner id or downloads. */
const analyticsColumns = {
	id: story.id,
	title: story.title,
	visibility: story.visibility,
	hidden: story.hidden,
	views: story.views,
	favorites: story.favorites,
	playStarts: story.play_starts,
	updatedAt: story.updated_at,
};

export async function readCreatorAnalytics(
	opts: ReadCreatorAnalyticsOptions,
): Promise<CreatorAnalyticsResult> {
	const owned = eq(story.owner, opts.ownerId);
	const since = creatorAnalyticsWindowStart(
		opts.window,
		opts.now ?? new Date(),
	);

	/**
	 * Counts comments on this creator's works only; the inner join is the narrowing.
	 *
	 * The count is current non-deleted user utterances, and a reply is one of them: it is writing on
	 * this work with an author, and omitting replies would not answer "how much did people say about
	 * my work". So `parent_id` is not looked at (no separate reply metric either; nothing reads it,
	 * and splitting makes the sum need re-explaining).
	 *
	 * Tombstones are not counted: they have no body or author and only hold a thread slot, and
	 * counting them would keep deleted comments in the metric forever. `deleted_at is null` is that
	 * rule; dropping it silently inflates the number.
	 */
	const commentCounts = db
		.select({
			story_id: story_comment.story_id,
			n: sql<number>`count(*)`.as("comment_n"),
		})
		.from(story_comment)
		.innerJoin(story, eq(story.id, story_comment.story_id))
		.where(and(owned, isNull(story_comment.deleted_at)))
		.groupBy(story_comment.story_id)
		.as("comment_counts");

	/**
	 * In-window views and plays; not built for `all` (the window value is then the counter).
	 *
	 * The view ledger holds a date string, so `>=` compares lexically, and `YYYY-MM-DD` sorts
	 * chronologically. The play ledger holds timestamps and is cut at the same midnight.
	 */
	const viewWindow = since
		? db
				.select({
					story_id: story_view_log.story_id,
					n: sql<number>`count(*)`.as("view_window_n"),
				})
				.from(story_view_log)
				.innerJoin(story, eq(story.id, story_view_log.story_id))
				.where(and(owned, gte(story_view_log.day, utcCalendarDay(since))))
				.groupBy(story_view_log.story_id)
				.as("view_window")
		: null;
	const playWindow = since
		? db
				.select({
					story_id: story_play_log.story_id,
					n: sql<number>`count(*)`.as("play_window_n"),
				})
				.from(story_play_log)
				.innerJoin(story, eq(story.id, story_play_log.story_id))
				.where(and(owned, gte(story_play_log.created_at, since)))
				.groupBy(story_play_log.story_id)
				.as("play_window")
		: null;

	const windowViews: SQL<number> = viewWindow
		? sql<number>`coalesce(${viewWindow.n}, 0)`
		: sql<number>`${story.views}`;
	const windowPlayStarts: SQL<number> = playWindow
		? sql<number>`coalesce(${playWindow.n}, 0)`
		: sql<number>`${story.play_starts}`;

	const rowsQuery = db
		.select({
			...analyticsColumns,
			/**
			 * A work with no comments leaves the join empty (NULL), folded to 0: the contract wants an
			 * integer, and null would be indistinguishable from "unknown".
			 */
			comments: sql<number>`coalesce(${commentCounts.n}, 0)`.mapWith(Number),
			windowViews: windowViews.mapWith(Number),
			windowPlayStarts: windowPlayStarts.mapWith(Number),
		})
		.from(story)
		.leftJoin(commentCounts, eq(commentCounts.story_id, story.id))
		.$dynamic();
	if (viewWindow)
		rowsQuery.leftJoin(viewWindow, eq(viewWindow.story_id, story.id));
	if (playWindow)
		rowsQuery.leftJoin(playWindow, eq(playWindow.story_id, story.id));

	const [rows, storyAgg, commentAgg, windowAgg] = await Promise.all([
		rowsQuery
			.where(owned)
			/**
			 * Performance order is this screen's default (`updated_at` belongs to the management list). With
			 * a window chosen, that window's numbers set the order; ordering by all-time numbers would bury
			 * this week's reads under old hits.
			 *
			 * Without the last axis (`id desc`) rows with equal metrics duplicate and drop at page
			 * boundaries, and on an account where every metric is 0 that is every row.
			 */
			.orderBy(
				desc(windowViews),
				desc(windowPlayStarts),
				desc(story.favorites),
				desc(story.id),
			)
			.limit(opts.pageSize)
			.offset((opts.page - 1) * opts.pageSize),

		/**
		 * Totals across all owned works, not one page's sum. `sum()` is NULL with no works, folded to 0.
		 * The total count uses the same predicate so page count and row count agree.
		 */
		db
			.select({
				views: sql<number>`coalesce(sum(${story.views}), 0)`.mapWith(Number),
				favorites: sql<number>`coalesce(sum(${story.favorites}), 0)`.mapWith(
					Number,
				),
				playStarts: sql<number>`coalesce(sum(${story.play_starts}), 0)`.mapWith(
					Number,
				),
				total: sql<number>`count(*)`.mapWith(Number),
			})
			.from(story)
			.where(owned),

		/**
		 * The comment total is one owner-narrowed join, not per work. It must use the same predicate as
		 * above (tombstones excluded); otherwise the total and the per-row sum drift, visible only on
		 * accounts with many works.
		 */
		db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(story_comment)
			.innerJoin(story, eq(story.id, story_comment.story_id))
			.where(and(owned, isNull(story_comment.deleted_at))),

		/** Window totals: each ledger narrowed by owner and counted separately; not opened for `all`. */
		since
			? Promise.all([
					db
						.select({ n: sql<number>`count(*)`.mapWith(Number) })
						.from(story_view_log)
						.innerJoin(story, eq(story.id, story_view_log.story_id))
						.where(and(owned, gte(story_view_log.day, utcCalendarDay(since)))),
					db
						.select({ n: sql<number>`count(*)`.mapWith(Number) })
						.from(story_play_log)
						.innerJoin(story, eq(story.id, story_play_log.story_id))
						.where(and(owned, gte(story_play_log.created_at, since))),
				])
			: null,
	]);

	const agg = storyAgg[0];
	const views = agg?.views ?? 0;
	const playStarts = agg?.playStarts ?? 0;
	return {
		since,
		summary: {
			views,
			favorites: agg?.favorites ?? 0,
			comments: commentAgg[0]?.n ?? 0,
			playStarts,
			windowViews: windowAgg ? (windowAgg[0][0]?.n ?? 0) : views,
			windowPlayStarts: windowAgg ? (windowAgg[1][0]?.n ?? 0) : playStarts,
		},
		items: rows.map((row) => ({
			id: row.id,
			title: row.title,
			visibility: row.visibility,
			hidden: row.hidden,
			views: row.views,
			favorites: row.favorites,
			comments: row.comments,
			playStarts: row.playStarts,
			windowViews: row.windowViews,
			windowPlayStarts: row.windowPlayStarts,
			updatedAt: row.updatedAt.toISOString(),
		})),
		total: agg?.total ?? 0,
	};
}
