import type { Viewer } from "@rowcat/domain";
import {
	refreshViewerState,
	resetViewerState,
	viewerQueryOptions,
} from "@rowcat/query";
import type { RowCatClient } from "@rowcat/sdk";
import type { QueryClient } from "@tanstack/react-query";
import { AuthFlowError } from "./auth-error.ts";

/**
 * The moment identity changes. The two functions in this file are that whole moment.
 *
 * Every login method (email, sign-up, Google) ends in `completeAuthentication`, so a defect such as
 * "signing in with Google leaves the previous user's SQLite in place" cannot be expressed. Adding a
 * method does not add cleanup code.
 *
 * The order is the rule:
 *
 * ```text
 * 1  cancel in-flight queries        a late response from Alice must not sit in Bob's cache
 * 2  clear the viewer-scoped cache   leftover values are drawn under the new person until refetch
 * 3  ask /me with the new cookie     the only authority for identity
 * 4  no member → fail                never invent a member from the session
 * ```
 *
 * Skipping step 1 fails silently: a request started as Alice succeeds after Bob is active, and
 * TanStack Query stores it under the current key. The screen shows Bob, the list shows Alice.
 *
 * Cache policy is not restated here. `@rowcat/query` owns what is cleared and invalidated
 * (`resetViewerState`, `refreshViewerState`). A mobile-only cleanup would drop an axis the web
 * clears, and those axes (balances, unpublished draft titles, unread notifications) are usually the
 * ones that must not survive into the next person's session.
 */

export interface SessionTransitionDeps {
	queryClient: QueryClient;
	client: RowCatClient;
	/** Better Auth sign-out. Injected so this module can run without a simulator. */
	signOut: () => Promise<void>;
}

/**
 * Asks the server now and ignores any cached value. With `viewerQueryOptions`' 60-second freshness,
 * a just-signed-out account's value would still count as fresh and `fetchQuery` would skip the
 * network. The identity decision at a transition must come from the server, not the cache.
 */
const askServerForViewer = (
	deps: Pick<SessionTransitionDeps, "queryClient" | "client">,
): Promise<Viewer | null> =>
	deps.queryClient.fetchQuery({
		...viewerQueryOptions(deps.client),
		staleTime: 0,
	});

/**
 * Runs once after authentication succeeds. Email, sign-up and Google share it.
 *
 * Better Auth returning 200 only says that a session exists. The app may call itself authenticated
 * only after that session resolves to a member, and that member id selects the local SQLite. The
 * caller does not store the returned viewer: the value already sits in the query cache, and the
 * return tells the caller what to wait for.
 */
export async function completeAuthentication(
	deps: SessionTransitionDeps,
): Promise<Viewer> {
	await deps.queryClient.cancelQueries();
	await refreshViewerState(deps.queryClient);

	let viewer: Viewer | null;
	try {
		viewer = await askServerForViewer(deps);
	} catch (cause) {
		// Authentication succeeded but the member lookup failed. Do not sign out: the cookie is valid,
		// and the next attempt (or the next launch) is the retry.
		throw new AuthFlowError("unreachable", { cause });
	}

	if (viewer) return viewer;

	/**
	 * The session exists but no member does. Never build the viewer from `session.user`: a database
	 * opened under that identity connects to no server resource, and that state never heals itself.
	 *
	 * The new session is closed so that this state is not left behind. If that cleanup also fails,
	 * what remains is an unusable cookie; the next launch's `/me` answers `null` and the app resets to
	 * guest. That is why the failure below is not masked here.
	 */
	try {
		await deps.signOut();
	} catch {
		// The error below is what the user is told. A failed cleanup must not hide it.
	}
	await resetViewerState(deps.queryClient);
	throw new AuthFlowError("session_without_viewer");
}

/**
 * Sign-out. What happens when it fails is the whole point of this function.
 *
 * The success path is short. A throw from `signOut()` can mean two different facts:
 *
 * ```text
 * the server deleted the session and only the response was lost   → already signed out
 * the request never reached the server                            → still signed in
 * ```
 *
 * Clearing caches without telling them apart leaves a half state in the second case: guest on
 * screen while the cookie is alive, and the local database closed while the server still says
 * Alice. So the server is asked once more. If that question also fails, nothing is cleared. An
 * unconfirmed state is not treated as confirmed.
 */
export async function signOutSession(
	deps: SessionTransitionDeps,
): Promise<void> {
	await deps.queryClient.cancelQueries();

	try {
		await deps.signOut();
	} catch (cause) {
		let confirmed: Viewer | null;
		try {
			confirmed = await askServerForViewer(deps);
		} catch {
			// Cannot confirm. Stay as Alice.
			throw new AuthFlowError("sign_out_failed", { cause });
		}
		if (confirmed) throw new AuthFlowError("sign_out_failed", { cause });
		// The session really is gone; only the response was lost. End as success.
	}

	/**
	 * Sign-out closes access. What is cleared below is the server-state cache only. This device's
	 * conversations, drafts and remembered DEKs stay, so the same files open when Alice signs in again
	 * (`local-data/isolation.test.ts`). Deletion is a separate operation (`local-data/purge.ts`).
	 */
	await resetViewerState(deps.queryClient);
}
