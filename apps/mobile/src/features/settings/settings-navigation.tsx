import { borderWidth, radiusScale, space } from "@rowcat/design";
import { controlHeight, Icon, Text, useTheme } from "@rowcat/ui-native";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import {
	MotionIndicatorGroup,
	MotionIndicatorItem,
} from "../../lib/motion/active-indicator.tsx";
import {
	MOBILE_SETTINGS_ACCOUNT_LINK,
	MOBILE_SETTINGS_NAV,
	type MobileSettingsCategory,
	SETTINGS_NAV_LABEL,
} from "./settings-nav.ts";

/**
 * Navigation inside settings. It belongs to the settings canvas, not to the drawer.
 *
 * The left drawer holds global destinations and recent conversations (`app-sidebar.tsx`). Adding
 * one feature's categories there would turn that surface into leftover space holding different
 * things per screen. The web keeps the settings list inside the canvas for the same reason.
 *
 * ## One container, the only place that differs from the web
 *
 * The web draws the same list in two containers: a left rail on wide screens and a horizontal row
 * on narrow ones. This app has no wide layout, so only the narrow shape remains. The rule of not
 * keeping two navigation IAs (one for desktop, one for narrow screens) reduces here to having a
 * single container.
 *
 * **Not a horizontally scrolling chip row.** With three destinations it fits at 320pt, so nothing
 * needs pressing to see what exists. At large accessibility text sizes it wraps (`flexWrap`);
 * targets are not shrunk to force a single line.
 *
 * ## The current category is answered by the route
 *
 * There is no shadow state such as `selectedCategory`. The screen receives its category as a prop
 * because the value comes from the route file (`app/settings/*.tsx`), and that value is the
 * address. Keeping it in local state would break deep links, back navigation and state restoration.
 *
 * ## Active state is not conveyed by color alone
 *
 * `accessibilityState.selected` is set and the label weight changes. The two branches share the
 * same static geometry: giving only the active one a border or padding would shake the whole row on
 * every category change. (The web's matching row keeps the same rule with a transparent underline.)
 *
 * ## The indicator is one underline that moves between siblings
 *
 * This is exactly the web's narrow-screen branch: a border line below the row (`border-b`) and a
 * 2px `foreground` line on the bottom of the active cell (`MotionActiveIndicator
 * group="settings-nav-compact"`). The web's wide-screen left rail uses a filled surface
 * (`bg-accent`); this app has no such width.
 *
 * **For a while this was a filled pill.** Colors and rhythm matched the web, so no check failed,
 * but side by side the same row read as a different control: the web is tabs and the app was a
 * segmented control. Geometry is now vocabulary (`shape="underline"`), and thickness belongs to
 * that layer.
 *
 * Toggling each cell's indicator on its own would make one operation (changing category) appear and
 * disappear in two places.
 *
 * **The background does not state the active state.** If motion fails (slow device, reduced motion,
 * first frame not yet measured) the indicator disappears, so the signals that remain are
 * independent of it: `accessibilityState.selected`, label weight and label color. The indicator is
 * not in the accessibility tree.
 *
 * **The name space is separated structurally.** On the web `layoutId` is a global string and must
 * be named (the sidebar's indicator is on the same screen). Here a different container means a
 * different indicator, and this group only measures its own children.
 */
