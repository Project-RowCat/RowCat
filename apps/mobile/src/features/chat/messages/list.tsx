import type {
	ChatMessage,
	ChatPlaceholderNames,
	ConversationDisplayMessage,
} from "@rowcat/chat";
import type { ChatSeedSceneImageDto } from "@rowcat/contracts/chat";
import { radiusScale, space } from "@rowcat/design";
import { Button, Spinner, Text, useTheme } from "@rowcat/ui-native";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	FlatList,
	type GestureResponderEvent,
	type LayoutChangeEvent,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
	StyleSheet,
	View,
} from "react-native";
import { chatListGutter } from "../chat-rhythm.ts";
import { MessageRow } from "./row.tsx";

/**
 * Conversation history as one virtualized list. Bubbles are not stacked in a `ScrollView`: a
 * conversation can reach thousands of rows and that combination turns virtualization off, stalling
 * low-end devices on old rooms (discover and story detail each keep one `FlatList` for the same
 * reason).
 *
 * - The streaming response is the list's last row, not drawn outside it: outside, the row would
 *   reappear one slot lower on commit and the screen would jump, and it would sit outside the
 *   list's scroll so a long response could not be followed. Its id is chosen here and cannot
 *   collide with a stored id; the key changing on commit is correct since they are different
 *   records.
 * - Committed rows are not passed as `ChatMessage`. The renderer reads five fields
 *   (`ConversationDisplayMessage`); narrowing prevents an unsaved row from inventing `dirty`, `rev`
 *   and `deletedAt` to stand in the list.
 * - The list is inverted, which keeps the view pinned to the bottom as rows are added and stable
 *   when scrolling up. Data must be reversed once, here; callers always pass ascending order.
 */

/** Slot of a not-yet-saved response; prefixed so it cannot collide with stored ids. */
const STREAMING_ID = "streaming:pending";

/**
 * Distance at which `Jump to latest` appears; same value as web's `JUMP_THRESHOLD_PX`. In an inverted list
 * the distance to the bottom is `contentOffset.y` (0 is newest), which the platform gives directly,
 * so no `scroll-position.ts` is needed. Web has two thresholds (follow 80, button 320); there is
 * one here because following is not decided by us: an inverted list stays pinned by default,
 * leaving only whether the button is worth showing.
 */
const JUMP_THRESHOLD = 320;

/**
 * Distance counted as the bottom, same as web's `BOTTOM_THRESHOLD_PX`. It measures "scrolled down
 * once more at the bottom" for `onScrollGesture`; if it differed, one app would start the next
 * scene at the same spot while the other would not.
 */
const AT_BOTTOM_THRESHOLD = 80;

/** How long a jumped-to row stays marked, same as web's `HIGHLIGHT_MS`. Longer would read as part of the conversation. */
const HIGHLIGHT_MS = 1_600;

/**
 * Beyond this many viewport heights, jump without animation. After expanding history upward the
 * remaining distance can be thousands of pt, and animating through it shows text streaking past for
 * seconds; the user asked for the newest message, not the journey. Web makes the same call at twice
 * the viewport height.
 */
const INSTANT_JUMP_FACTOR = 2;

