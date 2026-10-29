import * as AvatarPrimitive from "@rn-primitives/avatar";
import { radiusScale } from "@rowcat/design";
import { StyleSheet, Text } from "react-native";
import { useTheme } from "./theme.tsx";
import { typeface } from "./typography.ts";

/**
 * Avatar: a photo, falling back to initials when there is none or it fails. Behavior comes from
 * `@rn-primitives/avatar`, which owns a small state machine (error, loading when a valid source
 * arrives, loaded, or error again to show Fallback). It is not hand-written because that state
 * machine is easy to get wrong. The key detail is that the state resets when the address changes.
 * Virtualized lists reuse rows, so a previously failed avatar's slot must not show initials for a
 * different, valid person. The primitive resets in a layout effect keyed on `source`. Only
 * dimensions and colors remain here, which is the layer this package adds on top.
 */
export function Avatar({
	name,
	uri,
	size = 32,
}: {
	/** Source for the initials. When empty, `?` is drawn. */
	name: string;
	uri: string | null;
	size?: number;
}) {
	const { colors } = useTheme();
	const box = {
		backgroundColor: colors.muted,
		borderRadius: radiusScale.full,
		height: size,
		width: size,
	};

	return (
		<AvatarPrimitive.Root
			alt={name}
			/**
			 * Hidden from screen readers because it is decorative. The name is already visible text beside
			 * it, and reading it twice doubles the list. The primitive's role=img helps where no name sits
			 * next to the avatar.
			 */
			accessible={false}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={[avatar.root, box]}
		>
			{/** With no `source`, the primitive sets the state to error immediately, so Fallback renders. */}
			<AvatarPrimitive.Image
				source={uri ? { uri } : undefined}
				style={{ height: size, width: size }}
			/>
			<AvatarPrimitive.Fallback style={avatar.fallback}>
				<Text
					style={[
						avatar.mark,
						{ color: colors["muted-foreground"], fontSize: size * 0.4 },
					]}
				>
					{name.trim().slice(0, 1) || "?"}
				</Text>
			</AvatarPrimitive.Fallback>
		</AvatarPrimitive.Root>
	);
}

const avatar = StyleSheet.create({
	root: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
	/** Must share the photo's box, so the row does not shift when a photo fails to load. */
	fallback: {
		alignItems: "center",
		height: "100%",
		justifyContent: "center",
		width: "100%",
	},
	mark: typeface("semibold"),
});
