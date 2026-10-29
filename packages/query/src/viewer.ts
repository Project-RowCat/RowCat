import {
	EMPTY_PERSONALIZATION_STATE,
	type PersonalizationState,
	type Viewer,
} from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { ACCOUNT_QUERY_KEY } from "./account.ts";
import { STORY_COMMENTS_QUERY_KEY_PREFIX } from "./comments.ts";
import { CREATOR_ANALYTICS_QUERY_KEY_PREFIX } from "./creator-analytics.ts";
import { CREATOR_COMMENTS_QUERY_KEY_PREFIX } from "./creator-comments.ts";
import { CREATOR_WORKS_QUERY_KEY_PREFIX } from "./creator-work.ts";
import { GALLERY_QUERY_KEY_PREFIX } from "./gallery.ts";
import { MEMBERSHIP_QUERY_KEY_PREFIX } from "./membership.ts";
import { MODERATION_QUERY_KEY_PREFIX } from "./moderation.ts";
import { NOTIFICATIONS_QUERY_KEY_PREFIX } from "./notifications.ts";
import {
	CREATOR_STORIES_QUERY_KEY_PREFIX,
	OWN_PINNED_STORIES_QUERY_KEY,
	PINNED_STORIES_QUERY_KEY_PREFIX,
} from "./profile.ts";
import {
	RELATED_STORIES_QUERY_KEY_PREFIX,
	STORY_DETAIL_QUERY_KEY_PREFIX,
	STORY_PLAYBACK_QUERY_KEY_PREFIX,
} from "./story.ts";
import { THEME_CUSTOMIZATION_QUERY_KEY } from "./theme.ts";

/**
 * Viewer server state, shared by the whole app. The source of truth is /me. If the screen read the
 * Better Auth client's session hook directly, there would be two states ('a session exists but the
 * member lookup is empty'), and no way to decide which to trust when they disagree. The auth client
 * is used only to perform login and logout.
 */
export const VIEWER_QUERY_KEY = ["viewer"] as const;

/**
 * Placing personalization under the viewer is intentional: one logout can invalidate everything
 * tied to the viewer through the ['viewer'] prefix.
 *
 * The id lists are not part of the key. They are response data, not request identity; including
 * them would create a new cache entry every time a favorite was added.
 */
export const PERSONALIZATION_QUERY_KEY = ["viewer", "personalization"] as const;

/**
 * staleTime is not infinite. Member state (suspension, adult verification) changes on the server
 * regardless of this browser, and with infinity the change would not show until the tab closed.
 * With zero, the value provided by SSR would be refetched right after hydration.
 */
export function viewerQueryOptions(client: RowCatClient) {
	return queryOptions<Viewer | null>({
		queryKey: VIEWER_QUERY_KEY,
		queryFn: ({ signal }) => client.me.get({ signal }),
		staleTime: 60_000,
	});
}

/**
 * Batch of favorite, follow and block ids. It exists so each card does not query its relation
 * separately.
 */
export function personalizationQueryOptions(client: RowCatClient) {
	return queryOptions<PersonalizationState>({
		queryKey: PERSONALIZATION_QUERY_KEY,
		queryFn: ({ signal }) => client.me.state({ signal }),
		staleTime: 60_000,
	});
}

/**
 * Server-state cleanup after logout. Better Auth clears the cookie; this function reflects that in
 * the cache. Without it, the screen keeps drawing the nickname and hearts, and data received under
 * the old session stays until the next query finishes.
 *
 * The gallery is cleared too, because list results themselves depend on the viewer (own private
 * works, adult display, blocked creators). Keeping a list fetched while logged in would show
 * private works on the logged-out screen.
 *
 * Viewer and personalization are seeded with guest values first and then invalidated, to avoid
 * flicker. Invalidating alone would keep drawing the previous logged-in values until the refetch
 * finished.
 */
