import {
	classifyRuntimeAssetValue,
	type RuntimeAssetTarget,
	type RuntimeManagedAssetKind,
} from "@rowcat/runtime/asset";

/**
 * Asset string to the source for React Native's Image. A pure layer: image.tsx draws the component,
 * and this file decides what it draws. It is split out so that tests run without a simulator.
 *
 * The verdict (logical path or remote address) comes from classifyRuntimeAssetValue, the same
 * function the web renderer and the server call. Rewriting `startsWith("https://")` here would
 * create a fourth rule, and one of the four would send logical paths to the proxy.
 *
 * Only the resolver's answer becomes the source. A remote reference's url is the creator's address.
 * If it sat in { uri }, the player's device would request the creator's host directly, and that
 * request would carry the player's IP and time. So the verdict goes to the host's resolver and only
 * its answer is returned. The app builds the resolver (the RowCat proxy address and session
 * headers); this package does not know those rules.
 */

/**
 * Asset reference to a source that Image may open. null means placeholder.
 *
 * The generic keeps ImageSourcePropType out of this file, since this file does not import React
 * Native (boundaries.test.ts).
 */
export type NativeRuntimeAssetResolverOf<Source> = (
	target: RuntimeAssetTarget,
	expect: RuntimeManagedAssetKind,
) => Source | null;

/**
 * Decides the source that Image receives. null (no prop) is a placeholder. A value the runtime
 * could not have sealed is a placeholder. A logical path is drawn only if the resolver's binding
 * table has it; otherwise it is a placeholder. A remote reference becomes the RowCat proxy source
 * that the resolver builds.
 */
export function resolveNativeImageSource<Source>(
	asset: string | null,
	resolve: NativeRuntimeAssetResolverOf<Source>,
): Source | null {
	if (asset === null) return null;
	const target = classifyRuntimeAssetValue(asset);
	if (target === null) return null;
	/**
	 * Asks what the asset will be used as. A name bound to sound must not resolve to an image: Image
	 * would download the audio bytes, and that request could target media this session has no right to
	 * open. The verdict is made by the binding layer (bindRuntimeAssetResolver); on mismatch the
	 * answer is null.
	 */
	return resolve(target, "image");
}
