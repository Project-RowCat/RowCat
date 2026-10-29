import type {
	LoginMethodDisconnectDto,
	NicknameUpdateDto,
	PasskeyDeleteDto,
	PasskeyRenameDto,
	SessionRevokeDto,
	SetPasswordDto,
	ShowAdultUpdateDto,
} from "@rowcat/contracts";
import type {
	AccountDetails,
	AccountPasskey,
	AccountSession,
	Viewer,
} from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import { GALLERY_QUERY_KEY_PREFIX } from "./gallery.ts";
import { patchPublicProfileName } from "./profile.ts";
import {
	RELATED_STORIES_QUERY_KEY_PREFIX,
	STORY_DETAIL_QUERY_KEY_PREFIX,
} from "./story.ts";
import { VIEWER_QUERY_KEY } from "./viewer.ts";

/**
 * Server-state cache policy for account data and account writes. Everything here is server state.
 * - Local data (conversations, drafts) does not belong here. Changing a nickname or adult flag
 *   does not change Viewer.id, so scoping on it would close and reopen IndexedDB on every settings
 *   change, dropping in-flight conversation writes.
 * - No navigation, toasts, or form state: this package is shared by the web app and the upcoming
 *   Expo app.
 */

/**
 * Lives under ["viewer"] on purpose. Login and logout already clear the cache by that prefix
 * (resetViewerState, refreshViewerState), so the account needs no cleanup of its own. A separate
 * cleanup path would drift. This cell holds the email, so surviving an account change is the
 * costliest failure.
 */
export const ACCOUNT_QUERY_KEY = ["viewer", "account"] as const;

/**
 * staleTime matches the viewer's. Infinite staleness would hide changes made on other devices (such
 * as email verification) until the tab closes; zero would refetch the SSR value right after
 * hydration. Attach this query only to the account route. On the root loader or header, the email
 * would be in the SSR HTML of every route, which defeats the reason it is split from /me.
 */
export function accountQueryOptions(client: RowCatClient) {
	return queryOptions<AccountDetails>({
		queryKey: ACCOUNT_QUERY_KEY,
		queryFn: ({ signal }) => client.me.account({ signal }),
		staleTime: 60_000,
	});
}

/**
 * What the optimistic rollback needs: only the previous value of the viewer cell. Work and detail
 * caches are not snapshotted. This write does not patch them by hand; it asks the server again
 * through invalidation or reset, so there is nothing to restore.
 */
interface ViewerSnapshot {
	/**
	 * Whether the viewer cache existed when onMutate ran. If it did not, rollback does not create it.
	 */
	wasCached: boolean;
	viewer: Viewer | null | undefined;
}

/**
 * Optimistically patches one viewer cell and captures the previous value for rollback. In-flight
 * /me queries are cancelled first: a late response would overwrite the value just painted, so the
 * user's change would flash and vanish.
 */
async function optimisticViewerPatch(
	queryClient: QueryClient,
	patch: (viewer: Viewer) => Viewer,
): Promise<ViewerSnapshot> {
	await queryClient.cancelQueries({ queryKey: VIEWER_QUERY_KEY });
	const viewer = queryClient.getQueryData<Viewer | null>(VIEWER_QUERY_KEY);
	queryClient.setQueryData<Viewer | null>(VIEWER_QUERY_KEY, (prev) =>
		// Does not create a missing cell. A guest (null) has no viewer to patch.
		prev ? patch(prev) : prev,
	);
	return { wasCached: viewer !== undefined, viewer };
}

/** Restores the captured value. A cell that did not exist at the start stays absent. */
function rollbackViewer(
	queryClient: QueryClient,
	snapshot: ViewerSnapshot | undefined,
): void {
	if (!snapshot?.wasCached) return;
	queryClient.setQueryData<Viewer | null>(
		VIEWER_QUERY_KEY,
		snapshot.viewer ?? null,
	);
}

