import { applyChatEmphasisMarker } from "@rowcat/chat";
import { CHAT_MAX_MESSAGE_CHARS } from "@rowcat/contracts";
import { borderWidth, radiusScale, space } from "@rowcat/design";
import {
	BareInput,
	Icon,
	type TextFieldHandle,
	type TextFieldSelectionEvent,
	touchTarget,
	useTheme,
} from "@rowcat/ui-native";
import {
	type Ref,
	useCallback,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AnimatedIconSwap } from "../../lib/motion/animated-icon-swap.tsx";
import { chatGutter } from "./chat-rhythm.ts";

/**
 * Composer. When it clears is the whole point of this component.
 *
 * It clears only after the user utterance is saved to the conversation (`onAccepted`, from
 * `commitUserTurn` in `@rowcat/chat`), not on press: the first save is a local transaction that can
 * fail, and clearing first would lose the sentence from both the screen and the conversation. It
 * also does not wait for the response, or it would hold the user's sentence for the whole model
 * reply and later erase input the user started meanwhile. The clear compares the sent value against
 * the current one because the commit does not finish in the same tick (the web composer does the
 * same).
 *
 * Layout: the input and the controls share one rounded surface that owns the border and focus ring,
 * like the web `chat-composer.tsx`. The inner field drops its border (a second box inside would
 * blur what has focus), and send is a rounded square matching that curvature. The earlier
 * pill-plus-circle shape stacked two borders and used a radius outside `radiusScale`.
 *
 * Differences from web: 44pt targets, Enter inserts a newline, and the controls are glyph-only (a
 * "Send" label would take 64pt from the field; the name lives in `accessibilityLabel`).
 *
 * The value stays owned here even with reply suggestions: filling comes in through one imperative
 * handle (`fill`) because lifting the value would re-render the whole conversation screen (with its
 * inverted `FlatList`) on every keystroke. Only "is empty" goes up, and only when it flips
 * (`onEmptyChange`). That one axis lets the screen keep "no suggestion button while text exists",
 * which makes filling over someone's draft inexpressible (`canSuggestReply` in `@rowcat/chat`).
 *
 * Emphasis marker: the rule lives in the shared pure `applyChatEmphasisMarker`; this file only
 * hands its result back to the native field. Web calls `setSelectionRange` imperatively; native
 * plants `selection` once and clears it on the first `onSelectionChange`, because controlling it
 * every render commits the syllable being composed, which only breaks Korean, Japanese and Chinese
 * (`features/create/prompt-section.tsx` made the same call). The live caret position is a ref,
 * since as state it would re-render the composer per keystroke.
 */

/** The only thing the screen can do to the composer is fill it. */
export interface ComposerHandle {
	/**
	 * Replaces the value. Callers invoke it only while the field is empty (`canSuggestReply`); it does
	 * not re-check, since silently ignoring would look like nothing happened to the user.
	 */
	fill: (text: string) => void;
}

