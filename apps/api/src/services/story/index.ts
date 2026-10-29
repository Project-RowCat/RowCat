import {
	PROFILE_PINNED_STORY_LIMIT,
	RELATED_STORIES_LIMIT,
} from "@rowcat/contracts";
import {
	type CreatorWork,
	effectiveGallerySort,
	type Orientation,
	type Story,
	type StoryPeriod,
	type StoryPlayMode,
	type StorySort,
	type StoryVisibility,
	storyPeriodStart,
	utcCalendarDay,
} from "@rowcat/domain";
import {
	and,
	asc,
	desc,
	eq,
	exists,
	gt,
	gte,
	ilike,
	isNull,
	ne,
	notInArray,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { type Db, db } from "../../db/client.ts";
import {
	favorite,
	follow,
	member,
	profile_pinned_story,
	story,
	story_cover,
	story_play_starter,
	story_runtime,
	story_view_log,
} from "../../db/schema.ts";
import { publicApiUrl } from "../../env.ts";
import { containsPattern, prefixPattern } from "../../lib/like.ts";
import {
	POPULAR_ADULT_DEMOTION,
	POPULAR_WEIGHTS,
	RELEVANCE_WEIGHTS,
} from "./ranking.ts";

export interface GallerySelector {
	orientation: Orientation | null;
	/** true: adult only; false: all-ages only; null: any rating. */
	adult: boolean | null;
	search: string;
	/**
	 * Only stories carrying exactly this tag (`@>`); `null` means no axis. Substring matching would
	 * let `night` match `rewinds the night`, so someone who tapped a tag on the detail would see other stories.
	 * Normalization is trim only, the same as publication's `normalizeTags` (`@rowcat/authoring`);
	 * folding more would split the screen's tag from the server's.
	 */
	tag: string | null;
	/** Viewer member.id: the axis separating own private and own adult stories. */
	viewerId: string | null;
	/**
	 * Whether the viewer's own private stories are included. Not derived from `viewerId`: the gallery
	 * and single lookups show them, but the public profile grid must not, or the owner could not check
	 * how their profile looks to others. Required at every call site; an optional default would fall
	 * on the permissive side (a leak) when a new caller forgets.
	 */
	ownPrivateVisible: boolean;
	/**
	 * Whether unlisted stories are included: the axis separating discovery from viewing. Lists,
	 * search, popular, the following feed and public profiles exclude them; single-story paths
	 * (detail, cover, comments, reports, playback entitlement) open them like public ones. Not derived
	 * from the viewer: guests can open an unlisted detail and members never see it in the gallery, so
	 * what splits is what the query asks. Required at every call site, since either wrong default
	 * fails silently (leaking into the gallery, or a 404 for people with the address).
	 */
	unlistedVisible: boolean;
	adultAllowed: boolean;
	/**
	 * Whether the viewer may see their own adult stories regardless of the display opt-in.
	 * `adultAllowed` includes the `show_adult` viewing preference; this looks only at the legal
	 * requirement (verification + age 19), the same axis as publication
	 * (`services/story/publication.ts`). With one axis, a verified member with display off would
	 * publish an adult story successfully and then get a 404 opening it. Not enabled for lists: the
	 * gallery pushes ratings at people, so the display setting must stand; only single-story paths
	 * reached by address (detail, playback, cover) use it.
	 */
	ownAdultAllowed: boolean;
	blocked: string[];
	/** Only stories this member favorited. */
	favoritedBy: string | null;
	/** Only stories by creators this member follows. */
	followingOf: string | null;
	/** Only this creator's stories (public profile grid). */
	creatorId: string | null;
}

/**
 * The exposure boundary: visibility, orientation, rating, blocks, creator, search and feed filters.
 * List and total must use the same predicate so page counts match rows, and a missing condition
 * here leaks stories that should be hidden.
 *
 * Favorites and the following feed use EXISTS rather than joins: with joins the list and total
 * queries would each write the join, and fixing one would silently empty the last page or inflate
 * the total with HTTP 200. Postgres plans EXISTS as a semi-join, so cost is the same.
 */
function galleryWhere(sel: GallerySelector): SQL {
	/**
	 * Visibility is built as an allowlist. A negation like `visibility <> 'archived'` would let a new
	 * vocabulary value fall on the passing side; an allowlist leaves a new state invisible, which is
	 * not a leak.
	 *
	 * ```text
	 * public     always
	 * unlisted   only when unlistedVisible (single-story paths)
	 * private    owner + ownPrivateVisible (false for the public profile grid)
	 * archived   nowhere, even for the owner
	 * ```
	 */
	const visible: SQL[] = [eq(story.visibility, "public")];
	// Unlisted is true only on paths opened by address; discovery surfaces have this axis false, so
	// those stories are never fetched rather than filtered on screen.
	if (sel.unlistedVisible) visible.push(eq(story.visibility, "unlisted"));
	// Private opens only to the owner, and only where that screen shows their own stories.
	if (sel.viewerId && sel.ownPrivateVisible)
		visible.push(
			and(
				eq(story.visibility, "private"),
				eq(story.owner, sel.viewerId),
			) as SQL,
		);

	const conditions: (SQL | undefined)[] = [
		eq(story.hidden, false),
		// A single branch: or() returns it unchanged.
		visible.length === 1 ? visible[0] : (or(...visible) as SQL),
	];

	if (sel.orientation) conditions.push(eq(story.orientation, sel.orientation));
	if (sel.adult !== null) conditions.push(eq(story.adult, sel.adult));
	/**
	 * Viewers who cannot see adult content get them excluded regardless of the rating filter (legal
	 * gate + display opt-in). Only own stories escape, and only with the legal requirement
	 * (`ownAdultAllowed`): ownership does not replace verification.
	 */
	if (!sel.adultAllowed)
		conditions.push(
			sel.ownAdultAllowed && sel.viewerId
				? or(eq(story.adult, false), eq(story.owner, sel.viewerId))
				: eq(story.adult, false),
		);
	/**
	 * Excludes blocked creators' stories but not ownerless ones. `NULL NOT IN (…)` is NULL, not false,
	 * so without `isNull` a public story whose identity was erased by account deletion would vanish
	 * from the gallery for any viewer who blocked anyone.
	 */
	if (sel.blocked.length)
		conditions.push(
			or(isNull(story.owner), notInArray(story.owner, sel.blocked)),
		);
	if (sel.creatorId) conditions.push(eq(story.owner, sel.creatorId));

	if (sel.favoritedBy)
		conditions.push(
			exists(
				db
					.select({ x: sql`1` })
					.from(favorite)
					.where(
						and(
							eq(favorite.story_id, story.id),
							eq(favorite.member_id, sel.favoritedBy),
						),
					),
			),
		);

	if (sel.followingOf)
		conditions.push(
			exists(
				db
					.select({ x: sql`1` })
					.from(follow)
					.where(
						and(
							eq(follow.creator, story.owner),
							eq(follow.follower, sel.followingOf),
						),
					),
			),
		);

	// Array containment, served by the GIN index `idx_story_tags`; the value is one bind parameter.
	const tag = sel.tag?.trim() ?? "";
	if (tag) conditions.push(sql`${story.tags} @> array[${tag}]::text[]`);

	const search = sel.search.trim();
	if (search) {
		// ILIKE '%q%' cannot use btree; the GIN pg_trgm index serves it. `%`, `_` and `\` are user input
		// and are escaped (otherwise a lone `%` matches everything).
		const like = containsPattern(search);
		conditions.push(
			or(
				ilike(story.title, like),
				ilike(story.author, like),
				ilike(story.description, like),
				ilike(member.nickname, like),
				/**
				 * Tags are searched too. Substring match over array elements cannot use an index, but this OR
				 * already scans all candidates, and tags are capped (`STORY_PUBLISH_LIMITS.tags`), so per-row
				 * cost is bounded.
				 */
				tagMatches(like),
			),
		);
	}

	// At least two conditions, so and() always returns SQL.
	return and(...conditions) as SQL;
}

/** Whether any tag matches the pattern; the search predicate and relevance score share this expression. */
const tagMatches = (like: string): SQL =>
	sql`exists (select 1 from unnest(${story.tags}) as story_tag(value) where story_tag.value ilike ${like})`;

/** Whether any tag equals the term exactly, ignoring case. */
const tagEquals = (term: string): SQL =>
	sql`exists (select 1 from unnest(${story.tags}) as story_tag(value) where lower(story_tag.value) = lower(${term}))`;

/**
 * Relevance score. Weights live in `ranking.ts`; this only translates them to SQL.
 *
 * Title (exact, prefix, contains) and tag (exact, contains) are exclusive `case` tiers; the rest
 * add independently. Everything derives deterministically from the row, so the same query gives the
 * same order; page-boundary duplicates and gaps are prevented by that plus the `created_at desc, id
 * desc` tail. The pure `relevanceScore` is the same formula, and `stories-search.test.ts` plus the
 * single weight table keep the two from diverging.
 */
function relevanceExpression(term: string): SQL {
	const like = containsPattern(term);
	const prefix = prefixPattern(term);
	const w = RELEVANCE_WEIGHTS;
	return sql`(
		(case
			when lower(${story.title}) = lower(${term}) then ${w.titleExact}
			when ${story.title} ilike ${prefix} then ${w.titlePrefix}
			when ${story.title} ilike ${like} then ${w.titleContains}
			else 0 end)
		+ (case
			when ${tagEquals(term)} then ${w.tagExact}
			when ${tagMatches(like)} then ${w.tagContains}
			else 0 end)
		+ (case when ${member.nickname} ilike ${like} then ${w.creatorNickname} else 0 end)
		+ (case when ${story.author} ilike ${like} then ${w.author} else 0 end)
		+ (case when ${story.description} ilike ${like} then ${w.description} else 0 end)
	)`;
}

/** The transaction handle type drizzle passes to the callback. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Start cutoff of a period popularity sort; `all` has none.
 *
 * The boundary belongs to `@rowcat/domain` (`storyPeriodStart` → `calendarWindowStart`). This used
 * to be `Date.now() - 7 × 86400000` under the label `This week`, counting neither a rolling 168 hours
 * nor an ISO week, and the view ledger's UTC-day resolution cannot honour a timestamp cutoff
 * anyway. It now shares a function with creator analytics' window, so the two screens' `Last 7 days`
 * cannot count different days.
 */
function periodCutoff(period: StoryPeriod, now: Date): Date | null {
	return storyPeriodStart(period, now);
}

/**
 * Cover URL; `?v=` is the content identity of the cover bytes (`story_cover.version`).
 *
 * It used to be `story.updated_at`, which relied on two tables being written in one transaction and
 * served different bytes at the same immutable URL when a cover was replaced twice in one
 * millisecond. The version is now derived from the bytes (`db/tables/story.ts`). The cover route
 * adds `immutable` only after comparing the request's `v` with the current version
 * (`routes/stories/cover.ts`).
 */
const coverUrl = (id: string, version: string): string =>
	`${publicApiUrl}/stories/${encodeURIComponent(id)}/cover?v=${version}`;

/** Projection shared by list and detail. Cover bytes are never selected, only existence. */
const storyColumns = {
	id: story.id,
	title: story.title,
	description: story.description,
	author: story.author,
	orientation: story.orientation,
	adult: story.adult,
	visibility: story.visibility,
	promptProtected: story.prompt_protected,
	tags: story.tags,
	/** Public aggregate. The viewer's own relation (did I save it) is answered by /me/state. */
	favorites: story.favorites,
	creatorId: story.owner,
	creatorNickname: member.nickname,
	createdAt: story.created_at,
	updatedAt: story.updated_at,
	sizeBytes: story.size_bytes,
	/**
	 * How the story plays, the single source. The authority is the existence of a runtime publication
	 * row, which only the server knows; a guess from device authoring files is wrong on another device
	 * or account, and the symptom is a primary action that does nothing.
	 *
	 * `EXISTS` because joining the artifact column would drag two dozen artifacts (in TOAST) into one
	 * list page; this predicate reads only the primary key index. Compatibility is not asked here:
	 * whether this device can run the artifact is a playback question, and folding it in would make
	 * one story look like different products to different people.
	 */
	playMode: sql<StoryPlayMode>`case when exists (select 1 from ${story_runtime} where ${story_runtime.story_id} = ${story.id}) then 'runtime' else 'chat' end`,
	/** Non-null means a cover exists and the value is the cover URL's version. No bytea is selected, so TOAST is not read. */
	coverVersion: story_cover.version,
};

/** Keeps the leftJoin columns' nullability in the type; inference would drift silently when the join changes. */
interface StoryRow {
	id: string;
	title: string;
	description: string;
	author: string;
	orientation: Orientation | null;
	adult: boolean;
	visibility: StoryVisibility;
	promptProtected: boolean;
	tags: string[];
	favorites: number;
	/** Null when identity was erased by account deletion (`story.owner`). */
	creatorId: string | null;
	creatorNickname: string | null;
	createdAt: Date;
	updatedAt: Date;
	sizeBytes: number;
	playMode: StoryPlayMode;
	coverVersion: string | null;
}

/**
 * DB row to product value. The service does not build the HTTP representation (StoryDto): the DB
 * layer would then know the outer protocol, and contract changes would reach query files. The route
 * shapes the response.
 */
function toStory(row: StoryRow): Story {
	return {
		id: row.id,
		title: row.title,
		description: row.description,
		author: row.author,
		coverUrl: row.coverVersion ? coverUrl(row.id, row.coverVersion) : null,
		orientation: row.orientation,
		adult: row.adult,
		visibility: row.visibility,
		promptProtected: row.promptProtected,
		tags: row.tags,
		favorites: row.favorites,
		/**
		 * No owner means no creator. No placeholder such as an empty string or "deleted member" is
		 * invented, since the screen would draw it as a profile link and re-link the erased identity.
		 */
		creator: row.creatorId
			? { id: row.creatorId, nickname: row.creatorNickname ?? "" }
			: null,
		playMode: row.playMode,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		sizeBytes: row.sizeBytes,
	};
}

export interface ListStoriesOptions extends GallerySelector {
	sort: StorySort;
	period: StoryPeriod;
	page: number;
	pageSize: number;
	/**
	 * Clock for the period window boundary; tests fix it (creator analytics has the same shape). Not
	 * part of cache identity: the boundary moves once a day at UTC midnight and the guest cache lives
	 * 30 seconds, so a stale value cannot outlive it.
	 */
	now?: Date;
}

/**
 * One page plus the total. The total is counted so clients know when to stop infinite scroll; both
 * queries run in parallel to avoid adding latency.
 *
 * Both must use the same `where`: written separately, stories filtered by adult, block or private
 * would drop from the list but stay in the total, leaking "there are more you cannot see".
 */
export async function listStories(
	opts: ListStoriesOptions,
): Promise<{ items: Story[]; total: number }> {
	const where = galleryWhere(opts);
	const [rows, total] = await Promise.all([
		selectPage(opts, where),
		countStories(where),
	]);
	return { items: rows.map(toStory), total };
}

async function selectPage(
	opts: ListStoriesOptions,
	where: SQL,
): Promise<StoryRow[]> {
	/** A relevance sort without a query is recency; the folding rule is domain's. */
	const sort = effectiveGallerySort({ sort: opts.sort, query: opts.search });
	const cutoff =
		sort === "popular"
			? periodCutoff(opts.period, opts.now ?? new Date())
			: null;

	/**
	 * Period window aggregates join per-story pre-folded subqueries. A correlated subquery in ORDER BY
	 * would rescan the logs per candidate, and LIMIT does not help since sorting needs every
	 * candidate's score.
	 *
	 * The three ledgers are not joined in one subquery: joining logs together multiplies rows and
	 * inflates counts (10 plays x 5 favorites = 50), and distinct would fold two same-time events.
	 * Fold each, then attach.
	 *
	 * Only three signals are actually recorded and mean the same in both playback modes: starters,
	 * favorites, views; weights live in `ranking.ts`. `downloads` is absent on purpose: nothing live
	 * writes it, so it was always 0, and weighting zero changes nothing while reading as if downloads
	 * affected popularity. The first signal is `story_play_starter` (people), not `story_play_log`
	 * (events), because session keys mean different things per playback mode and adding event counts
	 * would bias the ranking (see the header of `ranking.ts`).
	 *
	 * The cutoff is UTC midnight so all three ledgers count the same days: the view ledger is a date
	 * string compared as `day >= YYYY-MM-DD` (lexicographic order is time order), and the two
	 * timestamp ledgers use that midnight directly.
	 */
	const playWindow = cutoff
		? db
				.select({
					story_id: story_play_starter.story_id,
					n: sql<number>`count(*)`.as("play_n"),
				})
				.from(story_play_starter)
				.where(gte(story_play_starter.first_started_at, cutoff))
				.groupBy(story_play_starter.story_id)
				.as("play_window")
		: null;
	const favoriteWindow = cutoff
		? db
				.select({
					story_id: favorite.story_id,
					n: sql<number>`count(*)`.as("favorite_n"),
				})
				.from(favorite)
				.where(gte(favorite.created_at, cutoff))
				.groupBy(favorite.story_id)
				.as("favorite_window")
		: null;
	const viewWindow = cutoff
		? db
				.select({
					story_id: story_view_log.story_id,
					n: sql<number>`count(*)`.as("view_n"),
				})
				.from(story_view_log)
				.where(gte(story_view_log.day, utcCalendarDay(cutoff)))
				.groupBy(story_view_log.story_id)
				.as("view_window")
		: null;

	// The adult demotion multiplies the score: it reorders but never decides exposure.
	const demotion = sql`(case when ${story.adult} then ${POPULAR_ADULT_DEMOTION}::numeric else 1 end)`;
	const w = POPULAR_WEIGHTS;
	const score =
		playWindow && favoriteWindow && viewWindow
			? sql`(coalesce(${playWindow.n}, 0) * ${w.uniquePlayStarter} + coalesce(${favoriteWindow.n}, 0) * ${w.favorite} + coalesce(${viewWindow.n}, 0) * ${w.view}) * ${demotion}`
			: sql`(${story.unique_play_starters} * ${w.uniquePlayStarter} + ${story.favorites} * ${w.favorite} + ${story.views} * ${w.view}) * ${demotion}`;

	const query = db
		.select(storyColumns)
		.from(story)
		.leftJoin(member, eq(member.id, story.owner))
		.leftJoin(story_cover, eq(story_cover.story_id, story.id))
		.$dynamic();

	if (playWindow && favoriteWindow && viewWindow) {
		query.leftJoin(playWindow, eq(playWindow.story_id, story.id));
		query.leftJoin(favoriteWindow, eq(favoriteWindow.story_id, story.id));
		query.leftJoin(viewWindow, eq(viewWindow.story_id, story.id));
	}

	const relevance =
		sort === "relevance" ? relevanceExpression(opts.search.trim()) : null;

	return query
		.where(where)
		.orderBy(
			/**
			 * Known limitation: paging is offset-based, so live score movement can shift a boundary row.
			 * Within one snapshot the order is fully deterministic (score, newest, id), but a favorite
			 * landing between page 1 and page 2 can push a row past the offset and show it twice or never.
			 * Closing it needs a cursor carrying the score or a ranking snapshot session, neither worth
			 * building at this scale. Do not drop the tail axes: without them equal-score rows duplicate and
			 * drop at boundaries even when nothing moves.
			 */
			...(sort === "popular" ? [desc(score)] : []),
			...(relevance ? [desc(relevance)] : []),
			desc(story.created_at),
			desc(story.id),
		)
		.limit(opts.pageSize)
		.offset((opts.page - 1) * opts.pageSize);
}

/**
 * Counts with the same predicate as the list. Sorting does not affect the total, so the popular
 * score joins are omitted; the member join stays because search references the nickname (it is a
 * leftJoin, so the row count is unchanged).
 */
async function countStories(where: SQL): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(story)
		.leftJoin(member, eq(member.id, story.owner))
		.where(where);
	return row?.n ?? 0;
}

