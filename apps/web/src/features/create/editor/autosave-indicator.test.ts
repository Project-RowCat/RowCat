import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { autosaveIndicatorView } from "./autosave-indicator.ts";
import type { AutosaveSnapshot, AutosaveStatus } from "./use-autosave.ts";

/**
 * The save indicator's accessibility contract. It can be wrong in two directions, and both fail
 * silently:
 * - Announcing too much interrupts assistive technology throughout typing, so real failures go
 *   unheard in that noise.
 * - Announcing too little means people who cannot see red text or the retry button never learn
 *   that a save failed. The web tests in this repository do not render React. If the decision lived
 *   in the component, the only check would be listening by hand, so the table is a pure function
 *   and is tested as a whole.
 */

const snapshot = (patch: Partial<AutosaveSnapshot> = {}): AutosaveSnapshot => ({
	status: "idle",
	pending: false,
	...patch,
});

/** The four non-failure statuses stay quiet, whether or not changes are pending. */
const QUIET: AutosaveStatus[] = ["idle", "pending", "saving", "saved"];

describe("quiet states", () => {
	it.each(QUIET)("%s is not an alert", (status) => {
		expect(autosaveIndicatorView(snapshot({ status })).announce).toBe(false);
	});

	/**
	 * Pending changes alone are not announced. Waiting for the debounce and a write in progress are
	 * the statuses in question, and both are the normal path of typing.
	 */
	it.each(QUIET)("%s stays quiet even with pending changes", (status) => {
		expect(
			autosaveIndicatorView(snapshot({ status, pending: true })).announce,
		).toBe(false);
	});
});

describe("failure", () => {
	it("shows as an alert", () => {
		expect(autosaveIndicatorView(snapshot({ status: "error" })).announce).toBe(
			true,
		);
	});

	/**
	 * Failures are announced even with nothing to lose. The user has no action left to take, but it
	 * remains true that the sentence they just typed has not been saved to this device.
	 */
	it("speaks even with no pending changes", () => {
		expect(
			autosaveIndicatorView(snapshot({ status: "error", pending: false }))
				.announce,
		).toBe(true);
	});

	/** There must be an actual sentence to read. An empty announcement says nothing. */
	it("has a sentence to read", () => {
		expect(
			autosaveIndicatorView(snapshot({ status: "error" })).label.length,
		).toBeGreaterThan(0);
	});
});

describe("try again", () => {
	/** A confirmed failure plus unsaved edits is the only combination with something to press. */
	it("stands only when failed with pending changes left", () => {
		expect(
			autosaveIndicatorView(snapshot({ status: "error", pending: true }))
				.retryable,
		).toBe(true);
	});

	it("does not stand without pending changes", () => {
		expect(autosaveIndicatorView(snapshot({ status: "error" })).retryable).toBe(
			false,
		);
	});

	it.each(QUIET)("does not stand in %s even with pending changes", (status) => {
		expect(
			autosaveIndicatorView(snapshot({ status, pending: true })).retryable,
		).toBe(false);
	});
});

/**
 * The table can be right, but if **the component renders differently** it protects nothing. That
 * divergence is silent: the screen draws normally, and only assistive technology users discover it.
 * Comments are stripped before scanning. This follows `draft-leave.test.ts`: comments here name the
 * rule by its own name, so scanning the raw text would make the sentences report themselves as
 * violations.
 */
const read = (name: string): string =>
	readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

describe("wiring", () => {
	const source = read("./page.tsx");

	it("the indicator goes through the pure decision", () => {
		expect(source).toContain("autosaveIndicatorView(");
		// The branch condition must not be written again beside the markup. The test checks that the
		// source does not repeat it.
		expect(source).not.toMatch(/status === "error"/);
	});

	/**
	 * **No general live region.** If `role="status"` or `aria-live` appears in this file, `pending`,
	 * `saving`, and `saved` all start being read aloud. That noise is exactly what this slice avoids.
	 */
	it("has no general live region", () => {
		expect(source).not.toMatch(/aria-live/);
		expect(source).not.toMatch(/role="status"/);
	});

	it("only the failure text is an alert", () => {
		expect(source).toMatch(/announce \?[\s\S]{0,200}role="alert"/);
	});

	/**
	 * **The two branches are separate nodes.** If only attributes on one node change, assistive
	 * technology does not treat the change as a new alert, so a second failure would go silent and an
	 * old alert would linger during `saving`.
	 */
	it("the alert and normal branches have different keys", () => {
		const keys = [...source.matchAll(/<span key="([^"]+)"/g)].map(
			(match) => match[1],
		);
		expect(keys).toHaveLength(2);
		expect(new Set(keys).size).toBe(2);
	});

	/**
	 * **No hidden copy.** The visible sentence already says the same thing, so an `sr-only` line would
	 * read the same fact twice.
	 */
	it("has no screen-reader-only copy", () => {
		expect(source).not.toMatch(/sr-only/);
	});

	/** **No second write path.** Retry goes through the existing autosave machinery. */
	it("the indicator does not call the store directly", () => {
		expect(source).toContain("autosave.flush()");
		expect(source).not.toMatch(/updateDraft|updateLore|updateStartScene/);
	});

	/**
	 * **The subscription boundary stays as it is.** If the editor body read the save state, every save
	 * would re-render the whole tree three times, for a change that touches only a few characters
	 * here.
	 */
	it("one component subscribes to save state", () => {
		expect([...source.matchAll(/useAutosaveState\(/g)]).toHaveLength(1);
	});

	/**
	 * **A failure is not announced twice.** The alert shown during editing and the warning shown when
	 * leaving are separate events. A toast in between would state the same failure in three places.
	 */
	it("raises no toast", () => {
		expect(source).not.toMatch(/showErrorToast|toast/i);
	});
});
