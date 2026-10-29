import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Locks the recovery notice's wiring: web's rules, checked on this platform. Only the container
 * differs (both use `Dialog`, with different geometry). Three things must not diverge: the notice
 * does not intrude, a person presses the actions, and the two columns' labels are not swapped. All
 * three pass compilation and rendering when wrong.
 */

const read = (name: string): string =>
	readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const notice = stripComments(read("./draft-recovery-notice.tsx"));
const editor = stripComments(read("./draft-editor-screen.tsx"));

describe("the notice doesn't interrupt", () => {
	it("draws nothing without a copy", () => {
		expect(notice).toMatch(/items\.length === 0\)\s*return null/);
	});

	it("doesn't open a dialog from an effect — and no automatic restore", () => {
		expect(notice).not.toContain("useEffect");
		expect(notice).not.toMatch(/autoOpen|autoRestore|useLayoutEffect/);
	});

	it("the editor draws the notice **above** the sections", () => {
		const index = editor.indexOf("<DraftRecoveryNotice");
		expect(index).toBeGreaterThan(-1);
		expect(index).toBeLessThan(editor.indexOf("<BasicsSection"));
	});

	it("the notice looks at the stored record — not the overlay", () => {
		/**
		 * The overlay (`view`) is unsaved input; comparing it with the preserved copy makes "current
		 * content" differ from the stored value, so the user would judge restoring against a sentence
		 * just typed.
		 */
		expect(editor).toContain("<DraftRecoveryNotice draft={draft ?? view} />");
	});
});

describe("container", () => {
	it("a dialog, not a sheet", () => {
		/**
		 * This is a small read-and-decide management screen, not a short single choice (presentation
		 * table in `docs/design/ARCHITECTURE.md`). A generic sheet is not expressible in feature code,
		 * but forcing the choice capability is the same mistake.
		 */
		expect(notice).toContain("<Dialog");
		expect(notice).not.toMatch(/ChoiceSheet|<Sheet/);
	});
});

describe("people press the operations", () => {
	it("restore and discard are both inside press handlers", () => {
		const restore = notice.indexOf("restoreDraftConflict(");
		const discard = notice.indexOf(".discard(");
		expect(restore).toBeGreaterThan(-1);
		expect(discard).toBeGreaterThan(-1);
		expect(notice.lastIndexOf("onPress", restore)).toBeGreaterThan(-1);
		expect(notice.lastIndexOf("onPress", discard)).toBeGreaterThan(-1);
	});

	it("restore goes through **the shared restore rule**", () => {
		expect(notice).toContain("restoreDraftConflict(");
		expect(notice).not.toMatch(/\.updateDraft\(/);
	});

	it("restore has a confirmation whose copy comes from the shared vocabulary", () => {
		expect(notice).toContain("draftRecoveryRestoreConfirm(recovery.group)");
		expect(notice).toContain("setConfirming(true)");
	});
});

describe("copy and labels", () => {
	it("this app doesn't rewrite the copy", () => {
		/**
		 * Both apps must make the same promise ("other parts stay as they are" is an invariant this
		 * feature really keeps). Written per app, a fix on one side leaves a platform promising something
		 * it does not keep.
		 */
		expect(notice).toContain("DRAFT_RECOVERY_COPY");
		expect(notice).not.toMatch(/"Kept edits"|"Restore this version"/);
	});

	it("the kept value and the current value aren't swapped", () => {
		const preserved = notice.indexOf("DRAFT_RECOVERY_COPY.preservedColumn");
		const current = notice.indexOf("DRAFT_RECOVERY_COPY.currentColumn");
		const preservedValue = notice.indexOf("recovery.values[field]");
		const currentValue = notice.indexOf("draft[field]");
		expect(preserved).toBeLessThan(preservedValue);
		expect(preservedValue).toBeLessThan(current);
		expect(current).toBeLessThan(currentValue);
	});

	it("internal sync vocabulary doesn't appear on screen", () => {
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
