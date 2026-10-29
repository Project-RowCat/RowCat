import type { ChatSearchResult, ChatSearchView, ChatStore } from "@rowcat/chat";
import { messagesFromEnd } from "@rowcat/chat";
import { borderWidth, radiusScale, space } from "@rowcat/design";
import {
	BareInput,
	Button,
	ComposerArea,
	EmptyState,
	IconButton,
	KeyboardLayout,
	Spinner,
	screenPadding,
	Text,
	useTheme,
} from "@rowcat/ui-native";
import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { formatDateTime } from "../../lib/format.ts";
import { useRoomSearch } from "./use-room-search.ts";

/**
 * In-room search: a surface replacing the canvas, not a sheet. Three reasons for the container:
 *
 * ```text
 * list     results can run to hundreds of rows; virtualization is needed and a FlatList inside a ScrollView turns it off
 * keyboard the input takes focus on open; a keyboard over a sheet leaves only a couple of result rows
 * overlap  selecting a result jumps to the history behind it; jumping from a layer covering that list is incoherent
 * ```
 *
 * A resident search field in the header is out for the same reason: that slot belongs to the room
 * title, and a permanent input would push the title or overflow aside on narrow screens.
 *
 * This surface lives inside the screen's `Screen`, which already owns top, left and right; only the
 * bottom is received here via `ComposerArea` (the same component as the chat composer): the
 * keyboard owns it when raised, the home indicator when lowered.
 */

export function ChatSearchPanel({
	store,
	roomId,
	onClose,
	onReveal,
}: {
	store: ChatStore | null;
	roomId: string;
	onClose: () => void;
	/**
	 * Reveals one result in the history. Window size and target id go together: widening the window
	 * and jumping to the row belong to different layers (subscription vs virtualizer), and touching
	 * scroll here would let the two corrections overwrite each other in one frame.
	 */
	onReveal: (input: { messageId: string; window: number }) => void;
}) {
	const [query, setQuery] = useState("");
	const search = useRoomSearch(store, roomId, query);

	const select = useCallback(
		(result: ChatSearchResult) => {
			// Compute the window size before closing: once this surface is gone nothing knows the total
			// message count, and without it the coordinate cannot become a window size.
			onReveal({
				messageId: result.messageId,
				window: messagesFromEnd(search.total, result.index),
			});
			onClose();
		},
		[onReveal, onClose, search.total],
	);

	return (
		<KeyboardLayout>
			<SearchField value={query} onChange={setQuery} onClose={onClose} />
			<Results
				query={query}
				view={search.view}
				state={search}
				onSelect={select}
			/>
			{/* Keeps the results' bottom above the home indicator and gesture bar. Drawn even when empty because that surface carries the background to the device edge; without it the screen background shows below the last result. */}
			<ComposerArea />
		</KeyboardLayout>
	);
}

/**
 * One search field and one way out. `AppBar` is not used: its slot is a title, and the leftover
 * width rule differs for an input; a title shrinks but an input must not.
 */
function SearchField({
	value,
	onChange,
	onClose,
}: {
	value: string;
	onChange: (next: string) => void;
	onClose: () => void;
}) {
	const { colors } = useTheme();
	return (
		<View style={[field.bar, { borderBottomColor: colors.border }]}>
			<BareInput
				label="Search conversations"
				value={value}
				onChangeText={onChange}
				placeholder="Find in this conversation"
				autoFocus
				/* No auto-capitalization or auto-correction on the query; discovery's and the list's search fields turn both off and only this one had them on. The symptom is silent: the first letter capitalizes (`lighthouse` → `Lighthouse`) and autocorrect swaps room-only words. */
				autoCapitalize="none"
				autoCorrect={false}
				returnKeyType="search"
				style={field.input}
			/>
			{/**
			 * Close, not back: this surface is a state replacing the canvas rather than a route, so
			 * leaving turns that state off instead of climbing the stack. A left `back` arrow once sat
			 * at the right edge, the icon's direction and position contradicting each other, so the
			 * button's action could not be read even though its name was already `Close search`. The X is
			 * the icon other surfaces in this app use at top right (`Dialog`).
			 */}
			<IconButton icon="close" label="Close search" onPress={onClose} />
		</View>
	);
}

