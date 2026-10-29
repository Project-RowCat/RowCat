import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { LayoutRectangle, StyleProp, ViewStyle } from "react-native";
import { StyleSheet, View } from "react-native";
import Animated, {
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { layoutTransition } from "./transitions.ts";

/**
 * One **active background** that moves between siblings. It matches web's `MotionActiveIndicator`
 * in meaning and rhythm, but not in geometry.
 *
 * - It measures sibling frames instead of using `layoutId`. Reanimated's shared-element
 *   transitions are still experimental, so a layoutId-style build would silently break on library
 *   upgrades. The indicator moves between frames with `layoutTransition` (normal · standard). The
 *   intended differences from web are listed in `docs/motion/ARCHITECTURE.md`.
 *
 * - It states nothing about the active item. If the motion fails (slow device, reduced motion, an
 *   unmeasured first frame), the background simply is not there, so each row keeps
 *   `accessibilityState.selected` and its static font weight. It is also hidden from the
 *   accessibility tree: there is nothing to read.
 * - The only state held here is the measured frames. `activeKey` is derived from the route and no
 *   shadow such as `previousActiveSection` is kept, because that would give two answers to which
 *   item is active.
 * - Geometry is fixed vocabulary, not a prop. Underline position is derived from the measured
 *   frame, so callers cannot drift the thickness or the placement apart.
 *
 * ```text
 * fill        a surface covering the sibling's frame    web: `bg-accent` layer in sidebar and settings rail
 * underline   a 2pt line on the bottom of that frame    web: `TabsList variant="line"`'s `after:h-0.5 bg-foreground`
 * ```
 *
 * `fill` was the only shape at first, so the tab rows looked different from web (web's tabs are
 * underlines). That difference is neither color nor rhythm, so token and motion checks missed it.
 */

/**
 * Indicator appearance, mapping directly to web's two expressions. The underline thickness lives
 * here because it belongs to this layer (web's `h-0.5`). Color is the caller's choice.
 */
export type IndicatorShape = "fill" | "underline";

/** Web's `after:h-0.5`: 2pt. */
const UNDERLINE_THICKNESS = 2;

type IndicatorContext = {
	activeKey: string | null;
	report: (key: string, layout: LayoutRectangle) => void;
};

const Group = createContext<IndicatorContext | null>(null);

export function MotionIndicatorGroup({
	activeKey,
	indicatorStyle,
	shape = "fill",
	style,
	children,
}: {
	/** Which sibling is active. The route decides; this layer does not. */
	activeKey: string | null;
	/** Background appearance. The surface hosting the indicator sets its corners and color. */
	indicatorStyle?: StyleProp<ViewStyle>;
	/**
	 * Cover the frame, or sit on its bottom edge. Defaults to cover, the shape this app drew first;
	 * the drawer and wide rails use it on web too.
	 */
	shape?: IndicatorShape;
	style?: StyleProp<ViewStyle>;
	children: ReactNode;
}) {
	const [frames, setFrames] = useState<Record<string, LayoutRectangle>>({});

	const report = useCallback((key: string, layout: LayoutRectangle) => {
		setFrames((current) => {
			const known = current[key];
			if (
				known &&
				known.x === layout.x &&
				known.y === layout.y &&
				known.width === layout.width &&
				known.height === layout.height
			)
				return current;
			return { ...current, [key]: layout };
		});
	}, []);

	const context = useMemo<IndicatorContext>(
		() => ({ activeKey, report }),
		[activeKey, report],
	);

	const frame = activeKey ? frames[activeKey] : undefined;
	const x = useSharedValue(0);
	const y = useSharedValue(0);
	const width = useSharedValue(0);
	const height = useSharedValue(0);
	const fade = useSharedValue(0);

	/**
	 * No motion on first placement. Before the first measurement there was no indicator, and a
	 * transition then would make it fly in from the top-left each time the screen opens. After that,
	 * siblings are connected with `layoutTransition`.
	 *
	 * Shared values are written in an effect: writing them during render lets the UI thread see values
	 * from an uncommitted render, which Reanimated reports as a warning.
	 */
	const placed = useRef(false);

	useEffect(() => {
		if (!frame) {
			fade.value = withTiming(0, layoutTransition.opacity);
			placed.current = false;
			return;
		}
		const settle = (to: number) =>
			placed.current ? withTiming(to, layoutTransition.transform) : to;
		/**
		 * The underline is derived from the measured frame and sits just inside the sibling's bottom
		 * edge. The arithmetic lives here because of the first frame: a constant `top` from the caller
		 * would park the line at 0 until measured, then drop it from the top.
		 */
		const underline = shape === "underline";
		x.value = settle(frame.x);
		y.value = settle(
			underline ? frame.y + frame.height - UNDERLINE_THICKNESS : frame.y,
		);
		width.value = settle(frame.width);
		height.value = settle(underline ? UNDERLINE_THICKNESS : frame.height);
		fade.value = placed.current ? 1 : withTiming(1, layoutTransition.opacity);
		placed.current = true;
	}, [fade, frame, height, shape, width, x, y]);

	const indicator = useAnimatedStyle(() => ({
		height: height.value,
		opacity: fade.value,
		transform: [{ translateX: x.value }, { translateY: y.value }],
		width: width.value,
	}));

	return (
		<View style={style}>
			<Animated.View
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				pointerEvents="none"
				style={[indicatorStyle, marker.fill, indicator]}
			/>
			<Group.Provider value={context}>{children}</Group.Provider>
		</View>
	);
}

/**
 * One sibling the indicator can move to. It only measures.
 *
 * Content, links and accessibility all stay with `children`. Adding `label` or `to` here would make
 * it a navigation component that branches markup in one place (web's file keeps the same boundary).
 */
export function MotionIndicatorItem({
	itemKey,
	children,
}: {
	itemKey: string;
	children: ReactNode;
}) {
	const group = useContext(Group);
	return (
		<View
			onLayout={(event) => group?.report(itemKey, event.nativeEvent.layout)}
		>
			{children}
		</View>
	);
}

const marker = StyleSheet.create({
	/**
	 * The indicator is outside flow, so it moves no sibling by a pixel. Position is carried by
	 * transforms, so `left` and `top` stay at 0; animating them would relayout every frame.
	 */
	fill: { left: 0, position: "absolute", top: 0 },
});