/**
 * Single lookup with exactly the list's exposure boundary. Knowing a story id must not be
 * authorization, so the gate is in the query predicate rather than filtered later in the route.
 */
export async function getStory(
	id: string,
	sel: Omit<GallerySelector, "favoritedBy" | "followingOf" | "creatorId">,
): Promise<Story | null> {
	const where = galleryWhere({
		...sel,
		favoritedBy: null,
		followingOf: null,
		creatorId: null,
	});
	const [row] = await db
		.select(storyColumns)
		.from(story)
		.leftJoin(member, eq(member.id, story.owner))
		.leftJoin(story_cover, eq(story_cover.story_id, story.id))
		.where(and(eq(story.id, id), where))
		.limit(1);
	return row ? toStory(row) : null;
}

/**
 * Related stories: those sharing tags with this one, then the same creator's.
 *
 * No vectors or embeddings; a deterministic score from signals the repository already has:
 *
 * ```text
 * each shared tag    RELATED_TAG_WEIGHT       strongest: the creator's own words overlap
 * same creator       RELATED_CREATOR_WEIGHT   weaker than one tag
 * favorites, plays   tie tail                 popularity orders but never creates relatedness
 * newest, id         deterministic tail
 * ```
 *
 * Score 0 is excluded: drawing merely popular stories as "related" would duplicate the discovery
 * screen. A story with no tags and no creator has none, which is an empty array (the screen draws
 * no section).
 *
 * The exposure boundary is the discovery predicate (`galleryWhere`): own private stories are
 * included; unlisted, archived, operator-hidden, blocked and adult gates stand. The source's tags
 * and creator were read by a caller that already passed the viewing gate (the route calls
 * `getStory` first); re-reading the source here would let an unviewable story's tags open related
 * stories. One query: the tags go in as one bound array and `unnest` counts overlap per candidate.
 */
