import { radiusScale, space } from "@rowcat/design";
import {
	controlHeight,
	screenPadding,
	Text,
	useTheme,
} from "@rowcat/ui-native";
import { Pressable, StyleSheet, View } from "react-native";
import {
	MotionIndicatorGroup,
	MotionIndicatorItem,
} from "../../lib/motion/active-indicator.tsx";
import {
	UpdateNotesUnseenDot,
	useUpdateNotesUnseen,
} from "../updates/update-notes-unseen-dot.tsx";
import {
	NOTIFICATIONS_TAB_LABEL,
	NOTIFICATIONS_TAB_UNSEEN_SUFFIX,
	NOTIFICATIONS_TABS_LABEL,
	type NotificationsTab,
} from "./notification-copy.ts";

const TABS: readonly NotificationsTab[] = ["general", "updates"];

/**
 * The tab row of the notifications screen. Same meaning as the web tab row, different geometry.
 *
 * ```text
 * [ General   Updates ● ]
 *    ────
 * ```
 *
 * ## No third tab library
 *
 * This app already has an active indicator that slides between siblings (`MotionIndicatorGroup`,
 * which the drawer and settings navigation also use). A tab library would add a second indicator
 * with a different rhythm.
 *
 * ## Active state is not conveyed by background alone
 *
 * `accessibilityRole="tab"` and `accessibilityState.selected` are set, and the weight changes too.
 * The moving background disappears when motion fails (a slow device, reduced motion, or a first
 * frame not yet measured), so the signals kept here are the other three.
 *
 * Both states share the same static geometry. If only the active one had a border or padding, the
 * whole row would jump each time the tab changes. Settings navigation follows the same rule.
 *
 * ## An unseen update is one dot, also spoken in the label
 *
 * It is not counted: `Updates (3)` belongs to the inbox's vocabulary. The dot is absent from the
 * accessibility tree; the web does the equivalent with invisible text, and here the
 * `accessibilityLabel` does it. That is why this row reads a single boolean
 * (`useUpdateNotesUnseen`). Neither the read record nor the history passes through here.
 */
export function NotificationsTabs({
	tab,
	onSelect,
}: {
	tab: NotificationsTab;
	onSelect: (next: NotificationsTab) => void;
}) {
	const { colors } = useTheme();
	const unseenUpdate = useUpdateNotesUnseen();

	return (
		<View
			accessibilityRole="tablist"
			accessibilityLabel={NOTIFICATIONS_TABS_LABEL}
			style={tabs.root}
		>
			{/**
			 * The indicator is an underline: the same shape as the web's `TabsList variant="line"`, and the same vocabulary
			 * the settings navigation uses (`shape="underline"`). It used to be a filled pill, so the same row read as a
			 * different control on each app.
			 */}
			<MotionIndicatorGroup
				activeKey={tab}
				shape="underline"
				indicatorStyle={{ backgroundColor: colors.foreground }}
				style={tabs.row}
			>
				{TABS.map((id) => {
					const active = id === tab;
					const updates = id === "updates";
					const label = NOTIFICATIONS_TAB_LABEL[id];
					return (
						<MotionIndicatorItem key={id} itemKey={id}>
							<Pressable
								accessibilityRole="tab"
								accessibilityState={{ selected: active }}
								accessibilityLabel={
									updates && unseenUpdate
										? `${label}${NOTIFICATIONS_TAB_UNSEEN_SUFFIX}`
										: label
								}
								/**
								 * Pressing the tab that is already active does nothing. Reselecting it would remount the
								 * list, losing scroll position and the state of the other tab.
								 */
								onPress={() => {
									if (active) return;
									onSelect(id);
								}}
								/**
								 * The active background is not here. The group draws that layer as it moves; only the press
								 * feedback remains in this element.
								 */
								style={({ pressed }) => [
									tabs.item,
									pressed && !active && { backgroundColor: colors.muted },
								]}
							>
								<Text
									variant="label"
									weight={active ? "semibold" : "regular"}
									tone={active ? "foreground" : "muted-foreground"}
								>
									{label}
								</Text>
								{updates ? <UpdateNotesUnseenDot /> : null}
							</Pressable>
						</MotionIndicatorItem>
					);
				})}
			</MotionIndicatorGroup>
		</View>
	);
}

const tabs = StyleSheet.create({
	/**
	 * **No border line. This is the one place it differs from settings navigation.**
	 *
	 * Both use underline indicators, but the web containers differ. Settings' narrow tab set is a
	 * `<nav className="border-b">`, so a line sits beneath the row. Notifications use `TabsList`,
	 * which has no line (measured: `border-bottom-width` is 0 on the list, and the underline is drawn
	 * with `::after`). Guessing would add a line the web does not have.
	 */
	root: { paddingBottom: space.sm, paddingHorizontal: screenPadding },
	/**
	 * The text wraps onto a new line when it grows. A horizontal scroll would hide the second tab
	 * off-screen with no hint that it exists, and shrinking the target would break the 44pt floor.
	 */
	row: { flexDirection: "row", flexWrap: "wrap" },
	/**
	 * No surface on the tab: the underline needs nothing covered, so only press feedback remains. The
	 * height matches the web's `TabsTrigger` (`px-2 py-1 text-sm`).
	 */
	item: {
		alignItems: "center",
		borderRadius: radiusScale.md,
		flexDirection: "row",
		gap: space.xs,
		justifyContent: "center",
		minHeight: controlHeight.md,
		paddingHorizontal: space.md,
	},
});
