import { borderWidth, lineHeight, radiusScale, space } from "@rowcat/design";
import {
	appliedGalleryFilters,
	GALLERY_FILTER_AXIS_LABEL,
	type GalleryFilters,
	hasActiveFilters,
	ORIENTATION_LABEL,
	ORIENTATIONS,
	periodApplies,
	relevanceApplies,
	STORY_PERIOD_LABEL,
	STORY_PERIODS,
	STORY_RATING_LABEL,
	STORY_RATINGS,
	STORY_SORT_LABEL,
	STORY_SORTS,
	type StorySort,
	sortTriggerLabel,
} from "@rowcat/domain";
import {
	Button,
	controlHeight,
	DropdownMenu,
	Icon,
	MenuCheckboxItem,
	MenuLabel,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	Text,
	targetSlop,
	useTheme,
} from "@rowcat/ui-native";
import { Pressable, StyleSheet, View } from "react-native";
import { discoverTotalLabel } from "./discover-state.ts";

/**
 * Discover's query axes, with the same IA as the web toolbar.
 *
 * ```text
 * [ ⚟ Filters ]                         [ Newest ▾ ]      what narrows, and in what order
 * [ Orientation: Female-oriented × ] [ Following × ]       conditions currently applied
 * 32 stories                         [ ↺ Reset filters ]   how many remain
 * ```
 *
 * ## ⚠️ This row used to have a different IA from the web
 *
 * Each axis had its own chip (orientation, rating, sort, period, following: five in all), each
 * opening a bottom sheet, in one horizontal strip. The reasoning written for that layout was
 * "applied conditions explain the result, so they must not be hidden." That sentence is right, but
 * the web had already met the requirement another way: controls fold into a menu, and **only the
 * applied conditions** stay outside as tokens. An axis at its default draws nothing, so an
 * unfiltered screen has just two triggers, and a filtered screen shows only the filters that apply.
 *
 * The old layout cost something real. The fifth chip (`Following`) sat off-screen at 402pt, so a
 * signed-in user could not learn that the axis existed without pressing something. The web has no
 * such state, because default axes are never drawn.
 *
 * ## The decision lives in shared pure functions
 *
 * Which axes count as applied, the sentence each one reads as, and what each × resets all come from
 * `appliedGalleryFilters` in `@rowcat/domain`. The sort trigger's label comes from
 * `sortTriggerLabel`. **The web calls the same functions.** Written per app, one side would drop
 * the rating token, or one side's × would clear the wrong axis.
 *
 * ## Guests get no following axis
 *
 * The server answers the personal feed with a 401, so pressing it shows nothing. Making it a
 * sign-in item would make it the only control in this row that navigates. **The address value is
 * kept as is.** Hiding the axis and clearing the route parameter are different operations.
 *
 * ## No favorites axis
 *
 * `GalleryFilters` has `favoritesOnly`, and the server knows it. It is left out anyway because the
 * web's toolbar does not have it. The model being able to express something is not a reason to add
 * it to the screen.
 */

/** The "all" orientation is `null` in the domain. A radio item needs a value, so it is a string only here. */
const ORIENTATION_ANY = "any";

