import { Icon, type IconSize, useTheme } from "@rowcat/ui-native";
import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { isApiOrigin, useAuthImageHeaders } from "../../lib/auth-image.ts";

/**
 * Work cover — draws the picture when there is one, and a **placeholder** when there is none or it
 * cannot be loaded.
 *
 * The placeholder used to be the RowCat wordmark. That filled the slot, but the web draws
 * `ImageOff` (a crossed-out picture) in the same place, and the mismatch made the two apps read
 * differently: the web card says "there is no cover", while the app card **advertised the brand**.
 * Lists with several coverless works were covered in the RowCat logo.
 *
 * Now the `image` name on `Icon` owns that slot, and the glyph it points at is the same as the
 * web's (the table in `packages/ui-native/src/icon.tsx` records the pairing).
 */
export interface StoryCoverStyle {
	aspectRatio?: number;
	borderRadius?: number;
}

export function StoryCover({
	uri,
	title,
	style,
	placeholderSize = "xl",
}: {
	uri: string | null;
	title: string | null;
	style?: StoryCoverStyle;
	/**
	 * Size of the placeholder glyph. The web varies it per slot too: cards use `size-7`, the work
	 * detail uses `size-10`. It is the same glyph scaled to the box, not a different meaning.
	 */
	placeholderSize?: IconSize;
}) {
	const [failedUri, setFailedUri] = useState<string | null>(null);
	const { colors } = useTheme();
	/**
	 * A cover that is only visible with a session returns 404 without the header — the reason is in
	 * `lib/auth-image.ts`. Addresses that are not our origin (a just-picked local file) get no header.
	 */
	const auth = useAuthImageHeaders();
	/**
	 * Do not request our-origin images **before** the session header is settled. If that request
	 * latches as 404, the placeholder stays even after the cookie arrives late (`lib/auth-image.ts`).
	 * Other origins (a just-picked local file) have no reason to wait.
	 */
	const holding = uri !== null && isApiOrigin(uri) && !auth.ready;
	const surface = { backgroundColor: colors.muted };

	if (!uri || holding || failedUri === uri)
		return (
			<View
				accessible={false}
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				style={[cover.placeholder, surface, style]}
			>
				{/**
				 * Only the picture is faded. It used to be `opacity: 0.55` on the whole box, which faded the
				 * background too and made the card look holed. The web keeps the surface and drops only the
				 * glyph colour to `text-muted-foreground/60`.
				 */}
				<View style={cover.placeholderInk}>
					<Icon name="image" size={placeholderSize} tone="muted-foreground" />
				</View>
			</View>
		);

	return (
		<Image
			accessibilityRole="image"
			accessible={title !== null}
			accessibilityLabel={title ? `Cover of ${title}` : undefined}
			source={
				auth.headers && isApiOrigin(uri)
					? { uri, headers: auth.headers }
					: { uri }
			}
			onError={() => setFailedUri(uri)}
			style={[cover.image, surface, style]}
		/>
	);
}

const cover = StyleSheet.create({
	image: { width: "100%" },
	placeholder: {
		alignItems: "center",
		justifyContent: "center",
		width: "100%",
	},
	placeholderInk: { opacity: 0.6 },
});
