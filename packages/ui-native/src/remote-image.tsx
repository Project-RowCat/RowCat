import { radiusScale } from "@rowcat/design";
import { type ReactNode, useState } from "react";
import { Image, StyleSheet, View } from "react-native";

/**
 * Remote image. It determines its own aspect ratio and collapses when it fails to load. Chat draws
 * pictures in two places: work-item situation images and markdown images in the body. Drawing is
 * the same in both, so it lives here. Separate implementations would give one chat two different
 * radius and ratio rules.
 * - Included: aspect detection, failure collapse, radius and clipping, state reset on row reuse.
 * - Not included: building the URL, safety checks, margins, invented alt text. Callers validate
 *   the address first; re-checking here would split that decision across two places.
 * - Until the real ratio arrives, a common landscape ratio holds the space. Tall images have a
 *   lower bound, so one image cannot fill the screen and push the text being read out of view.
 *   `resizeMode="contain"` fills the rest.
 * - Rows are reused in a virtualized list. A failed state or a tall ratio must not carry over to
 *   a valid address in the same row, so the state is reset by hand. Calling setState during render
 *   re-renders at once and discards the earlier output, as React documents. An effect would paint
 *   the wrong image for one frame.
 */

/** Placeholder ratio before the real one is known: a common landscape image (3:2). */
const DEFAULT_ASPECT = 3 / 2;

/**
 * Lower bound on the ratio for tall images. Taller images stop at this height, and the picture is
 * contained inside the box.
 */
const MIN_ASPECT = 3 / 4;

export function RemoteImage({
	uri,
	accessibilityLabel,
	fallback = null,
}: {
	/** The address, already past the safety check. `null` renders `fallback` immediately. */
	uri: string | null;
	/** The name screen readers announce. Without it the image is decorative and hidden from them. */
	accessibilityLabel?: string;
	/**
	 * What to show when the image cannot load. The default is nothing, since a broken image slot
	 * explains nothing. Only callers with a meaningful alt text pass a value.
	 */
	fallback?: ReactNode;
}) {
	const [shown, setShown] = useState(uri);
	const [aspect, setAspect] = useState<number | null>(null);
	const [failed, setFailed] = useState(false);

	if (shown !== uri) {
		setShown(uri);
		setAspect(null);
		setFailed(false);
	}

	if (!uri || failed) return fallback;

	return (
		<View style={image.frame}>
			<Image
				source={{ uri }}
				accessible={accessibilityLabel !== undefined}
				accessibilityLabel={accessibilityLabel}
				accessibilityIgnoresInvertColors
				resizeMode="contain"
				style={{ width: "100%", aspectRatio: aspect ?? DEFAULT_ASPECT }}
				onLoad={(event) => {
					const { width, height } = event.nativeEvent.source;
					if (width > 0 && height > 0)
						setAspect(Math.max(width / height, MIN_ASPECT));
				}}
				onError={() => setFailed(true)}
			/>
		</View>
	);
}

const image = StyleSheet.create({
	/**
	 * Radius and clipping belong to the box, not the Image. On Android, a radius combined with
	 * `resizeMode` can misalign.
	 */
	frame: { borderRadius: radiusScale.lg, overflow: "hidden", width: "100%" },
});
