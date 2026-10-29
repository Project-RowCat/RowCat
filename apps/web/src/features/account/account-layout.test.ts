import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { account } from "#/lib/i18n/messages/en/account.ts";

/**
 * Statically checks the account screen's **layout** and the **deletion copy.**
 *
 * Both guard against the same kind of mistake: a change that drops or misplaces something still
 * passes type checks and still renders.
 *
 * - If the section order breaks, an irreversible action can land next to everyday sections.
 * - If the deletion copy names something the product no longer has (once: churu treats, cat towers,
 *   store payment records), the warning is noise rather than information, and it also disagrees with the
 *   implementation. This test guards that too.
 *
 * What is checked is the policy, not the render result (the web tests have no React rendering). The
 * copy is not pinned word for word either: sentences get reworded. What is guarded is **whether the
 * fact is mentioned.**
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const read = (file: string): string => readFileSync(join(HERE, file), "utf8");

/**
 * The source with comments removed: **only user-visible copy remains.**
 *
 * Without this, a word mentioned in a comment that says "we do not mention X" would pass a check
 * for "mentions X" (or fail the other way). This repository once had exactly that kind of comment.
 */
const copyOf = (file: string): string =>
	read(file)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

describe("account screen sections", () => {
	const source = read("account-page.tsx");

	it("data comes after security and before the danger zone", () => {
		/*
		 * These two sections answer one question in sequence: whose account is this, then what does it
		 * hold. The irreversible action comes after both, in its own place.
		 */
		const at = (tag: string): number => {
			const index = source.indexOf(`<${tag}`);
			expect(index, `${tag} is not on the screen`).toBeGreaterThan(-1);
			return index;
		};
		expect(at("SecuritySection")).toBeLessThan(at("DataSection"));
		expect(at("DataSection")).toBeLessThan(at("DeleteAccountSection"));
	});

	it("the placeholder has its sections in the same order", () => {
		// If this is missing, every section below shifts down when the real values arrive.
		const skeleton = read("account-skeleton.tsx");
		const security = skeleton.indexOf('t("securitySection.security")');
		expect(security).toBeGreaterThan(-1);
		expect(security).toBeLessThan(skeleton.indexOf('t("dataSection.data")'));
	});
});

describe("where the active sessions failure message stands", () => {
	/**
	 * The rhythm in `feedback.ts` targets messages that **have no reserved place below them.** When
	 * that condition breaks, the symptom is quiet: after an error is cleared, the controls below do
	 * not move up right away and instead wait until the exit (120ms) finishes. The user sees two beats
	 * of movement rather than one final layout, and no animation can hide that.
	 *
	 * This section really did break the condition once. The failure message sat **above** the `Sign out all
	 * other devices` button, so the sentence on its way out was holding that button's vertical slot.
	 *
	 * The test does not pin the exact JSX order. What it targets is **the siblings that take up flow
	 * space**. A confirmation dialog owned by the portal can sit after them without pushing anything.
	 */
	/**
	 * **Checked on the source with comments removed.** This file's comments quote the button's label
	 * several times, so reading it raw would check the order of prose instead of JSX.
	 */
	const source = copyOf("sessions-section.tsx");
	/** Where this section's flow ends. The row components below are not scanned. */
	const sectionEnd = source.indexOf("function SessionRow");
	const feedbackAt = source.indexOf("exit={feedbackExit}");

	it("the failure message comes **after** the session controls", () => {
		expect(feedbackAt).toBeGreaterThan(-1);
		for (const action of [
			't("sessionsSection.showMoreDevices"',
			't("sessionsSection.signOutAllOtherDevices")',
		]) {
			const at = source.indexOf(action);
			expect(at, `${action} is not on the screen`).toBeGreaterThan(-1);
			expect(at).toBeLessThan(feedbackAt);
		}
	});

	it("no control below it takes up flow space", () => {
		expect(sectionEnd).toBeGreaterThan(feedbackAt);
		const after = source.slice(feedbackAt, sectionEnd);
		// The only thing left is the confirmation dialog drawn through the portal.
		expect(after).toContain("<RevokeOthersDialog");
		expect(after).not.toContain("<Button");
	});

	it("the failure stays inside this section, next to the controls", () => {
		/*
		 * Moving the sentence to the top of the account screen or into a toast would not fix the layout.
		 * This rhythm depends on cause and effect being visible in place (`lib/motion/feedback.ts`).
		 */
		expect(source).toContain('role="alert"');
		expect(copyOf("account-page.tsx")).not.toContain("feedbackExit");
	});

	it("blocks that set the layout get no presence", () => {
		/*
		 * The goal is not to remove the shift but to make it happen **later**. Only two presence exits
		 * belong in this section: the row (`rowExit`) and the sentence (`feedbackExit`).
		 */
		const exits = source.match(/exit=\{[A-Za-z]+\}/g) ?? [];
		expect([...new Set(exits)].sort()).toEqual([
			"exit={feedbackExit}",
			"exit={rowExit}",
		]);
	});
});

describe("account deletion copy", () => {
	/**
	 * The three places the user actually reads: the confirmation dialog, the section, and the guide.
	 * Their copy lives in the account dictionary under the matching groups, so that is what is read.
	 */
	const SURFACES = {
		"delete-account-dialog.tsx": account.deleteAccountDialog,
		"delete-account-section.tsx": account.deleteAccountSection,
		"account-deletion-guide.tsx": account.accountDeletionGuide,
	} as const;
	const copyOfSurface = (group: object): string =>
		JSON.stringify(group).toLowerCase();

	it.each(
		Object.keys(SURFACES),
	)("%s does not mention payments that no longer exist", (file) => {
		/*
		 * While payments existed, this copy mentioned churu treats, cat towers and store payment
		 * records, and that was correct: the user had actually paid and received things that were then
		 * removed. Now that payments are gone from the product, the reverse holds. A warning about a
		 * feature that does not exist is noise, and a note that records remain contradicts the
		 * implementation.
		 */
		const copy = copyOfSurface(SURFACES[file as keyof typeof SURFACES]);
		for (const word of [
			"churu",
			"cat tower",
			"payment",
			"refund",
			"subscription",
		])
			expect(copy, word).not.toContain(word);
	});

	it("does not show table names to the user", () => {
		// What matters is "what remains", not which column becomes NULL.
		for (const group of Object.values(SURFACES))
			expect(copyOfSurface(group)).not.toMatch(/member_id|_id\b/);
	});

	it("does not invent a retention period", () => {
		/*
		 * Retention periods are set by the privacy policy. If the number were invented in code, it would
		 * become a promise to the user.
		 */
		for (const group of Object.values(SURFACES))
			expect(copyOfSurface(group)).not.toMatch(/\d+\s*years?\b/);
	});

	it("the screens read their copy from the dictionary", () => {
		for (const file of Object.keys(SURFACES))
			expect(copyOf(file)).not.toMatch(/[\uAC00-\uD7A3]/);
	});
});