export function FilterBar({
	filters,
	followingAvailable,
	total,
	onChange,
	onReset,
}: {
	filters: GalleryFilters;
	/** Whether the following axis is drawn. True only for members (see above). */
	followingAvailable: boolean;
	/**
	 * Server-counted total: everything matching the conditions, not what has accumulated on screen
	 * (infinite scroll makes the two differ).
	 *
	 * **`null` is unknown, not 0.** Until the server answers there is no number here, and the toolbar
	 * shows that as a blank slot (`discoverTotalLabel`).
	 */
	total: number | null;
	onChange: (patch: Partial<GalleryFilters>) => void;
	onReset: () => void;
}) {
	const { colors } = useTheme();
	const applied = appliedGalleryFilters(filters, followingAvailable);
	const totalLabel = discoverTotalLabel(total);
	const showPeriod = periodApplies(filters);
	/**
	 * Relevance is an item only while a query exists. Picking it without one folds to newest
	 * (`effectiveGallerySort`), so it would change nothing. This matches the web's sort menu.
	 */
	const sorts = STORY_SORTS.filter(
		(sort) => sort !== "relevance" || relevanceApplies(filters),
	);

	return (
		<View style={bar.root}>
			<View style={bar.controls}>
				{/**
				 * **All narrowing axes expand into one menu**, with the same content and order as the
				 * web's `GalleryFilterMenu`. There are three axes with at most four values each, so there
				 * is no reason for submenus. Radio rows do not close the menu, so setting two conditions
				 * in a row does not require reopening it.
				 */}
				<DropdownMenu icon="filter" label="Filter" triggerLabel="Filter">
					<MenuLabel label={GALLERY_FILTER_AXIS_LABEL.orientation} />
					<MenuRadioGroup
						value={filters.orientation ?? ORIENTATION_ANY}
						onValueChange={(value) =>
							onChange({
								orientation:
									value === ORIENTATION_ANY
										? null
										: (value as (typeof ORIENTATIONS)[number]),
							})
						}
					>
						<MenuRadioItem value={ORIENTATION_ANY} label="All" />
						{ORIENTATIONS.map((orientation) => (
							<MenuRadioItem
								key={orientation}
								value={orientation}
								label={ORIENTATION_LABEL[orientation]}
							/>
						))}
					</MenuRadioGroup>

					<MenuSeparator />

					<MenuLabel label={GALLERY_FILTER_AXIS_LABEL.rating} />
					<MenuRadioGroup
						value={filters.rating}
						onValueChange={(rating) =>
							onChange({ rating: rating as (typeof STORY_RATINGS)[number] })
						}
					>
						{STORY_RATINGS.map((rating) => (
							<MenuRadioItem
								key={rating}
								value={rating}
								label={STORY_RATING_LABEL[rating]}
							/>
						))}
					</MenuRadioGroup>

					{followingAvailable ? (
						<>
							<MenuSeparator />
							<MenuCheckboxItem
								label={GALLERY_FILTER_AXIS_LABEL.following}
								checked={filters.followingOnly}
								onCheckedChange={(followingOnly) => onChange({ followingOnly })}
							/>
						</>
					) : null}
				</DropdownMenu>

				{/**
				 * **Sort has its own trigger.** Mixing it into the narrowing menu would blur "what
				 * remains" with "in what order" (the same judgment as the web). The popularity window
				 * belongs to sort, so it sits inside this menu.
				 */}
				<DropdownMenu
					icon="chevron-down"
					label={`Sort: ${sortTriggerLabel(filters)}`}
					triggerLabel={sortTriggerLabel(filters)}
				>
					<MenuLabel label="Sort" />
					<MenuRadioGroup
						value={filters.sort}
						onValueChange={(sort) => onChange({ sort: sort as StorySort })}
					>
						{sorts.map((sort) => (
							<MenuRadioItem
								key={sort}
								value={sort}
								label={STORY_SORT_LABEL[sort]}
							/>
						))}
					</MenuRadioGroup>

					{showPeriod ? (
						<>
							<MenuSeparator />
							<MenuLabel label="Period" />
							<MenuRadioGroup
								value={filters.period}
								onValueChange={(period) =>
									onChange({ period: period as (typeof STORY_PERIODS)[number] })
								}
							>
								{STORY_PERIODS.map((period) => (
									<MenuRadioItem
										key={period}
										value={period}
										label={STORY_PERIOD_LABEL[period]}
									/>
								))}
							</MenuRadioGroup>
						</>
					) : null}
				</DropdownMenu>
			</View>

			{applied.length > 0 ? (
				<View style={bar.tokens}>
					{applied.map((entry) => (
						<FilterToken
							key={entry.axis}
							text={entry.text}
							removeLabel={entry.removeLabel}
							onRemove={() => onChange(entry.patch)}
						/>
					))}
				</View>
			) : null}

			<View style={bar.summary}>
				{/**
				 * **An unknown value is not drawn as `0 stories`.** Until the server answers, a quiet bar of the
				 * same height stands in place of the text. The toolbar geometry stays fixed, so the grid
				 * below does not jump when the total arrives. This matches the web placeholder in this same
				 * spot (`gallery-skeleton.tsx`, `h-4 w-16`).
				 *
				 * The placeholder is **not read**. If it stayed in the accessibility tree, a meaningless
				 * shape would be announced where the total goes, and no sentence is there yet. The list
				 * already says what is being awaited (`DiscoverEmpty`'s `loading`).
				 */}
				{totalLabel === null ? (
					<View
						accessibilityElementsHidden
						importantForAccessibility="no-hide-descendants"
						style={bar.totalPending}
					>
						<View style={[bar.totalBar, { backgroundColor: colors.muted }]} />
					</View>
				) : (
					<Text variant="label" tone="muted-foreground">
						{totalLabel}
					</Text>
				)}
				{/** Drawn only when there is something to reset. If it were always present, the button would become background. */}
				{hasActiveFilters(filters) && (
					<Button
						label="Reset filters"
						variant="ghost"
						size="sm"
						icon="retry"
						onPress={onReset}
					/>
				)}
			</View>
		</View>
	);
}