const RELATED_TAG_WEIGHT = 10;
const RELATED_CREATOR_WEIGHT = 3;

export interface RelatedStoriesInput {
	/** The source: three values of a `Story` the caller read through the viewing gate. */
	source: { id: string; tags: readonly string[]; creatorId: string | null };
	selector: GallerySelector;
}

export async function listRelatedStories(
	input: RelatedStoriesInput,
): Promise<Story[]> {
	const { source, selector } = input;
	if (source.tags.length === 0 && source.creatorId === null) return [];

	// Tags bind as an `array[$1, $2, …]::text[]` literal: a JS array would expand to a tuple `($1,
	// $2)` that `any()` rejects (the tag filter in `galleryWhere` has the same shape).
	const tagArray = sql`array[${sql.join(
		source.tags.map((value) => sql`${value}`),
		sql`, `,
	)}]::text[]`;
	const sharedTags =
		source.tags.length === 0
			? sql<number>`0`
			: sql<number>`(select count(*) from unnest(${story.tags}) as story_tag(value) where story_tag.value = any(${tagArray}))`;
	const sameCreator =
		source.creatorId === null
			? sql<number>`0`
			: sql<number>`(case when ${story.owner} = ${source.creatorId} then 1 else 0 end)`;
	const score = sql<number>`(${sharedTags} * ${RELATED_TAG_WEIGHT} + ${sameCreator} * ${RELATED_CREATOR_WEIGHT})`;

	const rows = await db
		.select(storyColumns)
		.from(story)
		.leftJoin(member, eq(member.id, story.owner))
		.leftJoin(story_cover, eq(story_cover.story_id, story.id))
		.where(and(galleryWhere(selector), ne(story.id, source.id), gt(score, 0)))
		.orderBy(
			desc(score),
			desc(story.favorites),
			desc(story.unique_play_starters),
			desc(story.created_at),
			desc(story.id),
		)
		.limit(RELATED_STORIES_LIMIT);
	return rows.map(toStory);
}

