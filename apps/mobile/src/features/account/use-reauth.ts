import { useRouter } from "expo-router";
import { useCallback } from "react";
import { useMobileIdentity } from "../../lib/identity.tsx";

/**
 * Re-login by calling the existing transition owner.
 *
 * - Better Auth requires a fresh session (24h default) for session listing and method unlinking
 *   while ours last 30 days, so this is the normal path; the only action is signing in again.
 * - No second cleanup path: cookie, query-cache and local-scope cleanup order lives only in
 *   `session-transition.ts` (`signOutSession`); calling `resetViewerState` or the auth client here
 *   would leave one copy to be fixed alone.
 * - The return path is the constant `/account`, and the login screen filters it again with
 *   `safeMobileReturnPath`.
 * - A failed sign-out means still signed in (the transition owner re-asks the server), so it
 *   navigates nowhere; going to login would make the user think they were signed out.
 */
export function useReauth(): { reauth: () => void; pending: boolean } {
	const router = useRouter();
	const identity = useMobileIdentity();
	const { signOut } = identity;

	const reauth = useCallback(() => {
		void signOut().then((ok) => {
			if (!ok) return;
			router.push({ pathname: "/login", params: { redirect: "/account" } });
		});
	}, [router, signOut]);

	return { reauth, pending: identity.pending === "sign-out" };
}
