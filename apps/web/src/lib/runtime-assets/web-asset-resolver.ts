import type { ResolvedRuntimeAssetTarget } from "@rowcat/runtime/asset";
import { getRowCatClient } from "#/lib/api.ts";

/**
 * - The only place that turns a reference into an address the browser may open.
 * - Input is ResolvedRuntimeAssetTarget, not a logical path. The session's binding table
 *   (bindRuntimeAssetResolver) maps logical names to media identities; the type stops an unmapped
 *   string from being assembled into an address that is valid in no deployment.
 * - The rule (createWebRuntimeAssetResolver) is split from the wiring (resolveWebRuntimeAsset) so
 *   it can be checked as a value. The client exists only in the browser, and the SSR path needs
 *   request context.
 * - Studio preview and product playback share this rule, so an image that renders in one does not
 *   point elsewhere in the other.
 * - Both branches answer with our origin. Returning target.url for a remote asset would make the
 *   player's browser fetch the creator's host, breaking the promise that the runtime never fetches.
 * - Address rules come from the SDK (media.url, media.runtimeAssetUrl). Neither folder may import
 *   the SDK directly; runtime-preview-boundaries.test.ts allows only the generated adapter.
 */

export interface WebRuntimeAssetUrls {
	/** Media identity to an address on our origin (client.media.url). */
	mediaUrl: (mediaId: string) => string;
	/** Creator's HTTPS address to the RowCat proxy address (client.media.runtimeAssetUrl). */
	runtimeAssetUrl: (remoteUrl: string) => string;
}

/**
 * Maps a resolved target to a URL, and null means a placeholder, not an error. The SDK returns an
 * empty string for an empty id or address instead of throwing, because a reference stored months
 * ago may be damaged. That empty string is folded to null, since an empty src would make the
 * browser re-request the current page.
 */
export type WebResolvedAssetResolver = (
	target: ResolvedRuntimeAssetTarget,
) => string | null;

export function createWebRuntimeAssetResolver(
	urls: WebRuntimeAssetUrls,
): WebResolvedAssetResolver {
	return (target: ResolvedRuntimeAssetTarget): string | null => {
		const url =
			target.kind === "managed"
				? urls.mediaUrl(target.mediaId)
				: urls.runtimeAssetUrl(target.url);
		return url.length > 0 ? url : null;
	};
}

/** App-wide resolver. It reads the browser's shared client at call time. */
export const resolveWebRuntimeAsset: WebResolvedAssetResolver = (target) =>
	createWebRuntimeAssetResolver({
		mediaUrl: (mediaId) => getRowCatClient().media.url(mediaId),
		runtimeAssetUrl: (remote) =>
			getRowCatClient().media.runtimeAssetUrl(remote),
	})(target);