/**
 * Pinned works: what the creator pinned atop their profile, in pinned order.
 *
 * The exposure boundary is the public profile grid's selector (`galleryWhere`; callers pass the
 * grid's axes). Pinning decides only what stands first, not what is visible: works turned private,
 * operator-hidden, above the viewer's rating gate or by a blocked creator drop out even if pinned,
 * with no placeholder, since a gap would reveal the hidden work's existence.
 *
 * `creatorId` in the predicate (`story.owner = :creatorId`) is the second point: a pin row links a
 * member and a story but does not prove ownership, so a story whose owner was detached is no longer
 * theirs and must not stand atop their profile.
 */
export async function listPinnedStories(
	creatorId: string,
	selector: Omit<GallerySelector, "creatorId">,
): Promise<Story[]> {
	const rows = await db
		.select(storyColumns)
		.from(profile_pinned_story)
		.innerJoin(story, eq(story.id, profile_pinned_story.story_id))
		.leftJoin(member, eq(member.id, story.owner))
		.leftJoin(story_cover, eq(story_cover.story_id, story.id))
		.where(
			and(
				eq(profile_pinned_story.member_id, creatorId),
				galleryWhere({ ...selector, creatorId }),
			),
		)
		.orderBy(asc(profile_pinned_story.position))
		.limit(PROFILE_PINNED_STORY_LIMIT);
	return rows.map(toStory);
}

