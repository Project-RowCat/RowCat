import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The one-line hint shown in an empty conversation. **It is a layer over the list, not part of the
 * list.**
 *
 * Giving this line a presence added one more thing to lock. Entering the flow would shorten the
 * list by its height (that cell's geometry belongs to the virtualizer), so the fact must also hold
 * **while it exits**: joining the flow during an exit makes the scroll offsets wrong at the moment
 * the first message arrives.
 *
 * Both screens (conversation and playtest) share this shape. Fixing only one is the most common
 * regression here, so the scan checks **both together**.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

const SURFACES = {
	chat: join(HERE, "chat-page.tsx"),
	playtest: join(HERE, "..", "playtest", "playtest-page.tsx"),
} as const;

const read = (path: string): string => readFileSync(path, "utf8");

/** Source with comments removed and whitespace collapsed to single spaces. */
const code = (path: string): string =>
	read(path)
		.replaceAll(/\/\*[\s\S]*?\*\//g, " ")
		.replaceAll(/(^|[^:])\/\/.*$/gm, "$1")
		.replaceAll(/\s+/g, " ");

/** The one element that draws this line. Both screens have a single `m.p`, and it carries a key. */
const hintElement = (path: string): string => {
	const source = code(path);
	const start = source.indexOf('<m.p key="');
	expect(start).toBeGreaterThan(-1);
	return source.slice(start, source.indexOf("</m.p>", start));
};

describe("the empty conversation line", () => {
	for (const [surface, path] of Object.entries(SURFACES)) {
		describe(surface, () => {
			/**
			 * This is the layer-outside-the-flow itself. Without this class the sentence starts taking up
			 * list height, and the conversation jumps once when the first utterance arrives.
			 */
			it("stays a layer outside the flow", () => {
				expect(hintElement(path)).toContain(
					"pointer-events-none absolute inset-0",
				);
			});

			/**
			 * Nothing to press and nothing to focus, so `pointer-events-none` alone is enough and
			 * `useExitGuard()` is not needed (the test `feedback.ts` records is exactly this). Once a link
			 * or button enters, this rhythm is the wrong one.
			 */
			it("holds nothing to press inside", () => {
				const element = hintElement(path);
				expect(element).not.toContain("<Link");
				expect(element).not.toContain("<Button");
				expect(element).not.toContain("onClick");
			});

			/**
			 * The presence **does not change the condition.** The condition that shows the line stays
			 * outside this element, and neither the first message nor the pending indicator waits for this
			 * exit. `mode="wait"` is precisely the wait that would create that.
			 */
			it("does not hold back what arrives", () => {
				const element = hintElement(path);
				expect(element).not.toContain("onAnimationComplete");
				expect(code(path)).not.toContain('AnimatePresence mode="wait"');
			});

			/**
			 * Exit has no movement. At that moment the just-sent utterance is arriving in this seat, and
			 * movement in both directions would blur what is arriving and what is leaving (the same judgment
			 * as `rowExit` and `feedbackExit`).
			 */
			it("only opacity changes on exit", () => {
				expect(hintElement(path)).toContain(
					"exit={{ opacity: 0, transition: exitTransition }}",
				);
			});

			/**
			 * The source of durations and curves is `lib/motion` alone. Milliseconds written here would not
			 * follow when a token changes (`lib/motion/feedback.test.ts` applies the rule to the whole app;
			 * here we check that it also covers this element).
			 */
			it("writes no rhythm of its own", () => {
				const element = hintElement(path);
				expect(element).toContain("transition={enterTransition}");
				expect(element).not.toMatch(/\bduration:/);
				expect(element).not.toMatch(/\bease:/);
			});
		});
	}

	/**
	 * The condition that shows it has not changed by a character. **It separates loading from an empty
	 * room.** While `loading` is true the list is drawing placeholders, and stacking "the conversation
	 * is empty" over them would claim the room has no record during the few milliseconds the store is
	 * read. It is also not drawn while generating (there is a real short window before the first
	 * utterance commits).
	 */
	it("the conversation screen's condition is unchanged", () => {
		const source = code(SURFACES.chat);
		expect(source).toContain(
			'{roomState.status === "ready" && !loading && rows.length === 0 && !generation.generating && (',
		);
	});

	/** The playtest has nothing to load, so it has no loading axis (`hasMore` is always false). */
	it("the playtest's condition is unchanged", () => {
		const source = code(SURFACES.playtest);
		expect(source).toContain(
			'const conversationEmpty = rows.length === 0 && !generation.generating && generation.streamingText === "";',
		);
		expect(source).toContain("{conversationEmpty && (");
	});
});
