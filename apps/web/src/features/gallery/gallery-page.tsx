import {
	applyGalleryQuery,
	DEFAULT_GALLERY_FILTERS,
	filtersForViewer,
	type GalleryFilters,
	hasActiveFilters,
	type Viewer,
} from "@rowcat/domain";
import {
	galleryInfiniteQueryOptions,
	galleryStories,
	galleryTotal,
	personalizationQueryOptions,
	viewerQueryOptions,
} from "@rowcat/query";
import {
	useInfiniteQuery,
	useQuery,
	useSuspenseInfiniteQuery,
} from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { Suspense, useCallback, useMemo, useState } from "react";
import { StoryPreviewDialog } from "#/features/story/story-preview-dialog.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { enterTransition } from "#/lib/motion/transitions.ts";
import { GalleryEmpty } from "./gallery-empty.tsx";
import { GALLERY_GRID_CLASS } from "./gallery-grid.ts";
import { GalleryLoadMore } from "./gallery-load-more.tsx";
import { GalleryShell } from "./gallery-shell.tsx";
import { GalleryGridSkeleton } from "./gallery-skeleton.tsx";
import { GalleryToolbar } from "./gallery-toolbar.tsx";
import { filtersFromSearch, searchFromFilters } from "./search.ts";
import { StoryCard } from "./story-card.tsx";

const route = getRouteApi("/(app)/");

/**
 * Discover (gallery) screen.
 *
 * The query uses the same galleryInfiniteQueryOptions as the route loader, so key and fetch
 * function are shared and the SSR data becomes this component's cache entry. Writing the key again
 * here would make the client fetch the list the server already sent, once more after hydration,
 * with no visible sign.
 *
 * The list is appended, not swapped per page, so this screen keeps no 'current page' state. Query
 * derives the next page number from the last response; a filter change alters the query identity
 * and the list rebuilds from page 1.
 *
 * Filtering happens on the server. Filtering the full list on the client would leak private, adult,
 * and block decisions to the client, where they could be bypassed rather than enforced.
 */
