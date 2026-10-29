import { describe, expect, it } from "vitest";
import {
	canSendComposerText,
	type EnterSubmitSignal,
	prefersSoftKeyboardComposer,
	shouldSubmitOnEnter,
} from "./submit.ts";

/**
 * Tests for the composer predicates: which Enter counts as a send.
 *
 * Components are not rendered (the web test rule for this repo). The rules are still checked this
 * way because the decision reads only four event signals, which are facts about what the browser
 * sends and do not depend on markup.
 */

/** A plain Enter: a hardware keyboard with no input method involved. */
const plainEnter = (
	overrides: Partial<EnterSubmitSignal> = {},
): EnterSubmitSignal => ({
	key: "Enter",
	shiftKey: false,
	isComposing: false,
	keyCode: 13,
	composing: false,
	softKeyboard: false,
	...overrides,
});

/** The same Enter coming from the on-screen keyboard. */
const softEnter = (
	overrides: Partial<EnterSubmitSignal> = {},
): EnterSubmitSignal => plainEnter({ softKeyboard: true, ...overrides });

describe("can it send", () => {
	it("sends when there is content", () => {
		expect(
			canSendComposerText({ text: "hi", disabled: false, generating: false }),
		).toBe(true);
	});

	it("does not send empty input", () => {
		expect(
			canSendComposerText({ text: "", disabled: false, generating: false }),
		).toBe(false);
	});

	/** A whitespace-only message is not a conversation: it leaves only an empty bubble and an empty user turn. */
	it("does not send whitespace-only input", () => {
		for (const text of [" ", "\n", "\t", "  \n  "])
			expect(
				canSendComposerText({ text, disabled: false, generating: false }),
			).toBe(false);
	});

	it("does not send while generating", () => {
		expect(
			canSendComposerText({ text: "hi", disabled: false, generating: true }),
		).toBe(false);
	});

	it("does not send without a scope", () => {
		expect(
			canSendComposerText({ text: "hi", disabled: true, generating: false }),
		).toBe(false);
	});

	/**
	 * Trimming is used only for the decision; the value sent is the raw text. This predicate answers
	 * "may this be sent" and does not choose what to send.
	 */
	it("sends content even with surrounding whitespace", () => {
		expect(
			canSendComposerText({
				text: "  hi  ",
				disabled: false,
				generating: false,
			}),
		).toBe(true);
	});
});

describe("is Enter a send", () => {
	it("a plain Enter sends", () => {
		expect(shouldSubmitOnEnter(plainEnter())).toBe(true);
	});

	it("Shift+Enter is a line break", () => {
		expect(shouldSubmitOnEnter(plainEnter({ shiftKey: true }))).toBe(false);
	});

	it("keys other than Enter do not send", () => {
		for (const key of ["a", "Escape", "Tab", " "])
			expect(shouldSubmitOnEnter(plainEnter({ key }))).toBe(false);
	});

	/**
	 * Chrome and Firefox path. The keydown that confirms a composition carries isComposing=true and
	 * arrives before compositionend.
	 */
	it("does not send when the browser says composition is in progress", () => {
		expect(shouldSubmitOnEnter(plainEnter({ isComposing: true }))).toBe(false);
	});

	/**
	 * Safari path, and the one that was unguarded in this repository. Safari sends `compositionend`
	 * before `keydown`. At that point `isComposing` is false and our `composing` flag is already off.
	 * The only signal left is `keyCode === 229`. Without checking it, the Enter that confirms a
	 * composition goes out as a send, which happens in nearly every sentence for Korean users.
	 */
	it("does not send an Enter the IME is handling (keyCode 229)", () => {
		expect(
			shouldSubmitOnEnter(
				plainEnter({ keyCode: 229, isComposing: false, composing: false }),
			),
		).toBe(false);
	});

	/** Enter during composition (candidate selection). If the browser's flags disagree, our flag still catches it. */
	it("does not send inside a composition span", () => {
		expect(shouldSubmitOnEnter(plainEnter({ composing: true }))).toBe(false);
	});

	/**
	 * Pins the reason no time-based guard exists. In Chrome the user presses the real send Enter right
	 * after the confirming Enter. All three signals are off then and keyCode is 13, so it must send. A
	 * guard that ignores a few milliseconds after `compositionend` would swallow this Enter silently.
	 */
	it("the next Enter right after composition ends sends normally", () => {
		expect(
			shouldSubmitOnEnter(
				plainEnter({ isComposing: false, composing: false, keyCode: 13 }),
			),
		).toBe(true);
	});
});

describe("on a screen keyboard Enter is a line break", () => {
	/**
	 * This is where the finger-typing user diverged most. The on-screen keyboard has no Shift to
	 * press, so under "Enter = send" there is **no way to start a new line at all**. In a product
	 * where multi-paragraph utterances are normal, that makes the composer half unusable.
	 */
	it("Enter does not send", () => {
		expect(shouldSubmitOnEnter(softEnter())).toBe(false);
	});

	/** Same answer when Shift is attached: on this surface Enter is always a newline. */
	it("Shift+Enter is a line break too", () => {
		expect(shouldSubmitOnEnter(softEnter({ shiftKey: true }))).toBe(false);
	});

	/**
	 * The IME guards stand alongside. Both checks give the same direction (do not send), so reordering
	 * them cannot open a path where a composing Enter becomes a send. This pins that fact by value.
	 */
	it("Enter during composition still does not send", () => {
		for (const signal of [
			softEnter({ isComposing: true }),
			softEnter({ composing: true }),
			softEnter({ keyCode: 229 }),
		])
			expect(shouldSubmitOnEnter(signal)).toBe(false);
	});

	/** Other keys are unaffected by this axis. */
	it("other keys are still not a send", () => {
		expect(shouldSubmitOnEnter(softEnter({ key: "a" }))).toBe(false);
	});

	/**
	 * Confirms in the same place that the physical keyboard path has not changed at all. The costliest
	 * regression in this change would be a desktop Enter silently becoming a newline.
	 */
	it("Enter on a physical keyboard is still a send", () => {
		expect(shouldSubmitOnEnter(plainEnter())).toBe(true);
		expect(shouldSubmitOnEnter(plainEnter({ shiftKey: true }))).toBe(false);
	});
});

describe("which keyboard is it", () => {
	/**
	 * Does not look at the user-agent string. That regex goes stale with each new device, and both of
	 * its wrong directions fail silently: a misread tablet cannot add a line, and a misread laptop
	 * cannot send with Enter.
	 */
	it("a finger-only device has a screen keyboard", () => {
		expect(
			prefersSoftKeyboardComposer({ coarsePointer: true, hoverCapable: false }),
		).toBe(true);
	});

	it("a device with a mouse does not", () => {
		expect(
			prefersSoftKeyboardComposer({ coarsePointer: false, hoverCapable: true }),
		).toBe(false);
	});

	/**
	 * **A touchscreen laptop is this combination.** Reading `coarse` alone would leave that user
	 * unable to send with Enter while typing on the physical keyboard.
	 */
	it("a device with touch that also hovers does not", () => {
		expect(
			prefersSoftKeyboardComposer({ coarsePointer: true, hoverCapable: true }),
		).toBe(false);
	});

	/** The opposite misclassification is also blocked: a desktop whose mouse is temporarily disconnected. */
	it("a precise pointer without hover does not", () => {
		expect(
			prefersSoftKeyboardComposer({
				coarsePointer: false,
				hoverCapable: false,
			}),
		).toBe(false);
	});
});
