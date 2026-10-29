import { space } from "@rowcat/design";
import {
	applyGalleryQuery,
	DEFAULT_GALLERY_FILTERS,
	filtersForViewer,
	type GalleryFilters,
	type Story,
} from "@rowcat/domain";
import {
	galleryInfiniteQueryOptions,
	galleryStories,
	galleryTotal,
	personalizationQueryOptions,
} from "@rowcat/query";
import {
	EmptyState,
	ErrorState,
	Notice,
	Screen,
	Spinner,
	Text,
} from "@rowcat/ui-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { useMobileIdentity } from "../../lib/identity.tsx";
import { useMobileLocalScope } from "../../lib/local-data/scope.tsx";
import { AppHeader } from "../shell/app-header.tsx";
import { PrimaryNav } from "../shell/primary-nav.tsx";
import { resolveDiscoverState } from "./discover-state.ts";
import { FilterBar } from "./filter-bar.tsx";
import { DISCOVER_COLUMNS, DISCOVER_ROW_INSET } from "./grid.ts";
import {
	discoverReturnPath,
	filtersFromParams,
	paramsFromFilters,
} from "./search.ts";
import { SearchField } from "./search-field.tsx";
import { StoryCard } from "./story-card.tsx";

/**
 * Discover: the app's first screen, readable without signing in.
 *
 * The list never waits on `/v2/me` or on this device's SQLite. There is no `useMobileAppPhase()`
 * branch splitting the whole screen, because that hook spans session and local storage, and
 * branching on it would tie reading public stories to Better Auth and a device file. Identity
 * enters only the header and the actions (heart, following axis, sign-in button).
 * `discover-state.ts` takes the identity axes without reading them, and `lib/boundaries.test.ts`
 * scans for the rest.
 *
 * The server decides what is visible (private, adult, blocks, following, search, sort). Filtering a
 * full download on the client would leak that decision and make it bypassable.
 *
 * No page number is held here. Query derives the next page from the last response, and a filter
 * change replaces the query identity so pages restart from 1. A screen-held number would need a
 * reset on every filter change, and one missed reset fetches page 3 of the new filter first.
 */
