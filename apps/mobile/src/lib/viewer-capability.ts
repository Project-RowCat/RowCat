import { canUseByoProvider, canViewAdultContent } from "@rowcat/domain";
import { viewerQueryOptions } from "@rowcat/query";
import { useQuery } from "@tanstack/react-query";
import { getRowCatClient } from "./api.ts";

/**
 * The one place a screen asks what the viewer is allowed to do. Same role as the web's
 * `lib/query/viewer-capability.ts`.
 *
 * The decision itself is a pure domain function (`canUseByoProvider` in `@rowcat/domain`). This
 * file only attaches it to the viewer query. If a screen starts writing `viewer?.ageStatus ===
 * "child"` itself, the decision gets copied into settings, chat and the model picker, and whichever
 * spot misses it tells a child that the feature is open.
 *
 * This is a different axis from `viewer-action.ts`. That one asks "may I send an authenticated
 * write now" (guest, sanctions). This one asks "may this account use this feature" (age). Merging
 * them would put a sanctioned member and an under-14 member in the same bucket, but their next
 * steps differ completely.
 *
 * ## This is not authorization
 *
 * The server is the final authority (`requireNonChild` in `apps/api/src/lib/gates.ts`). The only
 * job here is to fold away operations the server would certainly reject, so the user does not press
 * into a failure.
 *
 * **BYO is the one exception, and it is stated plainly.** Generation with a personal API key does
 * not pass through our server, so no server decision exists on that path. The value here, and the
 * pure functions that read it (`resolveGenerationExecution`, `connectProvider`), are the last
 * effective gate on that restriction. `docs/membership/ARCHITECTURE.md` says the same about this
 * limit.
 *
 * ## A lookup failure does not block
 *
 * When `/me` fails the viewer is `null`, and the domain functions do not treat `null` as a child.
 * The direction is deliberate: a transient session-lookup failure should not strip the feature from
 * every member at once, and a child's restriction taking effect a few seconds late is the less
 * harmful outcome.
 */
export function useViewerCapability(): {
	/** The viewer has not been read yet. This is not the same as guest; the screen draws a placeholder. */
	loading: boolean;
	/** Whether generation with a personal API key (BYO) is allowed. */
	byo: boolean;
	/**
	 * Whether adult content may be viewed. This checks both authentication and the display setting.
	 * The web's hook exists for the same reason: if each screen writes out the two axes itself, the
	 * spot that misses one tells someone who cannot view adult content that they can.
	 *
	 * `false` while `loading` is true means "not known yet", not "not eligible". Treating those as the
	 * same draws the restriction message once for an eligible person.
	 */
	adult: boolean;
} {
	const query = useQuery(viewerQueryOptions(getRowCatClient()));
	const viewer = query.data ?? null;
	return {
		loading: query.isPending,
		byo: canUseByoProvider(viewer),
		adult: canViewAdultContent(viewer),
	};
}
