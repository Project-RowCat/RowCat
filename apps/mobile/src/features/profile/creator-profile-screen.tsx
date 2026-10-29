import { space } from "@rowcat/design";
import {
	profileContentBlocked,
	resolveProfileActions,
	type Story,
} from "@rowcat/domain";
import {
	creatorStories,
	creatorStoriesInfiniteQueryOptions,
	personalizationQueryOptions,
	pinnedStoriesQueryOptions,
	publicProfileQueryOptions,
} from "@rowcat/query";
import {
	AppBar,
	CenteredArea,
	Screen,
	Separator,
	Spinner,
	screenPadding,
	Text,
} from "@rowcat/ui-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { useMobileIdentity } from "../../lib/identity.tsx";
import { useMobileLocalScope } from "../../lib/local-data/scope.tsx";
import { PageEnter } from "../../lib/motion/page-enter.tsx";
import { viewerAction } from "../../lib/viewer-action.ts";
import {
	DISCOVER_CELL_GUTTER,
	DISCOVER_COLUMNS,
	DISCOVER_ROW_INSET,
} from "../discover/grid.ts";
import { StoryCard } from "../discover/story-card.tsx";
import { AppSidebarTrigger } from "../shell/app-sidebar.tsx";
import { ShellUtilities } from "../shell/shell-utilities.tsx";
import { creatorProfilePath } from "./creator-route.ts";
import { ProfileHeader } from "./profile-header.tsx";
import { resolveProfileState } from "./profile-state.ts";
import { ProfileStoriesNotice } from "./profile-stories-notice.tsx";
import {
	canLoadMoreProfileStories,
	resolveProfileStoriesState,
} from "./profile-stories-state.ts";
import { ProfileUnavailable } from "./profile-unavailable.tsx";

/**
 * Public profile — **identity and public works, nothing else.**
 *
 * ## Answers four questions in order
 *
 * ```text
 * 1  Who is this person        face · name
 * 2  How many follow them      one public aggregate
 * 3  What can I do             follow · (if a member) block
 * 4  What can I see            public works grid
 * ```
 *
 * Nothing beyond that. Cover banner, follower list, following list, works count, activity feed,
 * DMs, reports and profile editing are not part of this slice, and their absence does not leave
 * even a placeholder on screen.
 *
 * ## The two queries being split is the skeleton of this screen
 *
 * The profile is a **small value that is the same for everyone**, and the works grid is a **large
 * value that varies by viewer**, so the cache cells, freshness and logout cleanup are separate
 * (`profile.ts` in `@rowcat/query`). Because of that, fetching the second one does not re-fetch
 * name and bio, and switching accounts keeps the public identity.
 *
 * So **failures are separate too.** A works-query failure leaves name and face in place, and a
 * personalization failure still opens the profile. The contract of that promise is structured by
 * the two pure functions that split the decision (`profile-state.ts`, `profile-stories-state.ts`).
 *
 * ## This screen also does not wait for identity or SQLite
 *
 * Same rule as discover and story detail (see the `discover-state.ts` header). Identity enters
 * **only the header actions**, and the public identity and public works are drawn even for guests.
 *
 * ## Exposure is not decided again here
 *
 * Hidden, archived, blocked, the adult gate and operator hiding are all the server's predicates
 * (`galleryWhere`). A work arriving here is already "a public work this viewer may see", and if the
 * screen re-ran the same decision, the two decisions would one day disagree. Blocking is used
 * **only to choose the wording** — it does not decide which works survive.
 *
 * ## One vertical list
 *
 * Identity and section titles are `ListHeaderComponent`, works are `data`. Putting a grid
 * `FlatList` inside a `ScrollView` gives the outside an unbounded height and turns virtualization
 * off entirely; in a list that keeps appending, that means hundreds of cards mounted at once.
 *
 * ## Cards are the discover screen's, **as is**
 *
 * A profile-only card would make the same work look different per screen, and actions such as
 * favorite would exist on one side only. The grid geometry derives from the same source
 * (`discover/grid.ts`).
 */