export async function resetViewerState(
	queryClient: QueryClient,
): Promise<void> {
	queryClient.setQueryData<Viewer | null>(VIEWER_QUERY_KEY, null);
	queryClient.setQueryData<PersonalizationState>(
		PERSONALIZATION_QUERY_KEY,
		EMPTY_PERSONALIZATION_STATE,
	);
	await Promise.all([
		// The ['viewer'] prefix covers personalization and account too.
		queryClient.invalidateQueries({ queryKey: VIEWER_QUERY_KEY }),
		/**
		 * Account info is reset, not just invalidated: the stored value is dropped. The prefix
		 * invalidation above reaches this slot, but invalidation only marks it stale and keeps the value.
		 * Viewer and personalization are seeded with guest values just above, so nothing remains there.
		 * This slot would keep the email in memory (and in the query devtools) of a logged-out browser
		 * for minutes, since nothing observes it and it is not refetched.
		 *
		 * The login side (refreshViewerState) already uses resetQueries, so only logout is asymmetric. A
		 * separate account cleanup mechanism would create two logout paths, and one would eventually be
		 * fixed while the other is not.
		 */
		queryClient.resetQueries({ queryKey: ACCOUNT_QUERY_KEY }),
		/**
		 * Moderation is reset too. This prefix holds the person's sanction reasons and, if they were an
		 * operator, other people's report evidence. Invalidation alone would leave it in the next
		 * person's browser memory, since nothing observes it and it is not refetched. This is the state
		 * the §85 rule is meant to prevent.
		 */
		queryClient.resetQueries({ queryKey: MODERATION_QUERY_KEY_PREFIX }),
		/**
		 * Notifications are reset too, and this is the least visible risk in this function. The prefix
		 * sits under ['viewer'], so the prefix invalidation reaches it, but invalidation keeps the value.
		 * What is stored here is the list of who followed this person, comments on their works and
		 * sanctions on their account. The header badge redraws immediately once an observer exists, so
		 * without clearing, the previous person's unread count stays on screen before the next person
		 * even logs in (§76, §123).
		 *
		 * Viewer and personalization are not seeded with guest values, because guests have no inbox: the
		 * bell is simply not drawn.
		 */
		queryClient.resetQueries({ queryKey: NOTIFICATIONS_QUERY_KEY_PREFIX }),
		/**
		 * The creator workspace's own-works list is reset too, for the same reason as notifications, and
		 * its contents are more private. The slot holds titles of works not yet published to anyone,
		 * including private and archived ones. Invalidation keeps the value, so the next person opening
		 * /create would see the previous person's manuscript titles until the refetch finished.
		 */
		queryClient.resetQueries({ queryKey: CREATOR_WORKS_QUERY_KEY_PREFIX }),
		/**
		 * Creator analytics are reset as well, for the same reason as own-works. The stored value
		 * includes how widely each work was read, alongside the titles. Invalidation alone would show the
		 * previous person's unpublished titles and performance on /create?view=analytics until the
		 * refetch finished.
		 */
		queryClient.resetQueries({ queryKey: CREATOR_ANALYTICS_QUERY_KEY_PREFIX }),
		/**
		 * The creator comment inbox is reset too, for the same reason as analytics. The stored value
		 * holds the previous person's work titles (including archived ones) and other people's comments
		 * on them. Invalidation alone would draw that list on /create?view=comments until the refetch
		 * finished.
		 */
		queryClient.resetQueries({ queryKey: CREATOR_COMMENTS_QUERY_KEY_PREFIX }),
		/**
		 * Own pinned works are reset too, for the same reason as own-works. Pins set to private are
		 * included in this slot, so invalidation alone would show the previous person's private titles on
		 * the next person's account screen until the refetch finished.
		 */
		queryClient.resetQueries({ queryKey: OWN_PINNED_STORIES_QUERY_KEY }),
		/**
		 * Membership status is reset too. The prefix sits under ['viewer'], so invalidation reaches it,
		 * but invalidation keeps the value. What is stored here is that this person is under 14 and the
		 * state of any pending guardian consent. If the next person on a shared browser saw it, a minor's
		 * private information would leak.
		 *
		 * The guardian-screen cache (['guardian', token]) is deliberately not touched here. It belongs to
		 * the person who received the link, not to the viewer, and a logout must not erase a consent
		 * process in progress.
		 */
		queryClient.resetQueries({ queryKey: MEMBERSHIP_QUERY_KEY_PREFIX }),
		/**
		 * Account theme colors are reset too, and omitting this slot would be visible. The prefix sits
		 * under ['viewer'], so invalidation reaches it, but invalidation keeps the value. What is stored
		 * here is the color actually painted on screen. If left, a logged-out browser keeps the
		 * background and accent colors the previous person chose, until the next login, and afterwards
		 * too while freshness lasts.
		 *
		 * The runtime apply layer removes the override as soon as the viewer disappears, so the screen
		 * falls back to default colors at once. This line is the second defense: it leaves no material
		 * for that layer to paint again.
		 */
		queryClient.resetQueries({ queryKey: THEME_CUSTOMIZATION_QUERY_KEY }),
		queryClient.invalidateQueries({ queryKey: GALLERY_QUERY_KEY_PREFIX }),
		/**
		 * Detail is reset, not invalidated: the stored value is dropped. The list can usually still be
		 * seen logged out (public works), so marking it stale and refetching is enough. The detail cache,
		 * however, may hold whole works only this viewer could see (own private, adult works). Keeping
		 * that payload and marking it stale would keep drawing another identity's content until a refetch
		 * receives a 404, and if freshness remains, no refetch happens at all.
		 *
		 * removeQueries is not used because the detail screen runs on useSuspenseQuery. Removing the
		 * entry would leave the component suspended with no observer, and the follow-up refetch result (a
		 * 404 for guests) would have no one to receive it, so the screen would stay on the placeholder
		 * forever. reset achieves the same data drop while keeping the link to the screen that observes
		 * it.
		 */
		queryClient.resetQueries({ queryKey: STORY_DETAIL_QUERY_KEY_PREFIX }),
		/**
		 * Comments are reset too. The lines themselves are usually public, but when the identity changes,
		 * the permission on each line changes. The cached list holds Alice's comments, and the screen
		 * decides whether to draw delete by comparing the viewer id with the author id. Keeping the
		 * values while switching the viewer to guest would leave the boundary between 'others' comment'
		 * and 'my comment' drawn under the previous identity until refetch.
		 *
		 * As with detail, a comment thread may hold the discussion of works only this viewer could see.
		 * reset clears the data but re-triggers observed queries, so it does not freeze a suspended
		 * screen.
		 */
		queryClient.resetQueries({ queryKey: STORY_COMMENTS_QUERY_KEY_PREFIX }),
		/**
		 * The public profile's work grid is reset too, for the same reason as on login. This prefix is
		 * also outside ['viewer'] (it is ['creators', 'stories']), so the prefix invalidation above does
		 * not reach it. The grid's contents depend on the viewer (adult display, blocked creators). The
		 * profile itself stays: it is the same public value for everyone, so there is no reason to clear
		 * it.
		 */
		queryClient.resetQueries({ queryKey: CREATOR_STORIES_QUERY_KEY_PREFIX }),
		/** The pinned slot is on the same axis as the grid: its contents differ by viewer. */
		queryClient.resetQueries({ queryKey: PINNED_STORIES_QUERY_KEY_PREFIX }),
		...resetStoryBodies(queryClient),
	]);
}

