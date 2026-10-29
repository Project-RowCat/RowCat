import { space } from "@rowcat/design";
import { BareInput, Icon } from "@rowcat/ui-native";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

/** How long key input must stay still before it counts as settled. Too short and the route changes on every letter; too long and search feels sluggish. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Search input. **The route holds the confirmed value; this field holds only the transient state in
 * between.**
 *
 * Changing the route parameter on every keystroke would split the query identity on each letter, so
 * the whole list would be rebuilt and each of those requests thrown away. Keeping the final value
 * in this field instead would lose the search text on going back, since component state dies with
 * the screen. So the two are split: text being typed lives here, and the confirmed search lives in
 * the route.
 *
 * It follows the value when that changes from outside, as when `Reset filters` also clears the search
 * text. The subtlest line in this component is **cancelling the timer** at that point. If it were
 * left running, a query cleared a moment ago would come back a few hundred milliseconds later.
 *
 * The magnifier is drawn because it is **the same signal as the web gallery's search box**. It is
 * decorative, so it is hidden from screen readers (the field already has a name). There is still no
 * clear button: the native keyboard's `search` return key and `clearButtonMode` already do that
 * job, and those are conventions users already know.
 *
 * The placeholder states what the server actually searches (title, author, description, creator).
 * Tags are not listed, because the server's search predicate does not include them today, and
 * listing them would be false.
 */
export function SearchField({
	value,
	onSearch,
}: {
	/** The confirmed search text the route holds. */
	value: string;
	/** Confirmation after the debounce settles. */
	onSearch: (query: string) => void;
}) {
	const [text, setText] = useState(value);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	/**
	 * The confirm callback is held in a ref. Putting it in the effect's dependencies would reset the
	 * timer whenever the parent creates a new function on each render, so the search would **never
	 * confirm.**
	 */
	const commit = useRef(onSearch);
	commit.current = onSearch;

	/** Follow external changes and drop any running timer (see above). */
	useEffect(() => {
		setText(value);
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
	}, [value]);

	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);

	const change = (next: string) => {
		setText(next);
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => commit.current(next), SEARCH_DEBOUNCE_MS);
	};

	const submit = () => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
		commit.current(text);
	};

	return (
		<View style={search.box}>
			<View style={search.icon} pointerEvents="none">
				<Icon name="search" size="md" tone="muted-foreground" />
			</View>
			<BareInput
				label="Search stories"
				value={text}
				onChangeText={change}
				onSubmitEditing={submit}
				/**
				 * **The same sentence as the web** (`gallery-toolbar.tsx`). This slot once read `Title · author · description ·
				 * creator`. It counted the same four, but as a bare list with no predicate, and the two screens
				 * drew different sentences in the same field. At 390 width it does not truncate (both fit on
				 * one line).
				 */
				placeholder="Search titles, authors, descriptions and creators"
				autoCapitalize="none"
				autoCorrect={false}
				returnKeyType="search"
				clearButtonMode="while-editing"
				style={search.input}
			/>
		</View>
	);
}

const search = StyleSheet.create({
	box: { justifyContent: "center", paddingHorizontal: space.lg },
	/**
	 * The icon is drawn **on top of** the field. As a sibling laid out in a row, the row would become
	 * a box with its own border, and its surface would differ from other inputs, losing the reason for
	 * sharing the same `BareInput`. `pointerEvents="none"` means pressing the icon still focuses the
	 * field.
	 */
	icon: { left: 28, position: "absolute", zIndex: 1 },
	/** The left padding widens by the icon's space (16 + icon 16 + gap 8). */
	input: { paddingLeft: 40 },
});