export function CreatorProfileScreen({ creatorId }: { creatorId: string }) {
	const client = getRowCatClient();
	const router = useRouter();
	const identity = useMobileIdentity();
	const scope = useMobileLocalScope();

	const { session } = identity;
	const isMember = session.phase === "authenticated";
	const action = viewerAction(session);

	const profile = useQuery(publicProfileQueryOptions(client, creatorId));
	const stories = useInfiniteQuery(
		creatorStoriesInfiniteQueryOptions(client, creatorId),
	);

	/**
	 * Guests are never asked for personalization. The server returns an empty array, but the round
	 * trip would remain as first-screen latency. It is not asked even while identity is **not yet
	 * confirmed**, because the answer would sit in the cache without knowing who we are.
	 */
	/**
	 * Pinned works — emphasis above the grid, so **a failure of this query does not block the
	 * screen.** If it is late or fails, only that section does not appear (pinned works are all also
	 * in the grid below). Same judgment as the web (`apps/web/src/features/profile/profile-page.tsx`).
	 */
	const pinned = useQuery(pinnedStoriesQueryOptions(client, creatorId)).data;

	const personalization = useQuery({
		...personalizationQueryOptions(client),
		enabled: isMember,
	}).data;

	const rows = useMemo(
		() => (stories.data ? creatorStories(stories.data) : []),
		[stories.data],
	);

	/**
	 * The query response is an array and only lookups use a Set. There is no reason to scan a list of
	 * cards against thousands of favorites on every render (same rule as discover).
	 */
	const favorites = useMemo(
		() => new Set(personalization?.favorites ?? []),
		[personalization],
	);

	const state = resolveProfileState({
		/** Passes identity and local storage **but the decision does not use them** (see `profile-state.ts`). */
		context: { session: session.phase, localScope: scope.status },
		profile: {
			status: profile.status,
			paused: profile.fetchStatus === "paused",
			error: profile.error,
			data: profile.data,
		},
	});

	/**
	 * What appears in the header — the decision is one pure function in `@rowcat/domain`.
	 *
	 * The reason `viewer && !own && ...` is not assembled here is that two of the three values
	 * (profile, viewer, personalization) may not have arrived yet. If the conditions were scattered
	 * through JSX, a place would appear where "unknown" silently folds into "no", and the symptom is a
	 * one-time flicker of a button name right after arrival. The web calls **the same function**.
	 */
	const actions = useMemo(
		() =>
			state.kind === "profile"
				? resolveProfileActions(
						state.profile,
						session.viewer?.id ?? null,
						personalization,
					)
				: null,
		[state, session.viewer, personalization],
	);

	const storiesState = resolveProfileStoriesState({
		blocked: actions ? profileContentBlocked(actions) : false,
		stories: {
			status: stories.status,
			paused: stories.fetchStatus === "paused",
			/**
			 * **The existence of loaded query data, not the count.** Writing `rows.length > 0` makes a
			 * successful zero the same value as "never received", and a later background refresh failure
			 * would then turn the empty state into a failure message — discarding an answer we already have.
			 */
			hasData: stories.data !== undefined,
			storyCount: rows.length,
		},
	});

	/**
	 * The place login returns to — **this profile itself.**
	 *
	 * The point is not reusing discover's return path. A guest who presses favorite on a card on this
	 * screen must come back **to this profile**, not to discover.
	 */
	const returnPath = creatorProfilePath(creatorId);

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

	const leave = useCallback(() => router.replace("/"), [router]);

	if (state.kind !== "profile")
		return (
			<Screen>
				<ProfileBar onBack={() => router.back()} />
				<CenteredArea>
					<ProfileUnavailable
						state={state}
						onRetry={() => void profile.refetch()}
						onLeave={leave}
					/>
				</CenteredArea>
			</Screen>
		);

	/** From here on there is a profile — `state` holds that value, so no assertion is needed. */
	const value = state.profile;

	/**
	 * **The body has arrived** — the exit bar (`ProfileBar`) stays outside because two branches share
	 * it (`lib/motion/page-enter.tsx`).
	 *
	 * In this app `PageEnter` signals not the route but **the content resolving** (the native stack
	 * transition already signals the screen's arrival — see the "intended difference" in
	 * `docs/motion/ARCHITECTURE.md`). It does not attach to the placeholder, not-found and error
	 * branches above: those three are states of "not yet", and animating their arrival too would stack
	 * two layers of waiting.
	 *
	 * **The box moves, not the rows.** List cards are appended per page, so they do not each rise
	 * (that would make one `Show more` show twenty rows appearing one by one). Only the one layer holding
	 * the list moves here, so the height the virtualizer measures does not change by a pixel.
	 */
	return (
		<Screen>
			<ProfileBar onBack={() => router.back()} />
			<PageEnter style={grid.fill}>
				<FlatList
					data={storiesState === "stories" ? rows : []}
					keyExtractor={keyOf}
					renderItem={renderCard}
					numColumns={DISCOVER_COLUMNS}
					columnWrapperStyle={grid.row}
					contentContainerStyle={grid.content}
					ListHeaderComponent={
						<View style={grid.header}>
							<ProfileHeader
								profile={value}
								actions={
									/** If there is a profile there is a decision too — the `useMemo` above checks the same condition. */
									actions ?? { kind: "guest" }
								}
								action={action}
								returnPath={returnPath}
							/>
							{/**
							 * Pinned works — the work the owner placed at the top. **If there are none, the section itself does not render** (no title and no empty state).
							 * It does not appear for a creator the viewer has blocked — the decision checks blocking first, in the same order as the grid below.
							 *
							 * It is drawn outside the virtualized list (in the header) because of count: the cap is three, so mounts are always three or fewer, and adding
							 * another `FlatList` would make two vertical scrolls. The card is **the same component** as the grid, with the same half-gutter wrapper.
							 */}
							{storiesState !== "blocked" &&
								pinned !== undefined &&
								pinned.length > 0 && (
									<View style={grid.sectionTitle}>
										<Text
											accessibilityRole="header"
											variant="label"
											weight="semibold"
											tone="muted-foreground"
										>
											Pinned works
										</Text>
										<Separator />
										<View style={grid.pinnedRow}>
											{pinned.map((story) => (
												<StoryCard
													key={story.id}
													story={story}
													favorited={favorites.has(story.id)}
													returnPath={returnPath}
												/>
											))}
										</View>
									</View>
								)}
							{/**
							 * Gives the list a name. The main title of the screen is **a person's name**, so this section has to say what list it is — to those seeing it
							 * and those hearing it.
							 *
							 * **One underline on the quietest text** — the web's equivalent spot is `border-b pb-2 text-sm font-semibold text-muted-foreground`
							 * (`profile-page.tsx`).
							 *
							 * ⚠️ This line was once `variant="heading"` (20). That weight competes with the person's name right above, which makes this screen have two main
							 * titles — a signboard read as large as the list it names.
							 */}
							<View style={grid.sectionTitle}>
								<Text
									accessibilityRole="header"
									variant="label"
									weight="semibold"
									tone="muted-foreground"
								>
									Public stories
								</Text>
								<Separator />
							</View>
						</View>
					}
					ListEmptyComponent={
						<View style={grid.notice}>
							<ProfileStoriesNotice
								state={storiesState}
								onRetry={() => void stories.refetch()}
							/>
						</View>
					}
					ListFooterComponent={
						storiesState === "stories" ? (
							<ListEnd
								pending={stories.isFetchingNextPage}
								hasNext={stories.hasNextPage}
							/>
						) : null
					}
					/**
					 * Next page. The conditions are kept in a pure function because there are three of them — RN
					 * calls this callback several times per scroll, and Query does not merge a request that is
					 * already running. We do not hand-build a second lock.
					 */
					onEndReachedThreshold={0.6}
					onEndReached={() => {
						if (
							canLoadMoreProfileStories(storiesState, {
								hasNext: stories.hasNextPage,
								fetching: stories.isFetchingNextPage,
							})
						)
							void stories.fetchNextPage();
					}}
					/**
					 * Pulling down refetches **both** — what the user is refreshing is this screen, not one query.
					 * The two states still stay split: if only the works query fails, the name and face remain.
					 *
					 * The held values are not cleared first. Clearing the cache to force a placeholder would also
					 * lose what was there if the refresh then fails.
					 */
					refreshing={
						(profile.isRefetching || stories.isRefetching) &&
						!stories.isFetchingNextPage
					}
					onRefresh={() => {
						void profile.refetch();
						void stories.refetch();
					}}
				/>
			</PageEnter>
		</Screen>
	);
}

