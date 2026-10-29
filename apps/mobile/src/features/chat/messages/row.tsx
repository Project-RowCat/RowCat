import type {
	ChatPlaceholderNames,
	ConversationDisplayMessage,
} from "@rowcat/chat";
import type { ChatSeedSceneImageDto } from "@rowcat/contracts/chat";
import { radiusScale, space } from "@rowcat/design";
import { Text, useTheme } from "@rowcat/ui-native";
import { memo, type ReactNode, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, StyleSheet, View } from "react-native";
import { chatRowInset } from "../chat-rhythm.ts";
import { MessageBody } from "./body.tsx";

/**
 * One conversation row; the two roles take different shapes, not different colors.
 *
 * Both were once bubbles, but web draws only user utterances as bubbles and leaves the assistant
 * response as plain full-width text (`apps/web/src/features/chat/messages/row.tsx`). That is not
 * taste: assistant responses are multi-paragraph narration, and an 85%-width tinted box would
 * narrow the reading width, cover most of the screen in a muted surface, and make long narration
 * read like a short message from someone else.
 *
 * ```text
 * user       bubble, primary surface, right-aligned, width-limited   (web rounded-2xl bg-primary)
 * assistant  no surface, foreground text, full width, loose leading  (web leading-7)
 * ```
 *
 * - The body is markdown, with syntax, dangerous-URL folding and raw-HTML handling all from
 *   `@rowcat/markdown` as on web; only render code is here (`features/markdown/markdown-view.tsx`).
 *   Both roles use the same renderer, since typing `*opens the door*` is if anything more common on the user
 *   side, so text color is passed as `tone`.
 * - The merged accessibility name is gone on purpose. Markdown has several blocks, and headings,
 *   lists and links carry their own roles that folding into one `accessible` name would erase. Web
 *   keeps roles too; who spoke is conveyed by the user-side speaker name and placement.
 * - The search marker must not change height: only a background color attaches to the revealed
 *   row. Changing border, padding or font size changes its measurement and the virtualizer corrects
 *   the scroll, misaligning the jump target. The wrapper keeps the same geometry (radius and
 *   padding always present) and only the surface color differs.
 */
export const MessageRow = memo(function MessageRow({
	message,
	streaming,
	highlighted,
	actions,
	sceneImages,
	names,
}: {
	message: ConversationDisplayMessage;
	streaming?: boolean;
	/** Row chosen in search; only the surface color differs, geometry is unchanged. */
	highlighted?: boolean;
	/**
	 * Actions for this row, built by the screen; neither list nor row knows what can be done
	 * (`messageActionsFor` in `@rowcat/chat` alone decides per role).
	 */
	actions?: ReactNode;
	/**
	 * This room's scene images, which the body's `[img:...]` points at. It is a room value, so the
	 * list passes it down: rows each querying the room would cost one lookup per visible row, and a
	 * streaming response has no identity to look up.
	 */
	sceneImages?: readonly ChatSeedSceneImageDto[];
	/** Names for `{{char}}` and `{{user}}`, passed down by the list for the same reason as scene images. */
	names?: ChatPlaceholderNames;
}) {
	const own = message.role === "user";
	const speaker = own ? message.speaker.trim() : "";
	const { colors } = useTheme();

	const body = (
		<MessageBody
			content={message.content}
			sceneImages={sceneImages}
			names={names}
			tone={own ? "primary-foreground" : "foreground"}
			/**
			 * Streaming marker, attached at the end of the last block; as a sibling it would stand on its
			 * own line, detached from the last sentence and reading as a finished paragraph.
			 */
			caret={streaming ? <StreamingCursor /> : undefined}
		/>
	);

	return (
		<View
			style={[
				row.wrap,
				own ? row.wrapOwn : row.wrapOther,
				highlighted ? { backgroundColor: colors.muted } : null,
			]}
		>
			{speaker ? (
				<Text variant="caption" tone="muted-foreground" style={row.speaker}>
					{speaker}
				</Text>
			) : null}

			{own ? (
				<View style={[row.bubble, { backgroundColor: colors.primary }]}>
					{body}
				</View>
			) : (
				body
			)}

			{/**
			 * Interrupted response. Not drawn while streaming: marking text still arriving as
			 * unfinished reads a normal state as failure.
			 */}
			{message.incomplete && !streaming ? (
				<View style={row.incomplete}>
					{/**
					 * A dot, as on web: under a bubble-less response this line would blend into the body,
					 * and a leading dot makes same-size text read as an annotation rather than body.
					 */}
					<View
						style={[
							row.incompleteDot,
							{ backgroundColor: colors["muted-foreground"] },
						]}
					/>
					<Text variant="caption" tone="muted-foreground">
						The reply was cut off midway
					</Text>
				</View>
			) : null}

			{/**
			 * Actions sit under the bubble. Touch has no hover so this row is always visible, and
			 * beside the bubble it would take width on narrow screens.
			 */}
			{actions}
		</View>
	);
});

