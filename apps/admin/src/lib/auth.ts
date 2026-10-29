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