export function Composer({
	disabled,
	generating,
	onSend,
	onStop,
	onEmptyChange,
	ref,
}: {
	/** No room or storage not open, so there is nowhere to send. */
	disabled: boolean;
	generating: boolean;
	/** Starts a turn. `onAccepted` fires only after the conversation saved the utterance; it is the sole basis for clearing. */
	onSend: (text: string, options: { onAccepted: () => void }) => void;
	onStop: () => void;
	/** Notifies only when emptiness flips, not per keystroke (the conversation screen holds an inverted list). */
	onEmptyChange?: (empty: boolean) => void;
	ref?: Ref<ComposerHandle>;
}) {
	const [text, setText] = useState("");
	/** Synchronous copy of the current value; `onAccepted` closes over the `text` of its own render and could not tell that one more character was typed before the commit finished. */
	const currentRef = useRef("");

	/** Last reported emptiness; the basis for reporting flips only. */
	const emptyRef = useRef(true);

	/** The only path that changes the value: with separate `setText` calls one would skip the emptiness notification and the screen would stand the suggestion button on a wrong condition. */
	const update = useCallback(
		(next: string) => {
			currentRef.current = next;
			setText(next);
			const empty = next.trim().length === 0;
			if (emptyRef.current === empty) return;
			emptyRef.current = empty;
			onEmptyChange?.(empty);
		},
		[onEmptyChange],
	);

	useImperativeHandle(ref, () => ({ fill: update }), [update]);

	const field = useRef<TextFieldHandle>(null);
	/** Last caret reported by the field; `null` means end of text. Overflow is folded by `applyChatEmphasisMarker`. */
	const caret = useRef<{ start: number; end: number } | null>(null);
	/** Selection to plant for one render only; cleared on the first `onSelectionChange` (see header). */
	const [seed, setSeed] = useState<{ start: number; end: number } | null>(null);

	/** Wraps the selection with the emphasis marker via the shared function (the web button calls the same one). */
	const emphasize = useCallback(() => {
		const at = caret.current;
		const next = applyChatEmphasisMarker({
			text: currentRef.current,
			selectionStart: at?.start ?? currentRef.current.length,
			selectionEnd: at?.end ?? currentRef.current.length,
		});
		setSeed({ start: next.selectionStart, end: next.selectionEnd });
		update(next.text);
		// Restore focus; if the keyboard was dismissed, the next action is writing there.
		field.current?.focus();
	}, [update]);

	const trimmed = text.trim();
	const sendable = !disabled && !generating && trimmed.length > 0;

	const submit = useCallback(() => {
		if (!sendable) return;
		const sent = text;
		onSend(sent, {
			onAccepted: () => {
				// Clear only if unchanged; input typed while the commit was pending belongs to the user.
				if (currentRef.current === sent) update("");
			},
		});
	}, [onSend, sendable, text, update]);

	const { colors } = useTheme();
	// The surface owns focus (see header), so there is one state.
	const [focused, setFocused] = useState(false);

	return (
		<View style={composer.bar}>
			<View
				style={[
					composer.field,
					{
						backgroundColor: colors.background,
						borderColor: focused ? colors.ring : colors.input,
					},
				]}
			>
				<BareInput
					ref={field}
					label="Message"
					multiline
					value={text}
					onChangeText={update}
					// Pass `selection` only when seeded; afterwards the field owns its caret.
					selection={seed ?? undefined}
					onSelectionChange={(event: TextFieldSelectionEvent) => {
						caret.current = event.nativeEvent.selection;
						if (seed) setSeed(null);
					}}
					editable={!disabled}
					placeholder={disabled ? "" : "Type a message"}
					// The limit belongs to the contract; a copy here would go stale when the server changes it
					// (shows as a 400).
					maxLength={CHAT_MAX_MESSAGE_CHARS}
					// Enter inserts a newline on mobile keyboards; sending would half-send multi-paragraph
					// roleplay input.
					blurOnSubmit={false}
					onFocus={() => setFocused(true)}
					onBlur={() => setFocused(false)}
					// Turn off the primitive's border and background; the outer surface does that job (web does
					// the same).
					style={composer.input}
				/>
				{/* Emphasis marker (legacy "Add action"). Deliberately quieter than send (no surface or border) so send stays the strongest control; target is not shrunk below 44pt. Stays enabled while generating, like the rest of the composer. */}
				<Action
					icon="emphasis"
					tone="ghost"
					accessibilityLabel="Insert action marker"
					onPress={emphasize}
					disabled={disabled}
				/>
				{/* One control; only the glyph and its meaning swap. Two `Action`s split on `generating` unmount the target when generation starts and cut the press under the finger (web made the same call). Accessible name and handler change in this render without waiting for the glyph transition (motion explains state, state does not wait for motion). */}
				<Action
					icon={generating ? "stop" : "send"}
					// Stop is one emphasis step below send (web: primary vs outline); both filled put the
					// strongest color on "quit" and make waiting look wrong.
					tone={generating ? "outline" : "primary"}
					accessibilityLabel={
						generating ? "Stop generating the reply" : "Send message"
					}
					onPress={generating ? onStop : submit}
					disabled={!generating && !sendable}
				/>
			</View>
		</View>
	);
}

/**
 * One 44pt square target. Not the primitive `Button`, since there is no label and so no horizontal
 * padding, which leaves the field wider. Radius is `lg` to match the surrounding curve (web:
 * `rounded-xl` in `rounded-2xl`), never a pill or circle.
 */
function Action({
	icon,
	tone = "primary",
	accessibilityLabel,
	onPress,
	disabled,
}: {
	icon: "send" | "stop" | "emphasis";
	/** Same axis as the web button variants; `ghost` is the quiet slot so the row has one primary control. */
	tone?: "primary" | "outline" | "ghost";
	accessibilityLabel: string;
	onPress: () => void;
	disabled?: boolean;
}) {
	const { colors } = useTheme();
	const filled = tone === "primary";
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel}
			accessibilityState={{ disabled: Boolean(disabled) }}
			onPress={onPress}
			disabled={disabled}
			style={[
				composer.action,
				tone === "primary" && { backgroundColor: colors.primary },
				tone === "outline" && {
					backgroundColor: colors.background,
					borderColor: colors.border,
					borderWidth: borderWidth,
				},
				disabled && composer.actionBlocked,
			]}
		>
			{/* The glyph swaps in place without moving the box (`lib/motion/animated-icon-swap.tsx`); the box is not in the accessibility tree, so the name is the `accessibilityLabel` above. */}
			<AnimatedIconSwap stateKey={icon}>
				<Icon
					name={icon}
					size="lg"
					tone={
						filled
							? "primary-foreground"
							: tone === "ghost"
								? "muted-foreground"
								: "foreground"
					}
				/>
			</AnimatedIconSwap>
		</Pressable>
	);
}

const composer = StyleSheet.create({
	/** Device edges and safe area belong to `ComposerArea`; this holds only the layout of controls and field. Horizontal padding equals the list and failure notice (`chat-rhythm.ts`); the old 12 showed a 4pt mismatch once the keyboard pushed the composer against the last bubble. */
	bar: { paddingHorizontal: chatGutter, paddingVertical: space.sm },
	/** The one surface holding field and controls; it owns border and radius. */
	field: {
		alignItems: "flex-end",
		borderRadius: radiusScale.xl,
		borderWidth: borderWidth,
		flexDirection: "row",
		gap: space.xs,
		padding: space.xs,
	},
	input: {
		// The surface already has the border; no box inside a box.
		backgroundColor: "transparent",
		borderWidth: 0,
		flex: 1,
		// Multi-line grows but never takes the whole screen; the conversation above must stay visible.
		maxHeight: 140,
		minHeight: touchTarget,
		paddingHorizontal: space.sm,
	},
	action: {
		alignItems: "center",
		borderRadius: radiusScale.lg,
		justifyContent: "center",
		minHeight: touchTarget,
		width: touchTarget,
	},
	actionBlocked: { opacity: 0.5 },
});