/**
 * Cache policy for a nickname change. Three cells move:
 * - Viewer: patched optimistically, then set to the server's value, since the header reads this
 *   cell.
 * - Public profile: patched by hand, because it holds exactly one person and its staleTime is
 *   long (5 min).
 * - Gallery and work detail: invalidated, not reset, because the set of visible works does not
 *   change with the name. Cached work DTOs are deliberately not rewritten by hand: the server
 *   answers creator names by join, and copying them client-side would spread to follows, comments,
 *   and notifications. Personalization and account caches are left alone; the nickname is in
 *   neither the favorites list nor the email.
 */
export function nicknameMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
) {
	return mutationOptions<Viewer, Error, NicknameUpdateDto, ViewerSnapshot>({
		mutationFn: (input) => client.me.updateNickname(input),

		onMutate: ({ nickname }) =>
			/**
			 * Optimistic value also trims surrounding whitespace. The SDK sends the trimmed value, so
			 * drawing the raw input here would shift the header name slightly when the response arrives.
			 */
			optimisticViewerPatch(queryClient, (viewer) => ({
				...viewer,
				nickname: nickname.trim(),
			})),

		onError: (_error, _input, snapshot) => {
			rollbackViewer(queryClient, snapshot);
		},

		onSuccess: async (viewer) => {
			// Overwrite with the server-confirmed value; it can differ from the optimistic one (the server
			// trims further).
			queryClient.setQueryData<Viewer | null>(VIEWER_QUERY_KEY, viewer);
			/**
			 * The public profile address does not change: identity is member.id, and the name is only a
			 * display value. Only the name field inside that cell needs patching. Had the nickname been the
			 * address, the cache entry would have to move.
			 */
			patchPublicProfileName(queryClient, viewer.id, viewer.nickname);
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: GALLERY_QUERY_KEY_PREFIX }),
				queryClient.invalidateQueries({
					queryKey: STORY_DETAIL_QUERY_KEY_PREFIX,
				}),
			]);
		},
	});
}

/**
 * Adult display changes must reset rather than invalidate. Cached adult works must not be shown,
 * not merely marked stale; invalidation would keep them drawn until refetch. resetQueries discards
 * the values and refetches observed queries. removeQueries would drop entries that useSuspenseQuery
 * observers wait on, leaving them stuck on the placeholder. Turning it on goes through the same
 * path: the result set grows, and placement is decided by server ordering and exposure rules, which
 * the client must not mimic. Personalization caches are left alone; favorite, follow, and block ids
 * do not depend on this setting.
 */
export function showAdultMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
) {
	return mutationOptions<Viewer, Error, ShowAdultUpdateDto, ViewerSnapshot>({
		mutationFn: (input) => client.me.updateShowAdult(input),

		onMutate: ({ showAdult }) =>
			optimisticViewerPatch(queryClient, (viewer) => ({
				...viewer,
				showAdult,
			})),

		/**
		 * Reached when the server rejects turning this on without eligibility. Without rollback, the
		 * switch stays on and draws a state the server refused as if it were true.
		 */
		onError: (_error, _input, snapshot) => {
			rollbackViewer(queryClient, snapshot);
		},

		onSuccess: async (viewer) => {
			queryClient.setQueryData<Viewer | null>(VIEWER_QUERY_KEY, viewer);
			await Promise.all([
				queryClient.resetQueries({ queryKey: GALLERY_QUERY_KEY_PREFIX }),
				queryClient.resetQueries({ queryKey: STORY_DETAIL_QUERY_KEY_PREFIX }),
				/**
				 * Related works are also a list filtered by the adult-display axis, so clear them for the same
				 * reason as the gallery.
				 */
				queryClient.resetQueries({
					queryKey: RELATED_STORIES_QUERY_KEY_PREFIX,
				}),
			]);
		},
	});
}

/*
 * Account security writes (login methods and sessions) share one rule: only the changed cells get
 * the server-confirmed value. No invalidation and no optimistic update. A briefly painted lie here
 * ("this device can no longer access" or "this login method is gone") could make someone leave
 * believing it, so the screen paints only after the server confirms. The whole ["viewer"] prefix is
 * not invalidated (§29): changing a password has no reason to refetch gallery, notifications,
 * payments, or analytics.
 */