/**
 * The creator's own pinned works, including ones not visible on the profile now, in pinned order.
 *
 * It differs from the function above because the owner must know about pins they turned private: a
 * pin occupying a slot yet absent from the editor would read as "three allowed but only two
 * choosable". So it skips `galleryWhere` and reads the owner projection (`creatorWorkColumns`), the
 * same question as `listOwnedStories` ("is it mine"). The predicate still requires `story.owner =
 * :ownerId`, so a pin on a story with detached ownership disappears here too and the next pin
 * replaces it. The executor lets a write transaction re-read its result; reading after commit would
 * return another device's interleaved write as "just saved".
 */
export async function listOwnPinnedWorks(
	ownerId: string,
	executor: Db | Tx = db,
): Promise<CreatorWork[]> {
	const rows = await executor
		.select(creatorWorkColumns)
		.from(profile_pinned_story)
		.innerJoin(
			story,
			and(
				eq(story.id, profile_pinned_story.story_id),
				eq(story.owner, ownerId),
			),
		)
		.leftJoin(story_cover, eq(story_cover.story_id, story.id))
		.where(eq(profile_pinned_story.member_id, ownerId))
		.orderBy(asc(profile_pinned_story.position));
	return rows.map(toCreatorWork);
}

/**
 * One of the owner's own stories, without the viewing gate.
 *
 * Kept apart from `getStory`, whose predicate asks "is it visible to this viewer" including the
 * adult display opt-in: re-reading right after publishing would give a verified member with display
 * off a 404 on their own adult story (write succeeded, response failed). This is a different
 * authorization, not a skipped one: ownership, pinned in the predicate (`owner = :ownerId`). Hidden
 * and archived states are visible to the owner so they can learn why the story is not in the
 * gallery.
 */
