import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cn } from "@rowcat/ui-web/lib/utils";
import { describe, expect, it } from "vitest";
import {
	ASSISTANT_PROSE,
	COMPOSER_FIELD_MIN_H,
	COMPOSER_FIELD_TEXT,
	COMPOSER_FRAME,
	COMPOSER_SURFACE,
	ESTIMATED_LINE_CHARS,
	ESTIMATED_LINE_HEIGHT_PX,
	ESTIMATED_USER_LINE_CHARS,
	estimateMessageContentHeight,
	estimateMessageHeight,
	estimateResponseHeight,
	MESSAGE_ACTION_BAR_HEIGHT_PX,
	MESSAGE_ACTIONS_RESERVE_PX,
	MESSAGE_STACK_GAP,
	MESSAGE_STACK_GAP_PX,
	PENDING_ROW_PX,
	PROSE_BLOCK_GAP,
	PROSE_SOFT_BREAKS,
	USER_BUBBLE_EXTRA_PX,
} from "./chat-geometry.ts";

/**
 * Conversation screen dimensions: **do the virtualizer's estimate and the placeholder read the same
 * values?**
 *
 * We do not compare whole class strings. That breaks on every style edit and guards nothing. What
 * this file locks is **ownership**: each value lives in one place, and both the live list and the
 * server-rendered placeholder read it from there.
 *
 * A real mismatch happened. When the composer changed from three stacked borders to one rounded
 * surface, `chat-skeleton.tsx` kept the old geometry. Compile and tests both passed. The symptom
 * was a 16px jump that only someone who reloaded the page could see.
 */
describe("action geometry", () => {
	/*
	 * The most important line in this file. Folding two values into one constant was the root cause of
	 * a real defect: the name said "action bar" but the value was "gap + action bar", so a place that
	 * used it inside a parent that already had the gap counted the gap twice.
	 */
	it("the cost of attaching actions is the gap plus the action row", () => {
		expect(MESSAGE_ACTIONS_RESERVE_PX).toBe(
			MESSAGE_STACK_GAP_PX + MESSAGE_ACTION_BAR_HEIGHT_PX,
		);
	});

	/*
	 * Do the class and the pixel value describe the same number? Not parsing classes at runtime is the
	 * price of this test. Tailwind's `gap-N` is `N * 0.25rem`, so `gap-1` is 4px at a 16px root.
	 */
	it("the gap's class and pixels say the same value", () => {
		const step = Number(MESSAGE_STACK_GAP.replace("gap-", ""));
		expect(Number.isFinite(step)).toBe(true);
		expect(MESSAGE_STACK_GAP_PX).toBe(step * 4);
	});

	/*
	 * Placeholder arithmetic. `ActionsReserve` empties **only the physical height of the action row**;
	 * the gap comes from the parent (`MESSAGE_STACK_GAP`). Their sum must equal the live row's action
	 * cost. While this was out of step the placeholder ran 4px taller per turn, which is 16px across
	 * four turns.
	 */
	it("the placeholder does not count the gap twice", () => {
		const skeletonTurn = MESSAGE_STACK_GAP_PX + MESSAGE_ACTION_BAR_HEIGHT_PX;
		expect(skeletonTurn).toBe(MESSAGE_ACTIONS_RESERVE_PX);
	});
});

