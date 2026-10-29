import { borderWidth, radiusScale, space } from "@rowcat/design";
import { controlHeight, Text, useTheme } from "@rowcat/ui-native";
import { Pressable, StyleSheet, View } from "react-native";
import {
	MotionIndicatorGroup,
	MotionIndicatorItem,
} from "../../lib/motion/active-indicator.tsx";
import { AnimatedCount } from "../../lib/motion/animated-count.tsx";
import { CREATE_VIEW_LABEL, CREATE_VIEW_PICKER_LABEL } from "./create-copy.ts";
import { CREATE_VIEWS, type CreateView } from "./create-view.ts";

/**
 * Tab row for the four workspace views, mirroring the web row (underline indicator,
 * `tablist`/`tab`). Tabs rather than a select, because the current view must stay visible without
 * pressing.
 *
 * The active view comes from the address (`readCreateViewParam`); pressing only changes the
 * address. Active state is carried by `accessibilityState.selected`, font weight and color, not the
 * indicator, which is `aria-hidden`.
 */
export function CreateWorkspaceNavigation({
	view,
	draftCount,
	onSelect,
}: {
	view: CreateView;
	/** Only the drafts tab shows a count; it reuses an already-subscribed list, while other tabs query only when active. */
	draftCount: number;
	onSelect: (view: CreateView) => void;
}) {
	const { colors } = useTheme();

	return (
		/** Bottom border of the row; the active underline overlaps it. */
		<View style={[nav.root, { borderBottomColor: colors.border }]}>
			<View
				accessibilityRole="tablist"
				accessibilityLabel={CREATE_VIEW_PICKER_LABEL}
			>
				<MotionIndicatorGroup
					activeKey={view}
					shape="underline"
					indicatorStyle={{ backgroundColor: colors.foreground }}
					style={nav.row}
				>
					{CREATE_VIEWS.map((value) => {
						const active = value === view;
						return (
							<MotionIndicatorItem key={value} itemKey={value}>
								<Pressable
									accessibilityRole="tab"
									accessibilityState={{ selected: active }}
									onPress={() => {
										/** No-op on the active tab: setParams re-renders even for the same value, remounting the active query. */
										if (active) return;
										onSelect(value);
									}}
									/** No static active background: the moving indicator draws it, and a static one would show behind the incoming one. */
									style={({ pressed }) => [
										nav.item,
										pressed && !active && { backgroundColor: colors.muted },
									]}
								>
									<Text
										variant="label"
										weight={active ? "semibold" : "medium"}
										tone={active ? "foreground" : "muted-foreground"}
									>
										{CREATE_VIEW_LABEL[value]}
									</Text>
									{value === "drafts" ? (
										/** Stays mounted so the count animates on change; only the number moves. */
										<AnimatedCount
											value={String(draftCount)}
											variant="caption"
											tone="muted-foreground"
										/>
									) : null}
								</Pressable>
							</MotionIndicatorItem>
						);
					})}
				</MotionIndicatorGroup>
			</View>
		</View>
	);
}

const nav = StyleSheet.create({
	root: { borderBottomWidth: borderWidth },
	/** Wraps at large text sizes: horizontal scroll would hide the third tab, and shrinking targets breaks the 44pt floor. */
	row: { flexDirection: "row", flexWrap: "wrap" },
	/** Same 36 height as the web tab. No hitSlop: adjacent targets overlap and the later sibling wins (see metrics.ts). The radius only serves press feedback. */
	item: {
		alignItems: "center",
		borderRadius: radiusScale.md,
		flexDirection: "row",
		gap: space.xs + 2,
		justifyContent: "center",
		minHeight: controlHeight.md,
		paddingHorizontal: space.md,
	},
});
