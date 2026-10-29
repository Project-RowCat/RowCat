import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Locks the wiring of the recovery notice, which the type system cannot check.
 * - Mistakes here are silent and pass both compile and render: a notice that grows into a dialog
 *   blocks editing, a restore run from an effect writes values the user never chose, and swapped
 *   column names make the discard button drop the value the user meant to recover.
 * - The rules are tested elsewhere: what is kept (`@rowcat/authoring` pure tests), save and
 *   atomicity (`lib/local-sync/recovery.test.ts`), restore (`lib/local-recovery/store.test.ts`).
 * - This file checks only that the screen actually passes through those rules.
 */

const read = (name: string): string =>
	readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const notice = stripComments(read("./recovery-notice.tsx"));
const editor = stripComments(read("./page.tsx"));

describe("the notice does not interrupt", () => {
	it("draws nothing without a copy", () => {
		/**
		 * Do not keep an empty placeholder slot. It would become background, and it would go unread when
		 * a notice actually appears.
		 */
		expect(notice).toMatch(/items\.length === 0\)\s*return null/);
	});

	it("opens no window from an effect, and does not restore automatically", () => {
		/**
		 * The only guarantee is that this file has no `useEffect`. If a layer appears the moment sync
		 * finishes, it is an interruption rather than a notice. A restore run from an effect would write
		 * values the user did not choose.
		 */
		expect(notice).not.toContain("useEffect");
		expect(notice).not.toMatch(/autoOpen|autoRestore|useLayoutEffect/);
	});

	it("the editor draws the notice as **one line above the body**", () => {
		expect(editor).toContain("<DraftRecoveryNotice draft={draft} />");
	});
});

describe("a person presses the actions", () => {
	it("restore and discard both live in click handlers", () => {
		const restore = notice.indexOf("restoreDraftConflict(");
		const discard = notice.indexOf(".discard(");
		expect(restore).toBeGreaterThan(-1);
		expect(discard).toBeGreaterThan(-1);
		expect(notice.lastIndexOf("onClick", restore)).toBeGreaterThan(-1);
		expect(notice.lastIndexOf("onClick", discard)).toBeGreaterThan(-1);
	});

	it("restore goes through the **shared restore rule**", () => {
		/**
		 * The screen must go through `restoreDraftConflict` rather than calling `updateDraft` directly. A
		 * direct call can skip the recovery-copy cleanup, or delete the copy before a failed update. The
		 * ordering rule lives in that one function, not scattered across the screen.
		 */
		expect(notice).toContain("restoreDraftConflict(");
		expect(notice).not.toMatch(/\.updateDraft\(/);
	});

	it("restore asks for confirmation, with copy from the shared vocabulary", () => {
		expect(notice).toContain("draftRecoveryRestoreConfirm(recovery.group)");
		expect(notice).toContain("setConfirming(true)");
	});
});

describe("copy and labels", () => {
	it("the screen does not invent the two column names", () => {
		expect(notice).toContain("draftRecoveryCopy().preservedColumn");
		expect(notice).toContain("draftRecoveryCopy().currentColumn");
	});

	it("the preserved and current values are not swapped", () => {
		/**
		 * The order is the whole check. Drawing `draft[field]` in the `preserved` column looks plausible,
		 * but the user then presses a button that discards the value they meant to recover.
		 */
		const preserved = notice.indexOf("draftRecoveryCopy().preservedColumn");
		const current = notice.indexOf("draftRecoveryCopy().currentColumn");
		const preservedValue = notice.indexOf("recovery.values[field]");
		const currentValue = notice.indexOf("draft[field]");
		expect(preserved).toBeLessThan(preservedValue);
		expect(preservedValue).toBeLessThan(current);
		expect(current).toBeLessThan(currentValue);
	});

	it("internal sync vocabulary does not appear on screen", () => {
		for (const word of [
			"fieldRev",
			"serverVersion",
			"authoring_draft_group_conflict",
			"HLC",
			"losingRev",
			"dirty",
		])
			expect(notice).not.toContain(word);
	});
});
