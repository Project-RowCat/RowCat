import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Statically checks which mechanism drives the three feedback spots on the Create screen. The test
 * checks policy, not the styles Motion produces (same rule as lib/motion/*.test.ts). Asserting
 * interpolated transform strings would break on every library upgrade without protecting the
 * project's rules. The motion itself is checked in the browser. The four mistakes this file catches
 * are all silent:
 * - Confirmation state moves back into row-local state. The rows below drop without motion, with
 *   no type or render error.
 * - The trigger moves inside the presence wrapper. The last column collapses during confirmation
 *   and loses its return place.
 * - An exiting confirmation stays live. A closed confirmation's delete can be pressed or reached
 *   by tab.
 * - Height is interpolated. Layout is recalculated for the whole duration of the animation.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const read = (name: string) => readFileSync(join(HERE, name), "utf8");

/**
 * Source with comments removed before matching. Comments in this repo name the rules they describe,
 * so a match inside a comment would pass a check by accident.
 */
const code = (text: string) =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Matches an opening JSX tag that spans several lines. Biome indents with tabs, so a multi-line tag
 * ends with `>` at the same depth as its opening line (same convention as editor-layout.test.ts).
 */
function openingTag(source: string, name: string): string {
	const lines = source.split("\n");
	const start = lines.findIndex((line) =>
		new RegExp(`^\\t*<${name.replace(".", "\\.")}$`).test(line),
	);
	expect(start, `<${name}> not found; the scan is stale`).toBeGreaterThan(-1);
	const indent = /^(\t*)/.exec(lines[start] ?? "")?.[1] ?? "";
	const end = lines.findIndex(
		(line, at) => at > start && line === `${indent}>`,
	);
	expect(end, `end of <${name}> not found`).toBeGreaterThan(start);
	return lines.slice(start, end + 1).join("\n");
}

/** Body of a named function, up to the next top-level declaration. */
function functionBody(source: string, name: string): string {
	const start = source.indexOf(`function ${name}(`);
	expect(start, `${name} not found; the scan is stale`).toBeGreaterThan(-1);
	const rest = source.slice(start + 1);
	const next = rest.search(/\n(?:export )?(?:function|const) /);
	return next < 0 ? rest : rest.slice(0, next);
}

describe("draft delete confirmation", () => {
	const source = read("drafts/list.tsx");
	const clean = code(source);

	/**
	 * The open confirmation is owned by the list. Moving it back to row-local state is the most likely
	 * regression, since that was the original shape. The rows below would then drop without knowing
	 * they moved, because Motion re-measures geometry only for re-rendered nodes. There is no error or
	 * warning.
	 */
	it("the list holds the open confirmation", () => {
		expect(clean).toMatch(/const \[confirmingId, setConfirmingId\] = useState/);
		expect(clean).toMatch(/confirming=\{confirmingId === draft\.id\}/);
	});

	it("the row only receives that value and does not recreate it as its own state", () => {
		expect(functionBody(clean, "DraftRow")).not.toMatch(/useState/);
	});

	/** For sibling rows to flow when one collapses, the exit render must reach the whole group. */
	it("the list is one group", () => {
		expect(clean).toContain("<LayoutGroup>");
	});

	/**
	 * The trigger must stay in place while the confirmation is open. Inside the presence wrapper, the
	 * last column would collapse during confirmation and shake the earlier columns. A user who opened
	 * it by keyboard would also lose the place to return to.
	 */
	it("the trigger states open/closed outside the presence", () => {
		expect(clean).toMatch(/aria-expanded=\{confirming\}/);
		expect(functionBody(clean, "DraftDeleteConfirm")).not.toMatch(
			/aria-expanded/,
		);
	});

	it("delete and cancel exist only while the confirmation is open", () => {
		const confirm = functionBody(clean, "DraftDeleteConfirm");
		expect(confirm).toContain('t("common:actions.delete")');
		expect(confirm).toContain('t("common:actions.cancel")');
		// The row itself has no delete action. The confirmation is mounted only while open.
		expect(functionBody(clean, "DraftRow")).toMatch(
			/<AnimatePresence initial=\{false\}>[\s\S]*<DraftDeleteConfirm/,
		);
	});

	/**
	 * An exiting confirmation is neither pressable nor reachable by tab. pointer-events alone is only
	 * half the fix: a closed confirmation's delete button staying in tab order is the same mistake. On
	 * a tab that receives no frames, the exit window is unbounded rather than 120ms.
	 */
	it("an exiting confirmation can be neither pressed nor tabbed to", () => {
		const confirm = functionBody(clean, "DraftDeleteConfirm");
		expect(confirm).toContain("useExitGuard()");
		expect(confirm).toMatch(/style=\{exiting\}/);
		expect(confirm).toMatch(/inert=\{exiting !== undefined\}/);
	});

	/** Timing comes from the row's shared values. It is not recomputed here. */
	it("the rhythm comes from shared values", () => {
		const confirm = functionBody(clean, "DraftDeleteConfirm");
		expect(confirm).toMatch(/initial=\{rowEnter\.initial\}/);
		expect(confirm).toMatch(/animate=\{rowEnter\.animate\}/);
		expect(confirm).toMatch(/exit=\{rowExit\}/);
	});

	/** A failure replaces the hint. The slot is single, so the two never show together. */
	it("a failure replaces the hint", () => {
		expect(functionBody(clean, "DraftDeleteConfirm")).toMatch(
			/\{failure \? \([\s\S]*role="alert"[\s\S]*\) : \([\s\S]*notice &&/,
		);
	});

	/** The row only animates its position. Interpolating size would stretch the text inside it. */
	it("the row's motion shell only carries position", () => {
		expect(functionBody(clean, "DraftLibraryRow")).toContain(
			'layout="position"',
		);
	});
});

describe("published story transition state", () => {
	const clean = code(read("publishing/lifecycle-controls.tsx"));
	const status = functionBody(clean, "WorkLifecycleStatus");

	/**
	 * One result slot that alternates between states. If in-progress and failure overlap for a frame,
	 * the card would jump by two lines.
	 */
	it("results alternate in one slot", () => {
		expect(status).toContain('<AnimatePresence initial={false} mode="wait">');
		expect(status).toMatch(/key="pending"/);
		expect(status).toMatch(/key="failure"/);
	});

	it("in-progress uses that transition's own wording", () => {
		expect(status).toContain("workLifecyclePendingLabel(lifecycle.running)");
	});

	/** A failure is the answer to the user's action. The animation must not strip that role. */
	it("a failure keeps its role", () => {
		expect(status).toMatch(/key="failure"[\s\S]*role="alert"/);
	});

	/** Success has no line of its own. The changed card is the result. */
	it("makes no line announcing success", () => {
		expect(status).not.toMatch(/succeeded|success|done/i);
	});

	/**
	 * The absence of optimistic updates is a value this slice does not change. A briefly drawn
	 * optimistic state would claim the work is no longer public, and someone could leave trusting it.
	 */
	it("no optimistic transition appeared", () => {
		expect(clean).not.toMatch(/setQueryData|onMutate/);
	});
});

describe("scene image feedback", () => {
	const source = read("editor/sections/scene-image-list.tsx");
	const clean = code(source);

	it("an upload failure attaches and detaches", () => {
		expect(clean).toMatch(
			/<AnimatePresence initial=\{false\}>\s*\{failure && \(/,
		);
		expect(clean).toMatch(/initial=\{feedbackEnter\.initial\}/);
		expect(clean).toMatch(/exit=\{feedbackExit\}/);
	});

	/**
	 * The duplicate warning flips while the user types, so it does not move. A `y` offset would shift
	 * the sentence up and down on every keystroke.
	 */
	it("the overlap warning only changes opacity", () => {
		const warning = /\{duplicate && \([\s\S]*?\)\}/.exec(clean)?.[0] ?? "";
		expect(warning).toContain("initial={{ opacity: 0 }}");
		expect(warning).toContain(
			"exit={{ opacity: 0, transition: exitTransition }}",
		);
		expect(warning).not.toMatch(/\by:/);
		expect(warning).not.toMatch(/scale/);
	});

	/**
	 * The row convention stays the same: reposition and exit only, with no entrance animation (same
	 * rule as the lore and opening-scene screens). A newly uploaded picture simply becomes part of the
	 * list.
	 */
	it("rows gained no entrance animation", () => {
		const article = openingTag(clean, "m.article");
		expect(article).toContain('layout="position"');
		expect(article).toContain("exit={rowExit}");
		expect(article).not.toMatch(/\binitial=/);
	});
});

describe("height is not interpolated", () => {
	/**
	 * The listed files must not animate height. docs/motion/ARCHITECTURE.md deliberately leaves height
	 * out of every placement. Animating it recalculates the surrounding layout for the whole
	 * animation, which reads slower on text-heavy surfaces. The state takes its final geometry
	 * immediately, and the content arrives inside it with opacity and a few pixels of movement.
	 */
	it.each([
		"drafts/list.tsx",
		"publishing/lifecycle-controls.tsx",
		"editor/sections/scene-image-list.tsx",
	])("%s", (name) => {
		expect(code(read(name))).not.toMatch(/\b(?:height|maxHeight):/);
	});
});