export async function getOwnedStory(
	id: string,
	ownerId: string,
	/**
	 * Pass to read inside a transaction. Cover writes use it so the response reports the state they
	 * just wrote; a read after commit would present someone else's interleaved change as this
	 * operation's result.
	 */
	executor: Db | Tx = db,
): Promise<Story | null> {
	const [row] = await executor
		.select(storyColumns)
		.from(story)
		.leftJoin(member, eq(member.id, story.owner))
		.leftJoin(story_cover, eq(story_cover.story_id, story.id))
		.where(and(eq(story.id, id), eq(story.owner, ownerId)))
		.limit(1);
	return row ? toStory(row) : null;
}

/**
 * The playback payload is not in this file; `services/story/playback.ts` owns it.
 *
 * Two readers once lived here (the catalogue predicate and the ownership row), and the route
 * calling the first before falling back to the second was a payment bypass: the whole scenario went
 * to anyone for a public story. Paid ownership is gone and the predicates agree again, but the
 * function is not revived here: with the decision in two places, one of `/play`, protected
 * generation and telemetry would eventually see a different rule.
 */

/**
 * Cover bytes. Call only after the caller already decided exposure with `getStory`.
 *
 * Returning `version` is the whole cache contract: the route builds the ETag from it and compares
 * the request's `?v=` to decide whether to add `immutable`. The bytes are not re-hashed because
 * that hash is already this column (no SHA-256 over hundreds of KB per request).
 */
