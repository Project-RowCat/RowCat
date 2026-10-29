import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Pins by code shape that the server is the sole authority on reasoning capability.
 *
 * Web has the same check (`apps/web/src/features/generation/reasoning-boundaries.test.ts`); two
 * copies is the point, since one app alone guarding it shows the divergence only side by side.
 * Re-writing the rules here (hand-building the list or imitating the inheritance table) compiles
 * and renders plausibly, and only shows when the same room is opened on two devices.
 */

const REPO = fileURLToPath(new URL("../../../../../..", import.meta.url));

const strip = (source: string): string =>
	source
		.replaceAll(/\/\*[\s\S]*?\*\//g, " ")
		.replaceAll(/(^|[^:])\/\/.*$/gm, "$1");

const codeOf = (path: string): string =>
	strip(readFileSync(join(REPO, path), "utf8"));

/** Every mobile screen that handles reasoning effort. */
const SURFACES = [
	"apps/mobile/src/features/chat/generation/reasoning-effort-select.tsx",
	"apps/mobile/src/features/chat/room-settings/generation.tsx",
	"apps/mobile/src/features/settings/generation-defaults-section.tsx",
	"apps/mobile/src/features/playtest/playtest-settings-dialog.tsx",
];

describe("the screen doesn't guess capabilities", () => {
	it.each(SURFACES)("%s has no model-name branching", (path) => {
		const code = codeOf(path);
		expect(code).not.toMatch(/\bgpt-/);
		expect(code).not.toMatch(/\bclaude-/);
		expect(code).not.toMatch(/\bgemini-/);
	});

	it.each(SURFACES)("%s has no provider parameters", (path) => {
		const code = codeOf(path);
		expect(code).not.toMatch(/budget_tokens|thinkingBudget|reasoning_effort/);
		expect(code).not.toMatch(/\bthinking\b/);
	});

	/** The shared module owns both the list and the inheritance decision. */
	it.each(
		SURFACES.slice(1),
	)("%s goes through the shared list function", (path) => {
		expect(codeOf(path)).toContain("buildReasoningOptions");
	});

	it("the control doesn't draw the whole vocabulary", () => {
		const code = codeOf(SURFACES[0] as string);
		expect(code).not.toMatch(/REASONING_EFFORTS\b/);
	});
});

describe("the cleanup rule is shared", () => {
	/**
	 * One pure function owns erasing overrides that became unusable when the target changed. If a
	 * screen wrote `efforts.includes(...)` itself, web and mobile would erase at different moments.
	 */
	it.each(
		SURFACES.slice(1),
	)("%s goes through the shared cleanup function", (path) => {
		const code = codeOf(path);
		expect(code).toContain("reconcileReasoningOverride");
		expect(code).not.toMatch(/efforts\.includes/);
	});
});

/**
 * No path where a parent layer changes the target leaves an override unreconciled.
 *
 * `reconcileReasoningOverride` runs only when this layer's model picker is pressed. When a room
 * inherits its target and the global changes, that picker was never pressed, so the room's override
 * stays stored as an unusable value: the screen draws that tier while execution runs another.
 *
 * Web has the same check for the same reason: guarded in one app only, the same room of the same
 * account runs at different tiers on two devices.
 */
describe("cleanup happens even when the inherited target changes from outside", () => {
	it.each(SURFACES.slice(1))("%s cleans up stale overrides", (path) => {
		expect(codeOf(path)).toContain("useStaleReasoningReconcile");
	});

	/** Judged on the effective target; looking only at this layer's override never catches a room that inherits. */
	it.each(SURFACES.slice(1))("%s passes the effective target", (path) => {
		const call = /useStaleReasoningReconcile\(\{[\s\S]*?\}\);/.exec(
			codeOf(path),
		)?.[0];
		expect(call).toBeDefined();
		expect(call).toMatch(/target:.*\?\?/);
	});

	/** Only the reasoning axis is erased. */
	it.each(
		SURFACES.slice(1),
	)("%s's cleanup doesn't touch other axes", (path) => {
		const call = /useStaleReasoningReconcile\(\{[\s\S]*?\}\);/.exec(
			codeOf(path),
		)?.[0];
		expect(call).not.toContain("responseLength");
	});

	/**
	 * The rule is still one shared pure function; re-writing `efforts.includes(...)` here would make
	 * the two apps erase the user's setting at different moments.
	 */
	it("the cleanup hook goes through the shared decision and always writes null", () => {
		const code = codeOf(
			"apps/mobile/src/features/generation/use-stale-reasoning-reconcile.ts",
		);
		expect(code).toContain("reasoningOverrideStale");
		expect(code).toMatch(/persist\(null\)/);
		expect(code).not.toMatch(/efforts\.includes/);
	});
});

describe("the settings' save semantics don't change", () => {
	it.each(SURFACES)("%s has no save button", (path) => {
		expect(codeOf(path)).not.toContain("Save settings");
	});
});