/** The entity id is the key — keying by index makes cards sit in each other's positions when the list shifts. */
const keyOf = (story: Story) => story.id;

/**
 * The exit bar.
 *
 * Sets no title. The person's name is already the canvas's largest text, and drawing the same words
 * twice makes a screen reader read them twice — the work detail made the same choice for the same
 * reason.
 *
 * Not naming the place you return to is also intentional. The profile is entered from work detail,
 * discover cards and comments, so picking one and writing `Back to Discover` would make the link's name
 * mismatch its destination.
 */
function ProfileBar({ onBack }: { onBack: () => void }) {
	/** Notification bell — a global utility of the shell. The member decision is the component's own. */
	return (
		<AppBar
			navigation={<AppSidebarTrigger />}
			onBack={onBack}
			actions={<ShellUtilities />}
		/>
	);
}

/** End of the list. Either the next page is loading, or one fact: there is no more. */
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
	/**
	 * The wrapping box has to take part in layout. `ScrollView` has `flexGrow: 1` on its own, but
	 * without a parent that gives it the remaining height it does not get it (`PageEnter` has no
	 * default style).
	 */
	fill: { flex: 1 },
	content: { paddingBottom: space["2xl"], paddingTop: screenPadding },
	/**
	 * The header uses the canvas gutter and the grid uses its own — the cells carry a half-gutter, so
	 * the row's margin is smaller (`discover/grid.ts`). Setting both to the same value makes cards
	 * appear half a gutter inward from the name.
	 */
	header: {
		gap: space.lg,
		paddingBottom: space.md,
		paddingHorizontal: screenPadding,
	},
	/** Label and the line beneath it — the web's `pb-2` is the value between them. */
	sectionTitle: { gap: space.sm },
	/**
	 * Pinned row — inside the header, so the edge margin is already the canvas's. Cells carry a
	 * half-gutter, so it is pushed outward by that much to line up the vertical edges with the grid's
	 * cards below.
	 */
	pinnedRow: {
		flexDirection: "row",
		flexWrap: "wrap",
		marginHorizontal: -DISCOVER_CELL_GUTTER,
		marginTop: space.sm,
		rowGap: space.md,
	},
	/** No horizontal gutter here — the gap between columns is carried by the cells, half each (`discover/grid.ts`). */
	row: { marginBottom: space.md, paddingHorizontal: DISCOVER_ROW_INSET },
	notice: { paddingHorizontal: screenPadding },
	/** 20 is off the scale. This is where the spinner turns, so it should be more generous than `lg` and quieter than `xl`. */
	footer: { alignItems: "center", paddingVertical: 20 },
});
