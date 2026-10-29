import { describe, expect, it } from "vitest";
import { foldLegacyDraftBody, type LegacyDraftBody } from "./legacy.ts";

/**
 * Folding test. Web, mobile and sync must produce identical text for the same draft. A mismatch is
 * silent: the next merge makes one device's text overwrite the other's. The test compares the whole
 * string exactly, not whether it merely contains a phrase.
 */

const body = (patch: Partial<LegacyDraftBody> = {}): LegacyDraftBody => ({
	bodyMode: "structured",
	prompt: "",
	scenario: "",
	playGuide: "",
	suggestedPersona: null,
	characters: [],
	...patch,
});

const character = (
	patch: Partial<LegacyDraftBody["characters"][number]> = {},
) => ({
	name: "Librarian",
	mode: "structured" as const,
	description: "",
	personality: "",
	speechStyle: "",
	exampleDialogue: "",
	prompt: "",
	...patch,
});

describe("folding order", () => {
	it("a draft written by fields puts the scenario first", () => {
		expect(
			foldLegacyDraftBody(
				body({
					scenario: "A library where books talk.",
					playGuide: "Write in second person.",
				}),
			),
		).toBe(
			"A library where books talk.\n\n## \uc9c4\ud589 \uc9c0\uce68\nWrite in second person.",
		);
	});

	it("a draft written as a free prompt puts that body first", () => {
		expect(
			foldLegacyDraftBody(
				body({
					bodyMode: "prompt",
					prompt: "You are a librarian.",
					scenario: "a scenario left half-written",
				}),
			),
		).toBe(
			"You are a librarian.\n\n## \ud56d\ubaa9\ubcc4\ub85c \uc4f4 \uc138\uacc4\uad00\na scenario left half-written",
		);
	});

	it("the side not chosen also stays, under a heading", () => {
		expect(
			foldLegacyDraftBody(body({ scenario: "body", prompt: "old draft" })),
		).toBe(
			"body\n\n## \uc774\uc804\uc5d0 \uc4f4 \uc790\uc720 \ud504\ub86c\ud504\ud2b8\nold draft",
		);
	});

	it("character cards in free prompt mode stay too", () => {
		/**
		 * In free-prompt mode the character cards were not published, but they were not deleted either.
		 * Dropping them while folding would be the first time they disappear.
		 */
		expect(
			foldLegacyDraftBody(
				body({
					bodyMode: "prompt",
					prompt: "body",
					characters: [character({ description: "an old librarian" })],
				}),
			),
		).toBe(
			"body\n\n## \ub4f1\uc7a5\uc778\ubb3c\n### Librarian\n\uc18c\uac1c:\nan old librarian",
		);
	});
});

describe("character cards", () => {
	it("structured cards label only the filled fields", () => {
		expect(
			foldLegacyDraftBody(
				body({
					scenario: "body",
					characters: [
						character({ personality: "blunt", exampleDialogue: "…you came." }),
					],
				}),
			),
		).toBe(
			"body\n\n## \ub4f1\uc7a5\uc778\ubb3c\n### Librarian\n\uc131\uaca9:\nblunt\n\n\uc608\uc2dc \ub300\uc0ac:\n…you came.",
		);
	});

	it("prompt cards produce only their body", () => {
		expect(
			foldLegacyDraftBody(
				body({
					scenario: "body",
					characters: [
						character({
							mode: "prompt",
							prompt: "a freely written card",
							personality: "the unchosen side",
						}),
					],
				}),
			),
		).toBe(
			"body\n\n## \ub4f1\uc7a5\uc778\ubb3c\n### Librarian\na freely written card",
		);
	});

	it("a name-only card keeps its name", () => {
		/** A name the creator wrote. An empty body is no reason to erase that name too. */
		expect(
			foldLegacyDraftBody(
				body({ scenario: "body", characters: [character({ name: "  " })] }),
			),
		).toBe("body\n\n## \ub4f1\uc7a5\uc778\ubb3c\n### \uc774\ub984\uc5c6\uc74c");
	});

	it("keeps the incoming order", () => {
		expect(
			foldLegacyDraftBody(
				body({
					scenario: "body",
					characters: [
						character({ name: "Second" }),
						character({ name: "First" }),
					],
				}),
			),
		).toBe("body\n\n## \ub4f1\uc7a5\uc778\ubb3c\n### Second\n\n### First");
	});
});

describe("empty values", () => {
	it("a draft with nothing becomes an empty string", () => {
		expect(foldLegacyDraftBody(body())).toBe("");
	});

	it("whitespace-only fields make no paragraph", () => {
		expect(
			foldLegacyDraftBody(body({ scenario: "body", playGuide: "   " })),
		).toBe("body");
	});

	it("a counterpart with neither name nor description makes no paragraph", () => {
		expect(
			foldLegacyDraftBody(
				body({
					scenario: "body",
					suggestedPersona: { name: " ", description: "" },
				}),
			),
		).toBe("body");
	});

	it("a name-only counterpart stays too", () => {
		expect(
			foldLegacyDraftBody(
				body({
					scenario: "body",
					suggestedPersona: { name: "Visitor", description: "" },
				}),
			),
		).toBe("body\n\n## \uc0c1\ub300\uc5ed\n### Visitor");
	});
});

describe("determinism", () => {
	it("the same input always yields the same text", () => {
		const source = body({
			scenario: "body",
			playGuide: "guide",
			suggestedPersona: { name: "Visitor", description: "a late guest" },
			characters: [character({ description: "an old librarian" })],
		});
		expect(foldLegacyDraftBody(source)).toBe(foldLegacyDraftBody(source));
	});

	it("leaves inner line breaks alone", () => {
		expect(
			foldLegacyDraftBody(body({ scenario: "  first line\n\nsecond line  " })),
		).toBe("first line\n\nsecond line");
	});
});
