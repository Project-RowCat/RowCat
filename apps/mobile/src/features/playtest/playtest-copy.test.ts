import { describe, expect, it } from "vitest";
import {
	PLAYTEST_DISCLOSURE,
	PLAYTEST_EMPTY_PROMPT_NOTE,
	PLAYTEST_EPHEMERAL_NOTE,
	PLAYTEST_MISSING,
	PLAYTEST_RELOAD_CONFIRM,
	PLAYTEST_RELOAD_FAILURE,
	PLAYTEST_RESET_CONFIRM,
	PLAYTEST_SCENE_CONFIRM,
	PLAYTEST_START_FAILURE,
} from "./playtest-copy.ts";

/**
 * Pins the promises this screen makes to the user as values.
 *
 * Copy tests usually cannot check values, because they end up transcribing the implementation.
 * These are different: each is a checkable claim, and if any one becomes false the user
 * misunderstands where their manuscript goes.
 *
 * ```text
 * what leaves        the draft's settings and the AI provider this conversation selected
 * what stays         nothing (it is not saved to the conversation list)
 * what it is not     a publication
 * ```
 */

const ALL = [
	PLAYTEST_DISCLOSURE,
	PLAYTEST_EPHEMERAL_NOTE,
	PLAYTEST_EMPTY_PROMPT_NOTE,
	PLAYTEST_RELOAD_FAILURE,
	PLAYTEST_MISSING.title,
	PLAYTEST_MISSING.description,
	PLAYTEST_RESET_CONFIRM.title,
	PLAYTEST_RESET_CONFIRM.description,
	PLAYTEST_RELOAD_CONFIRM.title,
	PLAYTEST_RELOAD_CONFIRM.description,
	PLAYTEST_SCENE_CONFIRM.title,
	PLAYTEST_SCENE_CONFIRM.description,
	...Object.values(PLAYTEST_START_FAILURE),
];

describe("disclosure notice", () => {
	it("states both facts together — it goes out, and it doesn't stay", () => {
		expect(PLAYTEST_DISCLOSURE).toContain("provider");
		expect(PLAYTEST_DISCLOSURE).toContain("sends");
		expect(PLAYTEST_DISCLOSURE).toContain("aren't saved");
		expect(PLAYTEST_DISCLOSURE).toContain("conversation list");
	});

	/**
	 * Makes no promise the product cannot keep.
	 *
	 * When the managed model (RowCat-provided) is chosen, the prompt passes through our server. The
	 * sentence "no server sees this" would become false at that point, and a user who entered a
	 * manuscript on the strength of it would be acting on a guarantee we never made.
	 */
	it("doesn't say the server doesn't see it", () => {
		for (const forbidden of [
			"not sent to the server",
			"server can't see",
			"fully local",
			"only on the device",
			"anonymous",
			"encrypted",
		])
			expect(PLAYTEST_DISCLOSURE, forbidden).not.toContain(forbidden);
	});

	/**
	 * The lifetime sentence states only what is observable. Native has no page reload; instead the OS
	 * can kill the process. Promising that the test survives that is not possible, since this
	 * conversation is never written anywhere.
	 */
	it("the lifetime sentence states this app's facts", () => {
		expect(PLAYTEST_EPHEMERAL_NOTE).toContain("test screen");
		expect(PLAYTEST_EPHEMERAL_NOTE).toContain("disappears");
		expect(PLAYTEST_EPHEMERAL_NOTE).not.toContain("reload");
		/** No words that would be read as "survives a process death". */
		for (const forbidden of ["reopen the app", "recovery", "continue where"])
			expect(PLAYTEST_EPHEMERAL_NOTE, forbidden).not.toContain(forbidden);
	});
});

describe("no publish vocabulary", () => {
	/**
	 * This screen uploads nothing to the server. A creator who reads publish, review, approval or
	 * submission words walks away believing the work has gone up somewhere, and that belief persists
	 * until they open the catalogue.
	 */
	it("doesn't say publish, review, approval or check", () => {
		for (const text of ALL)
			for (const forbidden of [
				"Publish",
				"review",
				"Approve",
				"approval",
				"posted",
				"upload",
			])
				expect(text, `${forbidden} — ${text}`).not.toContain(forbidden);
	});
});

describe("confirm dialogs say what disappears", () => {
	it("all three state that the conversation disappears", () => {
		for (const copy of [
			PLAYTEST_RESET_CONFIRM,
			PLAYTEST_RELOAD_CONFIRM,
			PLAYTEST_SCENE_CONFIRM,
		])
			expect(copy.description, copy.title).toContain("disappear");
	});

	/**
	 * Reset says the conditions are kept, reload says the draft is not changed, and scene change says
	 * the draft's default opening is not touched. These are three different facts; merged into one,
	 * the user cannot tell what they lose.
	 */
	it("the three promise different things", () => {
		expect(PLAYTEST_RESET_CONFIRM.description).toContain("stay");
		expect(PLAYTEST_RELOAD_CONFIRM.description).toContain(
			"The draft doesn't change",
		);
		expect(PLAYTEST_SCENE_CONFIRM.description).toContain("default opening");
	});
});

describe("failures say what to do next", () => {
	/**
	 * `autosave` and `storage` are different. The first means the text just typed is not saved yet, so
	 * pressing again later works. The second means this account's storage could not be opened.
	 */
	it("a flush failure says it's a save failure", () => {
		expect(PLAYTEST_START_FAILURE.autosave).toContain("Couldn't save");
		expect(PLAYTEST_START_FAILURE.storage).toContain("draft");
	});

	/** A reload failure also states that the current test stays as it is. */
	it("a reload failure says what remains", () => {
		expect(PLAYTEST_RELOAD_FAILURE).toContain("stays as it is");
	});
});

describe("a missing draft isn't an error", () => {
	/**
	 * The draft was deleted, was made on another device and has not synced yet, or is a hand-edited
	 * deep link. All three are normal. The copy also does not say whether the draft belongs to someone
	 * else, since drafts are not on the server and there is no way to find out.
	 */
	it("it mentions the account and doesn't say error", () => {
		expect(PLAYTEST_MISSING.description).toContain("account");
		for (const forbidden of ["error", "failure", "damaged", "permission"])
			expect(PLAYTEST_MISSING.description, forbidden).not.toContain(forbidden);
	});
});