export function MessageList({
	opening,
	messages,
	streamingText,
	generating,
	hasOlder,
	onLoadOlder,
	renderActions,
	revealId,
	onRevealed,
	sceneImages,
	names,
	onScrollGesture,
}: {
	/**
	 * The opening shown as the history's first row; not a stored message. It is received apart from
	 * `messages` because of position: it is always first, and leaving that to the caller's array
	 * assembly would eventually reverse the order on a screen that widens upward via `Load earlier messages`.
	 */
	opening: ConversationDisplayMessage | null;
	/**
	 * Ascending (oldest first), in the conversation's own order. Received as display rows: taking
	 * stored messages would force non-persisted conversations (playtest) to invent `dirty`, `rev` and
	 * `deletedAt`. Callers narrow stored rows with `toDisplayMessage` (`ChatMessage` is a superset).
	 */
	messages: readonly ConversationDisplayMessage[];
	/** The streaming response; empty means no temporary row. */
	streamingText: string;
	generating: boolean;
	hasOlder: boolean;
	onLoadOlder: () => void;
	/**
	 * Per-row actions, called for stored rows only: a streaming response is not a record yet, with no
	 * original to copy or identity to report. It takes a node-building function because policy belongs
	 * to the screen; if the list knew the action set it would learn edit, report and tail-delete
	 * rules, and another conversation kind (like playtest) would add a branch here.
	 */
	renderActions?: (message: ConversationDisplayMessage) => ReactNode;
	/** Message chosen in search; if in the window, jump to it and mark it briefly. */
	revealId?: string | null;
	/** The jump finished (or the row vanished); the signal for the caller to clear the marker. */
	onRevealed?: () => void;
	/** This room's scene images, passed down to every row (same reason as web's prop). */
	sceneImages?: readonly ChatSeedSceneImageDto[];
	/**
	 * Names for `{{char}}` and `{{user}}`, passed down like scene images. They change only the drawn
	 * text; the stored body is untouched (see `MessageBody`).
	 */
	names?: ChatPlaceholderNames;
	/**
	 * Reports a scroll gesture once per drag with its direction and whether it is at the bottom. The
	 * list only reports; the rule that turns it into a paid action (continue generation, next scene)
	 * is a shared pure function the screen holds (`scroll-advance.ts` in `@rowcat/chat`, same as web).
	 * Without it no handler is attached.
	 */
	onScrollGesture?: (gesture: { downward: boolean; atBottom: boolean }) => void;
}) {
	// Narrow to display rows and reverse once. The streaming row is added only when it has text: an
	// empty bubble during the few hundred ms before the first token reads as an empty response, so the
	// waiting indicator below covers that span.
	const rows = useMemo(() => {
		const display: ConversationDisplayMessage[] = opening ? [opening] : [];
		for (const message of messages) display.push(message);
		if (streamingText)
			display.push({
				id: STREAMING_ID,
				role: "assistant",
				speaker: "",
				content: streamingText,
			});
		return display.reverse();
	}, [opening, messages, streamingText]);

	const listRef = useRef<FlatList<ConversationDisplayMessage>>(null);

	/**
	 * Marker for the jumped-to row: screen state, not a request. It was once the caller's single
	 * `revealId`, so the marker never showed: the effect below calls `onRevealed()` right after
	 * jumping, the caller clears the value, and the marker goes off in the same commit. Web splits
	 * request (`reveal`) from marker (`highlight`) for that reason. `seq` exists because the same
	 * result can be chosen twice; by identity alone the second choice would not restart the timer and
	 * would look like an unresponsive result.
	 */
	const [highlight, setHighlight] = useState<{
		id: string;
		seq: number;
	} | null>(null);
	const seqRef = useRef(0);

	const renderItem = useCallback(
		({ item }: { item: ConversationDisplayMessage }) => {
			const streaming = item.id === STREAMING_ID;
			return (
				<MessageRow
					message={item}
					streaming={streaming}
					highlighted={item.id === highlight?.id}
					actions={streaming ? null : renderActions?.(item)}
					sceneImages={sceneImages}
					names={names}
				/>
			);
		},
		[renderActions, highlight?.id, sceneImages, names],
	);

	// Jumps after the row exists. `rows` is a dependency because the searched message may be outside
	// the window now, and widening it is another layer's async work (the subscription); this just
	// re-checks on each redraw. If it never appears nothing happens (not jumping beats jumping to the
	// wrong row).
	useEffect(() => {
		if (!revealId) return;
		const index = rows.findIndex((row) => row.id === revealId);
		if (index < 0) return;
		listRef.current?.scrollToIndex({
			index,
			animated: true,
			// Centered; at the very top the row would hide under the header.
			viewPosition: 0.5,
		});
		seqRef.current += 1;
		setHighlight({ id: revealId, seq: seqRef.current });
		onRevealed?.();
	}, [revealId, rows, onRevealed]);

	// The marker is brief: left on, yesterday's row would still glow next time the conversation opens
	// with no way to tell what it means. Same timer and value as web.
	useEffect(() => {
		if (!highlight) return;
		const timer = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
		return () => clearTimeout(timer);
	}, [highlight]);

	// Distance from the newest row, which in an inverted list is the scroll offset itself. Rendering
	// uses one boolean and the distance stays in a ref: as state it would redraw the list every scroll
	// frame, showing up as sluggish scrolling in long conversations (web's `syncJump` skips `setState`
	// when the value is unchanged for the same reason).
	const distanceRef = useRef(0);
	const viewportRef = useRef(0);
	const [showJump, setShowJump] = useState(false);

	const onScroll = useCallback(
		(event: NativeSyntheticEvent<NativeScrollEvent>) => {
			const distance = event.nativeEvent.contentOffset.y;
			distanceRef.current = distance;
			const next = distance > JUMP_THRESHOLD;
			setShowJump((shown) => (next === shown ? shown : next));
		},
		[],
	);

	const onLayout = useCallback((event: LayoutChangeEvent) => {
		viewportRef.current = event.nativeEvent.layout.height;
	}, []);

	// Finger start and last position, the material for reading direction when a drag starts. Unlike
	// web it does not report on every move: native scroll takes over the touch once it recognizes a
	// drag (the moment differs per platform), and a tap is not a drag, so a slightly trembling finger
	// on a bottom button must not send a paid request. The report is the single `onScrollBeginDrag`
	// the platform decided is a drag, and direction is where the finger went until then. In an
	// inverted list a finger moving up means scrolling toward newest (same as web touch).
	const touchStartYRef = useRef<number | null>(null);
	const touchLastYRef = useRef<number | null>(null);
	const onTouchStart = useCallback((event: GestureResponderEvent) => {
		touchStartYRef.current = event.nativeEvent.pageY;
		touchLastYRef.current = event.nativeEvent.pageY;
	}, []);
	const onTouchMove = useCallback((event: GestureResponderEvent) => {
		touchLastYRef.current = event.nativeEvent.pageY;
	}, []);
	const onScrollBeginDrag = useCallback(() => {
		const start = touchStartYRef.current;
		const last = touchLastYRef.current;
		if (!onScrollGesture || start === null || last === null || last === start)
			return;
		onScrollGesture({
			downward: last < start,
			atBottom: distanceRef.current <= AT_BOTTOM_THRESHOLD,
		});
	}, [onScrollGesture]);

	// Returns to newest, the button's only path. Newest is offset 0 in an inverted list. It does not
	// jump by index because that row may be unmeasured (`scrollToIndex` then falls back to the failure
	// callback), while offset 0 is always valid.
	const jumpToLatest = useCallback(() => {
		// Hide the button before the scroll lands: the user pressed it explicitly, so a frame arriving
		// meanwhile must not show it again.
		setShowJump(false);
		listRef.current?.scrollToOffset({
			offset: 0,
			animated:
				distanceRef.current <= viewportRef.current * INSTANT_JUMP_FACTOR,
		});
	}, []);

	return (
		/**
		 * Holds the list and the button floating over it; inside the list the button would scroll away
		 * with content, leaving "go back" off screen. Left and right safe areas are not applied again:
		 * `Screen` owns those edges and this button floats inside it.
		 */
		<View style={list.root} onLayout={onLayout}>
			<FlatList
				ref={listRef}
				data={rows}
				inverted
				keyExtractor={keyOf}
				renderItem={renderItem}
				contentContainerStyle={list.content}
				// In an inverted list `ListFooterComponent` draws at the top of the screen, where the
				// load-older button belongs.
				ListFooterComponent={
					hasOlder ? (
						/**
						 * A secondary move inside the history, not a primary action. As a full-width button it became
						 * the strongest control at the top of the conversation instead of send. Web uses a small
						 * centered outline button, with the same wording.
						 */
						<View style={list.older}>
							<Button
								label="Load earlier messages"
								variant="outline"
								size="sm"
								onPress={onLoadOlder}
							/>
						</View>
					) : null
				}
				// The wait for the first token. In an inverted list `ListHeaderComponent` is the bottom, below
				// the last bubble.
				ListHeaderComponent={
					generating && !streamingText ? (
						<View style={list.pending}>
							<Spinner label="Waiting for a reply" style={list.pendingInner} />
						</View>
					) : null
				}
				// Shown only in a room started from a work with no start scene or candidate; with an opening
				// `rows` is non-empty and this is never drawn (web decides the same, writing the condition
				// directly because its notice is a layer over the list).
				ListEmptyComponent={
					generating ? null : (
						<View style={list.empty}>
							<Text variant="label" tone="muted-foreground">
								Send the first message to start the conversation.
							</Text>
						</View>
					)
				}
				keyboardDismissMode="interactive"
				keyboardShouldPersistTaps="handled"
				// Jumping to an unmeasured row calls back here. Pass quietly rather than throw: the effect
				// above retries next render and nothing is lost (better than dying on `scrollToIndex out of
				// range`).
				onScrollToIndexFailed={noop}
				onScroll={onScroll}
				onTouchStart={onScrollGesture ? onTouchStart : undefined}
				onTouchMove={onScrollGesture ? onTouchMove : undefined}
				onScrollBeginDrag={onScrollGesture ? onScrollBeginDrag : undefined}
				// 16ms: distance is read every frame and goes to a ref, so rendering does not follow.
				scrollEventThrottle={16}
			/>

			{showJump ? <JumpToLatest onPress={jumpToLatest} /> : null}
		</View>
	);
}

