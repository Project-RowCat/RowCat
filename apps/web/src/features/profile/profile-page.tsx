import { profileContentBlocked, resolveProfileActions } from "@rowcat/domain";
import {
	creatorStories,
	creatorStoriesInfiniteQueryOptions,
	personalizationQueryOptions,
	pinnedStoriesQueryOptions,
	publicProfileQueryOptions,
	viewerQueryOptions,
} from "@rowcat/query";
import {
	useQuery,
	useSuspenseInfiniteQuery,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { GALLERY_GRID_CLASS } from "#/features/gallery/gallery-grid.ts";
import { GalleryLoadMore } from "#/features/gallery/gallery-load-more.tsx";
import { StoryCard } from "#/features/gallery/story-card.tsx";
import { StoryPreviewDialog } from "#/features/story/story-preview-dialog.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { enterTransition } from "#/lib/motion/transitions.ts";
import { ProfileBlocked } from "./profile-blocked.tsx";
import { ProfileEmpty } from "./profile-empty.tsx";
import { ProfileHeader } from "./profile-header.tsx";
import { ProfileShell } from "./profile-shell.tsx";

const route = getRouteApi("/(app)/creators/$creatorId");

/**
 * - Writes are limited to two relationships, follow and block (`profile-header.tsx`). Neither
 *   changes the profile's content. Name and bio are edited only in the account, and the own-profile
 *   link goes there. If the public screen began doubling as an edit screen, what others see and
 *   what the owner edits would blur.
 * - No activity feed, follower list, or DM yet. The relationship graph being able to support them
 *   is not a reason to add screens.
 * - Two queries are split on purpose. The profile is a small value identical for everyone; the
 *   works grid is a large value that depends on the viewer. Each has its own cache slot and
 *   freshness (`@rowcat/query`), so fetching the second does not refetch the name and bio.
 * - Visibility is not judged here. Private, archived, blocked, and adult-gate rules are baked
 *   into the server predicate (`routes/creators.ts` → `galleryWhere`). Works that arrive are
 *   already visible to this viewer. Repeating the check here would create two judgments that could
 *   diverge, with no way to say which is right.
 * - Cards and previews are the discover screen's own, unchanged. A profile-specific card would
 *   make the same work look different from screen to screen, and behaviors such as favorite and
 *   start would exist on one side only.
 */
export function ProfilePage() {
	const { t } = useTranslation("profile");
	const { creatorId } = route.useParams();
	const client = getRowCatClient();

	/**
	 * Uses the same options factory as the route loader. The key and fetch function are identical, so
	 * the value server rendering sent becomes this component's cache entry as-is. Re-spelling the key
	 * here would fetch a profile the server already loaded, once more right after hydration.
	 */
	const { data: profile } = useSuspenseQuery(
		publicProfileQueryOptions(client, creatorId),
	);
	const {
		data,
		hasNextPage,
		isFetchingNextPage,
		isFetchNextPageError,
		fetchNextPage,
	} = useSuspenseInfiniteQuery(
		creatorStoriesInfiniteQueryOptions(client, creatorId),
	);

	const stories = useMemo(() => creatorStories(data), [data]);

	/**
	 * The pinned-works row is not a suspense boundary. It is emphasis placed in front of the grid and
	 * adds no information: every pinned work also appears in the grid. A slow or failed request
	 * therefore does not block the screen; the row simply does not render. No sentence describes a
	 * failure as `no featured works`.
	 */
	const pinned = useQuery(pinnedStoriesQueryOptions(client, creatorId)).data;
	const pinnedStories = pinned ?? [];

	/**
	 * Viewer and personalization do not block the profile: names and works must show even before the
	 * heart state is known. Only these two are not `useSuspenseQuery`.
	 *
	 * Guests are not asked for personalization at all. The server would return an empty array, but the
	 * round trip would only add delay to the first paint.
	 *
	 * Ownership is decided from this query, and it is important not to judge with a viewer cached from
	 * an earlier account. Switching accounts clears this slot first (`refreshViewerState`), and the
	 * own-profile link disappears at that moment.
	 */
	const viewer = useQuery(viewerQueryOptions(client)).data ?? null;
	const personalization = useQuery({
		...personalizationQueryOptions(client),
		enabled: viewer !== null,
	}).data;

	/**
	 * Query results are kept as arrays, since they must be serializable to cross SSR. Lookups use a
	 * Set. Same reason as on the discover screen, so the same cards see the same values.
	 */
	const favorites = useMemo(
		() => new Set(personalization?.favorites ?? []),
		[personalization],
	);

	/**
	 * Header actions are decided by one pure function, `resolveProfileActions` in @rowcat/domain. The
	 * expression `viewer && !own && ...` is not assembled in JSX, because one of the three inputs may
	 * not have arrived yet. Scattering the conditions through JSX would let "unknown" silently turn
	 * into "no", which shows up as a button label that flickers once after a refresh.
	 */
	const actions = useMemo(
		() => resolveProfileActions(profile, viewer?.id ?? null, personalization),
		[profile, viewer, personalization],
	);

	/**
	 * The preview holds only the id. Holding the work object would freeze a snapshot, so pressing the
	 * heart inside the preview would appear to leave the count stuck.
	 */
	const [previewId, setPreviewId] = useState<string | null>(null);
	const previewStory =
		pinnedStories.find((story) => story.id === previewId) ??
		stories.find((story) => story.id === previewId) ??
		null;
	const closePreview = useCallback(() => setPreviewId(null), []);

	return (
		<ProfileShell>
			{/*
			 * The entrance motion wraps the whole screen. Unlike the work-detail and discover screens, this
			 * screen
			 * has no placeholder and no shared fixed frame (back link, title). The header is the person's name,
			 * so
			 * the entire screen should change together on arrival.
			 */}
			<PageEnter>
				<ProfileHeader profile={profile} viewer={viewer} actions={actions} />

				{/*
				 * Pinned works are what the owner placed at the top. With no pinned works, the section does not
				 * exist:
				 * no title and no empty state. Not having pinned anything is not a fact to state as `No featured works`;
				 * the grid already lists everything. Not shown to a blocked creator. The server also returns zero
				 * there,
				 * but the block is checked first, in the same order as the grid.
				 *
				 * Cards are the same component as the grid. If pinning changed a card's shape, the same work would
				 * look
				 * different on one screen, and behaviors such as the heart or preview would appear on only one
				 * side.
				 */}
				{!profileContentBlocked(actions) && pinnedStories.length > 0 && (
					<section aria-labelledby="profile-pinned-heading" className="mt-8">
						<h2
							id="profile-pinned-heading"
							className="border-b pb-2 text-sm font-semibold text-muted-foreground"
						>
							{t("pinned")}
						</h2>
						<div className={`mt-4 ${GALLERY_GRID_CLASS}`}>
							{/*
							 * `initial={false}` keeps the cards' entrance values out of the server HTML. Cards start at
							 * `opacity: 0` with a motion, so without this boundary the pinned row would look empty until
							 * JavaScript
							 * arrives (see `CARD_ENTER` in `story-card.tsx`).
							 */}
							<AnimatePresence initial={false}>
								{pinnedStories.map((story) => (
									<StoryCard
										key={story.id}
										story={story}
										favorited={favorites.has(story.id)}
										viewer={viewer}
										onPreview={() => setPreviewId(story.id)}
									/>
								))}
							</AnimatePresence>
						</div>
					</section>
				)}

				{/*
				 * Names the list. The page's `h1` is the person's name, so this section must state what it lists,
				 * both
				 * visually and for assistive tech.
				 *
				 * One separator was removed. A separate `Separator` plus a separate title created two boundaries
				 * doing
				 * the same job and pushed the works further down. The title now carries its own rule beneath it,
				 * serving as both boundary and label.
				 *
				 * The title is deliberately small and quiet. The work cards should be read here; this line is a
				 * label
				 * introducing them, and a bold, large title would compete with the cover art. `mt-8` is the only
				 * boundary between the header and this line.
				 */}
				<section aria-labelledby="profile-stories-heading" className="mt-8">
					<h2
						id="profile-stories-heading"
						className="border-b pb-2 text-sm font-semibold text-muted-foreground"
					>
						{t("publicWorks")}
					</h2>

					{/*
					 * Switches between the list and the empty state. The outgoing side has no `exit`, as on the
					 * discover
					 * screen. Motion would begin to dictate when content appears, so the switch stops there.
					 * `initial={false}` keeps the first server render intact, since it already shows the final value.
					 */}
					<AnimatePresence initial={false}>
						{/*
						 * Blocking is checked first. The server returns zero works for a blocked creator, so the data alone
						 * is
						 * indistinguishable from an empty profile.
						 */}
						{profileContentBlocked(actions) ? (
							<m.div
								key="blocked"
								className="mt-4"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								transition={enterTransition}
							>
								<ProfileBlocked />
							</m.div>
						) : stories.length === 0 ? (
							<m.div
								key="empty"
								className="mt-4"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								transition={enterTransition}
							>
								<ProfileEmpty own={actions.kind === "own"} />
							</m.div>
						) : (
							<m.div
								key="grid"
								className={`mt-4 ${GALLERY_GRID_CLASS}`}
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								transition={enterTransition}
							>
								<AnimatePresence initial={false}>
									{stories.map((story) => (
										<StoryCard
											key={story.id}
											story={story}
											favorited={favorites.has(story.id)}
											viewer={viewer}
											onPreview={() => setPreviewId(story.id)}
										/>
									))}
								</AnimatePresence>
							</m.div>
						)}
					</AnimatePresence>

					{/*
					 * The end-of-list marker is drawn only when there is a list. At zero works, "you've seen
					 * everything"
					 * would contradict the empty state.
					 *
					 * The discover screen's component is reused as-is. The infinite-scroll rules (prefetch distance,
					 * placeholders, keyboard button, end marker) belong to the infinite-scroll mechanism, not to a
					 * screen. A
					 * second copy for profiles would eventually be fixed in only one place.
					 */}
					{stories.length > 0 && !profileContentBlocked(actions) && (
						<GalleryLoadMore
							hasNext={hasNextPage}
							pending={isFetchingNextPage}
							failed={isFetchNextPageError}
							onLoadMore={() => fetchNextPage()}
						/>
					)}
				</section>
			</PageEnter>

			{/*
			 * One container is placed for the whole list, not one per card. A container per card would mean
			 * twenty-four instances, while only one can be open at a time.
			 */}
			<StoryPreviewDialog
				story={previewStory}
				favorites={favorites}
				viewer={viewer}
				onClose={closePreview}
			/>
		</ProfileShell>
	);
}