export function GalleryPage() {
	const search = route.useSearch();
	const navigate = route.useNavigate();
	const client = getRowCatClient();

	/**
	 * The viewer is read before the list. The following axis needs it: that filter holds only for
	 * members (the server returns 401 to guests), so identity must be known before the query identity
	 * is built. The loader already fills this value, so no extra wait is added.
	 */
	const viewer = useQuery(viewerQueryOptions(client)).data ?? null;

	/**
	 * URL axes plus guest folding. A new object on every navigation would differ each render and reset
	 * the debounce timers in the callbacks below.
	 *
	 * Folding happens on the screen, not in the URL, so the URL is not rewritten. If a member shares
	 * `?following=true` and a guest opens it, only the list falls back to the full set while the
	 * address stays. When the guest logs in and returns, the same address is the following feed again.
	 */
	const filters = useMemo(
		() => filtersForViewer(filtersFromSearch(search), viewer !== null),
		[search, viewer],
	);

	/**
	 * Deliberately not a suspense boundary here; that is this screen's boundary decision. Results are
	 * drawn by `GalleryResults` below, inside its own boundary. This layer must stay mounted while
	 * conditions change: the search input lives here, and if it unmounted, typed text and caret would
	 * vanish. A suspense query here would replace the whole component with its fallback on every
	 * condition change.
	 *
	 * Key and query function match the layer below, so there is still one request (Query merges
	 * observers with the same key). This layer reads only two things from the value: the total in the
	 * toolbar and the story list for the preview box.
	 */
	const { data } = useInfiniteQuery(
		galleryInfiniteQueryOptions(client, filters),
	);

	/**
	 * Flattens the accumulated pages into one line. While the first page for new conditions does not
	 * exist yet this is an empty array; the only consumer here is the preview box, so an open box
	 * closes.
	 */
	const stories = useMemo(() => (data ? galleryStories(data) : []), [data]);

	/** Total count. Unknown is not zero (see `total` in gallery-toolbar.tsx). */
	const total = data ? galleryTotal(data) : null;

	/**
	 * Viewer and personalization do not block the list: works must appear even if hearts cannot be
	 * painted yet. That is why only these two are not useSuspenseQuery.
	 *
	 * Guests get no personalization request at all. The server returns an empty array, but for a guest
	 * that round trip changes nothing and only adds first-screen latency.
	 */
	const personalization = useQuery({
		...personalizationQueryOptions(client),
		enabled: viewer !== null,
	}).data;

	/**
	 * The query caches an array (it must be serializable to cross SSR); only lookups use a Set. A Set
	 * in the cache would come back from hydration as an empty object. Also, scanning thousands of
	 * favorites linearly for each of 24 cards on every render is needless.
	 */
	const favorites = useMemo(
		() => new Set(personalization?.favorites ?? []),
		[personalization],
	);

	const go = useCallback(
		(
			patch: Partial<GalleryFilters>,
			options?: { replace?: boolean; resetScroll?: boolean },
		) =>
			navigate({
				to: ".",
				search: searchFromFilters({ ...filters, ...patch }),
				...options,
			}),
		[filters, navigate],
	);

	const onSearch = useCallback(
		(query: string) => {
			/**
			 * The rule for how a search query moves the sort belongs to the domain (applyGalleryQuery): a
			 * query makes relevance the sort, clearing it returns to newest, and popular stays as it is. The
			 * mobile app calls the same function, so search results cannot come out newest-first on one
			 * platform only.
			 */
			const next = applyGalleryQuery(filters, query);
			// Do not push a history entry on every keystroke. Scroll position is kept, since the user is
			// still typing.
			go(
				{ query: next.query, sort: next.sort },
				{ replace: true, resetScroll: false },
			);
		},
		[filters, go],
	);

	const onReset = useCallback(() => go(DEFAULT_GALLERY_FILTERS), [go]);

	/**
	 * The preview holds only the id. Holding the work object would freeze a snapshot: pressing the
	 * heart inside the box would raise the total in the cache while the box still drew the old value,
	 * so the number looks stuck. Looking the story up in the current list each time makes the box
	 * follow every cache change.
	 */
	const [previewId, setPreviewId] = useState<string | null>(null);
	const previewStory = stories.find((story) => story.id === previewId) ?? null;
	const closePreview = useCallback(() => setPreviewId(null), []);

	return (
		<GalleryShell>
			{/*
			 * The enter animation wraps only the inner shell. The heading (`Discover`) is a frame shared by the
			 * placeholder
			 * and the list, so it must stay still during transitions and the title does not move again when the
			 * placeholder fades out.
			 *
			 * It does not overlap with the card entrance below: AnimatePresence uses initial={false}, so cards
			 * present
			 * at mount do not animate in. Only this one layer moves; the 6px card offset applies only to cards
			 * inserted later.
			 */}
			<PageEnter>
				{/*
				 * No divider between the query axes and the results. The toolbar's last line (the total) already
				 * forms the
				 * boundary, and an extra line would push the first work down on narrow screens.
				 */}
				<GalleryToolbar
					filters={filters}
					// Guests get no following axis at all (see the toolbar comment for why).
					followingAvailable={viewer !== null}
					total={total}
					onChange={go}
					onSearch={onSearch}
					onReset={onReset}
				/>

				{/*
				 * Only the results sit inside this boundary. When conditions change, everything below suspends and
				 * the
				 * fallback is a single grid skeleton. The toolbar above stays alive in the same fiber, so the
				 * search input
				 * keeps its text, selection, and caret.
				 *
				 * Raising the boundary above this point (the route's pendingComponent once did) would turn the
				 * input of the
				 * person who changed a condition into a gray bar. The fallback must not redraw the toolbar; that is
				 * its
				 * counterpart (GalleryGridSkeleton).
				 */}
				<Suspense fallback={<GalleryGridSkeleton />}>
					<GalleryResults
						filters={filters}
						viewer={viewer}
						favorites={favorites}
						followsNobody={
							filters.followingOnly && personalization?.following.length === 0
						}
						onReset={onReset}
						onPreview={setPreviewId}
					/>
				</Suspense>
			</PageEnter>

			{/*
			 * One preview box for the whole list. A dialog per card would mean 24 dialogs on one screen, of
			 * which only
			 * one can ever be open.
			 */}
			<StoryPreviewDialog
				story={previewStory}
				favorites={favorites}
				viewer={viewer}
				onClose={closePreview}
			/>
		</GalleryShell>
	);
}

