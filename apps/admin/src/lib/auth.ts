import { LOCAL_SIGN_IN_AUTH_PATH } from "@rowcat/contracts";
import { isLoopbackHostname } from "@rowcat/domain";
import { createAuthClient } from "better-auth/react";
import { API_BASE_URL } from "./api.ts";

/**
 * Performs sign-in and sign-out with the same Better Auth session as the web.
 *
 * - No separate operator identity: operator power is `member.role` on the product member row, and
 *   a second login system would let an account suspended on one side live on the other.
 * - No static admin key (`X-ADMIN-KEY`, as legacy had): it ships a secret to the browser, never
 *   rotates, and cannot say who did what, so no audit record could exist.
 * - Screens do not read identity from here; `/v2/me` (`viewerQueryOptions`) answers who. Binding
 *   product code to the Better Auth user id would make changing a login method an authorization
 *   change.
 */
export const authClient = createAuthClient({
	// Must match the server's mount point (apps/api: `${publicApiUrl}/auth`).
	baseURL: `${API_BASE_URL}/auth`,
});

/**
 * The one failure this file names: the claim may already have succeeded, so screens must not read it
 * as "the API is unreachable". Matched by `name` so pure modules can recognise it without importing
 * the auth client.
 */
export const LOCAL_SIGN_IN_ERROR = "LocalSignInError";

function localSignInError(message: string): Error {
	const error = new Error(message);
	error.name = LOCAL_SIGN_IN_ERROR;
	return error;
}

/**
 * Asks for a session as the deployment's local owner — a deployment set up to be used without
 * signing in (`@rowcat/contracts`'s `deployment-setup.ts`). The same Better Auth door the web uses.
 *
 * Throws on failure so the setup claim can report it; the login screen catches and stays a form.
 * A page that is not at a loopback address does not ask: the server would answer 404 anyway.
 */
export async function requestLocalSignIn(): Promise<void> {
	if (!isLoopbackHostname(window.location.hostname))
		throw localSignInError("not on this computer");
	const result = await authClient
		/** An empty JSON body: Better Auth answers 415 to a POST without one. */
		.$fetch(LOCAL_SIGN_IN_AUTH_PATH, { method: "POST", body: {} })
		.catch(() => ({ error: true }));
	if (result.error) throw localSignInError("local sign-in refused");
}

/** Whether to offer "use without signing in" at all on this page. */
export const onThisComputer = (): boolean =>
	typeof window !== "undefined" && isLoopbackHostname(window.location.hostname);