export function DiscoverScreen() {
	const params = useLocalSearchParams();
	const client = getRowCatClient();
	const identity = useMobileIdentity();
	const scope = useMobileLocalScope();

	const { session } = identity;
	/**
	 * True only for a confirmed member. `session.viewer !== null` is not used, so `unavailable` folds
	 * to neither guest nor member. A following-feed request on an unconfirmed session would 401 with
	 * no visible cause, so when unsure the public list is shown.
	 */
	const isMember = session.phase === "authenticated";

	/**
	 * Route axes plus the guest fold (`filtersForViewer`, the same function the web calls). Only the
	 * query is folded. Route params stay, so the same address becomes the following feed after signing
	 * in.
	 */
	const filters = useMemo(
		() => filtersForViewer(filtersFromParams(params), isMember),
		[params, isMember],
	);

	/** Carries the active axes so that signing in from a heart press returns to the same results. */
	const returnPath = useMemo(() => discoverReturnPath(filters), [filters]);

	const gallery = useInfiniteQuery(
		galleryInfiniteQueryOptions(client, filters),
	);

	/**
	 * Not requested for guests (an empty answer would only add first-paint latency), nor while
	 * identity is unconfirmed (the answer would land in the cache under an unknown identity).
	 */
	const personalization = useQuery({
		...personalizationQueryOptions(client),
		enabled: isMember,
	}).data;

	const stories = useMemo(
		() => (gallery.data ? galleryStories(gallery.data) : []),
		[gallery.data],
	);

	/** A Set so each card's lookup avoids a linear scan on every render. */
	const favorites = useMemo(
		() => new Set(personalization?.favorites ?? []),
		[personalization],
	);

	const state = resolveDiscoverState({
		// Passed but not read by the decision. The test relies on this signature to verify that
		// independence.
		context: { session: session.phase, localScope: scope.status },
		gallery: {
			status: gallery.status,
			paused: gallery.fetchStatus === "paused",
			storyCount: stories.length,
		},
		filters,
		followsNobody: personalization?.following.length === 0,
	});

	/**
	 * `setParams` merges, so omitted keys are not cleared. `paramsFromFilters` therefore returns all
	 * six keys (defaults as `undefined`) and is passed through as is.
	 */
	const go = useCallback(
		(patch: Partial<GalleryFilters>) =>
			router.setParams(paramsFromFilters({ ...filters, ...patch })),
		[filters],
	);

	/** The rule that a query moves the sort lives in `applyGalleryQuery`, shared with the web toolbar. */
	const onSearch = useCallback(
		(query: string) => {
			const next = applyGalleryQuery(filters, query);
			go({ query: next.query, sort: next.sort });
		},
		[filters, go],
	);
	const onReset = useCallback(() => go(DEFAULT_GALLERY_FILTERS), [go]);

	const renderCard = useCallback(
		({ item }: { item: Story }) => (
			<StoryCard
				story={item}
				favorited={favorites.has(item.id)}
				returnPath={returnPath}
			/>
		),
		[favorites, returnPath],
	);

	return (
		<Screen>
			<FlatList
				/**
				 * One virtualized list is the whole screen. Header, search and filters go in
				 * `ListHeaderComponent`. A `FlatList` inside a `ScrollView` gets unbounded height, which turns
				 * off virtualization and mounts every card.
				 *
				 * Height is explicit because the bottom nav is a sibling. The list must take the remaining
				 * height, otherwise a short list (empty, zero results) leaves the nav floating under the
				 * content.
				 */
				style={grid.fill}
				data={stories}
				keyExtractor={keyOf}
				renderItem={renderCard}
				numColumns={DISCOVER_COLUMNS}
				columnWrapperStyle={grid.row}
				contentContainerStyle={grid.content}
				ListHeaderComponent={
					<View style={grid.header}>
						<AppHeader returnPath={returnPath} />
						<SearchField value={filters.query} onSearch={onSearch} />
						<FilterBar
							filters={filters}
							// Guests get no following axis at all (see the toolbar comment for why).
							followingAvailable={isMember}
							/**
							 * Unknown is not 0. Passing `0` before the server answers shows `0 stories` as fact, and someone
							 * who just changed a filter reads it as everything filtered out.
							 */
							total={gallery.data ? galleryTotal(gallery.data) : null}
							onChange={go}
							onReset={onReset}
						/>
					</View>
				}
				ListEmptyComponent={
					<DiscoverEmpty
						state={state}
						onReset={onReset}
						onRetry={() => void gallery.refetch()}
					/>
				}
				ListFooterComponent={
					state.kind === "stories" ? (
						<ListEnd
							pending={gallery.isFetchingNextPage}
							hasNext={gallery.hasNextPage}
						/>
					) : null
				}
				/**
				 * Checking `hasNextPage` and `isFetchingNextPage` together is the whole duplicate-request
				 * guard. RN may call this several times per scroll, and Query does not coalesce an in-flight
				 * next-page fetch, so no second lock is needed.
				 */
				onEndReachedThreshold={0.6}
				onEndReached={() => {
					if (gallery.hasNextPage && !gallery.isFetchingNextPage)
						void gallery.fetchNextPage();
				}}
				/** Pull-to-refresh is kept separate from the first-load placeholder so the list does not vanish. */
				refreshing={gallery.isRefetching && !gallery.isFetchingNextPage}
				onRefresh={() => void gallery.refetch()}
				keyboardDismissMode="on-drag"
				keyboardShouldPersistTaps="handled"
			/>

			{/**
			 * Bottom primary nav (`features/shell/primary-nav.tsx`). A sibling of the list, not an
			 * overlay, so the last row never hides behind it. It sits inside `Screen`, which already
			 * supplies the home-indicator inset (`screen.tsx` in `@rowcat/ui-native`).
			 */}
			<PrimaryNav />
		</Screen>
	);
}