/**
 * One applied condition, shown **outside** the menu to explain why the results look this way.
 *
 * It is an operation, not decoration: the × alone resets that axis. The whole token is not made a
 * button, which matches the web. Pressing the text could otherwise either clear the condition or
 * open the menu, and the control would be ambiguous.
 */
function FilterToken({
	text,
	removeLabel,
	onRemove,
}: {
	text: string;
	removeLabel: string;
	onRemove: () => void;
}) {
	const { colors } = useTheme();
	return (
		<View
			style={[
				bar.token,
				{ backgroundColor: colors.secondary, borderColor: colors.border },
			]}
		>
			<Text variant="caption" tone="secondary-foreground">
				{text}
			</Text>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={removeLabel}
				onPress={onRemove}
				/** The glyph is 12pt, so the target falls well short of 44pt. The shortfall is not visible; hitSlop covers it. */
				hitSlop={targetSlop(12)}
				style={({ pressed }) => [pressed && bar.pressed]}
			>
				<Icon name="close" size="sm" tone="muted-foreground" />
			</Pressable>
		</View>
	);
}

const bar = StyleSheet.create({
	root: { gap: space.sm },
	/** The two triggers sit at opposite ends of the row, like the web's `justify-between`. */
	controls: {
		flexDirection: "row",
		gap: space.sm,
		justifyContent: "space-between",
		paddingHorizontal: space.lg,
	},
	tokens: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: space.xs + 2,
		paddingHorizontal: space.lg,
	},
	/** Pill shape matching the web's condition token. Taller than the badge height (20), since it holds a control. */
	token: {
		alignItems: "center",
		borderRadius: radiusScale.full,
		borderWidth: borderWidth,
		flexDirection: "row",
		gap: space.xs + 2,
		minHeight: controlHeight.sm,
		paddingLeft: space.md,
		paddingRight: space.sm,
	},
	pressed: { opacity: 0.6 },
	/** **Same height** as the total text, so the row neither grows nor shrinks when the value arrives. */
	totalPending: { height: lineHeight.label, justifyContent: "center" },
	/** Roughly the width of `1,234 stories`. Thinner than the text, so it does not read heavier than the value. */
	totalBar: { borderRadius: radiusScale.full, height: 10, width: 56 },
	summary: {
		alignItems: "center",
		flexDirection: "row",
		justifyContent: "space-between",
		paddingHorizontal: space.lg,
	},
});