/**
 * Placed under ACCOUNT_QUERY_KEY on purpose. The logout cleanup (resetViewerState) already clears
 * that key with resetQueries, and prefix matching sweeps this cell too; a separate cleanup
 * mechanism would only create a second logout path that could drift. The cell holds which devices
 * the person is logged in on, which must not persist for the next person on a shared browser.
 * Refetching only account info needs exact: true, which is why the writes below use setQueryData:
 * they know exactly what changed.
 */
export const ACCOUNT_SESSIONS_QUERY_KEY = [
	"viewer",
	"account",
	"sessions",
] as const;

/**
 * staleTime is 0, unlike account info (60s). This list answers "who is logged into my account right
 * now"; a stale list would omit a device that just logged in, defeating the screen's purpose. The
 * account route loader deliberately does not prefetch this query: it can fail on Better Auth's
 * fresh-session requirement for people who have been logged in a long time, and that failure must
 * stay contained in this section.
 */
export function accountSessionsQueryOptions(client: RowCatClient) {
	return queryOptions<AccountSession[]>({
		queryKey: ACCOUNT_SESSIONS_QUERY_KEY,
		queryFn: ({ signal }) => client.me.sessions({ signal }),
		staleTime: 0,
	});
}

/**
 * Only the account info cell moves: hasPassword becomes true and methods gains a credential. The
 * server-confirmed account is written as-is. Sessions are not touched. Setting a password must not
 * sign other devices out; that action has its own button and confirmation dialog. Revoking here
 * would make the user read an action they did not take.
 */
export function setPasswordMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
) {
	return mutationOptions<AccountDetails, Error, SetPasswordDto>({
		mutationFn: (input) => client.me.setPassword(input),
		onSuccess: (account) => {
			queryClient.setQueryData<AccountDetails>(ACCOUNT_QUERY_KEY, account);
		},
	});
}

/**
 * Only the account info cell moves. The viewer (/me) is not touched: disconnecting a login method
 * leaves the member identity intact, and invalidating ["viewer"] would blur that in code (local
 * data scoping keys on the viewer id). Sessions are not touched either: disconnecting a provider
 * stops future logins through it but does not end sessions already open, so the screen must not
 * draw that.
 */
export function disconnectLoginMethodMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
) {
	return mutationOptions<AccountDetails, Error, LoginMethodDisconnectDto>({
		mutationFn: (input) => client.me.disconnectLoginMethod(input),
		onSuccess: (account) => {
			queryClient.setQueryData<AccountDetails>(ACCOUNT_QUERY_KEY, account);
		},
	});
}

/**
 * Single and bulk revocation share one function because both responses carry the same thing (the
 * list after the change), so the policy is one. Splitting them would let the list update
 * differently depending on which action was used. The server's list is written as-is rather than
 * having rows removed by hand: a hand-edited list becomes what the client believes happened, and
 * sessions from other devices that appear at the same moment would never show up. Account info is
 * not touched; revoking sessions changes neither email nor login methods.
 */
function sessionRevokeCachePolicy(queryClient: QueryClient) {
	return (sessions: AccountSession[]): void => {
		queryClient.setQueryData<AccountSession[]>(
			ACCOUNT_SESSIONS_QUERY_KEY,
			sessions,
		);
	};
}

/** Revokes one session. Idempotent: sending the same request twice gives the same result. */
export function revokeSessionMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
) {
	const apply = sessionRevokeCachePolicy(queryClient);
	return mutationOptions<AccountSession[], Error, SessionRevokeDto>({
		mutationFn: (input) => client.me.revokeSession(input),
		onSuccess: apply,
	});
}

/**
 * Keeps only the current session and revokes all others. It takes no argument for which session to
 * keep.
 */
export function revokeOtherSessionsMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
) {
	const apply = sessionRevokeCachePolicy(queryClient);
	return mutationOptions<AccountSession[], Error, void>({
		mutationFn: () => client.me.revokeOtherSessions(),
		onSuccess: apply,
	});
}

