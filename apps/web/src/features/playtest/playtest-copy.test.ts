import { describe, expect, it } from "vitest";
import {
	playtestDisclosure,
	playtestEmptyConversationHint,
	playtestEmptyPromptNote,
	playtestEphemeralNote,
	playtestReloadConfirm,
	playtestReloadFailure,
	playtestResetConfirm,
	playtestRuntimeEmpty,
	playtestRuntimeNote,
	playtestRuntimeRestartAfterFailure,
	playtestRuntimeRun,
	playtestRuntimeStudioLink,
	playtestSceneConfirm,
} from "./playtest-copy.ts";

/**
 * Checks the screen's promises as values, since copy tests usually just restate the sentence. The
 * test checks the claims that must hold and the words that must not appear:
 * - Must hold: the fact that content is sent, and the fact that nothing is saved.
 * - Must not appear: `Publish`, `Review`, `Approval`, `Review`. This screen uploads nothing to a server.
 * - Must not appear: overreaching promises such as `nobody can see it`. Managed models pass through the
 *   server.
 */

const ALL = [
	playtestDisclosure(),
	playtestEphemeralNote(),
	playtestEmptyPromptNote(),
	playtestEmptyConversationHint(),
	playtestReloadFailure(),
	playtestResetConfirm().title,
	playtestResetConfirm().description,
	playtestReloadConfirm().title,
	playtestReloadConfirm().description,
	playtestSceneConfirm().title,
	playtestSceneConfirm().description,
	/**
	 * The runtime variant of the sentences must pass the same test. Whether the screen sends nothing
	 * to the server does not depend on whether a conversation or code is running, and the rule against
	 * promises that cannot be kept applies equally.
	 */
	playtestRuntimeNote(),
	playtestRuntimeEmpty(),
	playtestRuntimeStudioLink(),
	playtestRuntimeRun(),
	playtestRuntimeRestartAfterFailure(),
];

describe("disclosure boundary notice", () => {
	it("says the draft content **is sent** to the provider", () => {
		expect(playtestDisclosure()).toContain("sends");
		expect(playtestDisclosure()).toContain("AI provider");
	});

	/**
	 * Do not make promises that cannot be kept. With a managed model (RowCat-provided), the prompt
	 * passes through our server, so claims such as `nobody can see it` or `not stored on the server` would be false. The
	 * most that can be said is `doesn't appear in the conversation list`.
	 */
	it.each([
		"nobody",
		"encrypt",
		"never leaves",
	])("makes no overpromise like '%s'", (word) => {
		expect(ALL.filter((text) => text.includes(word))).toEqual([]);
	});

	it("says it isn't saved", () => {
		expect(playtestDisclosure()).toContain("aren't saved");
		expect(playtestEphemeralNote()).toContain("disappears");
	});
});

/**
 * The copy must not imply review. Pre-review, approval waiting, and review requests are procedures
 * this product does not have. Here the only thing going to the server is the generation stream, so
 * there is even less reason for them. An author who reads such a sentence leaves thinking their
 * work went somewhere. The publish section follows the same rule for the same reason.
 */
describe("does not read like publishing", () => {
	it.each(["publish", "review", "approv"])("has no word '%s'", (word) => {
		expect(ALL.filter((text) => text.includes(word))).toEqual([]);
	});
});

/**
 * The two confirmation dialogs describe different actions. If the same sentence appeared in both,
 * users would read them as the same action, and someone who reset because they disliked the
 * response would unknowingly test a different draft version.
 */
describe("reset and reload are different actions", () => {
	it("reset says the conditions stay", () => {
		expect(playtestResetConfirm().description).toContain("stay");
		expect(playtestResetConfirm().description).not.toContain("latest");
	});

	it("reload says it rereads the draft and pins that the draft does not change", () => {
		expect(playtestReloadConfirm().description).toContain("latest");
		expect(playtestReloadConfirm().description).toContain("doesn't change");
	});

	it("switching scenes says the draft setting does not change", () => {
		expect(playtestSceneConfirm().description).toContain("doesn't change");
	});

	it("the three titles differ", () => {
		const titles = [
			playtestResetConfirm().title,
			playtestReloadConfirm().title,
			playtestSceneConfirm().title,
		];
		expect(new Set(titles).size).toBe(titles.length);
	});
});

/**
 * Even if reload fails, the current test remains. If the screen does not say so, the user will read
 * it as lost.
 */
describe("reload failure", () => {
	it("says the current test stays", () => {
		expect(playtestReloadFailure()).toContain("stays");
	});
});

/**
 * A runtime test must state the lifetime of its progress. Saved state accumulated here lives in the
 * worker's memory and disappears on refresh. A line that reads `is saved` would make an author who ran
 * several rounds lose progress they believed was kept. This screen never made that promise.
 */
describe("runtime test copy", () => {
	it("says progress lasts only on this screen", () => {
		expect(playtestRuntimeNote()).toContain("only on this screen");
		expect(playtestRuntimeNote()).toContain("disappears");
	});

	/**
	 * A project without a file is not a failure. Phrasing it as an error would make a user who just
	 * turned on the runtime think they broke something.
	 */
	it.each([
		"fail",
		"error",
		"wrong",
	])("does not call an empty project '%s'", (word) => {
		expect(playtestRuntimeEmpty()).not.toContain(word);
	});

	/**
	 * This screen has no preview step; the whole screen is the work. The action words must not contain
	 * `Preview`.
	 */
	it("the action words do not say preview", () => {
		expect(playtestRuntimeRun()).not.toMatch(/preview/i);
		expect(playtestRuntimeRestartAfterFailure()).not.toMatch(/preview/i);
	});
});
