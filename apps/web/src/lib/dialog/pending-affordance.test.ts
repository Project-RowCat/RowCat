import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Dialogs that cannot close while pending must not show an enabled X either. Static scan.
 *
 * The policy lives in a neighboring file (`dismiss.ts`). This check catches the state where the
 * policy and the drawn control say different things:
 *
 *   While pending: Cancel and inputs are disabled, but the top-right X looks enabled.
 *   Pressing it sends a close reason, shouldCloseDialog(..., true) refuses, and nothing
 *   happens.
 *
 * The data is safe. The defect is that the UI offers an action and then refuses it. The symptom is
 * neither an error nor a warning, so review does not catch it.
 *
 * The two boundaries therefore receive the same boolean, each with a different job:
 * - shouldCloseDialog(reason, pending): interaction policy, whether this dialog may close.
 * - closeButtonDisabled={pending}: control availability, whether the drawn X is pressable now.
 *
 * The first remains the enforcement. This check only guards that the enforcement is honestly shown
 * on screen. It fails both when the policy is removed while the X stays locked, and when the X is
 * locked with no policy behind it.
 *
 * The targets are not listed by hand. The condition is already in the source: any dialog that
 * passes pending to the policy is a target, so adding one needs no change to this file. A dialog
 * with no in-progress state (a plain confirm) is not a target.
 */

const FEATURES = fileURLToPath(new URL("../../features", import.meta.url));

function tsx(dir: string, files: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) tsx(full, files);
		else if (entry.name.endsWith(".tsx")) files.push(full);
	}
	return files;
}

/**
 * Source with comments removed. Comments in this repo name rules by their names, so explanatory
 * sentences would be scanned too, and the docs would have to bend to fit the check.
 */
const codeOf = (text: string) =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Extracts only the opening tag of `<DialogContent`.
 *
 * A single regex that reads up to `>` misfires on greater-than signs inside `className={...}` or
 * template strings. That error produces silent false negatives: the tag is cut short and passes as
 * having no attributes. Counting brace depth and quotes is enough, because every attribute in this
 * repo is a string or a brace expression.
 */
function openingTags(code: string): string[] {
	const tags: string[] = [];
	const needle = "<DialogContent";
	for (
		let at = code.indexOf(needle);
		at !== -1;
		at = code.indexOf(needle, at + 1)
	) {
		/** `<DialogContentSomething` is a different component and is skipped. */
		if (/[A-Za-z0-9_]/.test(code[at + needle.length] ?? "")) continue;
		let depth = 0;
		let quote: string | null = null;
		for (let i = at + needle.length; i < code.length; i++) {
			const ch = code[i];
			if (quote) {
				if (ch === "\\") i++;
				else if (ch === quote) quote = null;
				continue;
			}
			if (ch === '"' || ch === "'" || ch === "`") quote = ch;
			else if (ch === "{") depth++;
			else if (ch === "}") depth--;
			else if (ch === ">" && depth === 0) {
				tags.push(code.slice(at, i + 1));
				break;
			}
		}
	}
	return tags;
}

/**
 * Dialogs that pass the in-progress state to the dismissal policy. This rule's targets are exactly
 * this list.
 */
const guarded = tsx(FEATURES)
	.map((path) => ({
		name: path.slice(FEATURES.length + 1),
		code: codeOf(readFileSync(path, "utf8")),
	}))
	.filter(({ code }) =>
		/shouldCloseDialog\(\s*[A-Za-z0-9_.]+\s*,\s*pending\s*\)/.test(code),
	);

describe("a dialog that cannot close while pending does not show a pressable X", () => {
	/** If this finds no targets, every assertion below passes vacuously. */
	it("there really are dialogs to scan", () => {
		expect(guarded.length).toBeGreaterThan(15);
	});

	it.each(
		guarded.map(({ name }) => name),
	)("%s's DialogContent passes the pending state to the close control", (name) => {
		const entry = guarded.find((file) => file.name === name);
		const tags = openingTags(entry?.code ?? "");
		expect(tags.length, `${name} has no DialogContent`).toBeGreaterThan(0);
		for (const tag of tags)
			expect(
				/closeButtonDisabled=\{pending\}/.test(tag) ||
					/showCloseButton=\{false\}/.test(tag),
				`${name}'s X looks pressable while pending`,
			).toBe(true);
	});

	/**
	 * This check does not replace the policy. A disabled X is a display, not enforcement. A dialog
	 * that disables only the X, without routing through `shouldCloseDialog`, stays open to Esc,
	 * outside presses, and focus loss.
	 */
	it("no dialog locks only the control and skips the policy", () => {
		for (const path of tsx(FEATURES)) {
			const code = codeOf(readFileSync(path, "utf8"));
			if (!code.includes("closeButtonDisabled")) continue;
			expect(
				code,
				`${path.slice(FEATURES.length + 1)} skips the shared dismiss policy`,
			).toContain("shouldCloseDialog");
		}
	});
});
