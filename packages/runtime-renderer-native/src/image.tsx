import { useEffect, useState } from "react";
import { Animated, type ImageSourcePropType } from "react-native";
import {
	type NativeRuntimeAssetResolverOf,
	resolveNativeImageSource,
} from "./image-source.ts";
import type { NativeMotionStyle } from "./motion.tsx";
import type { NativeBoxStyle } from "./styles.ts";
import { runtimeStyles } from "./theme.ts";

/**
 * Image. Asset references do not become addresses here.
 *
 * The creator passes the opaque result of asset('characters/sena/smile') or asset('https://...').
 * The host's resolver turns it into something drawable after image-source.ts classifies it, and
 * this component uses only that answer. No path in this file turns a creator's address into { uri
 * }. Remote images are converted by the resolver into RowCat's proxy source, so the device never
 * contacts the creator's host.
 *
 * A logical reference is a source only if the binding table has that name. An unbound name yields
 * null, and a placeholder is drawn, not a broken image. A remote image that fails to load shows the
 * same placeholder, and that failure never reaches creator code.
 *
 * Image and placeholder are both Animated.*. Animating only one would make the node jump on screen
 * when the image fails mid-transition, which is common with remote addresses. The kind does not
 * change, for the same reason as in host-node.tsx.
 */

export type NativeRuntimeAssetResolver =
	NativeRuntimeAssetResolverOf<ImageSourcePropType>;

const RESIZE = {
	cover: "cover",
	contain: "contain",
	fill: "stretch",
} as const;

export function RuntimeImage({
	asset,
	alt,
	fit,
	style,
	motion,
	resolve,
}: {
	asset: string | null;
	alt: string;
	fit: keyof typeof RESIZE;
	style: NativeBoxStyle | null;
	motion: NativeMotionStyle | null;
	resolve: NativeRuntimeAssetResolver;
}) {
	const source = resolveNativeImageSource(asset, resolve);
	/**
	 * Remembers a failed source. Image does not request the same uri again, so the only thing that
	 * clears this state is the reference changing. When the prop changes, it retries.
	 */
	const [failed, setFailed] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: forget the failure only when the asset reference changes.
	useEffect(() => setFailed(false), [asset]);
	if (source === null || failed)
		return (
			<Animated.View
				style={[runtimeStyles.imagePlaceholder, style, motion]}
				accessible={alt.length > 0}
				accessibilityRole="image"
				accessibilityLabel={alt.length > 0 ? alt : undefined}
			/>
		);
	return (
		<Animated.Image
			source={source}
			style={[style, motion]}
			resizeMode={RESIZE[fit]}
			accessible={alt.length > 0}
			accessibilityLabel={alt.length > 0 ? alt : undefined}
			onError={() => setFailed(true)}
		/>
	);
}
