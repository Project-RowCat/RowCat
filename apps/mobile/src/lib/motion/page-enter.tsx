import { PAGE_ENTER_Y } from "@rowcat/design";
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, { withTiming } from "react-native-reanimated";
import { enterTransition } from "./transitions.ts";

/**
 * The one transition that signals "the page body has arrived". Same rhythm as the web `PageEnter`.
 *
 * Wraps the body only: header, back button and title stay put, so swapping a placeholder for the
 * real body animates just the arrival. Placeholders are not wrapped, since waiting would then be
 * animated twice. It only animates the destination's entrance (no exit), and the navigator is not
 * wrapped in a presence: route identity belongs to expo-router, and rebuilding it would reset
 * scroll, focus and local state.
 *
 * The native stack animates nothing (`animation: "none"` in `app/_layout.tsx`), so this is the only
 * arrival signal and it runs unconditionally. A "only when late" condition would diverge from the
 * web, which runs this on every navigation except the first hydration. The 4dp distance matches the
 * web value and is pinned by `motion-policy.test.ts`.
 */
const pageEnter = () => {
	"worklet";
	return {
		initialValues: { opacity: 0, transform: [{ translateY: PAGE_ENTER_Y }] },
		animations: {
			opacity: withTiming(1, enterTransition.opacity),
			transform: [{ translateY: withTiming(0, enterTransition.transform) }],
		},
	};
};

export function PageEnter({
	children,
	style,
}: {
	children: ReactNode;
	/** Style for the wrapper. No default on purpose: a default `flex: 1` would change the screen's layout. */
	style?: StyleProp<ViewStyle>;
}) {
	return (
		<Animated.View style={style} entering={pageEnter}>
			{children}
		</Animated.View>
	);
}