describe("height estimate", () => {
	it("always includes the action row's space", () => {
		/*
		 * The action row takes space even when hidden (only its opacity is 0). If the estimate omits it,
		 * every row is underestimated by that amount, the error accumulates with row count, and the
		 * scrollbar lies. In a ten-message room that is 360px, which is easy to miss.
		 */
		expect(
			estimateMessageHeight({ role: "assistant", content: "short" }, true),
		).toBe(ESTIMATED_LINE_HEIGHT_PX + MESSAGE_ACTIONS_RESERVE_PX);
	});

	/*
	 * A screen that does not draw actions must not reserve that space. The conversation screen passes
	 * no `renderActions` until the local scope opens (`chat-page.tsx`), and while it is absent
	 * `MessageRow` has one child and adds no gap. The list has to estimate the DOM it actually draws.
	 */
	it("without drawn actions it reserves no space for them", () => {
		const message = { role: "assistant", content: "short" } as const;
		expect(estimateMessageHeight(message, false)).toBe(
			estimateMessageContentHeight(message),
		);
		expect(estimateMessageHeight(message, true)).toBe(
			estimateMessageHeight(message, false) + MESSAGE_ACTIONS_RESERVE_PX,
		);
	});

	it("counts explicit line breaks as lines", () => {
		const one = estimateMessageHeight(
			{ role: "assistant", content: "a" },
			true,
		);
		const three = estimateMessageHeight(
			{ role: "assistant", content: "a\nb\nc" },
			true,
		);
		expect(three - one).toBe(ESTIMATED_LINE_HEIGHT_PX * 2);
	});

	it("a blank line counts as a line, because the gap between paragraphs has real height", () => {
		expect(
			estimateMessageHeight({ role: "assistant", content: "a\n\nb" }, true),
		).toBe(ESTIMATED_LINE_HEIGHT_PX * 3 + MESSAGE_ACTIONS_RESERVE_PX);
	});

	it("adds the lines a long paragraph wraps into", () => {
		const long = "a".repeat(ESTIMATED_LINE_CHARS * 3);
		expect(
			estimateMessageHeight({ role: "assistant", content: long }, true),
		).toBe(ESTIMATED_LINE_HEIGHT_PX * 3 + MESSAGE_ACTIONS_RESERVE_PX);
	});

	it("user bubbles are taller by their padding and speaker line", () => {
		const content = "same text";
		expect(estimateMessageHeight({ role: "user", content }, true)).toBe(
			estimateMessageHeight({ role: "assistant", content }, true) +
				USER_BUBBLE_EXTRA_PX,
		);
	});

	/*
	 * An axis introduced when the bubble was limited to 64% of the reading width. Counting with the
	 * same character count as prose roughly halves the line count of a long utterance. The error stays
	 * hidden for typical short messages and shows up as a scroll offset only in rooms holding long
	 * pasted text.
	 */
	it("user bubbles wrap narrower than prose", () => {
		expect(ESTIMATED_USER_LINE_CHARS).toBeLessThan(ESTIMATED_LINE_CHARS);

		// A length that is one line in prose becomes two lines in a bubble.
		const content = "a".repeat(ESTIMATED_LINE_CHARS);
		expect(estimateMessageHeight({ role: "user", content }, true)).toBe(
			2 * ESTIMATED_LINE_HEIGHT_PX +
				USER_BUBBLE_EXTRA_PX +
				MESSAGE_ACTIONS_RESERVE_PX,
		);
		expect(estimateMessageHeight({ role: "assistant", content }, true)).toBe(
			ESTIMATED_LINE_HEIGHT_PX + MESSAGE_ACTIONS_RESERVE_PX,
		);
	});

	it("an empty body counts as one line; returning 0 would reserve as if the line were absent", () => {
		expect(
			estimateMessageContentHeight({ role: "assistant", content: "" }),
		).toBeGreaterThanOrEqual(ESTIMATED_LINE_HEIGHT_PX);
	});
});

/**
 * The streaming response. **A line still growing off-screen depends on this estimate.**
 *
 * A mounted line gets its real height from `ResizeObserver` almost immediately, so an error lasts
 * only briefly. If the user has scrolled several screens up, the line is not mounted at all, and
 * the total virtual height lives on the estimate alone. If that estimate is fixed, the scrollbar
 * and the `Jump to latest` decision go stale.
 */