export async function getCover(
	id: string,
): Promise<{ bytes: Buffer; mime: string; version: string } | null> {
	const [row] = await db
		.select({
			bytes: story_cover.bytes,
			mime: story_cover.mime,
			version: story_cover.version,
		})
		.from(story_cover)
		.where(eq(story_cover.story_id, id))
		.limit(1);
	return row ?? null;
}

/**
 * One story for an operator, without the exposure gate.
 *
 * Kept apart from `getStory` for the same reason as `getOwnedStory`: that predicate asks whether
 * the story is visible to a viewer, and applying it to a moderator reviewing a report would make an
 * already hidden story vanish from the screen opened to decide whether to unhide it. A different
 * authorization, not a skipped one: only routes that passed `requireModeratorViewer` call this. The
 * playback payload is not selected; operators judge on title, description, rating and state, not
 * the whole scenario.
 */
export interface ModerationStoryView {
	id: string;
	title: string;
	description: string;
	adult: boolean;
	hidden: boolean;
	visibility: StoryVisibility;
	ownerId: string | null;
	updatedAt: Date;
}

export async function getStoryForModeration(
	id: string,
): Promise<ModerationStoryView | null> {
	const [row] = await db
		.select({
			id: story.id,
			title: story.title,
			description: story.description,
			adult: story.adult,
			hidden: story.hidden,
			visibility: story.visibility,
			ownerId: story.owner,
			updatedAt: story.updated_at,
		})
		.from(story)
		.where(eq(story.id, id))
		.limit(1);
	return row ?? null;
}