/**
 * Jump to newest, above the composer at the right edge. Not centered because the assistant response
 * uses the full width (it is not a bubble), so the center is always over the sentence being read;
 * web picks the same spot. The surface is opaque as on web, since translucency would show text
 * beneath and read twice. It has no entrance animation: this app has no motion layer yet and one
 * button does not justify building it; erring toward none reads the same on every screen (reduced
 * motion).
 */
function JumpToLatest({ onPress }: { onPress: () => void }) {
	const { colors } = useTheme();
	return (
		<View style={list.jump} pointerEvents="box-none">
			<Button
				label="Jump to latest"
				variant="outline"
				size="sm"
				icon="jump-latest"
				onPress={onPress}
				style={[list.jumpButton, { backgroundColor: colors.background }]}
			/>
		</View>
	);
}

const keyOf = (message: ConversationDisplayMessage) => message.id;

const noop = () => {};

/**
 * Stored message to display row. The caller invokes it, not the list; it stays here because the
 * projection is the list's input contract and the conversation screen uses it (non-persisted
 * conversations never pass through, their rows are already display rows). `incomplete` is carried
 * only when present: `incomplete: false` would claim a confirmed normal ending, and old records
 * have no such axis.
 */
export const toDisplayMessage = (
	message: ChatMessage,
): ConversationDisplayMessage => ({
	id: message.id,
	role: message.role,
	speaker: message.speaker,
	content: message.content,
	...(message.incomplete ? { incomplete: true } : {}),
});

