import { ROOM_SORTS, type RoomSort } from "@rowcat/chat";
import { space } from "@rowcat/design";
import {
	BareInput,
	Icon,
	IconButton,
	Select,
	SelectOption,
	Text,
	touchTarget,
} from "@rowcat/ui-native";
import { StyleSheet, View } from "react-native";
import { formatCount } from "../../lib/format.ts";
import {
	ROOM_SEARCH_CLEAR_LABEL,
	ROOM_SEARCH_LABEL,
	ROOM_SEARCH_PLACEHOLDER,
	ROOM_SORT_LABEL,
	ROOM_SORT_TRIGGER_LABEL,
	roomCountLabel,
} from "./room-library-copy.ts";

/**
 * Search and sort, the head of the list.
 *
 * - No debounce: discovery's 300ms delay exists to slow route changes (each keystroke would
 *   change the query identity and rebuild the list); here the filter runs on an in-memory array and
 *   no request goes out.
 * - A clear button exists: discovery leans on the keyboard return key and `clearButtonMode`, but
 *   here clearing is the way out of the `No results` screen, and Android has no `clearButtonMode`.
 *   The web toolbar has the same button.
 * - The count is the matched number, not the revealed one: 400 matches with 50 drawn is still
 *   `400 conversations`, and a number rising on `Show more` reads as conversations having grown.
 */
export function LibraryToolbar({
	query,
	onQuery,
	sort,
	onSort,
	matched,
}: {
	query: string;
	onQuery: (query: string) => void;
	sort: RoomSort;
	onSort: (sort: RoomSort) => void;
	matched: number;
}) {
	return (
		<View style={toolbar.root}>
			<View style={toolbar.row}>
				<View style={toolbar.field}>
					{/**
					 * The icon overlays the field; laid out as a horizontal sibling, that row becomes
					 * a bordered box of its own and differs from other inputs.
					 */}
					<View style={toolbar.icon} pointerEvents="none">
						<Icon name="search" size="md" tone="muted-foreground" />
					</View>
					<BareInput
						label={ROOM_SEARCH_LABEL}
						value={query}
						onChangeText={onQuery}
						placeholder={ROOM_SEARCH_PLACEHOLDER}
						autoCapitalize="none"
						autoCorrect={false}
						returnKeyType="search"
						style={toolbar.input}
					/>
					{query.length > 0 ? (
						<View style={toolbar.clear}>
							<IconButton
								icon="close"
								label={ROOM_SEARCH_CLEAR_LABEL}
								tone="muted-foreground"
								onPress={() => onQuery("")}
							/>
						</View>
					) : null}
				</View>

				<SortSelect sort={sort} onSort={onSort} />
			</View>

			<MatchedCount matched={matched} />
		</View>
	);
}

/**
 * Sort picker: a `Select`, not a sheet. The container follows the interaction's character, not the
 * platform (`docs/design/ARCHITECTURE.md`); this is a value choice bound to a trigger and the
 * trigger must state the current value, as in the web toolbar. Having only three options is not a
 * reason for `ChoiceSheet`, which is for when rising from the bottom itself carries meaning.
 */
function SortSelect({
	sort,
	onSort,
}: {
	sort: RoomSort;
	onSort: (sort: RoomSort) => void;
}) {
	return (
		<Select label={ROOM_SORT_TRIGGER_LABEL} value={ROOM_SORT_LABEL[sort]}>
			{ROOM_SORTS.map((value) => (
				<SelectOption
					key={value}
					label={ROOM_SORT_LABEL[value]}
					selected={value === sort}
					onSelect={() => onSort(value)}
				/>
			))}
		</Select>
	);
}

/**
 * The count that passed search, not the revealed one. Numbers are not abbreviated (`formatCount`):
 * `12.4K` makes 12,400 and 12,449 the same glyphs, and here the number helps judge whether the
 * wanted item is in the list.
 */
function MatchedCount({ matched }: { matched: number }) {
	return (
		<Text
			variant="caption"
			tone="muted-foreground"
			accessibilityLiveRegion="polite"
		>
			{roomCountLabel(formatCount(matched))}
		</Text>
	);
}

const toolbar = StyleSheet.create({
	root: { gap: space.sm, paddingBottom: space.sm },
	/** Stacked vertically: at 320pt one row clips both values, and a clipped sort name (`Recent ac…`) is worse than none. */
	row: { gap: space.sm },
	field: { justifyContent: "center" },
	icon: { left: space.md, position: "absolute", zIndex: 1 },
	/**
	 * Left reserves the icon (padding + 16 icon + gap), right the clear button's target. Off-grid on
	 * purpose: both derive from another element's size (`touchTarget`, icon 16), and rounding to the
	 * nearest token would slide text under that element.
	 */
	input: { paddingLeft: 40, paddingRight: touchTarget + space.xs },
	clear: { position: "absolute", right: space.xs, zIndex: 1 },
});