/**
 * Returning from a provider link flow: refetch account info only. exact: true is the point. Without
 * it, prefix matching would also invalidate the sessions list, but linking a provider neither
 * creates nor ends a session (the same session comes back). Invalidation is used rather than
 * setQueryData because the response is not held: the OAuth round trip returns by redirect, with no
 * place to carry the confirmed account. Same judgment as invalidating `Published works` after publishing.
 * The whole ["viewer"] is not invalidated: linking does not change member identity, so viewer,
 * personalization, notifications, and payments have no reason to refetch.
 */
export async function invalidateAccountDetails(
	queryClient: QueryClient,
): Promise<void> {
	await queryClient.invalidateQueries({
		queryKey: ACCOUNT_QUERY_KEY,
		exact: true,
	});
}

/*
 * Registration is not in this file. The WebAuthn ceremony runs directly between the browser and the
 * authenticator client, not as a mutation: the challenge cookie is bound to that round trip. After
 * success, the only step is to refetch the list (invalidateAccountPasskeys).
 */

/**
 * Placed under ACCOUNT_QUERY_KEY, next to the sessions key. Logout cleanup already clears that
 * prefix with resetQueries, so no separate mechanism is needed. The cell holds which devices the
 * person can log in with, which must not carry over to the next person on a shared browser.
 */
export const ACCOUNT_PASSKEYS_QUERY_KEY = [
	"viewer",
	"account",
	"passkeys",
] as const;

/**
 * staleTime is 0, for the same reason as sessions: a passkey just registered on another device must
 * appear, otherwise the user concludes registration failed and registers again. The account route
 * loader does not prefetch this either. The list fills one section of the account screen, and its
 * failure must stay inside that section.
 */
export function accountPasskeysQueryOptions(client: RowCatClient) {
	return queryOptions<AccountPasskey[]>({
		queryKey: ACCOUNT_PASSKEYS_QUERY_KEY,
		queryFn: ({ signal }) => client.me.passkeys({ signal }),
		staleTime: 0,
	});
}

/**
 * Writes the server-returned list as-is. Renaming and deleting share this policy because both
 * responses carry the same thing (the list after the change). No optimistic update: a briefly
 * painted lie here is "this device can no longer log in", which someone could trust and leave on.
 * Account info is untouched: a passkey is not a LoginMethodProvider value, so neither that list nor
 * hasPassword moves. Invalidating here would make the code read as if the two models were one.
 * Sessions are not touched either: deleting a passkey does not end open sessions.
 */
function passkeyListCachePolicy(queryClient: QueryClient) {
	return (passkeys: AccountPasskey[]): void => {
		queryClient.setQueryData<AccountPasskey[]>(
			ACCOUNT_PASSKEYS_QUERY_KEY,
			passkeys,
		);
	};
}

/** Renames a passkey. On failure the old label stays; there is no optimistic update. */
export function renamePasskeyMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
) {
	const apply = passkeyListCachePolicy(queryClient);
	return mutationOptions<AccountPasskey[], Error, PasskeyRenameDto>({
		mutationFn: (input) => client.me.renamePasskey(input),
		onSuccess: apply,
	});
}

/** Deletes a passkey. This is irreversible, so the list changes only after the server confirms. */
export function deletePasskeyMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
) {
	const apply = passkeyListCachePolicy(queryClient);
	return mutationOptions<AccountPasskey[], Error, PasskeyDeleteDto>({
		mutationFn: (input) => client.me.deletePasskey(input),
		onSuccess: apply,
	});
}

/**
 * Registration finished: refetch the passkey list only. Invalidation is used because the response
 * is not held: the authenticator client performs registration directly, and its result is the raw
 * credential row (including the public key), not a value to seed. Provider linking uses
 * invalidation for the same reason. exact: true keeps the refetch to this list only. Registering a
 * passkey changes neither the email, login methods, nor sessions.
 */
export async function invalidateAccountPasskeys(
	queryClient: QueryClient,
): Promise<void> {
	await queryClient.invalidateQueries({
		queryKey: ACCOUNT_PASSKEYS_QUERY_KEY,
		exact: true,
	});
}
