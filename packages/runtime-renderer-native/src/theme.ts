import { StyleSheet } from "react-native";

/**
 * The renderer's own default visuals. These are not RowCat product components.
 * - Does not use `@rowcat/ui-native`'s Button. That component carries product vocabulary (sizes,
 *   variants, busy state, icons), and product changes would change creator works. Runtime visuals
 *   are part of the runtime contract, so this file holds only what the contract states: tone
 *   levels, box defaults and placeholders.
 * - Colors here are defaults. The playback surface should eventually be able to inject its own
 *   tokens (the same slot as the web renderer's --rowcat-runtime-* variables). Not built yet: there
 *   is only one preview, so there are no values to inject, and an API for values would first need
 *   an answer to what those values mean.
 */

export const RUNTIME_TONE_COLOR = {
	primary: { background: "#2f6df6", label: "#ffffff", border: "transparent" },
	secondary: { background: "#eef1f6", label: "#1b1f27", border: "transparent" },
	ghost: { background: "transparent", label: "#2f6df6", border: "#d6dbe4" },
} as const;

export const runtimeStyles = StyleSheet.create({
	/**
	 * Box default. React Native's View is already column flex; it is stated explicitly to match the
	 * web.
	 */
	box: { flexDirection: "column" },
	/**
	 * Only children of a row shrink, the same rule as the web's `.rc-row > *`. Yoga's flexShrink
	 * defaults to 0 and CSS's to 1. With that gap, the same work lays out differently: a long sentence
	 * in a row wraps on one renderer and is clipped on the other. Not applied to stacks. Shrinking
	 * there squeezes content that should scroll and makes the scroll disappear (the web had that
	 * defect). Images and progress bars are exceptions (host-node.tsx) because they have intrinsic
	 * size. The web makes the same two exceptions.
	 */
	rowChild: { flexShrink: 1 },
	row: { flexDirection: "row" },
	screen: { flex: 1, flexDirection: "column" },
	scrollContent: { flexDirection: "column" },
	scrollContentHorizontal: { flexDirection: "row" },
	button: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: 16,
		paddingVertical: 10,
		borderRadius: 10,
		borderWidth: 1,
	},
	buttonLabel: { fontSize: 15, fontWeight: "500" },
	buttonDisabled: { opacity: 0.45 },
	/** Used when an asset cannot be drawn. A quiet placeholder, not a broken-image icon. */
	imagePlaceholder: { backgroundColor: "#e7eaf0", borderRadius: 6 },
	progressTrack: {
		height: 6,
		borderRadius: 3,
		backgroundColor: "#e7eaf0",
		overflow: "hidden",
	},
	progressFill: { height: 6, borderRadius: 3, backgroundColor: "#2f6df6" },
	/**
	 * Default surface for text entry. It aims for the same padding, corners and border as the web's
	 * `.rc-text-input`.
	 */
	textEntry: {
		paddingHorizontal: 12,
		paddingVertical: 10,
		borderRadius: 10,
		borderWidth: 1,
		borderColor: "#d6dbe4",
		fontSize: 15,
		color: "#1b1f27",
	},
	/** Multiline entries start at the top. React Native on Android centers vertically by default. */
	textEntryMultiline: { minHeight: 88, textAlignVertical: "top" },
});
