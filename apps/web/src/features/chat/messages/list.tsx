import type { ChatPlaceholderNames } from "@rowcat/chat";
import type { ChatSeedSceneImageDto } from "@rowcat/contracts/chat";
import { Button } from "@rowcat/ui-web/components/button";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { ConversationDisplayMessage } from "#/features/conversation/message.ts";
import { enterTransition, exitTransition } from "#/lib/motion/transitions.ts";
import {
	ESTIMATED_LINE_HEIGHT_PX,
	estimateMessageHeight,
	estimateResponseHeight,
	LIST_PADDING_END_PX,
	LIST_PADDING_START_PX,
	MESSAGE_ACTIONS_RESERVE_PX,
	ROW_GAP_PX,
} from "../chat-geometry.ts";
import { ChatHistorySkeleton } from "../chat-skeleton.tsx";
import {
	BOTTOM_THRESHOLD_PX,
	getDistanceFromBottom,
	isAtBottom,
	shouldShowJump,
} from "../scroll-position.ts";
import { revealRowIndex } from "./reveal.ts";
import { MessageRow } from "./row.tsx";

/**
 * The chat history list. It owns scrolling.
 *
 * Most of this file is scroll rules. The rules are simple, but getting them wrong makes the
 * conversation unusable: if every new token pulls the view down while the user reads older
 * messages, nothing can be read.
 *
 * There are three rules, and none overrides another:
 *
 * 1. **At the bottom, follow.** New messages and streaming tokens keep the bottom in view.
 * 2. **Reading upward, hold position.** Show a button back to the latest message instead.
 *    Without it, a user who scrolled up cannot tell that a new response arrived or how to return.
 * 3. **Loading older keeps the reading position.** Compensate the scroll by the height
 *    prepended. Without this, `Load earlier messages` pushes the paragraph being read off screen.
 *
 * All three are viewport state. The local message store (Dexie) knows nothing about them.
 *
 * ## Virtual scrolling
 *
 * TanStack Virtual renders the list: only rows on screen are in the DOM, and the rest exist only as
 * heights. Roleplay responses span several paragraphs, so a few hundred rows can mean thousands of
 * DOM nodes. Streaming into that state would make every token trigger a layout that scans all of
 * them.
 *
 * The three rules are handed to the virtualizer rather than written by hand. `anchorTo: "end"`
 * re-anchors on the row in view whenever the list changes, so whatever is prepended (rule 3) or
 * grown (rule 1, streaming) leaves the reading position intact. Two owners of scroll correction in
 * the same frame would overwrite each other and make the view jump, so there must be exactly one.
 * One exception is documented at `loadOlder` below.
 *
 * ## One coordinate system
 *
 * The scroll container gets no CSS padding. Top and bottom spacing, line gaps, the load-older
 * button and the in-progress response are all rows of the virtual list, or the virtualizer's
 * `padding*` options.
 *
 * The virtualizer decides "at bottom" in its own coordinates (the sum of row heights). Any real
 * height outside the virtual list shifts the two coordinate systems apart, and that gap becomes the
 * boundary between rules 1 and 2. A streaming response placed outside the list would grow the gap
 * by the response length, so the view would keep dragging down even while the user reads upward.
 */

/**
 * The dimensions are not here: `chat-geometry.ts` owns them.
 *
 * Line gaps, list padding, action-row height and height estimates live there because the
 * server-rendered placeholder must read the same values, and this file imports TanStack Virtual,
 * which must not enter the server bundle's static graph. The values sit in a pure module that
 * imports nothing, and both the list and the placeholder read from it.
 *
 * Only the two constants below stay here, because they describe this list's behavior rather than
 * its geometry.
 */

/**
 * How long a jumped-to row stays highlighted.
 *
 * Long enough for the eye to find it. Longer, and the highlight reads as part of the conversation.
 */
const HIGHLIGHT_MS = 1_600;

/** Rows rendered outside the viewport. Only enough to avoid blank gaps during fast scrolling. */
const OVERSCAN_ROWS = 6;

/**
 * One row of the list.
 *
 * The array also carries the load-older button and the in-progress response, not just messages. See
 * "One coordinate system" above for why.
 */
type Row<T extends ConversationDisplayMessage> =
	| { kind: "load-older"; key: string; estimate: number }
	| { kind: "message"; key: string; estimate: number; message: T }
	| { kind: "response"; key: string; estimate: number; text: string };