describe("estimating an in-progress reply", () => {
	it("before the first token it adds the action space to the placeholder height", () => {
		expect(estimateResponseHeight("", true)).toBe(
			PENDING_ROW_PX + MESSAGE_ACTIONS_RESERVE_PX,
		);
	});

	/*
	 * The reserve cell is drawn only when `renderActions` is present (`message-list.tsx`). Reserving
	 * the space on a screen without it would size the first-token wait cell 36px larger than it really
	 * is.
	 */
	it("on a screen without actions it is just the placeholder height", () => {
		expect(estimateResponseHeight("", false)).toBe(PENDING_ROW_PX);
	});

	it("one arriving line does not fold to one line's height; the action space stands with it", () => {
		const estimate = estimateResponseHeight("one line", true);
		expect(estimate).toBe(
			ESTIMATED_LINE_HEIGHT_PX + MESSAGE_ACTIONS_RESERVE_PX,
		);
		expect(estimate).toBeGreaterThan(ESTIMATED_LINE_HEIGHT_PX);
	});

	/*
	 * The core fix of this slice. Previously the estimate stayed at one line (30px) no matter how long
	 * the text grew, so a twenty-paragraph response was estimated at 30px.
	 */
	it("the estimate grows with the streamed text", () => {
		const short = estimateResponseHeight("short", true);
		const long = estimateResponseHeight(
			"a".repeat(ESTIMATED_LINE_CHARS * 10),
			true,
		);
		expect(long).toBeGreaterThan(short);
		expect(long).toBe(
			ESTIMATED_LINE_HEIGHT_PX * 10 + MESSAGE_ACTIONS_RESERVE_PX,
		);
	});

	it("explicit line breaks count by the same rule as stored messages", () => {
		const one = estimateResponseHeight("a", true);
		const three = estimateResponseHeight("a\nb\nc", true);
		expect(three - one).toBe(ESTIMATED_LINE_HEIGHT_PX * 2);
	});

	/*
	 * **The most important regression contract.** If a streaming line changes into a stored message
	 * and the same text gets a different estimate, the virtual coordinates shift by that difference in
	 * that frame. The user sees the conversation jump as the response is confirmed. The test checks by
	 * value that both paths pass through the same function. A second copy of the line-counting formula
	 * would be caught here first.
	 */
	it("estimates the same height as a committed assistant message", () => {
		for (const text of [
			"one line",
			"a\nb\nc",
			"a".repeat(ESTIMATED_LINE_CHARS * 7),
			"para\n\nthe second paragraph is a bit longer",
		]) {
			for (const hasActions of [true, false]) {
				expect(estimateResponseHeight(text, hasActions)).toBe(
					estimateMessageHeight(
						{ role: "assistant", content: text },
						hasActions,
					),
				);
			}
		}
	});
});

/**
 * Ownership of the geometry: is each value in one place, and does each slot read the value meant
 * for it?
 *
 * This kind of rule cannot be checked by value, so the test scans source. Both constants have the
 * same type (number), so swapping them still compiles, and a screen that picked the wrong one is
 * off by a few pixels with no error at all. What is checked is the policy, not the render output
 * (this repo's web tests do not render React).
 */
