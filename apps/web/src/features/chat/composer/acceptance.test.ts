import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * When the composer clears its input. The boundary is locked by the shape of the code.
 *
 * Web tests here do not render React (`vitest.config.ts`), so the checks cover two things: the
 * clearing action sits **only inside the accepted signal**, and this component still does not know
 * the storage layer.
 *
 * Why value tests alone are not enough: the regression is a single `setText("")` returning to the
 * submit path. The screen keeps working. Only in the rare moment a save fails does the user lose
 * their sentence, and they have no way to reproduce it for us.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

const codeOf = (file: string): string =>
	readFileSync(join(HERE, file), "utf8")
		.replaceAll(/\/\*[\s\S]*?\*\//g, " ")
		.replaceAll(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Source with whitespace collapsed. The scan cares about **what is written**, not how many lines it
 * spans. Without collapsing, the test breaks on the day the formatter folds one more attribute onto
 * a line, and then the test, not the rule, gets fixed.
 */
const flatOf = (file: string): string => codeOf(file).replaceAll(/\s+/g, " ");

describe("the composer empties only after commit", () => {
	const composer = codeOf("composer.tsx");

	it("emptying lives inside the acceptance signal", () => {
		expect(composer).toContain("onAccepted:");
		/** The one line that cleared right after submit is what this change removed. */
		expect(composer).not.toContain('setText("")');
	});

	/**
	 * Clears only if the value still matches what was sent. The commit does not finish in the same
	 * tick, so clearing unconditionally would erase the input of someone who started typing the next
	 * sentence in the meantime.
	 */
	it("empties only when the sent value is unchanged", () => {
		expect(composer).toContain("current === sent");
	});

	/**
	 * If the composer knew the storage layer, this component would need one copy per conversation
	 * kind, and the story test could not reuse the same input.
	 */
	it.each([
		"ChatStore",
		"dexie",
		"local-chat",
		"local-data",
		"generation/router",
		"churu",
		"billing",
	])("does not know %s", (forbidden) => {
		expect(composer.toLowerCase()).not.toContain(forbidden.toLowerCase());
	});

	/**
	 * Does not create a state that waits for the send's result. `send()` reports only the local
	 * commit, and assistant completion is still stated by `generating`. If the composer held both at
	 * once, it would keep the user's sentence until the model replied.
	 */
	it("send does not wait for the reply to finish", () => {
		expect(composer).not.toContain("await onSend");
		expect(composer).not.toContain("onSend(text).then");
	});
});

/**
 * **Send and stop are the same circle.**
 *
 * A long comment said so, but the code did not keep it. There were two `Button`s split by
 * `generating`, so matching size, shape and target was coincidence held up by two sets of identical
 * classes. Fixing one side makes the switch look like "a different button", and that drift passes
 * both the compiler and the tests.
 *
 * The structure now enforces it: one circle stays put and only the name, the action and the glyph
 * change. The checks below pin that structure.
 */
describe("send and stop are the same circle", () => {
	const composer = codeOf("composer.tsx");
	const flat = flatOf("composer.tsx");

	/**
	 * ⚠️ **Do not count the elements.** This check once looked for exactly one `<Button`, and that was
	 * the right expression of the rule at the time. The composer now has a second button of a
	 * different kind (the action marker). Counting would make deleting that button the quickest way to
	 * pass this check.
	 *
	 * What it guards is that **state does not pick the element**. If the two actions were split inside
	 * one element, the shared size, shape and target would be coincidence rather than structure.
	 */
	it("send and stop do not split into elements", () => {
		expect(flat).toContain("onClick={generating ? onStop : submit}");
		expect(flat).not.toMatch(/generating \? <Button/);
	});

	/**
	 * The size and shape must be stated in one place. With two, they can drift apart, and a drifted
	 * screen shifts the right edge of the input slightly when generation starts.
	 */
	it("size and shape do not split by state", () => {
		expect(composer.match(/size="icon-lg"/g)?.length).toBe(1);
		expect(composer.match(/className=\{COMPOSER_BUTTON\}/g)?.length).toBe(1);
	});

	/**
	 * The accessible name changes **in the same render as the state**; motion only links the glyphs
	 * below it. Both names must exist so that no one relies on the icon alone.
	 */
	it("the name follows the state", () => {
		expect(flat).toContain(
			'generating ? t("composer.stopGenerating") : t("composer.send")',
		);
	});

	/**
	 * Stop is always pressable. Disabled is only the send state when there is nothing to send, and
	 * that decision still belongs to `canSendComposerText` alone. While generating that value is
	 * false, so `generating` has to be removed here to keep the meaning intact.
	 */
	it("is not disabled while generating", () => {
		expect(flat).toContain("disabled={!generating && !canSend}");
		expect(flat).toContain("onClick={generating ? onStop : submit}");
	});

	/**
	 * Only the glyph changes. This box stacks the two overlapping pictures in one grid cell and blocks
	 * the first mount (`lib/motion/animated-icon-swap.tsx`). The button's geometry is left alone.
	 */
	it("only the glyph switches", () => {
		expect(flat).toContain(
			'<AnimatedIconSwap stateKey={generating ? "stop" : "send"}>',
		);
	});

	/**
	 * If the composer began writing timings and curves, the values would have two sources. The rhythm
	 * lives in `lib/motion`, and this file only calls that box (`lib/motion/feedback.test.ts` applies
	 * the same rule across the app).
	 */
	it("writes no rhythm of its own", () => {
		expect(composer).not.toMatch(/\bduration:/);
		expect(composer).not.toMatch(/\bease:/);
		expect(composer).not.toContain("AnimatePresence");
	});
});

/**
 * Action marker (`Mark as action`) — **the legacy `Add action` is back in this spot.**
 *
 * Three things are locked here: the rule does not live in this file, pressing it does not steal
 * focus, and the decision that the composer owns the value is not disturbed by this button.
 */
describe("action marker", () => {
	const composer = codeOf("composer.tsx");
	const flat = flatOf("composer.tsx");

	/**
	 * The asterisks are not added here. Wrapping a selection that ends in a space leaves CommonMark
	 * emphasis unmatched, so the asterisks stay on screen, and **that failure is silent.**
	 */
	it("the rule belongs to the shared pure function", () => {
		expect(composer).toContain("applyChatEmphasisMarker");
		expect(composer).not.toContain('"**"');
		expect(composer).not.toContain("'**'");
	});

	/** If focus moves to the button, the selection disappears from the screen at that moment, and the user cannot see what is being wrapped. */
	it("pressing it does not steal the composer's focus", () => {
		expect(flat).toContain("onMouseDown={(event) => event.preventDefault()}");
	});

	/** A name is needed so that no one relies on the icon alone; a lone asterisk does not read as a picture. */
	it("has an accessible name", () => {
		expect(flat).toContain('aria-label={t("composer.insertActionMarker")}');
	});

	/**
	 * The composer still owns the value. If this button called `setText` on its own path, the "is it
	 * empty" notification would be skipped, and the screen would then compute the suggestion button's
	 * state from the wrong condition.
	 */
	it("there is still one path that changes the value", () => {
		expect(composer.match(/setText\(/g)?.length).toBe(1);
		expect(flat).toContain("update(next.text)");
	});
});
