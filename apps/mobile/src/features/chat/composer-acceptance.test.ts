import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Locks, by code shape, when the composer clears. This app's tests do not render screens
 * (`vitest.config.ts`), so this checks that clearing lives only inside the acceptance signal and
 * that the component still knows nothing about the store. That the signal arrives after the save is
 * checked by value in `generation-turn.test.ts`.
 *
 * Value tests are not enough: the regression is one `setText("")` creeping back into the submit
 * path, which looks fine until a rare save failure makes the user lose their sentence with no way
 * to reproduce it. The web has a same-named test for the same reason.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

const codeOf = (file: string): string =>
	readFileSync(join(HERE, file), "utf8")
		.replaceAll(/\/\*[\s\S]*?\*\//g, " ")
		.replaceAll(/(^|[^:])\/\/.*$/gm, "$1");

describe("the composer clears only after the commit", () => {
	const composer = codeOf("composer.tsx");

	it("clearing happens inside the acceptance signal", () => {
		expect(composer).toContain("onAccepted:");
		/** The clear-on-submit line must not exist. */
		expect(composer).not.toMatch(/setText\(\s*""\s*\)/);
	});

	/** Commit does not finish in the same tick; clearing unconditionally would drop what the user started typing meanwhile. */
	it("clears only when the sent value is unchanged", () => {
		expect(composer).toContain("currentRef.current === sent");
	});

	/** A composer that knows the store would be needed once per conversation kind. */
	it.each([
		"ChatStore",
		"local-data",
		"sqlite",
		"generation/transport",
		"churu",
		"billing",
	])("doesn't know %s", (forbidden) => {
		expect(composer.toLowerCase()).not.toContain(forbidden.toLowerCase());
	});

	/** `send()` reports only the local commit; `generating` carries assistant completion. Merging them would hold the user's sentence for the whole model reply. */
	it("doesn't wait for send", () => {
		expect(composer).not.toMatch(/await\s+onSend|onSend\([\s\S]{0,80}\)\.then/);
	});
});

describe("stop takes the send button's place", () => {
	const composer = codeOf("composer.tsx");

	/**
	 * Stop takes send's place. Side by side leaves an unpressable button during generation and two
	 * 44pt targets crowd a narrow screen. It must be a glyph swap, not two `Action`s split by
	 * `generating ?`: that remounts the target when generation starts, cutting the press under the
	 * finger (the web composer made the same call, `docs/motion/ARCHITECTURE.md`).
	 */
	it("there is one control and only the glyph changes", () => {
		expect(composer).toMatch(/icon=\{generating \? "stop" : "send"\}/);
		expect(composer).toMatch(/onPress=\{generating \? onStop : submit\}/);
		/** The shared swap container; the screen does not build its own transition. */
		expect(composer).toContain("<AnimatedIconSwap");
		/** The old two-control shape must not return. */
		expect(composer).not.toMatch(/generating \?\s*\(/);
	});

	/** The accessible name changes in the same render as the state; waiting for the glyph transition would leave a screen-reader user with "send" in between. */
	it("the name and the operation don't wait for motion", () => {
		expect(composer).toMatch(
			/accessibilityLabel=\{\s*generating \? "Stop generating the reply" : "Send message"/,
		);
		expect(composer).not.toContain("onAnimationComplete");
	});

	/**
	 * Target size is an accessibility axis. The value (44) is locked by `@rowcat/ui-native`'s
	 * `semantics.test.ts`; this checks that the screen uses the named `touchTarget` rather than a
	 * literal, which would break the code that uses the name.
	 */
	it("the target uses the named minimum target", () => {
		expect(composer).toContain("minHeight: touchTarget");
		expect(composer).toMatch(
			/import\s*\{[^}]*\btouchTarget\b[^}]*\}\s*from\s*"@rowcat\/ui-native"/,
		);
	});

	/**
	 * Not a pill or circle: `full` radius is not in RowCat's radius family. The web button is a
	 * rounded square matching the surrounding curve (`rounded-xl` in `rounded-2xl` in
	 * `chat-composer.tsx`).
	 */
	it("send and stop aren't pills", () => {
		expect(composer).toMatch(
			/action:\s*\{[^}]*borderRadius:\s*radiusScale\.lg/,
		);
		expect(composer).not.toMatch(
			/action:\s*\{[^}]*borderRadius:\s*radiusScale\.full/,
		);
	});
});

/**
 * Field and controls share one surface, like the web `chat-composer.tsx`. Two side-by-side pills
 * stacked two borders in one place and made the round button a radius unique to this screen.
 */
describe("the field and the controls are inside one surface", () => {
	const composer = codeOf("composer.tsx");

	it("the surface has the border and the field drops it", () => {
		expect(composer).toMatch(/field:\s*\{[^}]*borderWidth:/);
		expect(composer).toMatch(/input:\s*\{[^}]*borderWidth:\s*0/);
		expect(composer).toMatch(
			/input:\s*\{[^}]*backgroundColor:\s*"transparent"/,
		);
	});

	/** One source for horizontal rhythm (`chat-rhythm.ts`); 12 vs 16 diverged and showed once the keyboard pushed the composer against the last bubble. */
	it("the horizontal margin comes from the conversation's rhythm", () => {
		expect(composer).toContain("paddingHorizontal: chatGutter");
		expect(composer).not.toMatch(/bar:\s*\{[^}]*paddingHorizontal:\s*space\./);
	});
});

/**
 * Emphasis-marker button. Locks four things: the rule does not live here, the caret is seeded once,
 * the caret position does not trigger renders, and the composer still owns the value. The web's
 * same-named test covers the first and last for the same reason.
 */
describe("action marker", () => {
	const composer = codeOf("composer.tsx");

	/** Asterisks are not added here: wrapping a selection with a trailing space breaks CommonMark emphasis and leaves literal asterisks, silently. */
	it("a shared pure function owns the rule", () => {
		expect(composer).toContain("applyChatEmphasisMarker");
		expect(composer).not.toContain('"**"');
		expect(composer).not.toContain("'**'");
	});

	/**
	 * Do not keep controlling `selection`: passing it every render in RN commits the syllable being
	 * composed, which only shows in Korean, Japanese and Chinese. Seed once and clear on the first
	 * caret event (`features/create/prompt-section.tsx` made the same call).
	 */
	it("sets the caret once and lets go", () => {
		expect(composer).toContain("selection={seed ?? undefined}");
		expect(composer).toContain("if (seed) setSeed(null);");
	});

	/** Caret position is a ref: as state it re-renders the composer on every keystroke, with an inverted list above it. */
	it("the caret position doesn't cause renders", () => {
		expect(composer).toMatch(/const caret = useRef</);
		expect(composer).toContain("caret.current = event.nativeEvent.selection;");
	});

	/** A lone asterisk does not read as a picture, so the control needs a name. */
	it("has an accessible name", () => {
		expect(composer).toContain('accessibilityLabel="Insert action marker"');
	});

	/** The composer owns the value; another `setText` path would skip the "is empty" notification and stand the suggestion button on a wrong condition. */
	it("the single path that changes the value stays as is", () => {
		expect(composer.match(/setText\(/g)?.length).toBe(1);
		expect(composer).toContain("update(next.text)");
	});

	/** Do not shrink the target: the web uses a smaller button because a pointer presses it, but here a finger would aim below 44pt. */
	it("the target is the same container as send", () => {
		expect(composer.match(/<Action/g)?.length).toBe(2);
		expect(composer).toMatch(/action:\s*\{[^}]*width: touchTarget/);
	});

	/** Feature code in this app does not use the word `TextInput` (`lib/boundaries.test.ts`); the handle type comes from `@rowcat/ui-native`. */
	it("doesn't write the native field's name directly", () => {
		expect(composer).toContain("TextFieldHandle");
		expect(composer).not.toContain("TextInput");
	});
});
