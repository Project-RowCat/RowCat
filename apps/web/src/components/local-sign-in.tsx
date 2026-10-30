import { LOCAL_SIGN_IN_AUTH_PATH } from "@rowcat/contracts";
import { isLoopbackHostname } from "@rowcat/domain";
import {
	refreshViewerState,
	runtimeConfigQueryOptions,
	viewerQueryOptions,
} from "@rowcat/query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { getRowCatClient } from "#/lib/api.ts";
import { authClient } from "#/lib/auth.ts";

/**
 * Signs this computer in as the deployment's local owner — the "use without signing in" setup
 * (`@rowcat/contracts`'s `deployment-setup.ts`). Renders nothing.
 *
 * It asks only when all three hold: the viewer answered "guest", the deployment says it has a local
 * owner, and this page is at a loopback address. The server decides the rest — a request from
 * anywhere else is a 404, and the screen simply stays a guest's. Signing in goes through the same
 * `refreshViewerState` the login form uses, and the router re-runs its loaders, so `/login` itself
 * moves on to its destination without a reload.
 *
 * One attempt per tab session (`sessionStorage`): if the session does not stick — cookies blocked,
 * a clock far off — retrying on every render would hammer the door with no change in the answer. A
 * signed-in viewer clears the mark, so an expired session thirty days later is asked for again.
 */
const TRIED_KEY = "rowcat.localSignIn.tried";

function storage(): Storage | null {
	try {
		return window.sessionStorage;
	} catch {
		return null;
	}
}

export function LocalSignIn() {
	const client = getRowCatClient();
	const queryClient = useQueryClient();
	const router = useRouter();
	const viewer = useQuery(viewerQueryOptions(client));
	const config = useQuery(runtimeConfigQueryOptions(client));

	const guest = viewer.data === null;
	const signedIn = !!viewer.data;
	const available = config.data?.localSignIn === true;

	useEffect(() => {
		if (signedIn) {
			try {
				storage()?.removeItem(TRIED_KEY);
			} catch {}
			return;
		}
		if (!guest || !available) return;
		if (!isLoopbackHostname(window.location.hostname)) return;
		const store = storage();
		try {
			if (store?.getItem(TRIED_KEY)) return;
			store?.setItem(TRIED_KEY, "1");
		} catch {}

		void authClient
			/** An empty JSON body: Better Auth answers 415 to a POST without one. */
			.$fetch(LOCAL_SIGN_IN_AUTH_PATH, { method: "POST", body: {} })
			.then(async (result) => {
				if (result.error) return;
				await refreshViewerState(queryClient);
				await router.invalidate();
			})
			.catch(() => {
				/** Nothing to say: the guest screen is already drawn and still correct. */
			});
	}, [guest, signedIn, available, queryClient, router]);

	return null;
}