export function SettingsNavigation({
	category,
}: {
	category: MobileSettingsCategory;
}) {
	const router = useRouter();
	const { colors } = useTheme();

	return (
		/**
		 * One border **below** the row, matching the web's `<nav className="border-b">`. The active
		 * underline sits exactly on top of that line, so without it the underline would float.
		 */
		<View style={[nav.root, { borderBottomColor: colors.border }]}>
			<View
				accessibilityRole="tablist"
				accessibilityLabel={SETTINGS_NAV_LABEL}
				style={nav.list}
			>
				<MotionIndicatorGroup
					activeKey={category}
					shape="underline"
					indicatorStyle={{ backgroundColor: colors.foreground }}
					style={nav.row}
				>
					{MOBILE_SETTINGS_NAV.map((item) => {
						const active = item.category === category;
						return (
							<MotionIndicatorItem key={item.route} itemKey={item.category}>
								<Pressable
									accessibilityRole="tab"
									accessibilityState={{ selected: active }}
									onPress={() => {
										/**
										 * Does nothing when the category is already active. `replace` does not stack history, but
										 * it remounts the screen, so pressing the current cell would discard a form being edited
										 * (persona or color draft).
										 */
										if (active) return;
										/**
										 * **`replace`.** Switching category changes a cell of the same workspace rather than
										 * navigating elsewhere. Pushing would stack entries, so someone who moved across three
										 * cells would need three back presses to return (usually to a conversation or a work).
										 */
										router.replace(item.route);
									}}
									/**
									 * **No active background here.** That layer is drawn by the group's moving indicator (see
									 * the header). This item keeps only the press feedback. Drawing both would stack two
									 * backgrounds in the same place, with a static background sitting under the sliding
									 * indicator.
									 */
									style={({ pressed }) => [
										nav.item,
										pressed && !active && { backgroundColor: colors.muted },
									]}
								>
									{/**
									 * The same two axes as the web: active is `font-semibold text-foreground`,
									 * the rest are `text-muted-foreground`. When the underline is absent
									 * (reduced motion, first frame) these two still say where the user is.
									 */}
									<Text
										variant="label"
										weight={active ? "semibold" : "regular"}
										tone={active ? "foreground" : "muted-foreground"}
									>
										{item.label}
									</Text>
								</Pressable>
							</MotionIndicatorItem>
						);
					})}
				</MotionIndicatorGroup>
			</View>

			{/**
			 * Account management is **outside the tab group but on the same row**, which is exactly the web's
			 * narrow shape (`justify-between`). It is an exit, not a category, so it is not inside `tablist`;
			 * the absence of an underline and the arrow say so.
			 *
			 * **It is not moved to its own row.** It was once, which added 44pt of height and made this row
			 * read as "three categories plus a fourth destination". Keeping it out of that list was the point
			 * of this link, and the layout undid it.
			 *
			 * The icon matches the web (`leave` = `ArrowUpRight`). A chevron (`chevron-right`) would mean
			 * "descends into a child of this list", saying the opposite on the same row.
			 *
			 * It uses `navigate`: the account is a utility destination you return from, and the header's
			 * account menu goes to the same place the same way.
			 */}
			<Pressable
				accessibilityRole="link"
				accessibilityLabel={MOBILE_SETTINGS_ACCOUNT_LINK.label}
				accessibilityHint="Goes to the account screen"
				onPress={() => router.navigate(MOBILE_SETTINGS_ACCOUNT_LINK.route)}
				style={({ pressed }) => [
					nav.account,
					pressed && { backgroundColor: colors.muted },
				]}
			>
				<Text variant="label" tone="muted-foreground">
					{MOBILE_SETTINGS_ACCOUNT_LINK.label}
				</Text>
				<Icon name="leave" size="sm" tone="muted-foreground" />
			</Pressable>
		</View>
	);
}

const nav = StyleSheet.create({
	/**
	 * The tab group and the exit link share **one row** (the web's `justify-between`). The border sits
	 * below that row, and the active underline overlaps it.
	 *
	 * `flexWrap` is here for accessibility text sizes: if the four items cannot fit one row, they
	 * wrap.
	 */
	root: {
		alignItems: "center",
		borderBottomWidth: borderWidth,
		flexDirection: "row",
		flexWrap: "wrap",
		justifyContent: "space-between",
	},
	list: { minWidth: 0 },
	/**
	 * **Wraps to a new line as text grows.** Horizontal scrolling would hide the third cell with no
	 * sign that it exists, and shrinking targets would break the 44pt floor.
	 */
	row: { flexDirection: "row", flexWrap: "wrap" },
	/**
	 * The cell draws no shape: the indicator is an underline, so there is no surface to cover, and
	 * only the press feedback remains. Horizontal padding matches the web's `px-3`.
	 */
	/** Same 36 as the web's tab (`px-3 py-2 text-sm`). Cells touch horizontally, so no extra hit slop is added. */
	item: {
		alignItems: "center",
		borderRadius: radiusScale.md,
		justifyContent: "center",
		minHeight: controlHeight.md,
		paddingHorizontal: space.md,
	},
	account: {
		alignItems: "center",
		borderRadius: radiusScale.md,
		flexDirection: "row",
		gap: space.xs,
		minHeight: controlHeight.md,
		paddingHorizontal: space.sm,
	},
});