describe("geometry ownership", () => {
	/**
	 * Source with comments stripped.
	 *
	 * Comments in this repo state what must **not** be done, by naming it. For example, the
	 * `ActionsReserve` note names `MESSAGE_ACTIONS_RESERVE_PX` as something not to use. Scanning the
	 * raw source would flag that note as a violation, and the quickest fix would then be to delete the
	 * note.
	 */
	const read = (file: string) =>
		readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8")
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/(^|[^:])\/\/.*$/gm, "$1");

	/*
	 * The placeholder's reserve cell sits **inside a parent that already has the gap**. Writing `gap +
	 * action row` here would count the gap twice, which is the defect this slice fixed.
	 */
	it("the placeholder leaves only the action row's physical height", () => {
		const source = read("./chat-skeleton.tsx");
		expect(source).toContain("MESSAGE_ACTION_BAR_HEIGHT_PX");
		expect(source).not.toContain("MESSAGE_ACTIONS_RESERVE_PX");
	});

	/*
	 * In contrast, the streaming response's reserve cell is a **sibling outside `MessageRow`**, so no
	 * gap is added automatically. It has to provide its own spacing within its flow, so it reads the
	 * full cost.
	 */
	it("the in-progress reservation uses the cost including the gap", () => {
		const source = read("./messages/list.tsx");
		expect(source).toContain("MESSAGE_ACTIONS_RESERVE_PX");
		expect(source).not.toContain("MESSAGE_ACTION_BAR_HEIGHT_PX");
	});

	/*
	 * Is there one line-counting rule? If the stored message and the streaming response each started
	 * counting on their own, the same text would estimate differently in the two states, and the
	 * conversation would jump by that difference in the frame where the response is confirmed.
	 */
	it("one place counts prose lines", () => {
		for (const file of [
			"./messages/list.tsx",
			"./messages/row.tsx",
			"./chat-skeleton.tsx",
		]) {
			expect(read(file)).not.toContain('split("\\n")');
		}
	});

	/*
	 * This module is the only dimension source the server-rendered placeholder carries
	 * (`ChatSkeleton`). If a browser API or React reaches it, the server bundle ends up carrying that
	 * code.
	 */
	it("the dimension module is safe on the server", () => {
		const source = read("./chat-geometry.ts");
		// Only a type import is allowed. No value imports.
		expect(source).not.toMatch(/^import (?!type )/m);
		for (const forbidden of ["window.", "document.", "useState", "useEffect"]) {
			expect(source).not.toContain(forbidden);
		}
	});
});

