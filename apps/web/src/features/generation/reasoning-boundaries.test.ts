import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Locks, through the shape of the code, that the authority for reasoning capability is the server
 * alone. Value tests lock what is drawn now. These tests block the code the next person would
 * naturally write:
 * - Guessing capability from the model id: every new model would need a frontend change, and a
 *   missed deploy would draw an entry that does not run.
 * - Branching on company or provider name: models from one company can differ in capability.
 * - The screen knowing budget numbers: provider parameters would rise into the product layer and
 *   go stale when a model cap changes.
 * - A save button: there is no transaction across two stores, so a partial success would be
 *   reported as success. None of these throw errors. The first three show up only in the nature of
 *   the responses; the fourth reports an unsaved value as saved.
 *
 * Comments are excluded from the scan. Comments in these files mention `thinking` and
 * `budget_tokens`, and they explain why those are not used here, so they are the rationale to keep.
 */

const REPO = fileURLToPath(new URL("../../../../..", import.meta.url));

const strip = (source: string): string =>
	source
		.replaceAll(/\/\*[\s\S]*?\*\//g, " ")
		.replaceAll(/(^|[^:])\/\/.*$/gm, "$1");

const codeOf = (path: string): string =>
	strip(readFileSync(join(REPO, path), "utf8"));

/**
 * Every web surface the reasoning effort passes through. A file that touches this axis but is
 * missing from this list means the boundary was drawn wrong.
 */
const SURFACES = [
	"apps/web/src/features/generation/reasoning-effort-field.tsx",
	"apps/web/src/features/generation/use-reasoning-reconcile.ts",
	"apps/web/src/features/chat/room-settings/generation.tsx",
	"apps/web/src/features/settings/generation-defaults.tsx",
	"apps/web/src/features/playtest/playtest-inspector.tsx",
];

describe("screens do not guess capability", () => {
	/**
	 * Once branching happens on model identity, the catalog loses authority. That is why the server
	 * sends capabilities, and the judgment lives in one pure module (`buildReasoningOptions`).
	 */
	it.each(SURFACES)("%s has no branch on model names", (path) => {
		const code = codeOf(path);
		expect(code).not.toMatch(/\bgpt-/);
		expect(code).not.toMatch(/\bclaude-/);
		expect(code).not.toMatch(/\bgemini-/);
		expect(code).not.toMatch(/\bdeepseek/);
	});

	/** Branching on provider or company name is the same mistake: models from one company differ. */
	it.each(SURFACES)("%s has no branch on provider or company", (path) => {
		const code = codeOf(path);
		expect(code).not.toMatch(/vendorLabel\s*===/);
		expect(code).not.toMatch(/providerLabel\s*===/);
		expect(code).not.toMatch(/provider\s*===\s*["']rowcat["']/);
	});

	/**
	 * Provider parameters must not rise into the product layer. Budget numbers belong to the execution
	 * boundary; if the screen knew them, this file would go stale the day the model limit changes.
	 */
	it.each(SURFACES)("%s has no provider parameters", (path) => {
		const code = codeOf(path);
		expect(code).not.toMatch(/budget_tokens|thinkingBudget|reasoning_effort/);
		expect(code).not.toMatch(/\bthinking\b/);
	});

	/** The screen does not write another copy of the step list. It uses what the server sent. */
	it("the control does not build the step list itself", () => {
		const code = codeOf(SURFACES[0] as string);
		expect(code).toContain("buildReasoningOptions");
		/** Drawing the full vocabulary would list steps that the model does not have. */
		expect(code).not.toMatch(/REASONING_EFFORTS\b/);
	});
});

describe("the save meaning of settings does not change", () => {
	/**
	 * Changes are saved immediately. The three axes are used at different moments and no transaction
	 * spans them, so a single commit button would report partial success as success.
	 */
	it.each(SURFACES)("%s has no save button", (path) => {
		expect(codeOf(path)).not.toContain("Save settings");
	});
});

describe("inheriting is not copying", () => {
	/**
	 * If `Use default` copied the current inherited value on save, that layer would stop following the
	 * parent afterward. The symptom appears only later, when the default changes.
	 */
	it("the control does not send the inherited value up as is", () => {
		const code = codeOf(SURFACES[0] as string);
		expect(code).toMatch(/onChange\(\s*\n?\s*next === INHERIT_VALUE \? null/);
		expect(code).not.toMatch(/onChange\(\s*inherited/);
	});
});

describe("changing one axis does not touch another", () => {
	/**
	 * When the target changes, the only thing cleared is the reasoning axis. If the response length
	 * were cleared there too, changing the model would silently revert a length the user chose.
	 */
	it.each([
		SURFACES[2],
		SURFACES[3],
		SURFACES[4],
	] as string[])("%s's target change does not touch response length", (path) => {
		const code = codeOf(path);
		for (const match of code.matchAll(/reconcileReasoning\(\{[\s\S]*?\}\)/g))
			expect(match[0]).not.toContain("responseLength");
	});
});

/**
 * No path that changes the parent's target is left uncleared. `reconcileReasoning` runs only when
 * this layer's model selector is pressed. If a room inherits the target and the global target
 * changes, the room's selector is never pressed, so the room's override stays saved but becomes
 * unusable, and the screen draws that step while execution runs another.
 *
 * The hook that closes this window must be attached on all three screens. If one is missing, that
 * screen alone drifts, and the drift only shows when the two settings are viewed side by side.
 */
describe("cleaned up even when the inherited target changes elsewhere", () => {
	it.each([
		SURFACES[2],
		SURFACES[3],
		SURFACES[4],
	] as string[])("%s cleans up a stale override", (path) => {
		expect(codeOf(path)).toContain("useStaleReasoningReconcile");
	});

	/**
	 * Judge by the effective target. Judging by this layer's override alone would never evaluate a
	 * room that inherits, and that is exactly the room this window applies to.
	 */
	it.each([
		SURFACES[2],
		SURFACES[3],
		SURFACES[4],
	] as string[])("%s passes the effective target", (path) => {
		const code = codeOf(path);
		const call = /useStaleReasoningReconcile\(\{[\s\S]*?\}\);/.exec(code)?.[0];
		expect(call).toBeDefined();
		expect(call).toMatch(/target:.*\?\?/);
	});

	/** Clearing removes only the reasoning axis. The target and the response length remain. */
	it.each([
		SURFACES[2],
		SURFACES[3],
		SURFACES[4],
	] as string[])("%s's cleanup does not touch other axes", (path) => {
		const call = /useStaleReasoningReconcile\(\{[\s\S]*?\}\);/.exec(
			codeOf(path),
		)?.[0];
		expect(call).not.toContain("responseLength");
		expect(call).toMatch(/persist:/);
	});

	/**
	 * Do not move the value to another step. Clearing returns the axis to inheritance. Moving it would
	 * save a value the user never chose as their explicit choice.
	 */
	it("the cleanup hook always writes null", () => {
		const code = codeOf(SURFACES[1] as string);
		expect(code).toMatch(/persist\(null\)/);
		expect(code).toContain("reasoningOverrideStale");
	});
});

/** Keeps this file from going stale: if a path disappears, the test breaks here first. */
describe("the target list exists", () => {
	it.each(SURFACES)("%s exists", (path) => {
		expect(codeOf(path).length).toBeGreaterThan(0);
	});
});
