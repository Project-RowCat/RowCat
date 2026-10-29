/**
 * Gallery ranking weights; this file is the only source of them.
 *
 * Pure: no drizzle, no Postgres. Scattering the numbers across SQL strings would make "what does
 * popular count" a matter of reading `case when` in query files, and relevance and popular could
 * weigh the same word (favorite) differently.
 *
 * ## Relevance
 *
 * Tiers are summed. An exact title match must always beat a description brush (exact > prefix >
 * contains), and a title+tag match must beat a title-only match (hence a sum, not a product). Each
 * tier is sized so the tiers below it cannot add past it: tag, author and description together
 * (40+15+15+5=75) stay under a title prefix (80), because the title is the work's name. Ties fall
 * to newest then id (`services/story/index.ts`). No vector or semantic search here.
 *
 * ## Popular: only signals that are really recorded and mean the same in both playback modes
 *
 * ```text
 * uniquePlayStarter  people who ever started this work   (story_play_starter)
 * favorite           holders now / favorites added in a window   (favorite)
 * view               detail views folded to (story, viewer, UTC day)   (story_view_log)
 * ```
 *
 * The first signal counts people, not sessions. It used to be `story.play_starts`, whose unit
 * differs per mode (chat's session key is a local room id, so three rooms from one person count
 * three; runtime's is the library row identity, so reopening counts once). Adding those at one
 * weight biases the ranking toward chat works. A per-mode coefficient was rejected because it
 * writes today's usage pattern into business logic and goes stale. Telemetry did not change:
 * `story_play_log` still counts events and creator analytics' `playStarts` is still that number
 * (`services/creator-analytics.ts`).
 *
 * `downloads` is deliberately absent: the column, log and recorder exist but nothing live calls
 * them, and weighting a constant zero would only make it read as a signal.
 *
 * Favorite is heaviest (an explicit, reversible preference that is hard to inflate), starters next
 * (a real session but not a stated preference), views lightest. Values are integers so the SQL
 * stays in integer arithmetic.
 *
 * There is no time decay. The period windows (`day`, `week`, `month`) already cover that axis, and
 * decay over all time cannot be computed from cumulative counters without scanning the logs. Within
 * a window all three signals count what is new in that window (first-time starters, favorites
 * added, views); mixing "active in the window" for one of them would add two meanings in one
 * expression.
 */

/**
 * Relevance tiers; larger is earlier. `titleExact`, `titlePrefix` and `titleContains` are mutually
 * exclusive, as are the two tag tiers; the other three are independent and add.
 */
export const RELEVANCE_WEIGHTS = Object.freeze({
	titleExact: 100,
	titlePrefix: 80,
	titleContains: 60,
	tagExact: 40,
	tagContains: 25,
	creatorNickname: 15,
	author: 15,
	description: 5,
});

/** Popular weights (integers). `POPULAR_ADULT_DEMOTION` affects order only, never exposure. */
export const POPULAR_WEIGHTS = Object.freeze({
	/** Distinct members who started this work; not a session count. */
	uniquePlayStarter: 3,
	favorite: 4,
	view: 1,
});

/**
 * Adult popular-score demotion. The gate decides whether adult works are shown; this only keeps
 * them from dominating the top for viewers who turned display on.
 */
export const POPULAR_ADULT_DEMOTION = 0.2;

/**
 * Relevance score: the same formula the SQL computes, run on plain values. The server uses the SQL
 * in `services/story/index.ts`; this is its specification and the test reference, so weights are
 * read from the one table above. Case-insensitive, like the SQL's `ILIKE` and `lower()`.
 */
export interface RelevanceInput {
	title: string;
	tags: readonly string[];
	creatorNickname: string | null;
	author: string;
	description: string;
}

export function relevanceScore(term: string, row: RelevanceInput): number {
	const q = term.trim().toLowerCase();
	if (q === "") return 0;
	const title = row.title.toLowerCase();
	let score = 0;
	if (title === q) score += RELEVANCE_WEIGHTS.titleExact;
	else if (title.startsWith(q)) score += RELEVANCE_WEIGHTS.titlePrefix;
	else if (title.includes(q)) score += RELEVANCE_WEIGHTS.titleContains;

	const tags = row.tags.map((tag) => tag.toLowerCase());
	if (tags.some((tag) => tag === q)) score += RELEVANCE_WEIGHTS.tagExact;
	else if (tags.some((tag) => tag.includes(q)))
		score += RELEVANCE_WEIGHTS.tagContains;

	if (row.creatorNickname?.toLowerCase().includes(q))
		score += RELEVANCE_WEIGHTS.creatorNickname;
	if (row.author.toLowerCase().includes(q)) score += RELEVANCE_WEIGHTS.author;
	if (row.description.toLowerCase().includes(q))
		score += RELEVANCE_WEIGHTS.description;
	return score;
}

/** Popular score, same formula as the SQL; windowed counts and cumulative counters get the same weights. */
export function popularScore(input: {
	/** People, not events: putting `story.play_starts` here brings the playback-mode bias back. */
	uniquePlayStarters: number;
	favorites: number;
	views: number;
	adult: boolean;
}): number {
	const raw =
		input.uniquePlayStarters * POPULAR_WEIGHTS.uniquePlayStarter +
		input.favorites * POPULAR_WEIGHTS.favorite +
		input.views * POPULAR_WEIGHTS.view;
	return input.adult ? raw * POPULAR_ADULT_DEMOTION : raw;
}
