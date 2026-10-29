import type { AdultVerificationStartDto } from "@rowcat/contracts";
import type { Viewer } from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import type { QueryClient } from "@tanstack/react-query";
import { GALLERY_QUERY_KEY_PREFIX } from "./gallery.ts";
import {
	RELATED_STORIES_QUERY_KEY_PREFIX,
	STORY_DETAIL_QUERY_KEY_PREFIX,
} from "./story.ts";
import { VIEWER_QUERY_KEY } from "./viewer.ts";

/**
 * Adult verification has no query, only two mutations. Whether verification is complete already
 * lives in the viewer (verified, adult). An in-progress attempt is a state the user watches in the
 * verification provider's window, not in RowCat, so the screen has no value to wait on. Parental
 * consent polls because a different person, on another device, must act; this flow has no such
 * wait. No optimistic updates: a brief "adult verified" before server confirmation would falsely
 * reassure the person. When eligibility opens, adult-display result sets can widen. That happens
 * when display is already on but eligibility was missing (old data, operator correction), so the
 * cache is reset like the display setting: resetQueries rather than removeQueries, so that suspense
 * observers keep their entries.
 */

/**
 * Touches no cache. The request creates one attempt row on the server, and the screen does nothing
 * with it except open the provider's window. Invalidating the viewer here would refetch the whole
 * app while the window is open, and at that moment nothing has changed yet.
 */
export function beginAdultVerificationMutationOptions(client: RowCatClient) {
	return {
		mutationKey: ["viewer", "adult-verification", "begin"] as const,
		mutationFn: (): Promise<AdultVerificationStartDto> =>
			client.adultVerification.begin(),
	};
}

/**
 * Writes the confirmed viewer into the cache as-is. verified and adult are not set by hand: the
 * server decides and returns the updated viewer in full. Guessing on the client would show adult
 * eligibility when verification succeeded but the person is under 19. The whole ["viewer"] prefix
 * is not invalidated (§29): one verification would otherwise refetch personalization, account,
 * notifications, payments, and the creator workspace, while this write changes one cell only.
 */
export function completeAdultVerificationMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
) {
	return {
		mutationKey: ["viewer", "adult-verification", "complete"] as const,
		mutationFn: (): Promise<Viewer> => client.adultVerification.complete(),
		onSuccess: async (viewer: Viewer) => {
			queryClient.setQueryData<Viewer | null>(VIEWER_QUERY_KEY, viewer);
			await Promise.all([
				queryClient.resetQueries({ queryKey: GALLERY_QUERY_KEY_PREFIX }),
				queryClient.resetQueries({ queryKey: STORY_DETAIL_QUERY_KEY_PREFIX }),
				/**
				 * Related works are also a list filtered by the adult-display axis, so reset them for the same
				 * reason as the gallery.
				 */
				queryClient.resetQueries({
					queryKey: RELATED_STORIES_QUERY_KEY_PREFIX,
				}),
			]);
		},
	};
}