/** Keyed by entity id. An index key would make cards swap places when the list changes. */
const keyOf = (story: Story) => story.id;

/**
 * When there is no list, each branch states a different fact. `resolveDiscoverState` already
 * decided; this only maps the value to copy. The order is not rebuilt here because a wrong order
 * fails silently (offline users see an endless placeholder, zero-result searches see `No stories
 * yet`).
 */
function DiscoverEmpty({
	state,
	onReset,
	onRetry,
}: {
	state: ReturnType<typeof resolveDiscoverState>;
	onReset: () => void;
	onRetry: () => void;
}) {
	if (state.kind === "loading")
		return (
			<View style={grid.center}>
				<Spinner />
			</View>
		);

	if (state.kind === "offline")
		return (
			<View style={grid.center}>
				<Notice message="You're not connected to a network. It continues automatically once connected." />
			</View>
		);

	/** A fetch failure is not an auth failure: no sign-out, no redirect to sign-in, no response body shown. */
	if (state.kind === "failed")
		return (
			<View style={grid.center}>
				{/**
				 * Retry is offered as on the web's `gallery-error.tsx`. Pull-to-refresh alone is
				 * undiscoverable, and there is nothing to pull when the list is empty.
				 */}
				<ErrorState
					message="Couldn't load stories."
					actionLabel="Try again"
					onAction={onRetry}
				/>
			</View>
		);

	if (state.kind !== "empty") return null;

	/**
	 * Empty is not a failure, so it is an `EmptyState` rather than a bordered error box. Blurring that
	 * makes zero-result searches read as breakage. The three icons match the web's
	 * `gallery-empty.tsx`, because the three causes differ and the picture says so before the text.
	 */
	if (state.followsNobody)
		return (
			<EmptyState
				icon="follow"
				title="You don't follow any creators"
				description="Follow the creators of stories you like, and their new stories gather here."
				actionLabel="Browse stories"
				/** Matches the web's empty state, which uses `outline` (`gallery-empty.tsx`). */
				actionVariant="outline"
				onAction={onReset}
			/>
		);

	return state.filtered ? (
		<EmptyState
			icon="no-results"
			title="No stories match these conditions"
			actionLabel="Reset filters"
			/** Matches the web's empty state, which uses `outline` (`gallery-empty.tsx`). */
			actionVariant="outline"
			onAction={onReset}
		/>
	) : (
		<EmptyState
			icon="library"
			title="No stories yet"
			description="The first story will appear here once it's posted."
		/>
	);
}

/** List end: either the next page is loading, or there is nothing more to load. */
function ListEnd({ pending, hasNext }: { pending: boolean; hasNext: boolean }) {
	if (pending)
		return (
			<View style={grid.footer}>
				<Spinner />
			</View>
		);
	if (hasNext) return <View style={grid.footer} />;
	return (
		<View style={grid.footer}>
			<Text variant="caption" tone="muted-foreground">
				You've reached the end
			</Text>
		</View>
	);
}

const grid = StyleSheet.create({
	fill: { flex: 1 },
	content: { paddingBottom: space["2xl"] },
	header: { gap: space.md, paddingBottom: space.md },
	/**
	 * No horizontal gutter: each cell owns half the column gap (`grid.ts`). A row `gap` only appears
	 * when siblings exist, and a `flex`-sized cell stretches to the full row on the last row.
	 */
	row: { marginBottom: space.md, paddingHorizontal: DISCOVER_ROW_INSET },
	center: { padding: space.lg },
	/** 20 is deliberately off the scale: the footer needs more than `lg` but should stay quieter than `xl`. */
	footer: { alignItems: "center", paddingVertical: 20 },
});