/**
 * Results: the only layer swapped out when conditions change on this screen.
 *
 * The suspense query is here for two reasons. It keeps the layer above (GalleryPage) intact. And it
 * keeps where failures land: a throwing query reaches the route's errorComponent, so a list that
 * fails to load shows the same error screen as before. Non-suspense would turn failure into a
 * placeholder that never ends.
 *
 * Same key and query function as the layer above, so the request count stays at one.
 */
function GalleryResults({
	filters,
	viewer,
	favorites,
	followsNobody,
	onReset,
	onPreview,
}: {
	filters: GalleryFilters;
	viewer: Viewer | null;
	favorites: ReadonlySet<string>;
	/**
	 * 'Follows nobody' and 'followed people have published no works yet' are different states. The
	 * first is answered by personalization, the second by this empty list itself. Folding both into
	 * one message would tell a person who already follows many people to follow someone. Without
	 * personalization loaded yet, the first claim would be false.
	 */
	followsNobody: boolean;
	onReset: () => void;
	onPreview: (storyId: string) => void;
}) {
	const client = getRowCatClient();
	const {
		data,
		hasNextPage,
		isFetchingNextPage,
		isFetchNextPageError,
		fetchNextPage,
	} = useSuspenseInfiniteQuery(galleryInfiniteQueryOptions(client, filters));

	/**
	 * Flattens the accumulated pages into one line. Wrapped in useMemo because this array is the
	 * grid's input; rebuilding it every render would cost more as pages accumulate.
	 */
	const stories = useMemo(() => galleryStories(data), [data]);

	return (
		<>
			{/*
			 * Swap between the list and the empty state. When a filter change flips results from present to
			 * absent, half
			 * the screen switches wholesale; the swap is bridged only by the incoming opacity.
			 *
			 * The outgoing side deliberately has no exit. An exit animation would need mode="wait" (otherwise
			 * the leaving
			 * element holds its slot and new content is pushed down), and then the new results' entrance would
			 * wait for the
			 * leaving animation to finish. Motion would start deciding when content appears, so the chain is
			 * cut here. In
			 * a background tab where no frames arrive, that wait would become a freeze.
			 *
			 * initial={false} keeps the first server render: list or empty, the value is already final.
			 */}
			<AnimatePresence initial={false}>
				{stories.length === 0 ? (
					<m.div
						key="empty"
						className="mt-4"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={enterTransition}
					>
						<GalleryEmpty
							filtered={hasActiveFilters(filters)}
							followsNobody={followsNobody}
							onReset={onReset}
						/>
					</m.div>
				) : (
					<m.div
						key="grid"
						className={`mt-4 ${GALLERY_GRID_CLASS}`}
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={enterTransition}
					>
						{/*
						 * Card entrance is given only to cards that arrived later. With initial={false}, cards from the
						 * first render
						 * (server HTML and its hydration) sit at their final value; only cards produced by filter/search
						 * changes and
						 * pages appended by scrolling rise 6px.
						 *
						 * Exiting cards get no exit. In a CSS grid, if several cards leave together, holding their slots
						 * leaves gaps
						 * and visible reflow, and handling that properly needs layout animation (domMax). What is needed
						 * now is only
						 * 'what newly arrived', so the code does not go that far.
						 */}
						<AnimatePresence initial={false}>
							{stories.map((story) => (
								<StoryCard
									key={story.id}
									story={story}
									favorited={favorites.has(story.id)}
									viewer={viewer}
									onPreview={() => onPreview(story.id)}
								/>
							))}
						</AnimatePresence>
					</m.div>
				)}
			</AnimatePresence>

			{/*
			 * Draws the end marker only when the list has items. At zero results, `You've seen every story` (you have seen
			 * it all)
			 * would contradict the empty-state guidance.
			 */}
			{stories.length > 0 && (
				<GalleryLoadMore
					hasNext={hasNextPage}
					pending={isFetchingNextPage}
					failed={isFetchNextPageError}
					/*
					 * Called with no argument. The observer knows only that it intersected, not the next page
					 * number. If the screen started counting pages, it would have to reset that number whenever a
					 * filter changed.
					 */
					onLoadMore={() => fetchNextPage()}
				/>
			)}
		</>
	);
}
