import type { EffectiveGeneration, GenerationTarget } from "@rowcat/chat";
import type { GenerationModel } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import {
	playtestConfigurationSummary,
	playtestDefaultSceneLabel,
	playtestUntitledSceneLabel,
} from "./playtest-configuration-summary.ts";

/**
 * The current test conditions that the collapsed toolbar line reports. The test checks the claims
 * the line makes, not its wording: inherited values and overrides are stated, unknown names are not
 * invented, and nothing is said while nothing can yet be determined.
 *
 * Drawing the product default in that state would show `Standard` to a user who overrode to `Long`, every
 * time the screen opens.
 */

const MANAGED: GenerationTarget = {
	provider: "rowcat",
	model: "claude-sonnet-5",
};
const BYO: GenerationTarget = {
	provider: "anthropic-byo",
	model: "claude-sonnet-4-5",
};

const model = (
	target: GenerationTarget,
	label: string,
	extra: Partial<GenerationModel> = {},
): GenerationModel => ({
	id: `${target.provider}:${target.model}`,
	provider: target.provider,
	providerLabel: target.provider === "rowcat" ? "RowCat" : "Anthropic",
	vendorLabel: "Anthropic",
	label,
	model: target.model,
	requiresConnection: target.provider !== "rowcat",
	reasoning: null,
	promptPack: null,
	...extra,
});

const CATALOG: GenerationModel[] = [
	model(MANAGED, "Claude Sonnet 5"),
	model(BYO, "Claude Sonnet 4.5"),
];

const effective = (
	target: GenerationTarget,
	responseLength: EffectiveGeneration["responseLength"] = "standard",
): EffectiveGeneration => ({
	target,
	responseLength,
	reasoningEffort: "medium",
	maxOutputTokens: 1024,
	sources: {
		target: "product",
		responseLength: "product",
		reasoningEffort: "product",
	},
});

const summarize = (
	overrides: Partial<Parameters<typeof playtestConfigurationSummary>[0]> = {},
) =>
	playtestConfigurationSummary({
		loading: false,
		effective: effective(MANAGED),
		/**
		 * This file checks the order of the parts and the start scene. Whether the reasoning part appears
		 * is covered by its own test; it does not appear here because the catalog entry has `reasoning:
		 * null`.
		 */
		reasoningEffortLabel: () => "Standard",
		models: CATALOG,
		catalogLoaded: true,
		connected: ["anthropic-byo"],
		byoAllowed: true,
		responseLengthLabel: "Standard",
		startSceneTitle: null,
		...overrides,
	});

describe("while not read yet", () => {
	it("draws no parts", () => {
		const summary = summarize({ loading: true });
		expect(summary.parts).toEqual([]);
		expect(summary.text).toBeNull();
	});

	/**
	 * A claim that the model is unusable cannot be made yet either: the values needed to decide have
	 * not arrived.
	 */
	it("does not say it is blocked", () => {
		expect(summarize({ loading: true }).blocked).toBe(false);
	});
});

describe("generation target", () => {
	it("names an inherited target too", () => {
		expect(summarize().text).toBe(
			"Claude Sonnet 5 · Standard · Default opening",
		);
	});

	it("states the overridden target", () => {
		const summary = summarize({
			effective: effective(BYO, "long"),
			responseLengthLabel: "Long",
		});
		expect(summary.text).toBe("Claude Sonnet 4.5 · Long · Default opening");
	});

	/**
	 * Unknown names are never invented. If the catalog failed to load or the target is not in it, the
	 * stored model string is used as is. A plausible made-up name would make the user read a model
	 * they never chose as their own setting.
	 */
	it("uses the stored model string as is when the catalog did not arrive", () => {
		const summary = summarize({ models: [], catalogLoaded: false });
		expect(summary.parts[0]?.value).toBe(MANAGED.model);
	});

	it("also uses a model that left the list as is", () => {
		const summary = summarize({
			models: [model(MANAGED, "Claude Sonnet 5")],
			effective: effective(BYO),
		});
		expect(summary.parts[0]?.value).toBe(BYO.model);
	});

	/**
	 * The fact that a target is unusable must persist in the collapsed state; the inspector explains
	 * the reason.
	 */
	it("marks a BYO target without a connection as blocked", () => {
		const summary = summarize({ effective: effective(BYO), connected: [] });
		expect(summary.blocked).toBe(true);
		expect(summary.text).toBe("Claude Sonnet 4.5 · Standard · Default opening");
	});

	it("a usable target is not blocked", () => {
		expect(summarize().blocked).toBe(false);
	});
});

describe("Opening scene", () => {
	it("says default opening without an override", () => {
		expect(summarize().parts[2]?.value).toBe(playtestDefaultSceneLabel());
	});

	it("states the chosen scene's title", () => {
		expect(summarize({ startSceneTitle: "Entrance" }).parts[2]?.value).toBe(
			"Entrance",
		);
	});

	/**
	 * A scene with an empty title is not folded into the default opening. The user picked a different
	 * scene, and folding would drop that fact from the summary.
	 */
	it("an empty title does not fold to the default opening", () => {
		const summary = summarize({ startSceneTitle: "   " });
		expect(summary.parts[2]?.value).toBe(playtestUntitledSceneLabel());
		expect(summary.parts[2]?.value).not.toBe(playtestDefaultSceneLabel());
	});

	it("surrounding whitespace in the title is not drawn", () => {
		expect(summarize({ startSceneTitle: "  Entrance  " }).parts[2]?.value).toBe(
			"Entrance",
		);
	});
});

describe("part labels", () => {
	/**
	 * A line of bare values would be three unlabeled words to a user who is not looking at the screen.
	 * Carrying each axis name makes the line readable.
	 */
	it("all three carry their own axis name", () => {
		expect(summarize().parts.map((part) => part.label)).toEqual([
			"Model",
			"Response length",
			"Opening scene",
		]);
	});

	/** Labels do not leak into the on-screen line; only values are drawn. */
	it("the joined line holds only values", () => {
		const summary = summarize({ startSceneTitle: "Entrance" });
		expect(summary.text).toBe("Claude Sonnet 5 · Standard · Entrance");
	});
});

describe("long names", () => {
	/**
	 * Does not truncate. Where the text should cut off depends on the available width, which CSS
	 * decides. Cutting by character count here would turn that number into a rule that is wrong at
	 * every other width.
	 */
	it("does not shorten the model name", () => {
		const long = "a very long model name".repeat(20);
		const summary = summarize({
			models: [model(MANAGED, long)],
		});
		expect(summary.parts[0]?.value).toBe(long);
	});
});