/**
 * Cursor at the end of a streaming response: the same spot as web's `animate-pulse` block, a
 * different implementation.
 *
 * - It is a glyph because standing a box inside text flow is unreliable in React Native (a nested
 *   `View` pushes line height or vanishes on Android), while nested `Text` flows by the same rules
 *   on both platforms.
 * - It animates color, not opacity: a nested text node merges into the parent string on Android,
 *   so its own `opacity` is not guaranteed to apply, while color is a character attribute. For the
 *   same reason the native driver is not used (color cannot go there).
 * - Geometry never changes: the character always occupies its place and only color alternates, so
 *   nothing jumps when it disappears.
 * - It only requests not to be read. It was once reliably unread because the body `Text` held the
 *   whole `accessibilityLabel`; once the body became markdown that name went away and this glyph
 *   joined the flow as the sentence's last piece. Both platforms' hide attributes are set, but how
 *   far nested text nodes respect them varies, so the worst case is one extra character read at the
 *   end of the last sentence while streaming (web's `::after` creates no accessibility name; RN
 *   lacks that syntax).
 */

/** U+258C: a vertical bar in the same proportion as web's cursor (`h-4 w-1.5`). */
const CURSOR_GLYPH = "▌";

/** Time for one direction; a usual text-cursor rhythm. */
const CURSOR_FADE_MS = 620;

function StreamingCursor() {
	const { colors } = useTheme();
	const value = useRef(new Animated.Value(1)).current;
	// Reduced motion: stand still instead of blinking. That a cursor exists is information, so it
	// stays and only the alternation stops.
	const [reduced, setReduced] = useState(false);

	useEffect(() => {
		let alive = true;
		AccessibilityInfo.isReduceMotionEnabled().then(
			(on) => {
				if (alive) setReduced(on);
			},
			() => {},
		);
		const subscription = AccessibilityInfo.addEventListener(
			"reduceMotionChanged",
			setReduced,
		);
		return () => {
			alive = false;
			subscription.remove();
		};
	}, []);

	useEffect(() => {
		if (reduced) {
			value.setValue(1);
			return;
		}
		const loop = Animated.loop(
			Animated.sequence([
				Animated.timing(value, {
					toValue: 0,
					duration: CURSOR_FADE_MS,
					useNativeDriver: false,
				}),
				Animated.timing(value, {
					toValue: 1,
					duration: CURSOR_FADE_MS,
					useNativeDriver: false,
				}),
			]),
		);
		loop.start();
		return () => loop.stop();
	}, [reduced, value]);

	return (
		<Animated.Text
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{
				color: value.interpolate({
					inputRange: [0, 1],
					outputRange: ["transparent", colors.foreground],
				}),
			}}
		>
			{CURSOR_GLYPH}
		</Animated.Text>
	);
}

const row = StyleSheet.create({
	/**
	 * The width cap belongs to the bubble, not the whole row; assistant text must use the full width,
	 * so capping the wrapper would defeat that. Radius and padding are always present: giving them
	 * only while the search marker is on would change the row height and the virtualizer's scroll
	 * correction would misalign the jump target.
	 */
	wrap: {
		borderRadius: radiusScale.lg,
		gap: space.xs,
		marginVertical: 6,
		// One source for the rhythm (`chat-rhythm.ts`); the list is inset by the same amount.
		paddingHorizontal: chatRowInset,
		paddingVertical: space.xs,
		width: "100%",
	},
	wrapOwn: { alignItems: "flex-end" },
	wrapOther: { alignItems: "flex-start" },
	speaker: { paddingHorizontal: space.xs },
	/**
	 * No tail. The bottom-right corner was once smaller (a messenger idiom), but web's user bubble has
	 * four equal corners (`rounded-2xl`), and one difference makes two screens of one product read as
	 * different lineages; a tail signals someone on the other end, and this conversation's counterpart
	 * is not a person. Width is web's 85%; the 88% here was an unfounded 3% divergence.
	 */
	bubble: {
		borderRadius: radiusScale.xl,
		maxWidth: "85%",
		paddingHorizontal: 14,
		paddingVertical: 10,
	},
	incomplete: {
		alignItems: "center",
		flexDirection: "row",
		gap: space.xs + 2,
		paddingHorizontal: space.xs,
	},
	/** A 4pt dot; a marker, not text, so its size does not follow system font size. */
	incompleteDot: { borderRadius: 2, height: 4, opacity: 0.6, width: 4 },
});