function Results({
	query,
	view,
	state,
	onSelect,
}: {
	/** The current input; separates "not typed yet" from "typed but nothing found". */
	query: string;
	view: ChatSearchView;
	state: { loading: boolean; stale: boolean; showMore: () => void };
	onSelect: (result: ChatSearchResult) => void;
}) {
	// The order of the three states is the rule: reading, not typed yet, nothing found. Drawing
	// "reading" as "no results" would tell someone opening a long conversation their word is absent, a
	// fact we cannot yet know. The middle cell was once missing, so everyone opening search got `No
	// matches` before typing anything, the same false claim; web's dialog keeps four sentences apart and
	// puts this cell first (`chat-search-dialog.tsx`). Whitespace-only counts as not typed, as web's
	// `trim()` does.
	//
	// Non-list cells also fill the remaining height. `EmptyState` and `Spinner` do not stretch (they
	// are content blocks and the screen decides geometry, see `ui-native/src/state.tsx`); returned
	// bare, the cell would be content-tall and the `ComposerArea` below would rise and draw its top
	// border as a solid line mid-screen. The list cell lacks the symptom (`FlatList` stretches), so it
	// surfaces only when another state is added.
	if (state.loading)
		return (
			<View style={results.fill}>
				<Spinner label="Reading the conversation" />
			</View>
		);

	if (query.trim().length === 0)
		return (
			<View style={results.fill}>
				<EmptyState
					icon="search"
					title="Type what to find in the conversation"
					description="Searches only messages stored in this conversation."
				/>
			</View>
		);

	return (
		<FlatList
			data={view.results}
			keyExtractor={keyOf}
			renderItem={({ item }) => (
				<ResultRow result={item} onPress={() => onSelect(item)} />
			)}
			contentContainerStyle={results.content}
			keyboardShouldPersistTaps="handled"
			keyboardDismissMode="on-drag"
			style={state.stale ? results.stale : undefined}
			ListHeaderComponent={
				view.matched > 0 ? (
					<Text variant="caption" tone="muted-foreground" style={results.count}>
						{view.matched} {view.matched === 1 ? "message" : "messages"}
					</Text>
				) : null
			}
			ListFooterComponent={
				view.hasMore ? (
					<Button
						label="More results"
						variant="outline"
						fullWidth
						onPress={state.showMore}
					/>
				) : null
			}
			ListEmptyComponent={
				<EmptyState
					icon="no-results"
					title="No matches"
					description="Try another word."
				/>
			}
		/>
	);
}

const keyOf = (result: ChatSearchResult) => result.messageId;

/**
 * One result row: who spoke, when, and only the text around the match. Not carrying the whole body
 * is already decided by the search rule (`snippet`). The highlight ranges are coordinates within
 * that preview and are not re-found here; re-finding would duplicate the normalization rule, and
 * the divergence shows only as highlights shifted by a character.
 */
function ResultRow({
	result,
	onPress,
}: {
	result: ChatSearchResult;
	onPress: () => void;
}) {
	const { colors } = useTheme();
	const at = formatDateTime(result.createdAt);
	const who = result.role === "user" ? result.speaker || "Me" : "Other";

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`Go to ${who}'s message: ${result.snippet}`}
			onPress={onPress}
			style={({ pressed }) => [
				results.row,
				{ borderColor: colors.border },
				pressed && { backgroundColor: colors.muted },
			]}
		>
			<View style={results.rowHead}>
				<Text variant="caption" tone="muted-foreground">
					{who}
				</Text>
				{at ? (
					<Text variant="caption" tone="muted-foreground">
						{at}
					</Text>
				) : null}
			</View>
			<Snippet result={result} />
		</Pressable>
	);
}

/** Emphasizes matches with weight, not color alone, which is plain text to anyone who cannot distinguish it. Web's search results make the same call. */
function Snippet({ result }: { result: ChatSearchResult }) {
	const parts: { text: string; hit: boolean }[] = [];
	let cursor = 0;
	for (const range of result.matchRanges) {
		if (range.start > cursor)
			parts.push({
				text: result.snippet.slice(cursor, range.start),
				hit: false,
			});
		parts.push({
			text: result.snippet.slice(range.start, range.end),
			hit: true,
		});
		cursor = range.end;
	}
	if (cursor < result.snippet.length)
		parts.push({ text: result.snippet.slice(cursor), hit: false });

	return (
		<Text variant="body" numberOfLines={3}>
			{parts.map((part, index) => (
				<Text
					// biome-ignore lint/suspicious/noArrayIndexKey: pieces are derived values with no identity.
					key={index}
					variant="body"
					weight={part.hit ? "semibold" : "regular"}
					tone={part.hit ? "foreground" : "muted-foreground"}
				>
					{part.text}
				</Text>
			))}
		</Text>
	);
}

const field = StyleSheet.create({
	bar: {
		alignItems: "center",
		borderBottomWidth: borderWidth,
		flexDirection: "row",
		gap: space.sm,
		paddingHorizontal: space.md,
		paddingVertical: space.xs,
	},
	input: { borderRadius: radiusScale.full, flex: 1 },
});

const results = StyleSheet.create({
	// Non-list cells take the same height as the list; see the `Results` comment.
	fill: { flex: 1 },
	content: { gap: space.sm, padding: screenPadding },
	count: { paddingBottom: space.xs },
	// Not yet the result of the characters just typed: dimmed, but interaction is not blocked.
	stale: { opacity: 0.6 },
	row: {
		borderRadius: radiusScale.lg,
		borderWidth: borderWidth,
		gap: space.xs,
		padding: space.md,
	},
	rowHead: {
		flexDirection: "row",
		gap: space.sm,
		justifyContent: "space-between",
	},
});
