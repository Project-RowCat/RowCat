import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { storyStartLabel } from "./story-start-control.tsx";
import { startFailureMessage } from "./use-story-start.tsx";

/**
 * The **screen-side promise** of starting — the wording and the two start places.
 *
 * This place once held the promise of ownership (a button stating a price, a payment link when the
 * balance ran short, a subscriber's primary action). With story ownership gone, anyone can start a
 * story they can see, and what this file guards has shrunk to two things:
 *
 * 1. **Price and ownership vocabulary does not return to the start places.** If it did, a button
 *    would sell something nobody sells, and pressing it would call an endpoint that does not exist.
 * 2. **Both start places (detail and gallery preview) use the same wording function and glyph.**
 */

/**
 * The source with comments stripped — the rules are about code. The comments in these files still
 * carry sentences from the ownership era, as the reason that wiring is absent.
 */
const read = (file: string) =>
	readFileSync(new URL(file, import.meta.url), "utf8")
		.replaceAll(/\/\*[\s\S]*?\*\//g, " ")
		.replaceAll(/(^|[^:])\/\/.*$/gm, "$1");

const control = read("./story-start-control.tsx");
const preview = read("./story-preview-dialog.tsx");
const hook = read("./use-story-start.tsx");

describe("primary action wording", () => {
	it("uses the place's word as is", () => {
		expect(storyStartLabel({ pending: false })).toBe("Start conversation");
		expect(storyStartLabel({ pending: false, startLabel: "Play" })).toBe(
			"Play",
		);
	});

	it("shows the progress wording while running", () => {
		expect(storyStartLabel({ pending: true, startLabel: "Start" })).toBe(
			"Getting ready…",
		);
	});
});

describe("failure wording", () => {
	/** Does not spell out a 404 — the screen does not undo the existence hiding the server kept. */
	it("hides existence", () => {
		for (const message of (
			["play_unavailable", "storage", "unknown"] as const
		).map(startFailureMessage))
			expect(message).not.toMatch(
				/private|blocked|adult|archived|hidden|does not exist|deleted/i,
			);
	});

	it("does not suggest ownership", () => {
		for (const message of (
			["play_unavailable", "storage", "unknown"] as const
		).map(startFailureMessage))
			expect(message).not.toMatch(/\bown|churu|subscri/i);
	});
});

describe("absence of ownership", () => {
	/**
	 * The start places carry no price, ownership or subscription vocabulary. This repository removed
	 * billing, and if the button started waiting on personalization or a billing summary again, that
	 * wait would be a delay that decides nothing.
	 */
	it.each([
		["story-start-control.tsx", control],
		["story-preview-dialog.tsx", preview],
		["use-story-start.tsx", hook],
	])("%s has no ownership wiring", (_file, source) => {
		for (const forbidden of [
			/own for \d+ churu/i,
			/stories\.purchase/,
			/purchaseStory/,
			/PURCHASE_FAILURE/,
			/to="\/billing"/,
			/billingSummaryQueryOptions/,
			/personalizationQueryOptions/,
			/invalidateCattowerEntitlement/,
		])
			expect(source).not.toMatch(forbidden);
	});
});

describe("the two start places", () => {
	/**
	 * **The preview has no wording table of its own.** For a while a ternary ladder sat there, so when
	 * the domain gained a value only the detail was fixed and the preview drew the old table.
	 */
	it("the preview calls the same wording function", () => {
		expect(preview).toMatch(/storyStartLabel\(/);
	});

	/**
	 * **The glyph has no table of its own either.** If each place picked its own glyph, only one would
	 * be fixed when the domain vocabulary grew — mobile actually diverged that way.
	 */
	it("both places use the same glyph component", () => {
		expect(control).toMatch(/storyStartGlyph\(/);
		expect(preview).toMatch(/<StartGlyph\b/);
		/** The preview does not import the glyph components directly. */
		expect(preview).not.toMatch(/MessageCircle|\bPlay\b/);
	});
});
