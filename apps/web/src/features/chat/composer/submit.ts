/**
 * Two predicates that decide whether the composer can send right now. They render no component, so
 * the tests can check them without React (`apps/web/vitest.config.ts`). They stay out of
 * `onKeyDown` because the failure mode is specific to Korean IME input, which English-language
 * tests never reach.
 *
 * The two are split on purpose. `canSendComposerText` answers "may this value be sent" and is the
 * button's enabled state and the final gate on submit. `shouldSubmitOnEnter` answers "is this Enter
 * a send". The second cannot stand in for the first: an Enter judged to be a send still does
 * nothing on an empty input.
 *
 * They are also separate from `@rowcat/chat`'s `canStartGeneration`. That one is the generation
 * lifecycle gate: it reads in-flight state from a synchronous copy and covers turns started with no
 * input (regenerate). These are composer affordances. Merging them would teach the pure package
 * about IME and keyboard events, which belong to the browser and not to Expo.
 */

export interface ComposerSendCheck {
	/** The raw input value, untrimmed. */
	text: string;
	/** Local storage is not ready yet, or the room was not found, so there is nowhere to send. */
	disabled: boolean;
	/** This room is already generating. */
	generating: boolean;
}

/**
 * Whether this input can be sent right now. The button, the keyboard and submit all read this one
 * function.
 *
 * Checking the conditions in three separate places always drops one of them. The keyboard path is
 * the one that goes missing (the button is visible and gets fixed first), which leaves Enter able
 * to pass next to a disabled button.
 *
 * Whitespace-only input is rejected because it is not a conversation: sending it leaves an empty
 * bubble and an empty user turn in the next request's context.
 */
export function canSendComposerText(check: ComposerSendCheck): boolean {
	if (check.disabled || check.generating) return false;
	return check.text.trim().length > 0;
}

/**
 * The standard signal that the IME is handling this key. `KeyboardEvent.keyCode` is deprecated, but
 * there is no replacement here: browsers send 229 for the Enter that confirms a composition, and no
 * browser sends 229 for a plain Enter. Checking it therefore blocks no normal send in any browser.
 */
const IME_PROCESSING_KEY_CODE = 229;

export interface EnterSubmitSignal {
	key: string;
	shiftKey: boolean;
	/**
	 * Whether the browser reports an active composition. In Chrome and Firefox the `keydown` that
	 * confirms a composition carries `true` and arrives before `compositionend`, so this one flag
	 * covers that path.
	 */
	isComposing: boolean;
	/** Deprecated `keyCode`. Keys handled by the IME carry 229. */
	keyCode: number;
	/**
	 * Between `compositionstart` and `compositionend`, counted by us. It is kept alongside
	 * `isComposing` because some input methods disagree with it on the Enter that picks a candidate.
	 * Reading only one flag would send a half-composed character.
	 */
	composing: boolean;
	/**
	 * Whether this composer sits above the on-screen keyboard. If true, Enter is always a newline.
	 *
	 * The decision is made by `prefersSoftKeyboardComposer` below; this is its result. This flag is
	 * checked before the IME flags, not after, because the meaning differs: an IME flag says "this
	 * Enter belongs to the input method", while this one says "Enter is not a send on this keyboard".
	 * The answer is the same whether or not a composition is active.
	 */
	softKeyboard: boolean;
}

/**
 * Whether this Enter is a send, as opposed to a newline or an IME key.
 *
 * This is where Korean users hit the most bugs on this screen. If the Enter that confirms a
 * composition counts as a send, the last character goes out half-formed, or the same message goes
 * out twice. That happens in nearly every sentence.
 *
 * All three signals are read together because browsers order `compositionend` and `keydown`
 * differently:
 *
 * ```text
 * Chrome, Firefox   keydown(isComposing=true) → compositionend    the first signal catches it
 * Safari            compositionend → keydown(isComposing=false)   only keyCode 229 remains
 * ```
 *
 * In the second order our `composing` flag is already off, because `compositionend` came first.
 * Without checking `keyCode`, Safari would be blocked by no signal at all.
 *
 * Do not add a time-based guard, such as ignoring a few milliseconds after `compositionend`. It
 * fails in the other direction: in Chrome, the real send Enter that the user presses right after
 * confirming a composition falls inside that window and is silently swallowed. State correctness is
 * not delegated to a delay.
 *
 * ## On the soft keyboard, Enter is never a send
 *
 * When `softKeyboard` is true the function returns here. The reason is in
 * `prefersSoftKeyboardComposer` below. In short, that environment has no Shift key to press, so
 * "Enter = send" would mean there is no way to start a new line. Putting this branch before the IME
 * checks is safe because both lead to the same result, not sending, so reordering cannot let a
 * composing Enter through as a send.
 */
export function shouldSubmitOnEnter(signal: EnterSubmitSignal): boolean {
	if (signal.key !== "Enter" || signal.shiftKey) return false;
	if (signal.softKeyboard) return false;
	if (signal.isComposing || signal.composing) return false;
	return signal.keyCode !== IME_PROCESSING_KEY_CODE;
}

/* ══════════════════════════════════════════════════════════════════════════
 * What Enter means depends on the kind of keyboard
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Whether this composer sits above a soft keyboard. A pure decision.
 *
 * The axis exists because of Shift+Enter. On a physical keyboard that combination is the newline
 * convention, but a soft keyboard has no Shift to press (even a shifted key only capitalizes the
 * next character and does not supply `shiftKey`). So for a user typing with their fingers, "Enter =
 * send" means there is no way to add a line at all, even though writing several paragraphs of
 * roleplay in one message is normal use here.
 *
 * In that environment Enter is a newline, and sending is the button's job. The button is always in
 * place, and its target size is already sized for fingers (`COMPOSER_BUTTON`).
 *
 * ## It does not look at the user-agent string
 *
 * Matching `/iPhone|Android/` goes stale with each new device, and its wrong answers are silent: a
 * tablet misread as a desktop cannot add a line, and a laptop misread as mobile cannot send with
 * Enter. Instead it reads two input capabilities that the browser reports directly. The repository
 * already uses the same axis to decide when the action bar shows (`pointer-coarse` in
 * `action-bar.tsx`).
 *
 * ```text
 * pointer: coarse + hover: none    typed with fingers → soft keyboard   Enter is a newline
 * anything else                     mouse, trackpad or hardware keys    Enter sends
 * ```
 *
 * Both must be read together. `coarse` alone would classify a touchscreen laptop as a soft-keyboard
 * device, and that user typing on physical keys could not send with Enter. `hover: none` alone
 * would classify a desktop whose mouse is temporarily disconnected.
 */
export function prefersSoftKeyboardComposer(input: {
	/** `(pointer: coarse)` — whether the primary pointer is coarse, like a finger. */
	coarsePointer: boolean;
	/** `(hover: hover)` — whether the primary pointer can hover. */
	hoverCapable: boolean;
}): boolean {
	return input.coarsePointer && !input.hoverCapable;
}