export function MessageList<T extends ConversationDisplayMessage>({
	messages,
	loading,
	hasMore,
	onLoadOlder,
	streamingText,
	generating,
	reveal,
	onRevealed,
	renderActions,
	columnClassName,
	sceneImages,
	names,
	onScrollGesture,
}: {
	messages: T[];
	loading: boolean;
	hasMore: boolean;
	onLoadOlder: () => void;
	/** In-progress response not yet saved. Renders nothing when empty. */
	streamingText: string;
	generating: boolean;
	/**
	 * Jumps to the message picked from search.
	 *
	 * `token` is needed because the same result can be picked twice. Identity alone would make the
	 * second pick a no-op, which the user would see as an unresponsive result.
	 *
	 * If the message is outside the loaded window, nothing happens here. Widening the window belongs
	 * to the subscriber (`chat-page.tsx`), and this effect runs again once the window widens.
	 */
	reveal?: { messageId: string; token: number } | null;
	/** Fired when the jump actually happens; the parent ends its wait here. */
	onRevealed?: () => void;
	/**
	 * Width of the reading column. It applies to the content, not the scroll container.
	 *
	 * The scrollbar is the reason: a width on the scroll container would draw the scrollbar right
	 * beside the text column. The conversation screen passes the width here to push the scrollbar to
	 * the screen edge (`CHAT_COLUMN`).
	 *
	 * Without it, the list uses the parent's width. The story test relies on that: its header, notices
	 * and action row share one column, so the parent should own the width. The list does not decide
	 * the geometry itself, which is why this is a class supplied by the parent rather than a
	 * `fullBleed` boolean.
	 */
	columnClassName?: string;
	/**
	 * Actions attached to each saved row. The policy belongs to the screen.
	 *
	 * This used to receive the whole `MessageActions`. It now receives only a node-building function
	 * because the action set differs per screen: the conversation screen has copy, edit, regenerate,
	 * delete-from-here and report, while the story test has copy only (no tail to delete, no server
	 * identity to report). If the list knew that decision, every new screen would add a branch that
	 * asks a question the list cannot answer ("does this conversation have a room identity?").
	 *
	 * Called for saved rows only. An in-progress response is not a record yet, so there is nothing to
	 * copy or delete. The only action it can show, stop, belongs to the composer.
	 */
	renderActions?: (message: T) => ReactNode;
	/**
	 * The room's scene images: the pictures that `[img:…]` in the body points at.
	 *
	 * The list passes this value to every row unchanged. Rows do not look up the room themselves, for
	 * three reasons: an in-progress response has no room identity yet, the story test has no room, and
	 * each row would add a subscription.
	 */
	sceneImages?: readonly ChatSeedSceneImageDto[];
	/**
	 * Names for `{{char}}` and `{{user}}`, passed down for the same reason as scene images.
	 *
	 * It is a room value, so rows cannot re-derive it: an in-progress response has no room identity,
	 * and the story test has no room. Which text it applies to is documented on `ChatBody`.
	 */
	names?: ChatPlaceholderNames;
	/**
	 * Reports scroll gestures: one call per wheel or touch move, with direction and whether the list
	 * is at the bottom.
	 *
	 * This is a different axis from `onScroll`. `onScroll` fires when the position actually changed.
	 * This also fires for a gesture that does not move the position, such as a downward flick at the
	 * bottom, which is exactly what a user does after reading a response to the end and pressing down
	 * once more.
	 *
	 * The list makes no judgment here. The screen turns the gesture into a paid action (continue, next
	 * scene) with a pure function (`scroll-advance.ts` in `@rowcat/chat`). Screens that do not pass
	 * the prop (the story test) get no handler attached.
	 */
	onScrollGesture?: (gesture: { downward: boolean; atBottom: boolean }) => void;
}) {
	const { t } = useTranslation(["chat", "common"]);
	const viewportRef = useRef<HTMLDivElement>(null);
	/** On the first render, always go to the bottom: conversations are read from the latest message. */
	const initializedRef = useRef(false);
	/**
	 * Whether the user was near the bottom at the last scroll.
	 *
	 * This is not what makes the list follow. The virtualizer decides that in its own coordinates
	 * (rule 1). This ref only decides whether to skip re-measuring when content grows.
	 *
	 * Skipping matters because follow-scrolling is **smooth**. Measuring in the commit that appends a
	 * row, before the scroll starts, would read the new row's height as the distance from the bottom,
	 * and a user at the bottom would see "jump to latest" flash once.
	 */
	const atBottomRef = useRef(true);
	/** Only the button's visibility is rendered. The scroll math itself stays with the virtualizer and the DOM. */
	const [showJump, setShowJump] = useState(false);

	/**
	 * Re-syncs the jump button's visibility from the current distance to the bottom.
	 *
	 * Scroll events and content growth both call this. Writing the threshold twice would eventually
	 * let one copy change without the other. If the value is unchanged, `setState` is skipped:
	 * streaming calls this every frame, and a render each time would make long responses stutter.
	 *
	 * Read-only: it never touches `scrollTop`. Moving the view of a user who is reading upward here
	 * would trade one bug for another.
	 */
	const syncJump = useCallback(() => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		const next = shouldShowJump(getDistanceFromBottom(viewport));
		setShowJump((shown) => (next === shown ? shown : next));
	}, []);

	/** Previous vertical touch position. Moving the finger up means the list scrolls down. */
	const touchYRef = useRef<number | null>(null);

	/**
	 * Reports one gesture. "At bottom" is measured the same way as in the other checks
	 * (`scroll-position.ts`). Does nothing without the prop.
	 */
	const reportGesture = useCallback(
		(downward: boolean) => {
			const viewport = viewportRef.current;
			if (!viewport || !onScrollGesture) return;
			onScrollGesture({
				downward,
				atBottom: isAtBottom(getDistanceFromBottom(viewport)),
			});
		},
		[onScrollGesture],
	);

	/**
	 * Whether this list draws action slots. **The estimate has to answer this question.**
	 *
	 * It checks presence, not value: `renderActions` is an inline function created by the caller, so
	 * its identity changes every render. Putting it in the dependencies would re-run the `useMemo`
	 * below on every render.
	 *
	 * The point is not reserving space on screens that draw no actions. The conversation screen passes
	 * this prop only after the local scope opens (`chat-page.tsx`). Until then rows draw neither
	 * action rows nor the reserved space below, so the list has to estimate from what it actually
	 * draws.
	 */
	const hasActions = Boolean(renderActions);

	const rows = useMemo<Row<T>[]>(() => {
		const next: Row<T>[] = [];
		if (hasMore)
			next.push({ kind: "load-older", key: "load-older", estimate: 32 });
		for (const message of messages)
			next.push({
				kind: "message",
				key: message.id,
				estimate: estimateMessageHeight(message, hasActions),
				message,
			});
		/*
		 * An in-progress response is one row. The waiting indicator (`PendingIndicator`) and the streamed
		 * text are two states of the same slot, so when the first token arrives the text continues where
		 * the indicator was.
		 *
		 * The key includes the previous message id because of measurement caching. With a constant key,
		 * the height measured for the previous response (hundreds of pixels) would carry over into the
		 * next generation, and the indicator-only row would render as a screen-tall blank.
		 */
		if (generating || streamingText)
			next.push({
				kind: "response",
				key: `response:${messages[messages.length - 1]?.id ?? "first"}`,
				/*
				 * The estimate **grows with the streamed text.** This slot was once a one-line constant. That
				 * went unnoticed while the row was on screen, since its real measurement arrived quickly. It
				 * only showed for responses growing off screen: if the user had scrolled several screens up,
				 * the row was not mounted, so `ResizeObserver` never fired. The total height stayed stale,
				 * which made the scrollbar and the jump-to-latest check stale, and then one large correction
				 * happened all at once when the row came close.
				 *
				 * It is counted by the **same function** as a saved assistant message (`chat-geometry.ts`). If
				 * two estimates disagreed for the same text, the response would jump by the difference in the
				 * frame it is saved.
				 */
				estimate: estimateResponseHeight(streamingText, hasActions),
				text: streamingText,
			});
		return next;
	}, [messages, hasMore, streamingText, generating, hasActions]);

	/**
	 * Identity of the last row. When a saved message is appended, or the in-progress row appears or
	 * disappears, the list grows downward. The re-measure effect below watches this value.
	 */
	const lastRowKey = rows[rows.length - 1]?.key;

	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => viewportRef.current,
		estimateSize: (index) => rows[index]?.estimate ?? ESTIMATED_LINE_HEIGHT_PX,
		/*
		 * Identity is the message id. An index would shift every row's number when a page is prepended
		 * above, and all measured heights would then belong to the wrong messages.
		 */
		getItemKey: (index) => rows[index]?.key ?? index,
		gap: ROW_GAP_PX,
		paddingStart: LIST_PADDING_START_PX,
		paddingEnd: LIST_PADDING_END_PX,
		overscan: OVERSCAN_ROWS,
		/*
		 * Handles rules 1 and 3 together. Whenever the list changes, the scroll is re-anchored to the row
		 * in view (3), and the list sticks to the bottom as it grows (1).
		 */
		anchorTo: "end",
		/*
		 * Whether to follow when a row is appended at the end: only when the user was near the bottom,
		 * which is where rule 2 is enforced. Distance uses the bottom threshold from
		 * `scroll-position.ts`, the same value that decides whether the button shows, so the two checks
		 * never disagree about where the bottom is.
		 */
		followOnAppend: "smooth",
		scrollEndThreshold: BOTTOM_THRESHOLD_PX,
	});

	/**
	 * The message that was at the top of the viewport when `Load earlier messages` was pressed, and its distance
	 * from the viewport's top.
	 *
	 * Rule 3 is normally handled by `anchorTo: "end"`, but **this button is the exception.** The
	 * button is the first row, and pressing it requires the user to be at the top. The virtualizer
	 * would then anchor on the button itself, keeping the button pinned at the top while the paragraph
	 * being read is pushed down by the newly prepended messages. So in this case the anchor is chosen
	 * manually.
	 */
	const restoreRef = useRef<{
		key: string;
		offset: number;
		count: number;
	} | null>(null);

	const loadOlder = () => {
		const viewport = viewportRef.current;
		const first = messages[0];
		const index = first ? rows.findIndex((row) => row.key === first.id) : -1;
		const item = index >= 0 ? virtualizer.measurementsCache[index] : undefined;
		restoreRef.current =
			viewport && first && item
				? {
						key: first.id,
						offset: viewport.scrollTop - item.start,
						count: messages.length,
					}
				: null;
		onLoadOlder();
	};

	/**
	 * Restores the position after loading older messages. It must run in the **same commit** that
	 * lengthened the list, before paint, or the view jumps. That is why it is a `useLayoutEffect`.
	 *
	 * Newly prepended messages have never been drawn, so they only have estimated heights. The
	 * correction is applied on those estimates, and when real measurements arrive the virtualizer
	 * adjusts the scroll by the difference. The two corrections chain rather than overlap.
	 */
	useLayoutEffect(() => {
		const restore = restoreRef.current;
		// No new page has arrived yet; check again on the next commit.
		if (!restore || messages.length <= restore.count) return;
		restoreRef.current = null;
		const index = rows.findIndex((row) => row.key === restore.key);
		const item = index >= 0 ? virtualizer.measurementsCache[index] : undefined;
		if (!item) return;
		virtualizer.scrollToOffset(item.start + restore.offset);
	}, [rows, messages.length, virtualizer]);

	/**
	 * The first entry goes to the bottom without animation. It is a `useLayoutEffect` because it must
	 * move before paint: if the effect ran after paint, the top of the conversation would show for one
	 * frame and then jump down.
	 *
	 * At this point the bottom is the **bottom of the estimated heights**. Real heights become known
	 * as rows draw, and the virtualizer re-pins to the bottom each time (`anchorTo: "end"`), so the
	 * user sees the end from the start.
	 */
	useLayoutEffect(() => {
		if (initializedRef.current || loading || !rows.length) return;
		initializedRef.current = true;
		virtualizer.scrollToEnd();
	}, [loading, rows.length, virtualizer]);

	/**
	 * Re-syncs the button's visibility when content grows.
	 *
	 * Scroll events alone are not enough. The distance to the bottom changes **even when the user does
	 * nothing**: a response growing 500px while the user reads 200px above the bottom makes the
	 * distance 700px, but nothing scrolled, so `onScroll` never fires. "Jump to latest" would then not
	 * appear at the moment it is needed, and the user would not know a new response arrived.
	 *
	 * It is a `useLayoutEffect` because the check depends on the **drawn height**. Reading before
	 * commit would capture the height from before the growth.
	 *
	 * If the user was at the bottom, it returns early: the virtualizer is following down, and
	 * measuring before that scroll arrives would take the just-appended height as the distance (see
	 * `atBottomRef` above).
	 *
	 * During streaming, the virtualizer's measurement (ResizeObserver) can arrive a frame late. The
	 * next token runs this effect again, so the lag is at most one frame. In exchange, the effect only
	 * does three reads (`scrollHeight`, `scrollTop`, `clientHeight`) and a `setState` when the value
	 * changes. It attaches no observer per row and does not measure paragraphs.
	 *
	 * The dependencies are **signals, not values the effect reads.** The list grows downward exactly
	 * when these change (a last row is appended, or the in-progress response grows), and the distance
	 * itself is read from the DOM. Removing them would stop the effect from re-running and bring back
	 * the staleness it exists to fix.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the dependencies are signals that trigger the effect, not values it reads (see the note above).
	useLayoutEffect(() => {
		if (atBottomRef.current) return;
		syncJump();
	}, [lastRowKey, streamingText, syncJump]);

	/**
	 * The row that was just jumped to. **Screen state**; no storage has this axis.
	 *
	 * The whole `reveal` object is kept because of tokens: picking the same message again keeps its
	 * identity but changes the token, so the timer below starts over.
	 */
	const [highlight, setHighlight] = useState<{
		messageId: string;
		token: number;
	} | null>(null);

	/**
	 * Jumps to a search result.
	 *
	 * The movement is **left to the virtualizer.** Writing `scrollTop` directly would fight the
	 * virtualizer's correction in the same frame and make the view jump. That is why this file has one
	 * coordinate rule.
	 *
	 * `center` is for context: a result pinned to the top hides what came before it, and in a
	 * conversation the lines around a match are usually the answer.
	 *
	 * It runs once more one frame later. Rows along the path have usually never been drawn and only
	 * have estimated heights, and their real measurements shift things. The second call runs on those
	 * measurements, so no offset remains.
	 */
	useEffect(() => {
		if (!reveal) return;
		const index = revealRowIndex(rows, reveal.messageId);
		// Not yet inside the subscribed window; the effect runs again once the window widens.
		if (index < 0) return;

		virtualizer.scrollToIndex(index, { align: "center" });
		const frame = requestAnimationFrame(() =>
			virtualizer.scrollToIndex(index, { align: "center" }),
		);
		setHighlight(reveal);
		onRevealed?.();
		return () => cancelAnimationFrame(frame);
	}, [reveal, rows, virtualizer, onRevealed]);

	/**
	 * The highlight is brief. If it stayed, the next time this conversation opened, yesterday's match
	 * would still be glowing, and the user could not tell what it meant.
	 */
	useEffect(() => {
		if (!highlight) return;
		const timer = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
		return () => clearTimeout(timer);
	}, [highlight]);

	/**
	 * Returns to the bottom. This is the only path the button uses.
	 *
	 * Distant jumps do not use smooth scrolling. After loading a lot of history, the remaining
	 * distance can be thousands of pixels, and animating it would make the user watch text scroll for
	 * several seconds. The user asked for the latest message, not the journey.
	 */
	const jumpToLatest = useCallback(() => {
		const viewport = viewportRef.current;
		/*
		 * The user explicitly asked to follow the latest. The judgment must flip to true before the
		 * scroll actually arrives, so tokens that land in between do not show the button again.
		 */
		atBottomRef.current = true;
		setShowJump(false);
		const distance = viewport ? getDistanceFromBottom(viewport) : 0;
		virtualizer.scrollToEnd({
			behavior:
				distance > (viewport?.clientHeight ?? 0) * 2 ? "instant" : "smooth",
		});
	}, [virtualizer]);

	const virtualItems = virtualizer.getVirtualItems();

	return (
		/*
		 * Wraps the scroll container and the button floating over it. If the button sat inside the scroll
		 * container it would scroll with the content, and "back to latest" would end up off screen.
		 */
		<div className="relative flex min-h-0 flex-1 flex-col">
			<div
				ref={viewportRef}
				onScroll={(event) => {
					atBottomRef.current = isAtBottom(
						getDistanceFromBottom(event.currentTarget),
					);
					syncJump();
				}}
				/*
				 * Gesture reporting. Without the prop, no handler is attached (the story test). A wheel's
				 * `deltaY` gives the direction. A touch's direction comes from the change since the previous
				 * position (a finger moving up means the list scrolls down).
				 */
				onWheel={
					onScrollGesture
						? (event) => reportGesture(event.deltaY > 0)
						: undefined
				}
				onTouchStart={
					onScrollGesture
						? (event) => {
								touchYRef.current = event.touches[0]?.clientY ?? null;
							}
						: undefined
				}
				onTouchMove={
					onScrollGesture
						? (event) => {
								const y = event.touches[0]?.clientY;
								if (y === undefined) return;
								const previous = touchYRef.current;
								touchYRef.current = y;
								if (previous !== null) reportGesture(previous > y);
							}
						: undefined
				}
				/*
				 * **No width here.** This container must take the full canvas width so the scrollbar sits at
				 * the screen edge. The reading width belongs to the column directly below (`columnClassName`).
				 */
				className="min-h-0 flex-1 overflow-y-auto"
			>
				{/*
				 * The reading column. Padding lives on **this** column, not on the `relative` one below: rows are absolutely positioned, so their reference box is the padding box of the `relative` column. Padding there would make `left-0` point outside the padding and ignore the side margins entirely.
				 */}
				<div className={columnClassName}>
					{loading ? (
						<ChatHistorySkeleton />
					) : (
						/*
						 * The only element holding the list's full height. The rows inside are absolutely placed, so
						 * the scrollbar reflects the total length, including parts that are not drawn.
						 */
						<div
							className="relative w-full"
							style={{ height: virtualizer.getTotalSize() }}
						>
							{virtualItems.map((virtualItem) => {
								const row = rows[virtualItem.index];
								if (!row) return null;
								return (
									<div
										key={virtualItem.key}
										data-index={virtualItem.index}
										// The virtualizer measures heights; we do not supply them.
										ref={virtualizer.measureElement}
										className="absolute top-0 left-0 w-full"
										style={{ transform: `translateY(${virtualItem.start}px)` }}
									>
										{row.kind === "load-older" && (
											<div className="flex justify-center">
												<Button variant="outline" size="sm" onClick={loadOlder}>
													{t("list.loadEarlierMessages")}
												</Button>
											</div>
										)}
										{row.kind === "message" && (
											<MessageRow
												message={row.message}
												highlighted={highlight?.messageId === row.key}
												actions={renderActions?.(row.message)}
												sceneImages={sceneImages}
												names={names}
											/>
										)}
										{/*
										 * In-progress response. It is not a saved message, so this row disappears when the text commits and the same text appears in the list (drawn by the subscription).
										 *
										 * No entrance animation. If the temporary row animated in while becoming the saved message, the same text would appear twice and the response would look repeated. Continuity matters more than the transition here.
										 *
										 * For the same reason the **action row is reserved in advance.** Nothing can stand on this row (there is no record to copy and no tail to delete), but a row appears when the text is saved. Without the reserve, the conversation would jump 36px in the frame the response commits, while the user is looking at a paragraph they just finished. Screens that draw no actions do not reserve it.
										 */}
										{row.kind === "response" && (
											<>
												{row.text ? (
													<MessageRow
														pending
														message={{
															role: "assistant",
															speaker: "",
															content: row.text,
														}}
														sceneImages={sceneImages}
														names={names}
													/>
												) : (
													/*
													 * Nothing has arrived yet. Without this, the screen shows no change after sending and
													 * looks as if the press did nothing.
													 */
													<PendingIndicator />
												)}
												{hasActions && (
													/*
													 * The reserved slot is a **sibling outside `MessageRow`**, so it must reserve the
													 * whole `gap + action row`. For a saved row the gap comes from `MessageRow`'s
													 * `MESSAGE_STACK_GAP`, but this row has no action child, so that gap would not appear.
													 * The slot reserves the height of both (`MESSAGE_ACTIONS_RESERVE_PX`) rather than a
													 * measured height.
													 */
													<div
														aria-hidden="true"
														style={{ height: MESSAGE_ACTIONS_RESERVE_PX }}
													/>
												)}
											</>
										)}
									</div>
								);
							})}
						</div>
					)}
				</div>
			</div>

			{/*
			 * Back to latest. Appears only when the user is far enough from the bottom.
			 *
			 * It sits in the bottom-right corner, and the list's bottom padding (`LIST_PADDING_END_PX`) reserves space equal to the button's height, so the last paragraph is not covered when scrolled to the bottom. Once the body drops its bubbles and uses the full width, a button centered over the text would sit on the sentence being read.
			 *
			 * **The reading column decides where the right edge is.** The scroll container now takes the full canvas width, so `right-0` would mean the screen edge, hundreds of pixels from the text, and the button would float away from the list it returns to. So it is bound to the same width and pinned right inside it. Screens without a supplied width (the story test) keep the parent's right edge, which is correct there because the parent is already the reading column.
			 *
			 * **The background must be opaque, which is why it is `secondary` and not `outline`.**
			 *
			 * This slot used `variant="outline"` with `bg-background` added. In dark themes that combination was actually translucent: the variant brings `dark:bg-input/30`, and the `bg-background` we added loses to it in the cascade. The last paragraph showed through the button and read as two layers, the exact shape an earlier version of this comment warned against.
			 *
			 * Adding `dark:bg-background` to win is not a fix. It relies on the generation order of two utilities that set the same property, and in practice it does not work. `secondary` has no dark override, so it is opaque in both themes, and its color happens to be the one `outline` was trying to show through at 30%. The intended look is obtained without a cascade fight.
			 *
			 * A presence wrapper because this is a **state appearing**. If it popped in and out while scrolling, the eye would be drawn to it. Under reduced motion only the transform drops and the opacity still fades, so appearing and disappearing still read either way.
			 */}
			<AnimatePresence>
				{showJump && (
					<m.div
						key="jump-to-latest"
						className={`pointer-events-none absolute bottom-3 flex justify-end ${
							columnClassName ? `inset-x-0 ${columnClassName}` : "right-0"
						}`}
						initial={{ opacity: 0, y: 6 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: 6, transition: exitTransition }}
						transition={enterTransition}
					>
						<Button
							size="sm"
							onClick={jumpToLatest}
							/*
							 * A floating utility, so it should resemble no row in the list. The pill shape and shadow
							 * say it sits on a different layer, and the filled background says it is the only thing here
							 * worth pressing.
							 *
							 * The background is **fully opaque**. Translucency or blur would show the text underneath,
							 * and this button appears exactly when unread text is directly beneath it.
							 */
							className="pointer-events-auto gap-1.5 rounded-full pr-3.5 pl-3 shadow-lg"
						>
							<ArrowDown aria-hidden="true" className="size-3.5" />
							{t("list.jumpToLatest")}
						</Button>
					</m.div>
				)}
			</AnimatePresence>
		</div>
	);
}