const list = StyleSheet.create({
	root: { flex: 1 },
	/**
	 * Horizontal padding is inset by the row's own inner padding (`chat-rhythm.ts`) so the text's left
	 * edge aligns with the failure notice and composer. The bottom padding reserves the height so `Jump to
	 * latest` does not sit over the last paragraph; in an inverted list `paddingTop` is the bottom of
	 * the screen.
	 */
	content: {
		paddingBottom: space.md,
		paddingHorizontal: chatListGutter,
		paddingTop: space["3xl"],
	},
	older: { alignItems: "center", paddingBottom: space.lg },
	jump: {
		alignItems: "flex-end",
		bottom: space.md,
		left: chatListGutter,
		position: "absolute",
		right: chatListGutter,
	},
	jumpButton: { borderRadius: radiusScale.full },
	pending: { alignItems: "flex-start", paddingTop: space.sm },
	/** The wait indicator stands left like a bubble, where the response will arrive. */
	pendingInner: { flexDirection: "row", padding: 0 },
	/**
	 * No manual `scaleY: -1` here: `VirtualizedList` already composes the inversion into the header,
	 * footer and empty state (as for rows), so applying it again flips twice and the text stands
	 * upside down.
	 */
	empty: { alignItems: "center", paddingVertical: space["3xl"] },
});
