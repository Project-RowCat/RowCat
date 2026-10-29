/**
 * - The domain package holds only product meaning and pure rules. Runtime validation of values
 *   crossing process or network boundaries lives in @rowcat/contracts.
 * - Transport conventions, such as an empty string meaning unset, must not leak in here. Unset is
 *   null.
 * - The /v2 StoryDto matches Story field for field on purpose. The packages stay separate:
 *   contracts decides whether incoming values can be trusted, while domain decides what they mean.
 * - @rowcat/sdk keeps no field-by-field identity mapper while the shapes match, since that only
 *   adds places to update. If the wire format diverges later, the SDK absorbs the difference.
 */

import {
	CALENDAR_WINDOW_LABEL,
	CALENDAR_WINDOWS,
	type CalendarWindow,
	calendarWindowStart,
} from "./time-window.ts";

export const ORIENTATIONS = ["female", "male", "all"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

/**
 * Display labels for orientation. They live in the domain because the list, detail, and filter
 * views must use the same words.
 */
export const ORIENTATION_LABEL: Record<Orientation, string> = {
	female: "For women",
	male: "For men",
	all: "All audiences",
};

/**
 * Creator-chosen exposure state. It lives in the domain so the authoring screen can use the same
 * words without going through the server contract. Local drafts (@rowcat/authoring) are never sent
 * to the server, so a wire-format change must not change what drafts already stored on devices
 * mean.
 *
 * `archived` is included because the server column already stores it. Publishing can select only
 * public, unlisted, or private. Archiving is a transition on a published story, so policy decides
 * what can be selected.
 *
 * `unlisted` is a fourth value, not a boolean. A separate boolean would allow the impossible pair
 * (private && unlisted) and force every visibility check to read two axes. The server merged its
 * two legacy booleans for the same reason (apps/api/src/db/tables/story.ts).
 */
export const STORY_VISIBILITIES = [
	"public",
	"unlisted",
	"private",
	"archived",
] as const;
export type StoryVisibility = (typeof STORY_VISIBILITIES)[number];

/**
 * How a story is played. This is a separate axis from exposure.
 * - `chat` replays an existing conversation from a playback snapshot that the device builds into
 *   a room.
 * - `runtime` runs a compiled artifact in an isolated VM.
 *
 * The same vocabulary exists in @rowcat/contracts (StoryPlayMode). The domain does not import
 * contracts, so product rules never depend on transport conventions. A test at the assembly point
 * keeps the two lists equal. Review or draft states must not be added here: this is a play mode,
 * not a lifecycle.
 */
export const STORY_PLAY_MODES = ["chat", "runtime"] as const;
export type StoryPlayMode = (typeof STORY_PLAY_MODES)[number];

/**
 * Primary action word for each play mode, read by both apps. With separate ternaries, a new mode
 * could update one app and leave the other with the old word. As a Record, adding a mode breaks
 * compilation.
 *
 * `Play` is used for runtime because the activity there is not a conversation. `Start game` and `Run`
 * would name a genre or an implementation, which users do not need to know.
 */
export const STORY_START_LABEL: Record<StoryPlayMode, string> = {
	chat: "Start conversation",
	runtime: "Play",
};

/**
 * Primary action icon, chosen by play mode alone: a chat bubble for chat, a play triangle for
 * runtime. The icon promises what the press does.
 *
 * Color, size, and glyph implementation belong to each platform (lucide-react on web, IconName on
 * mobile). The action no longer depends on purchase or availability, since owning stories was
 * removed, so the play mode is the only input. The function is shared because web added a runtime
 * branch while mobile kept drawing the chat bubble.
 */
export const storyStartGlyph = (playMode: StoryPlayMode): "chat" | "play" =>
	playMode === "runtime" ? "play" : "chat";

/**
 * Labels for all four exposure states, on purpose. Publishing produces only public, unlisted, or
 * private, but `archived` comes from a lifecycle transition (services/story/lifecycle.ts) and the
 * creator's list still renders it. A missing entry would show a blank status on the creator's own
 * story, which reads as unknown rather than as the real state.
 *
 * `Link only` means, for users, 'not in listings, but opens with the link'. `Unlisted` reads as nothing, and
 * `Hidden` names the separate operator-hide axis (`hidden`).
 */
export const STORY_VISIBILITY_LABEL: Record<StoryVisibility, string> = {
	public: "Public",
	unlisted: "Link only",
	private: "Private",
	archived: "Archived",
};

/**
 * Badge text for exposure on read surfaces (gallery card, detail, preview), or null when no badge
 * is drawn. Both apps call this one function. Separate copies of the check would let a missed
 * screen show an unlisted story as public.
 *
 * `public` returns null on purpose. It is the default, and badging it would put an empty pill on
 * nearly every card while hiding the two labels that carry meaning, `Private` and `Link only`.
 *
 * Color and shape belong to each platform. This function decides only the words.
 */
export const storyVisibilityBadgeLabel = (
	visibility: StoryVisibility,
): string | null =>
	visibility === "public" ? null : STORY_VISIBILITY_LABEL[visibility];

/**
 * Whether the story appears on discovery surfaces: gallery, search, popular, and the following
 * feed. Discoverable and openable are different questions. Until `unlisted` existed, both were
 * `visibility === 'public'`, so scattered comparisons did no harm. Each comparison now has to be
 * assigned to one of the four exposure questions.
 *
 * The authority is the server predicate (galleryWhere in services/story/index.ts). This function
 * gives screens the same decision with the same words; it does not enforce access.
 */
export const isStoryDiscoverable = (visibility: StoryVisibility): boolean =>
	visibility === "public";

/**
 * Whether anyone who knows the address can open the story. This is the catalog-side check for
 * detail, cover, comments, reports, collection, and play access.
 *
 * It is not a security boundary. `Link only` promises only that the story is not listed, and anyone
 * with the URL can open it. The UI copy says so, because promising more privacy would endanger
 * creators who shared links on that basis.
 */
export const isStoryDirectlyViewable = (visibility: StoryVisibility): boolean =>
	visibility === "public" || visibility === "unlisted";

/**
 * Whether the creator can hand out the address. It matches isStoryDirectlyViewable as a
 * consequence, not a coincidence: a shared address must open, or the link is a dead end.
 *
 * The two functions stay separate because the questions differ. If a state ever became openable but
 * not shareable, only this function would change, not the viewing boundary.
 */
export const isStoryShareable = (visibility: StoryVisibility): boolean =>
	visibility === "public" || visibility === "unlisted";

/**
 * Whether the story appears in a public profile's creator grid. The answer matches
 * isStoryDiscoverable for a different reason: the grid states what a person has published, so it
 * must be identical for the owner and for others. This is why ownPrivateVisible is false only in
 * this grid.
 *
 * `Link only` is a story the creator chose to keep out of listings. If it appeared only on the owner's
 * profile, the owner could not see how it looks from outside.
 */
export const isStoryVisibleOnCreatorProfile = (
	visibility: StoryVisibility,
): boolean => visibility === "public";

export interface StoryCreator {
	id: string;
	nickname: string;
}

/**
 * Byline for a story with no creator. It states a status, not a person, so labels such as `Unknown`
 * or `Deleted member` that read like a name are avoided. The line itself should say why there is no author.
 *
 * The line is not removed, because list cards are sized for one byline row. A blank slot would
 * leave readers asking why the name is missing.
 */
export const DELETED_CREATOR_LABEL = "Deleted creator";

/**
 * List, detail, and preview share this byline. If each screen wrote its own fallback, one might use
 * different words, and users would doubt that a listed story is the one they open.
 */
export const creatorLabel = (story: Story): string =>
	story.creator?.nickname ?? DELETED_CREATOR_LABEL;

export interface Story {
	id: string;
	title: string;
	description: string;
	/** Author name printed on the work. It can differ from the creator account (creator). */
	author: string;
	/** Cover image URL, or null when there is none. The caller draws a placeholder in that case. */
	coverUrl: string | null;
	/** null means the orientation is unspecified. */
	orientation: Orientation | null;
	adult: boolean;
	/**
	 * Creator-chosen exposure state. It is one state axis, not a boolean.
	 *
	 * The earlier field was `isPrivate: boolean`, which could not tell `public` from `archived` even
	 * with three values. Adding `unlisted` made folding four states into one boolean impossible to
	 * express. Rather than adding an `isUnlisted` flag next to it, the canonical value is carried,
	 * because a set of booleans leaves contradictory combinations in the type with nothing checking
	 * them.
	 *
	 * Carrying it on the public projection leaks nothing. Only states the viewer can actually see
	 * reach here (galleryWhere): `public` and `unlisted` go to others, `private` only to the owner,
	 * and `archived` to no one.
	 */
	visibility: StoryVisibility;
	promptProtected: boolean;
	tags: string[];
	/**
	 * Aggregate favorite count (public). Whether the viewer has favorited the story is a viewer axis
	 * held by PersonalizationState. Putting it here would make the same story differ between people.
	 */
	favorites: number;
	/**
	 * Creator of the story. null means the identity was erased because the creator withdrew. The
	 * screen must not draw a byline then. Do not invent a name such as `Unknown`; it would read as a
	 * fact.
	 */
	creator: StoryCreator | null;
	/**
	 * How the story is played, as projected by the server. The client does not infer it;
	 * `storyPlayMode` only reads it. Only the server knows whether a valid runtime publication exists.
	 * A client-side guess would be wrong for any account whose device has no runtime authoring file.
	 */
	playMode: StoryPlayMode;
	/** ISO 8601. */
	createdAt: string;
	updatedAt: string;
	sizeBytes: number;
}

/**
 * A single page with a server-computed total. Discovery concatenates pages for infinite scroll.
 * Whether more pages exist is answered by the page and pageCount fields, so no cursor is needed to
 * know where to stop. The total survives concatenation, so the UI can still say how many stories
 * match.
 */
export interface StoryPage {
	items: Story[];
	total: number;
	page: number;
	pageSize: number;
	pageCount: number;
}

/**
 * Product vocabulary for the sort axis. It is a literal array so that a value arriving from outside
 * (URL, form) can be checked against it. The check itself lives at each boundary (zod or similar).
 * This declaration only defines the valid values.
 */
export const STORY_SORTS = ["recent", "popular", "relevance"] as const;
export type StorySort = (typeof STORY_SORTS)[number];

/**
 * `relevance` is a sort that means something only when a search query exists. Without a query every
 * score is 0, so relevance would return the same results as recent under another name. That
 * combination therefore never survives as a value. The URL round trip (web and mobile), the query
 * key (@rowcat/query), and the server predicate all fold it through effectiveGallerySort.
 *
 * The fold rule lives in one place on purpose. If three layers each wrote it, one would miss it,
 * and the same query would split across two cache entries.
 */
export function relevanceApplies(
	filters: Pick<GalleryFilters, "query">,
): boolean {
	return filters.query.trim() !== "";
}

/** The sort that actually drives the query. Relevance without a search term folds to recent. */
export function effectiveGallerySort(
	filters: Pick<GalleryFilters, "sort" | "query">,
): StorySort {
	return filters.sort === "relevance" && !relevanceApplies(filters)
		? "recent"
		: filters.sort;
}

/**
 * Changes the search query and holds the rule for how sort moves with it:
 * - A query is added while sort is the default (recent): switch to relevance.
 * - The query is cleared while sort is relevance: switch back to recent, since there is nothing
 *   to compare.
 * - Popular stays as it is in both cases, because the user chose it explicitly.
 *
 * Screens do not write this rule themselves. The web toolbar and the mobile search field call the
 * same function, so search results cannot sort differently by platform. When nothing changes, the
 * same reference is returned so query identity does not change on every render.
 */
export function applyGalleryQuery(
	filters: GalleryFilters,
	query: string,
): GalleryFilters {
	const hasQuery = query.trim() !== "";
	const sort =
		hasQuery && filters.sort === "recent"
			? "relevance"
			: !hasQuery && filters.sort === "relevance"
				? "recent"
				: filters.sort;
	if (query === filters.query && sort === filters.sort) return filters;
	return { ...filters, query, sort };
}

/**
 * Canonical form of a tag filter: trimming surrounding whitespace is all it does. Publishing
 * normalizes tags the same way (normalizeTags in @rowcat/authoring removes whitespace, empty
 * values, and duplicates, and keeps case). Folding more here would make the screen's tags and the
 * server comparison diverge. An empty result means no tag filter (`null`).
 */
export function normalizeGalleryTag(
	raw: string | null | undefined,
): string | null {
	const tag = raw?.trim() ?? "";
	return tag === "" ? null : tag;
}

/**
 * Aggregation window for popular sort. It has no meaning for recent sort. The vocabulary and
 * boundaries live in time-window.ts and are not restated here, because this window means the same
 * thing as the creator analytics window. Two separate arrays could drift apart while keeping the
 * same names. The alias makes that mismatch unrepresentable.
 */
export const STORY_PERIODS = CALENDAR_WINDOWS;
export type StoryPeriod = CalendarWindow;

/** Rating filter: `any` (no restriction), `sfw` (all ages), `adult` (adult-oriented). */
export const STORY_RATINGS = ["any", "sfw", "adult"] as const;
export type StoryRating = (typeof STORY_RATINGS)[number];

/**
 * Display labels. Like the orientation labels, these are product vocabulary, because the toolbar
 * and the guidance text use the same words.
 */
export const STORY_SORT_LABEL: Record<StorySort, string> = {
	recent: "Newest",
	popular: "Popular",
	relevance: "Relevance",
};

/**
 * Labels for periods. They must mean the same thing as the window that is actually computed.
 *
 * These labels once read `This week` and `This month`, while the server counted rolling 7 × 24 hours and 30 ×
 * 24 hours. Those words mean ISO weeks and calendar months, so the screen claimed to count
 * something it did not. The label and the window now both come from time-window.ts.
 */
export const STORY_PERIOD_LABEL: Record<StoryPeriod, string> =
	CALENDAR_WINDOW_LABEL;

/**
 * Start of the popular-sort window, or null for `all`. The server cutoff comes from this function
 * (services/story/index.ts). It is the same function creatorAnalyticsWindowStart calls, and that
 * shared call is what guarantees both screens count the same days.
 */
export function storyPeriodStart(period: StoryPeriod, now: Date): Date | null {
	return calendarWindowStart(period, now);
}

export const STORY_RATING_LABEL: Record<StoryRating, string> = {
	any: "All",
	sfw: "All ages",
	adult: "Adult",
};

/**
 * All axes that determine the list query. Search, favorites, and following are filtered on the
 * server, so they belong in the query key.
 *
 * The page number is excluded. Since discovery became infinite scroll, the page being viewed is
 * internal progress of the chained query, not something the user picks. Keeping it here would
 * change query identity on every scroll and discard the accumulated list.
 */
export interface GalleryFilters {
	orientation: Orientation | null;
	rating: StoryRating;
	sort: StorySort;
	period: StoryPeriod;
	query: string;
	/**
	 * Only stories carrying this tag. null means there is no tag axis.
	 *
	 * Only one tag is supported. Several tags would require the vocabulary to say whether they combine
	 * with AND or OR, and no screen asks that question. The value is the tag exactly as written on the
	 * story; normalization belongs to normalizeGalleryTag.
	 */
	tag: string | null;
	favoritesOnly: boolean;
	followingOnly: boolean;
}

export const GALLERY_PAGE_SIZE = 24;

export const DEFAULT_GALLERY_FILTERS: GalleryFilters = {
	orientation: null,
	rating: "any",
	sort: "recent",
	period: "all",
	query: "",
	tag: null,
	favoritesOnly: false,
	followingOnly: false,
};

/** Whether any axis differs from its default. It decides which message an empty result shows. */
export function hasActiveFilters(f: GalleryFilters): boolean {
	return (
		f.orientation !== null ||
		f.rating !== "any" ||
		f.favoritesOnly ||
		f.followingOnly ||
		f.query.trim() !== "" ||
		f.tag !== null ||
		(f.sort === "popular" && f.period !== "all")
	);
}

/**
 * Folds a member-only axis (currently following) for this viewer. A guest opening a member's shared
 * `?following=1` link would otherwise get a 401 error page instead of a prompt to sign in.
 *
 * The function returns a query filter only and does not touch navigation. The address stays the
 * same, so after signing in, the same link becomes the following feed.
 *
 * It lives in the domain because the rule must be identical on web and mobile. Reading the axis
 * from the address (TanStack Router search params, Expo Router route params) differs per app and
 * stays out.
 *
 * It takes a boolean because membership is all it inspects. An unconfirmed identity must be passed
 * as false, since a member-only query sent without confirmation is bound to fail. It returns the
 * same reference when nothing changes, so query identity does not churn on every render.
 */
export function filtersForViewer(
	filters: GalleryFilters,
	isMember: boolean,
): GalleryFilters {
	if (isMember || !filters.followingOnly) return filters;
	return { ...filters, followingOnly: false };
}

/**
 * Whether the viewer created this story, judged by creator.id on the story itself. It is not
 * derived from a separate 'my stories' query, whose failure would look the same as 'not the owner'.
 * The server remains the authority; this is a display decision.
 *
 * A story with no creator (identity erased after withdrawal) belongs to no one, so this function
 * must have no path that returns true for it.
 */
export function isOwnStory(story: Story, viewerId: string | null): boolean {
	return !!viewerId && story.creator?.id === viewerId;
}

/**
 * A story the viewer manages on the server. It is a different product concept from `Story`,
 * although it is another projection of the same row. `Story` is a discovered story and carries what
 * others see (cover, description, tags, favorite count). This type carries the state axes
 * (`visibility`, `hidden`) and the link back to the source draft.
 *
 * Owner-only fields are not added to `Story`. The gallery card type would then carry `hidden` and
 * `originDraftId`, which are always empty for other people's stories. They would have to be
 * nullable, and then 'no value' and 'not allowed to see' could no longer be told apart.
 */
export interface CreatorWork {
	/** Server story id. It is a different identity from the local draft id (`StoryDraft.id`). */
	id: string;
	/**
	 * Id of the local draft this story was created from, or null for stories that came from a
	 * migration or seed. The screen finds the device draft by this id, not by title or list position.
	 * A title can change independently on either side after publishing, and a list position points to
	 * a different item once the sort changes.
	 */
	originDraftId: string | null;
	title: string;
	visibility: StoryVisibility;
	adult: boolean;
	promptProtected: boolean;
	/** Operator hide. This is an axis independent of the creator's `visibility`. */
	hidden: boolean;
	/**
	 * Address of the cover currently attached, or null. It is built by the same rules as
	 * `Story.coverUrl`, so the management screen gets no second address scheme.
	 *
	 * The projection carries it because cover management lives on this screen and public detail cannot
	 * supply it. An archived or operator-hidden story returns 404 from detail, even to its owner.
	 */
	coverUrl: string | null;
	/** ISO 8601. */
	createdAt: string;
	/** When the authored content was last edited. Replacing the cover does not advance this value. */
	updatedAt: string;
}

/** Same shape as the gallery page, with the server total, but with CreatorWork items. */
export interface CreatorWorkPage {
	items: CreatorWork[];
	total: number;
	page: number;
	pageSize: number;
	pageCount: number;
}

/**
 * Whether the owner can open this work, which decides whether the 'view work' link is drawn. Detail
 * uses the same viewing boundary as the list (galleryWhere), so operator-hidden and archived works
 * return 404 even to their owner. A link drawn anyway would send the creator to a 'not found' page
 * that looks like a product fault.
 *
 * The adult-content opt-in is not checked here. The detail route skips that setting for the
 * creator's own work (GallerySelector.ownAdultAllowed), and the server decides. Repeating the rule
 * here would create two places that drift.
 *
 * The parameter is the two axes it reads, not a CreatorWork. Two projections ask this question
 * (CreatorWork and CreatorAnalyticsWork). Binding the predicate to one type would force the other
 * to copy it, and a drifted copy would draw dead links when the boundary changes. Taking the axes
 * alone prevents the copy, and an added axis fails compilation in both screens.
 */
export const isOwnWorkViewable = (work: {
	hidden: boolean;
	visibility: StoryVisibility;
}): boolean => !work.hidden && work.visibility !== "archived";

/**
 * Lifecycle actions a creator can take on their own story. The vocabulary matches the contract; the
 * rules live here.
 *
 * Transitions:
 * - publish moves private or unlisted to public.
 * - unlist moves private to unlisted (reachable by link, not listed), or public to unlisted
 *   (removed from the catalog only).
 * - unpublish moves public or unlisted to private.
 * - archive moves any non-archived state to archived.
 * - restore moves archived to private, not public.
 *
 * There is deliberately no archived-to-public or archived-to-unlisted path. Restoring and
 * publishing again are two decisions; combined in one tap, an old unpublished story would return to
 * the catalog unconfirmed. Restore always lands on private.
 *
 * `unlist` is a fifth action rather than a visibility patch, because the vocabulary names actions,
 * not destinations. A patch like { visibility } would make the forbidden transition expressible as
 * a request. A named action makes archived-to-unlisted impossible to request.
 */
export const STORY_LIFECYCLE_ACTIONS = [
	"publish",
	"unlist",
	"unpublish",
	"archive",
	"restore",
] as const;
export type StoryLifecycleAction = (typeof STORY_LIFECYCLE_ACTIONS)[number];

/**
 * The state a story is in once the transition completes. The screen and the cache read the same
 * table.
 *
 * A successful response is the public projection (StoryDto), which carries the authoritative
 * visibility. That projection does not produce the owner's list row (originDraftId and hidden are
 * absent), so the cache copies only the state axis of the row. Each action is idempotent on the
 * server for its destination, so success means this state holds. It is the endpoint's
 * postcondition, not a guessed value.
 */
export const STORY_LIFECYCLE_RESULT: Record<
	StoryLifecycleAction,
	StoryVisibility
> = {
	publish: "public",
	unlist: "unlisted",
	unpublish: "private",
	archive: "archived",
	restore: "private",
};

/**
 * Actions available in the current state. This is a pure function for two reasons.
 *
 * First, if the table is wrong the symptom is silent: a pressable button that returns 409, or a
 * valid action missing from the screen. Second, the server re-derives the same rules with its own
 * predicate (services/story/lifecycle.ts), so this is display logic, not authorization. Blurring
 * that would eventually produce code that skips server checks because the screen already hid the
 * action.
 *
 * It takes one axis rather than CreatorWork, for the same reason as isOwnWorkViewable.
 *
 * It ignores operator hide. A hidden story must still be archivable and restorable by its owner;
 * hide is another actor's axis. Publishing a hidden story does not make it visible to others,
 * because the server never touches `hidden`.
 */
export function storyLifecycleActions(work: {
	visibility: StoryVisibility;
}): StoryLifecycleAction[] {
	switch (work.visibility) {
		case "private":
			return ["publish", "unlist", "archive"];
		case "unlisted":
			return ["publish", "unpublish", "archive"];
		case "public":
			return ["unlist", "unpublish", "archive"];
		case "archived":
			return ["restore"];
	}
}

/**
 * Whether one action is possible in the current state. This is the shape a screen asks when
 * deciding a single button.
 */
export const canRunStoryLifecycleAction = (
	work: { visibility: StoryVisibility },
	action: StoryLifecycleAction,
): boolean => storyLifecycleActions(work).includes(action);