/**
 * The indicator shown while waiting for the first token. **It claims the slot the next turn will
 * occupy.**
 *
 * It replaces a three-dot indicator, which only said "something is running" and so looked like
 * something that could happen anywhere in a conversation. This slot takes up the space of two lines
 * of prose and breathes in place, saying that text will appear **here**.
 *
 * It uses no spinner. A spinner says the whole application is waiting, but what is waited on here
 * is the conversation's next line.
 *
 * The bar rhythm equals the placeholder's: the prose lines in `ChatHistorySkeleton` (16px bars, a
 * 14px gap, 7px above and below, totaling 60px for two prose lines). If they diverged, opening a
 * room and waiting for a response would look like two different screens.
 *
 * `<output>` implicitly has `role="status"`, so a user who is not watching the screen still hears
 * "generating" once. The bars are `aria-hidden`: they are the shape of waiting, not content to
 * read.
 *
 * The animation is CSS. Two bars breathing need no state, and making this a Motion component would
 * only add an always-running animation runtime. By rule only **opacity** moves, because the
 * virtualizer is measuring this slot right now.
 *
 * **It keeps breathing under reduced motion, which is where it differs from the placeholder.** The
 * geometry is the same but the meaning differs. The placeholder (`Skeleton`) says "this is not
 * content yet", and that stays true when still. This bar says "generating now"; if it stopped, it
 * would look identical to an empty slot where a response stalled. Opacity is not an axis reduced
 * motion removes. The streaming caret is in the same category, and the two exceptions are listed in
 * `docs/motion/ARCHITECTURE.md`.
 */
function PendingIndicator() {
	const { t } = useTranslation(["chat", "common"]);
	return (
		<output className="flex flex-col gap-3.5 py-[7px]">
			<span className="sr-only">{t("list.generatingAReply")}</span>
			{[
				{ width: "62%", delay: 0 },
				{ width: "34%", delay: 320 },
			].map((bar) => (
				<span
					key={bar.width}
					aria-hidden="true"
					style={{ width: bar.width, animationDelay: `${bar.delay}ms` }}
					className="h-4 animate-pulse rounded-full bg-muted-foreground/20"
				/>
			))}
		</output>
	);
}