/**
 * Turns operator hiding on or off without touching `visibility`.
 *
 * The single column in `set` is the policy: the creator's visibility choice and operator hiding are
 * separate axes (`db/tables/story.ts` header), and any line resetting `visibility` to `public` on
 * unhide would publish a story the creator had made private. `updated_at` is untouched too: it is
 * the creator's edit axis and cover cache buster, so an operator action moving it would invalidate
 * every viewer's cover cache for no reason.
 *
 * The owner is returned for the action record: `target_member` of a story hide is its owner, which
 * the appeal ownership check needs (ownerless stories have null, so nobody can appeal).
 */
export async function setStoryHidden(
	tx: Tx,
	storyId: string,
	hidden: boolean,
): Promise<{ ownerId: string | null } | null> {
	const [row] = await tx
		.update(story)
		.set({ hidden })
		.where(eq(story.id, storyId))
		.returning({ ownerId: story.owner });
	return row ?? null;
}

/**
 * The member's own stories, without `galleryWhere`.
 *
 * Reusing `listStories` with axes like `includeHidden` or `ignoreAdultPreference` was rejected:
 * that predicate asks whether the story is visible to a viewer, this screen asks whether it is
 * mine, and every added boolean would shake the discovery path's exposure boundary, showing up on
 * other people's screens. List and count share `owner = :ownerId`, so they cannot diverge.
 *
 * ```text
 * adult opt-in   managing my work is not a discovery feed; hiding my own story because display
 *                is off would leave no way to edit it
 * blocks         one cannot block oneself (services/social.ts)
 * hidden         the owner must learn why the story is not in the gallery
 * archived       "out of lists, not deleted"
 * ```
 *
 * This does not loosen exposure: the list draws only titles and states, and the paths that open a
 * story (detail, playback, cover) still go through `galleryWhere`. Ordering is `updated_at desc, id
 * desc`; without the second axis two rows updated in the same millisecond would duplicate or drop
 * at page boundaries.
 */
export interface ListOwnedStoriesOptions {
	/** Session-resolved member only; the request has no slot for it. */
	ownerId: string;
	page: number;
	pageSize: number;
}

/**
 * Owner projection; does not select the playback payload, counters, description or tags. Only the
 * cover URL's 32-character version is joined, never `bytes`, or opening the management screen would
 * download every cover (the gallery projection keeps the same rule).
 */
const creatorWorkColumns = {
	id: story.id,
	originDraftId: story.origin_draft_id,
	title: story.title,
	visibility: story.visibility,
	adult: story.adult,
	promptProtected: story.prompt_protected,
	hidden: story.hidden,
	coverVersion: story_cover.version,
	createdAt: story.created_at,
	updatedAt: story.updated_at,
};

interface CreatorWorkRow {
	id: string;
	originDraftId: string | null;
	title: string;
	visibility: StoryVisibility;
	adult: boolean;
	promptProtected: boolean;
	hidden: boolean;
	/** Null without a cover (left join). */
	coverVersion: string | null;
	createdAt: Date;
	updatedAt: Date;
}

/** Owner-projection row to `CreatorWork`; my works and my pinned works share it. */
const toCreatorWork = (row: CreatorWorkRow): CreatorWork => ({
	id: row.id,
	originDraftId: row.originDraftId,
	title: row.title,
	visibility: row.visibility,
	adult: row.adult,
	promptProtected: row.promptProtected,
	hidden: row.hidden,
	coverUrl: row.coverVersion ? coverUrl(row.id, row.coverVersion) : null,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
});

export async function listOwnedStories(
	opts: ListOwnedStoriesOptions,
): Promise<{ items: CreatorWork[]; total: number }> {
	const where = eq(story.owner, opts.ownerId);
	const [rows, countRows] = await Promise.all([
		db
			.select(creatorWorkColumns)
			.from(story)
			.leftJoin(story_cover, eq(story_cover.story_id, story.id))
			.where(where)
			.orderBy(desc(story.updated_at), desc(story.id))
			.limit(opts.pageSize)
			.offset((opts.page - 1) * opts.pageSize),
		db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(story)
			.where(where),
	]);

	return {
		items: rows.map(toCreatorWork),
		total: countRows[0]?.n ?? 0,
	};
}