describe("composer geometry", () => {
	/*
	 * Does the outer layer respect the safe area? If the composer sat under the home indicator, the
	 * send button could not be pressed. One constant holds that, and the placeholder uses the same
	 * value.
	 */
	it("the bottom padding follows the device safe area", () => {
		expect(COMPOSER_FRAME).toContain("env(safe-area-inset-bottom)");
	});

	it("sets no width; the reading column's width belongs to the caller", () => {
		expect(COMPOSER_FRAME).not.toContain("max-w");
		expect(COMPOSER_SURFACE).not.toContain("max-w");
	});

	/*
	 * The top solid rule disappeared when this surface was introduced. If it returns, the boundary
	 * between the conversation and the composer becomes two layers. It has in fact returned before: it
	 * survived on the placeholder.
	 */
	it("no rule separates conversation and input; the boundary is one rounded surface", () => {
		expect(COMPOSER_FRAME).not.toMatch(/\bborder-t\b/);
		expect(COMPOSER_SURFACE).not.toMatch(/\bborder-t\b/);
		/*
		 * The **value** of the radius is not locked. That is a typographic decision, and this rule still
		 * holds if it changes. What is locked is only that the surface is one and rounded.
		 */
		expect(COMPOSER_SURFACE).toMatch(/\brounded-\S+/);
	});

	/*
	 * The idle state must be **inside the surface**. The live states (focus and input) belong only to
	 * the real composer, but the receded state must also be drawn by the placeholder. Otherwise the
	 * background recedes once during hydration, which is exactly the kind of jump the placeholder
	 * exists to prevent.
	 */
	it("the surface has an idle state but no focus state", () => {
		expect(COMPOSER_SURFACE).toMatch(/\bbg-muted\//);
		expect(COMPOSER_SURFACE).not.toContain("focus-within");
	});

	/**
	 * ⚠️ **iOS Safari zooms the page when an input whose text is smaller than 16px receives focus.**
	 *
	 * This screen is locked to the viewport (`viewportLocked`), so the zoom never reverts. The header
	 * and the composer are pushed outside the enlarged layout viewport, and the user sees "I tapped to
	 * type and the screen broke."
	 *
	 * There are two fixes, and we use only one. `user-scalable=no` (or `maximum-scale=1`) prevents the
	 * zoom but **also blocks pinch zoom**. Low-vision users would then be unable to enlarge any screen
	 * in this product, a cost that cannot be weighed against this problem. So the axis is reversed:
	 * make the text big enough that zoom is never needed.
	 *
	 * The value locked here is **a floor for narrow screens**. What wide screens use is a typographic
	 * decision (this behavior does not apply there), and locking it here would make taste look like a
	 * rule.
	 */
	it("input text on narrow screens does not go below 16px", () => {
		/*
		 * The default (no breakpoint) size must be `text-base` (1rem = 16px). Classes with an `sm:`
		 * prefix belong to wide screens and do not matter for this rule.
		 */
		const base = COMPOSER_FIELD_TEXT.split(/\s+/).filter(
			(token) => !token.includes(":"),
		);
		expect(base).toEqual(["text-base"]);
	});

	/*
	 * The field, not the button, must set the surface height. If the button did, whether the
	 * placeholder needs to draw the button or only the field would depend on the value.
	 */
	it("the input's minimum height exceeds the send button (size-10)", () => {
		expect(COMPOSER_FIELD_MIN_H).toBe("min-h-11");
	});
});

describe("prose typesetting", () => {
	/*
	 * Line height and the one-line estimate must be **the same value**. If they diverge, a long
	 * conversation's scrollbar drifts a little at a time, with a symptom so quiet that no one finds
	 * the cause. The two values share one file so that changing the typography also changes the
	 * estimate.
	 */
	it("line height matches the one-line estimate", () => {
		expect(ASSISTANT_PROSE).toContain(
			`leading-[${ESTIMATED_LINE_HEIGHT_PX / 16}rem]`,
		);
	});

	/*
	 * Observed first in Korean. The default (`normal`) breaks CJK at character boundaries, so words
	 * break at arbitrary points at line ends. A short English benchmark screen never shows this.
	 * Removing `break-words` to avoid it would let a single URL scroll the whole conversation
	 * horizontally.
	 */
	it("keeps words whole but wraps long tokens with no break point", () => {
		expect(ASSISTANT_PROSE).toContain("[word-break:keep-all]");
		expect(ASSISTANT_PROSE).toContain("break-words");
	});

	/*
	 * **The string and the rendered element can disagree.** Passing `break-keep` and `break-words` to
	 * `cn()` together makes tailwind-merge treat them as one group and drop the first. The string-only
	 * test above still passes. This actually leaked once, so the test checks by value that the rule
	 * survives the merge.
	 */
	it("the word-break rule survives class merging", () => {
		expect(cn(ASSISTANT_PROSE)).toContain("[word-break:keep-all]");
		expect(cn(ASSISTANT_PROSE, "text-muted-foreground")).toContain(
			"[word-break:keep-all]",
		);
	});

	/*
	 * Roleplay responses divide scenes with paragraphs and line breaks, and collapsing them erases the
	 * text's structure. Now that the body is markdown, preserving breaks **must not live on the outer
	 * box**. Markdown output places newline text nodes between its blocks. If the outer box preserves
	 * whitespace, every such newline becomes a blank line and each paragraph gets double spacing.
	 * Preservation belongs to the block that actually contains the text.
	 */
	it("line-break preservation belongs to the block, not the outer box", () => {
		expect(ASSISTANT_PROSE).not.toContain("whitespace-pre");
		expect(PROSE_SOFT_BREAKS).toBe("whitespace-pre-line");
	});

	/*
	 * The gap between paragraphs must be **exactly one line**, for two reasons. The first is
	 * typography: the old `whitespace-pre-wrap` drew each blank line of the source at one line's
	 * height, so using the same value means enabling markdown does not change the look of
	 * conversations already stored. The second is the estimate: `estimateTextLines` counts each blank
	 * line as one line, while markdown removes blank lines and draws this gap instead, so the estimate
	 * stays exact only when the two are equal.
	 */
	it("the gap between markdown blocks equals one line of prose", () => {
		expect(PROSE_BLOCK_GAP).toContain(
			`mt-[${ESTIMATED_LINE_HEIGHT_PX / 16}rem]`,
		);
		/* No gap above the first block. If there were, every line would drop by one line. */
		expect(PROSE_BLOCK_GAP).toContain("first:mt-0");
	});
});
