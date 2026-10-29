import { applyChatEmphasisMarker } from "@rowcat/chat";
import { Button } from "@rowcat/ui-web/components/button";
import { Textarea } from "@rowcat/ui-web/components/textarea";
import { cn } from "@rowcat/ui-web/lib/utils";
import { Asterisk, Send, Square } from "lucide-react";
import {
	type KeyboardEvent,
	type Ref,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { AnimatedIconSwap } from "#/lib/motion/animated-icon-swap.tsx";
import {
	COMPOSER_BUTTON,
	COMPOSER_FIELD_MIN_H,
	COMPOSER_FIELD_TEXT,
	COMPOSER_FRAME,
	COMPOSER_SURFACE,
} from "../chat-geometry.ts";
import { canSendComposerText, shouldSubmitOnEnter } from "./submit.ts";
import { useSoftKeyboardComposer } from "./use-soft-keyboard.ts";

/** What the screen can do with this composer — **only one thing: fill it.** */
export interface ChatComposerHandle {
	/**
	 * Replaces the value with this sentence and focuses the input.
	 *
	 * The caller invokes this only when the box is empty (`canSuggestReply` holds that condition). The
	 * condition is not rechecked here because there is **nothing to do** if it fails: silently
	 * ignoring it would look to the person who pressed the button as if nothing happened. The one
	 * place that guards the condition is whether the button is shown at all.
	 */
	fill: (text: string) => void;
}

/**
 * The composer: **a single object placed under the conversation.**
 *
 * It used to be a bordered box holding a textarea and a square button side by side. Now one rounded
 * surface holds both, and that surface has states: while reading it recedes faintly, and when text
 * comes in or focus arrives, the background, border and shadow come alive together. **Size does not
 * change in any state**: a growing input would push the paragraph being read. The surface geometry
 * and the reasons for its constants are in `chat-geometry.ts`.
 *
 * On a physical keyboard Enter sends and Shift+Enter starts a new line, a convention chat has
 * settled on. **On the on-screen keyboard that convention does not hold**: with no Shift to press,
 * `Enter = send` means there is no way to start a new line, which in a product where
 * multi-paragraph utterances are normal makes the input half unusable. So on that surface Enter is
 * a newline and the button sends. Which applies is decided by **input capability**, not by the user
 * agent (`submit.ts`).
 *
 * In every case **Enter during Korean composition does not send.** If the Enter that confirms a
 * composition counted as a send, the last character would go out half-formed, or the same message
 * would go out twice. Without this handling, nearly every sentence would be a problem for Korean
 * users.
 *
 * Sending has an accessible name, not just an icon. If the function were conveyed by the icon shape
 * alone, screen-reader users would face two unlabeled buttons side by side.
 *
 * **The composer does not know the storage layer.** `ChatStore`, Dexie and the generation router do
 * not come in here. If they did, this component would need one copy per conversation kind, and the
 * story test could not share the same input. Instead the lifecycle only reports "the conversation
 * accepted that utterance" (`onAccepted` of `onSend`), and this component clears its own value on
 * that signal.
 *
 * ## The value's owner is still this component, even after reply suggestions
 *
 * Filling a suggested sentence arrives through **one imperative handle** (`fill`). The value was
 * not lifted into the screen as a `value`/`onChange` pair because of input latency: if this box's
 * state moved up, the whole conversation screen (which hosts the virtualized list) would re-render
 * on every keystroke.
 *
 * The only value that goes up is **whether it is empty**, and only when that flips
 * (`onEmptyChange`). That axis lets the screen keep "do not show the suggestion button while there
 * is text in the box", and that one rule makes **filling overwriting someone else's text
 * unrepresentable** (`canSuggestReply` in `@rowcat/chat`).
 */

export function ChatComposer({
	disabled,
	generating,
	onSend,
	onStop,
	onEmptyChange,
	ref,
}: {
	/** The local store is not ready yet, or the room was not found. */
	disabled: boolean;
	generating: boolean;
	/**
	 * Starts a turn. **The input is cleared by `onAccepted`, not by this call.** That callback fires
	 * only after the user's utterance has been saved to the conversation
	 * (`features/conversation/user-turn.ts`).
	 */
	onSend: (text: string, options: { onAccepted: () => void }) => void;
	onStop: () => void;
	/**
	 * Reports emptiness **only when it flips**, not on every keystroke.
	 *
	 * Reporting on every character would re-render the conversation screen each time, and that screen
	 * hosts the virtualized list. It flips only twice per message.
	 */
	onEmptyChange?: (empty: boolean) => void;
	ref?: Ref<ChatComposerHandle>;
}) {
	const { t } = useTranslation(["chat", "common"]);
	const [text, setText] = useState("");
	const inputRef = useRef<HTMLTextAreaElement>(null);
	/**
	 * A **synchronous copy** of the current value. `onAccepted` is a callback that remembers the
	 * `text` of the render it was created in. Comparing against that value cannot tell apart the case
	 * where one more character was typed before the commit finished (the mobile composer keeps the
	 * same copy).
	 */
	const currentRef = useRef("");
	/** The last value that was **reported**. This copy is what decides whether to report a flip. */
	const emptyRef = useRef(true);

	/**
	 * The **only path** that changes the value.
	 *
	 * If the three (typing, clearing, filling) each called `setText` directly, one of them would skip
	 * reporting emptiness, and the screen would then show the suggestion button under the wrong
	 * condition. That mismatch raises no error.
	 */
	const update = (next: string): void => {
		currentRef.current = next;
		setText(next);
		const empty = next.trim().length === 0;
		if (emptyRef.current === empty) return;
		emptyRef.current = empty;
		onEmptyChange?.(empty);
	};

	/**
	 * The selection to restore on the next render. **When the value changes, the browser moves the
	 * caret to the end.**
	 *
	 * It is a ref rather than state because nothing in render reads it, and it is read in an effect
	 * because `setSelectionRange` means something only **after the new value has reached the DOM**.
	 */
	const pendingSelection = useRef<readonly [number, number] | null>(null);
	/* No dependency array: check on every render. If nothing is pending, it returns at once. */
	useEffect(() => {
		const range = pendingSelection.current;
		if (!range) return;
		pendingSelection.current = null;
		const field = inputRef.current;
		if (!field) return;
		field.focus();
		field.setSelectionRange(range[0], range[1]);
	});

	/**
	 * Wraps the selection in the **action marker**. The rule lives in a shared pure function.
	 *
	 * The asterisks are not added here because of a single space: if the selection carries leading or
	 * trailing whitespace, CommonMark emphasis does not form, and the asterisks stay on screen
	 * (`applyChatEmphasisMarker`).
	 */
	const emphasize = () => {
		const field = inputRef.current;
		if (!field) return;
		const next = applyChatEmphasisMarker({
			text: currentRef.current,
			selectionStart: field.selectionStart,
			selectionEnd: field.selectionEnd,
		});
		pendingSelection.current = [next.selectionStart, next.selectionEnd];
		update(next.text);
	};

	useImperativeHandle(ref, () => ({
		fill: (value: string) => {
			update(value);
			/*
			 * Focus moves here too. Refining the chosen sentence is the next step, and if the cursor stayed
			 * on the list's button the person would have to press the input each time, and the list is
			 * already gone by then.
			 */
			inputRef.current?.focus();
		},
	}));
	/**
	 * Whether an IME composition is active. A ref rather than state because nothing in render reads
	 * it. Triggering a re-render on every keystroke would make typing lag in long text.
	 */
	const composingRef = useRef(false);
	/**
	 * What Enter means on this keyboard. The decision is made by a pure predicate; here its result is
	 * only passed to the key handler (`use-soft-keyboard.ts`).
	 */
	const softKeyboard = useSoftKeyboardComposer();

	/**
	 * Whether sending is possible: both the button's enabled state and the final gate on submit. **The
	 * decision lives in one place** (`submit.ts`). Writing it again here would give the keyboard path
	 * a different condition.
	 */
	const canSend = canSendComposerText({ text, disabled, generating });

	const submit = () => {
		if (!canSend) return;
		/**
		 * Holds the sent value. The clearing decision compares that value with the **current value**.
		 *
		 * The commit is a storage round-trip and does not finish in the same tick, so the person can
		 * start typing the next sentence in between. Clearing unconditionally would erase that input.
		 */
		const sent = text;
		onSend(sent, {
			/**
			 * Clears **only after the conversation has accepted the utterance**. If saving fails this
			 * callback never comes, so the original text stays and the person can send the same sentence
			 * again. The rule of not erasing a rejected input (generating, or no scope) has been extended to
			 * this point.
			 */
			onAccepted: () => {
				if (currentRef.current === sent) update("");
			},
		});
		/*
		 * Focus does not wait for the commit. It answers the action just taken, and is independent of
		 * whether the save succeeds.
		 *
		 * Focus returns to the input. If focus stayed on the button after sending with the button, the
		 * person would have to press the input again to type the next sentence (when sent with Enter it
		 * is already there).
		 */
		inputRef.current?.focus();
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		/**
		 * Whether this Enter is a send is decided by a pure predicate. Browsers order `compositionend`
		 * and `keydown` differently, so dropping one signal here would fail silently for Korean input
		 * only (`submit.ts`).
		 */
		if (
			!shouldSubmitOnEnter({
				key: event.key,
				shiftKey: event.shiftKey,
				isComposing: event.nativeEvent.isComposing,
				keyCode: event.nativeEvent.keyCode,
				composing: composingRef.current,
				softKeyboard,
			})
		)
			return;
		event.preventDefault();
		submit();
	};

	return (
		/*
		 * The outer layer and the surface geometry **live in `chat-geometry.ts`**, because the
		 * server-rendered placeholder has to read the same values. The two files used to write them
		 * separately, and even after this surface became one rounded box the placeholder kept the old
		 * geometry (a top rule plus a square input box). That mismatch passes both the compiler and the
		 * tests and is visible only to someone who reloads the page.
		 *
		 * What those constants do not hold is the width. The reading column's width is **already held by
		 * the caller** (the conversation uses `ChatColumn`, the story test uses `PlaytestShell` — both
		 * are the reading column plus side margins), and the rule in `chat-shell.tsx` is that this value
		 * must have one source.
		 */
		<div className={COMPOSER_FRAME}>
			{/*
			 * Focus is received by **the surface** (`focus-within`). Leaving the inner input's ring in place
			 * would make a second box glow inside the surface, and it would blur which element holds focus. The
			 * send button keeps its own ring: that means the button itself holds focus, not the surface.
			 *
			 * That ring and the transitions exist only here, not in the placeholder, which has no focusable field.
			 */}
			<div
				className={cn(
					COMPOSER_SURFACE,
					"transition-[background-color,border-color,box-shadow]",
					/*
					 * A surface with something in it. If text is already present before focus arrives, this person
					 * is in the middle of writing, and the background keeps where they got to even after switching
					 * tabs. Size is unchanged: only colour and border come alive.
					 */
					text.length > 0 && "border-border bg-background",
					/*
					 * Focus is precise. The ring is thin and the shadow steps up only one level. This surface is
					 * the largest object on the screen, so a large glow here would push the conversation back
					 * behind it.
					 */
					"focus-within:border-ring focus-within:bg-background focus-within:shadow-md focus-within:ring-2 focus-within:ring-ring/40",
				)}
			>
				<Textarea
					ref={inputRef}
					value={text}
					onChange={(event) => update(event.target.value)}
					onKeyDown={onKeyDown}
					onCompositionStart={() => {
						composingRef.current = true;
					}}
					onCompositionEnd={() => {
						composingRef.current = false;
					}}
					// A visible label would add an empty line above the input, so the name is kept and nothing is
					// drawn.
					aria-label={t("composer.message")}
					placeholder={
						disabled
							? t("composer.loadingTheConversation")
							: t("composer.typeAMessage")
					}
					disabled={disabled}
					rows={1}
					/*
					 * Height is handled by CSS (`field-sizing-content` on the primitive). Measuring and fitting it
					 * by hand would have to be redone whenever the font loads late or the window width changes,
					 * and that measuring loop would show up directly as input lag.
					 *
					 * At the cap (max-h-40) the input itself scrolls. Growing beyond that would push the
					 * conversation off screen.
					 *
					 * The border, shadow, focus ring and dark background that the primitive brings are turned off
					 * here. Those values are for the input standing **alone**; here the outer surface does the
					 * same job, so leaving them would put a box inside a box.
					 */
					/*
					 * Font size is held by the geometry constant (`COMPOSER_FIELD_TEXT`). On a narrow screen,
					 * going below 16px makes iOS Safari zoom the page on focus, and in this screen (confined to
					 * the viewport) that zoom does not come back. The reason is recorded at that constant.
					 */
					className={`max-h-40 ${COMPOSER_FIELD_MIN_H} ${COMPOSER_FIELD_TEXT} resize-none overflow-y-auto border-0 bg-transparent px-1.5 py-2.5 leading-6 shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-0 dark:bg-transparent`}
				/>
				{/*
				 * During generation the same position becomes 'stop'. Keeping two buttons side by side leaves a
				 * disabled send button during generation, which blurs which one to press.
				 *
				 * **Both are the same circle** (position, size and fill stay put, only the glyph changes). When the
				 * stop control was a faint outlined button, the switch read as "the button turned into something
				 * else", and the eye had to find it again.
				 *
				 * **So the button is one too.** For a while this position was two `Button`s split by `generating`,
				 * and that shape did not let the code keep the claim that they are one circle: each state flip
				 * unmounted the element, so matching size, shape and target became coincidence held up by two sets
				 * of classes (fixing one side silently splits them), and above all **the glyph inside could not carry
				 * over**: the newly mounted one has no previous state to continue from. Now one circle stays put and
				 * only three things change: the name, what pressing does, and the picture inside.
				 *
				 * The target size (`icon-lg`) is unchanged: sitting on a rounded surface does not shrink the area a
				 * finger can hit.
				 */}
				{/*
				 * Action marker — **the legacy `Add action` is back in this spot.**
				 *
				 * It is a far quieter item than send (ghost, small target, faint glyph). The strongest thing on this
				 * surface should still be send, and this button only needs to appear when the person looks for it.
				 *
				 * **It does not take focus when pressed** (the default `onMouseDown` behaviour is prevented). If focus
				 * moved to the button, the input's selection would disappear from the screen at that moment, and the
				 * person would have to press without seeing what the marker is applied to.
				 *
				 * It stays live during generation as well: writing the next utterance while waiting for a response is
				 * not blocked, which is the input's rule.
				 */}
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label={t("composer.insertActionMarker")}
					title={t("composer.insertActionMarker")}
					disabled={disabled}
					className={`${COMPOSER_BUTTON} text-muted-foreground`}
					onMouseDown={(event) => event.preventDefault()}
					onClick={emphasize}
				>
					<Asterisk aria-hidden="true" />
				</Button>
				<Button
					size="icon-lg"
					/*
					 * The accessible name changes **in the same render as the state**. Motion only links the
					 * glyphs beneath it, and says nothing about when this name changes.
					 */
					aria-label={
						generating ? t("composer.stopGenerating") : t("composer.send")
					}
					/*
					 * Stop is always pressable. Disabled is only the send state when there is nothing to send, and
					 * that decision still belongs to `canSendComposerText` alone. While generating that value is
					 * false, so `generating` has to be removed here to keep the meaning intact.
					 */
					disabled={!generating && !canSend}
					className={COMPOSER_BUTTON}
					onClick={generating ? onStop : submit}
				>
					<AnimatedIconSwap stateKey={generating ? "stop" : "send"}>
						{generating ? (
							/*
							 * A filled square. Drawn with a thin stroke it looks smaller than the send arrow within the
							 * same-sized circle, so it reads as a different button rather than the same object with a
							 * changed glyph.
							 */
							<Square aria-hidden="true" className="size-3.5 fill-current" />
						) : (
							<Send aria-hidden="true" />
						)}
					</AnimatedIconSwap>
				</Button>
			</div>
		</div>
	);
}
