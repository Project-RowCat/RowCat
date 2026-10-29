import { borderWidth, space } from "@rowcat/design";
import {
	appBarHeight,
	Icon,
	type IconName,
	Text,
	useTheme,
} from "@rowcat/ui-native";
import { usePathname, useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import {
	type MobileAppSection,
	mobilePrimaryDestination,
} from "./shell-route.ts";
import { SIDEBAR_SECTION_LABEL } from "./sidebar-copy.ts";

/**
 * The bottom primary navigation: **three destinations, and nothing else.**
 *
 * ## Why this exists
 *
 * This app's global navigation was a drawer for a long time, and the documented reason was:
 * *"Because the navigation IA is three destinations plus three utilities, a tab bar with three
 * slots cannot express those six."* **That sentence folds two axes into one.** Utilities
 * (notifications, account) have no claim to the bottom row at all: their test is *does it call me
 * from any screen*, while a destination's test is *where can I go*. The web separated them too
 * (three in the sidebar, three in the header).
 *
 * So this row needs to express **three**, not six, and three fits exactly in three slots. What
 * remained was a cost question, and it was measured: with the drawer, `Discover → Conversations` was **one trigger
 * press plus one item press**, and the most common move from the first screen took two presses and
 * a surface transition.
 *
 * ## Only one global navigation surface at a time
 *
 * The drawer was not removed. Removing it would drop recent-chat resume entirely, and that list
 * cannot fit in a bottom row (the row is defined as three items). Instead, **the two never stand on
 * the same screen**:
 *
 * ```text
 * root screens (/ · /chats · /create)   the bottom row stands · no drawer trigger in the header
 * other screens                         the drawer trigger stands · no bottom row
 * ```
 *
 * This invariant is the point of the slice. If both stood together, the same three destinations
 * would be reachable by two paths on one screen, and they would soon behave differently (one
 * `push`, one `navigate`). It is the same rule that removed the temporary chat icon from discover's
 * header.
 *
 * **Nothing is lost.** Opening a room from discover was two presses under the drawer (trigger ·
 * row), and it is still two (`Conversations` · row). On screens where the bottom row does not stand (the room,
 * the editor), the drawer remains with both destinations and recent chats.
 *
 * ## Screens where the bottom row does not stand
 *
 * The decision belongs to `mobilePrimaryDestination` alone. The chat room (input bar), the draft
 * editor (keyboard), and the work detail (comment input) already use the bottom, and a row placed
 * over them would cover content. The screen does not state "this is a root" itself, for the same
 * reason as the other shell decisions.
 *
 * ## This row is not a navigator
 *
 * It was not moved to `Tabs` from `expo-router`. That would change the lifetime, back navigation,
 * and deep-link rules of every screen, an architecture swap this change did not request. This is an
 * ordinary row each screen sets at its bottom, and movement is still `router.navigate`
 * (`lib/boundaries.test.ts`'s "does not change the navigator" holds).
 *
 * ## Quiet
 *
 * No floating pill, blur, shadow, or sliding background. The current location is said together by
 * three signals: font weight, color, and `accessibilityState.selected`. The drawer's rows have a
 * moving indicator because that is a vertical list where motion reads. In a horizontal row of
 * three, the same thing would make the bottom of the screen flash on every move
 * (`docs/motion/ARCHITECTURE.md`: do not move for decoration).
 *
 * ## The screen owns the safe area
 *
 * This row stands **inside** `Screen` (= `SafeAreaView`). Adding padding here would stack a second
 * empty band above the home indicator, the same rule the `Screen` header records.
 */

const DESTINATIONS: {
	section: MobileAppSection;
	icon: IconName;
	to: string;
}[] = [
	{ section: "discover", icon: "discover", to: "/" },
	{ section: "chat", icon: "chats", to: "/chats" },
	{ section: "create", icon: "create", to: "/create" },
];

export function PrimaryNav() {
	const pathname = usePathname();
	const router = useRouter();
	const { colors } = useTheme();
	const active = mobilePrimaryDestination(pathname);

	/**
	 * Draws nothing on non-root addresses. Every screen that mounts this component is a root today, so
	 * this branch is not reached; the fact that the row turns on only where it should must live in the
	 * decision, not in the wiring, so it holds when a screen is added.
	 */
	if (!active) return null;

	return (
		/**
		 * **Does not use the `tablist` / `tab` roles.** In this app those words mean the items **inside**
		 * the canvas (`/create`'s drafts · published · analytics, the settings category row). A second
		 * `tablist` drawn over that screen would read to assistive-technology users as six tabs. This row
		 * uses **the same vocabulary** as the drawer's list: buttons with `selected`.
		 */
		<View
			style={[
				nav.bar,
				{ backgroundColor: colors.background, borderTopColor: colors.border },
			]}
		>
			{DESTINATIONS.map((item) => {
				const selected = item.section === active;
				return (
					<Pressable
						key={item.to}
						accessibilityRole="button"
						accessibilityLabel={SIDEBAR_SECTION_LABEL[item.section]}
						/** The current location is not conveyed by color alone; assistive technology reads this value. */
						accessibilityState={{ selected }}
						onPress={() => {
							/**
							 * `navigate`. What global navigation does is **return to** that destination. `push` would
							 * stack a layer on every bottom-row press, and `replace` would remove the place to return to
							 * from a work detail. The drawer's same list uses the same function for the same reason.
							 */
							if (selected) return;
							router.navigate(item.to);
						}}
						/**
						 * No `hitSlop`. The items **touch** each other, so with overlapping targets in RN the
						 * later-drawn sibling wins: what is under the finger and what opens would differ, and that
						 * misfire leaves no trace on screen (`@rowcat/ui-native`'s `metrics.ts` records the same
						 * rule). One item is already a third of the screen width by 56pt.
						 */
						style={nav.item}
					>
						<Icon
							name={item.icon}
							size="lg"
							tone={selected ? "foreground" : "muted-foreground"}
						/>
						<Text
							variant="caption"
							weight={selected ? "semibold" : "regular"}
							tone={selected ? "foreground" : "muted-foreground"}
							numberOfLines={1}
						>
							{SIDEBAR_SECTION_LABEL[item.section]}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}

const nav = StyleSheet.create({
	/**
	 * Same height as the header (`appBarHeight`). Not a hand-picked number: it is the height this app
	 * already uses for a horizontal band, so the top and bottom bands stand at the same weight.
	 */
	bar: {
		borderTopWidth: borderWidth,
		flexDirection: "row",
		minHeight: appBarHeight,
	},
	/**
	 * Items split the width evenly. The vertical padding is there so that a two-line label at
	 * accessibility font sizes is not cut off: `minHeight` is the floor, and the content grows upward
	 * past it.
	 */
	item: {
		alignItems: "center",
		flex: 1,
		gap: space.xs,
		justifyContent: "center",
		paddingHorizontal: space.xs,
		paddingVertical: space.sm,
	},
});
