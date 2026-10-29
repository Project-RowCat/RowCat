import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { shouldBlockLeave } from "./leave.ts";
import type { AutosaveSnapshot } from "./use-autosave.ts";

/**
 * Whether the editor may be left. The decision can be wrong in two directions:
 * - Blocking too much: a dialog appears on navigation after normal typing, and it soon stops
 *   being read.
 * - Blocking too little: edits the screen already reported as failed disappear on a single
 *   navigation.
 *
 * Both must be checkable without rendering, so the decision is one pure function and this file runs
 * its full table.
 */

const snapshot = (patch: Partial<AutosaveSnapshot> = {}): AutosaveSnapshot => ({
	status: "idle",
	pending: false,
	...patch,
});

describe("when not blocking", () => {
	it("leaves freely when nothing was done", () => {
		expect(shouldBlockLeave(snapshot())).toBe(false);
	});

	it("leaves freely once saved", () => {
		expect(shouldBlockLeave(snapshot({ status: "saved" }))).toBe(false);
	});

	/**
	 * A plain debounce must not block. A confirmation every 500ms is exactly what this slice avoids;
	 * the unmount's final flush writes that pending change.
	 */
	it("does not block while waiting on the debounce", () => {
		expect(
			shouldBlockLeave(snapshot({ status: "pending", pending: true })),
		).toBe(false);
	});

	it("does not block while a save is running", () => {
		expect(
			shouldBlockLeave(snapshot({ status: "saving", pending: true })),
		).toBe(false);
	});

	/**
	 * Failures with nothing at stake do not block. Blocking on the status label alone would force a
	 * choice in front of a dialog that protects nothing, because the change was discarded (ownership
	 * transferred).
	 */
	it("does not block when failed but nothing is pending", () => {
		expect(shouldBlockLeave(snapshot({ status: "error" }))).toBe(false);
	});
});

describe("when blocking", () => {
	/**
	 * A confirmed failure plus unwritten edits still pending is the only combination where
	 * irreversible loss is at stake.
	 */
	it("blocks when failed with pending changes left", () => {
		expect(shouldBlockLeave(snapshot({ status: "error", pending: true }))).toBe(
			true,
		);
	});

	/**
	 * Lifted as soon as a retry succeeds. This is what lets the dialog call proceed(), and it is why
	 * the next navigation is not blocked again.
	 */
	it("does not block after a successful retry", () => {
		expect(shouldBlockLeave(snapshot({ status: "saved" }))).toBe(false);
	});

	/** Also lifted after discarding: discard() sets the status back to idle and empties the queue. */
	it("does not block after discarding", () => {
		expect(shouldBlockLeave(snapshot({ status: "idle" }))).toBe(false);
	});
});

/**
 * A correct table protects nothing if nothing calls it. That gap is silent: the editor renders and
 * saves work as usual, and the only symptom appears after someone whose IndexedDB really failed
 * moves to another screen.
 */
/**
 * Strips comments before scanning, so only code is checked. Comments in this repo name the rules
 * they describe (for example, that popstate is not intercepted), and scanning raw text would flag
 * that sentence as a violation of itself. Rewording comments to satisfy the check would bend the
 * documentation to the test.
 */
const read = (name: string): string =>
	readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

describe("wiring", () => {
	it("the editor mounts the navigation guard", () => {
		expect(read("./page.tsx")).toContain(
			"<DraftLeaveGuard autosave={autosave} />",
		);
	});

	it("uses the router's blocker", () => {
		const source = read("./leave-guard.tsx");
		expect(source).toContain("useBlocker(");
		expect(source).not.toMatch(/\bpopstate\b/);
		expect(source).not.toMatch(/history\.pushState|history\.back\(/);
	});

	it("discarding comes before navigating", () => {
		const source = read("./leave-guard.tsx");
		const discard = source.indexOf("autosave.discard()");
		const proceed = source.indexOf("blocker.proceed()", discard);
		expect(discard).toBeGreaterThan(-1);
		expect(proceed).toBeGreaterThan(discard);
	});

	it("the dialog does not call the store directly", () => {
		const source = read("./leave-guard.tsx");
		expect(source).toContain("autosave.flush()");
		expect(source).not.toMatch(/updateDraft|updateLore|updateStartScene/);
	});
});