/**
 * Playback bodies and related works: both identity-change cleanups clear these together. An earlier
 * version of the comments said logout clears ['stories'] wholesale, which was not true (the two
 * functions cleared only gallery, detail and comments). In that gap, a playback body the previous
 * person had paid for (a compiled artifact or conversation snapshot) opened at the same address for
 * the next person without a request, skipping the payment check, and the related-works list kept
 * the previous person's private works. Since prefixes are listed one by one here, this function is
 * where neither gets missed.
 */
function resetStoryBodies(queryClient: QueryClient): Promise<void>[] {
	return [
		queryClient.resetQueries({ queryKey: STORY_PLAYBACK_QUERY_KEY_PREFIX }),
		queryClient.resetQueries({ queryKey: RELATED_STORIES_QUERY_KEY_PREFIX }),
	];
}

/**
 * Server-state cleanup right after login, the counterpart of resetViewerState. It is deliberately
 * not symmetric with logout. Logout knows the result, so it writes guest values first and then
 * invalidates (no flicker). Login cannot know who the new viewer is here; /me answers that. So
 * stored values are cleared and the next query asks the server.
 *
 * It uses resetQueries rather than invalidateQueries. Invalidation marks stale but keeps the value,
 * and the ensureQueryData used by route loaders returns an existing value as is. The person who
 * just logged in would then get a screen drawn with the pre-login guest viewer. The value must be
 * emptied so the next ensureQueryData asks the server.
 *
 * Gallery, detail and comments are cleared together, as on logout: lists and works depend on the
 * viewer (private, adult, blocked), and comments also depend on which line belongs to whom. Keeping
 * a list fetched as a guest would show pre-login results on the logged-in screen.
 */
export async function refreshViewerState(
	queryClient: QueryClient,
): Promise<void> {
	await Promise.all([
		/**
		 * ['viewer'] covers personalization, account and notifications too, so the account email and the
		 * previous person's inbox are emptied here. The login side already uses resetQueries from the
		 * start, so unlike logout it needs no extra line.
		 */
		queryClient.resetQueries({ queryKey: VIEWER_QUERY_KEY }),
		/**
		 * Moderation is outside ['viewer'] (it is ['moderation']), so the prefix reset above does not
		 * reach it. Without this line, an identity switch that skips logout (a session expiry followed by
		 * logging in as another account) would keep the previous person's sanction reasons and, if they
		 * were an operator, other people's report evidence. The logout side already has the same line,
		 * and the two functions have no reason to diverge on this axis.
		 */
		queryClient.resetQueries({ queryKey: MODERATION_QUERY_KEY_PREFIX }),
		queryClient.resetQueries({ queryKey: GALLERY_QUERY_KEY_PREFIX }),
		queryClient.resetQueries({ queryKey: STORY_DETAIL_QUERY_KEY_PREFIX }),
		queryClient.resetQueries({ queryKey: STORY_COMMENTS_QUERY_KEY_PREFIX }),
		queryClient.resetQueries({ queryKey: CREATOR_STORIES_QUERY_KEY_PREFIX }),
		queryClient.resetQueries({ queryKey: PINNED_STORIES_QUERY_KEY_PREFIX }),
		...resetStoryBodies(queryClient),
	]);
}
