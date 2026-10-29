import type { EffectiveGeneration, GenerationTarget } from "@rowcat/chat";
import type { GenerationModel } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import { roomGenerationSummary } from "./generation-summary.ts";

/**
 * The one-line summary on the settings home. It is checked without rendering because a mistake here
 * is silent: a model name the user never picked appears as their setting, or an unusable target
 * looks fine.
 */

const managed: GenerationTarget = {
	provider: "rowcat",
	model: "claude-sonnet-5",
};
const byo: GenerationTarget = {
	provider: "anthropic-byo",
	model: "claude-sonnet-5",
};

const effectiveFor = (target: GenerationTarget): EffectiveGeneration => ({
	target,
	responseLength: "standard",
	reasoningEffort: "medium",
	maxOutputTokens: 2048,
	sources: {
		responseLength: "global",
		target: "room",
		reasoningEffort: "product",
	},
});

const catalogEntry = (
	target: GenerationTarget,
	label: string,
	requiresConnection: boolean,
): GenerationModel => ({
	id: `${target.provider}:${target.model}`,
	provider: target.provider,
	providerLabel: target.provider,
	vendorLabel: "Anthropic",
	model: target.model,
	label,
	requiresConnection,
	reasoning: null,
	promptPack: null,
});

const base = {
	loading: false,
	effective: effectiveFor(managed),
	models: [catalogEntry(managed, "Claude Sonnet 5", false)],
	catalogLoaded: true,
	connected: [],
	byoAllowed: true,
	responseLengthLabel: "Standard",
	/**
	 * This file checks the model name and the blocked state. Whether a reasoning fragment is appended
	 * is tested elsewhere; the catalog entries above use `reasoning: null`, so none is appended here.
	 */
	reasoningEffortLabel: () => "Standard",
};

describe("roomGenerationSummary", () => {
	it("claims nothing until read", () => {
		/** A placeholder showing the product default would show a user with an override someone else's model. */
		expect(roomGenerationSummary({ ...base, loading: true })).toEqual({
			text: null,
			blocked: false,
		});
	});

	it("writes the catalog name and response length on one line", () => {
		expect(roomGenerationSummary(base).text).toBe(
			"Claude Sonnet 5 · Standard replies",
		);
	});

	it("summarizes an inherited target the same way", () => {
		/**
		 * No override does not remove the conversation's generation target. The summary reads the
		 * `effective` value the resolver returns, not the room's override.
		 */
		const inheritedEffective: EffectiveGeneration = {
			...effectiveFor(managed),
			sources: {
				responseLength: "product",
				target: "product",
				reasoningEffort: "product",
			},
		};
		expect(
			roomGenerationSummary({ ...base, effective: inheritedEffective }).text,
		).toBe("Claude Sonnet 5 · Standard replies");
	});

	it("a target missing from the catalog uses the stored model string as is", () => {
		/** We have no name for it; inventing a plausible one would be a wrong name. */
		const summary = roomGenerationSummary({ ...base, models: [] });
		expect(summary.text).toBe("claude-sonnet-5 · Standard replies");
		expect(summary.blocked).toBe(true);
	});

	it("does not judge whether the model exists when the lookup failed", () => {
		/**
		 * A brief network failure and a retired model are different facts. If the catalog did not load,
		 * do not block.
		 */
		const summary = roomGenerationSummary({
			...base,
			models: [],
			catalogLoaded: false,
		});
		expect(summary.text).toBe("claude-sonnet-5 · Standard replies");
		expect(summary.blocked).toBe(false);
	});

	it("marks a BYO target without a connection as blocked", () => {
		const summary = roomGenerationSummary({
			...base,
			effective: effectiveFor(byo),
			models: [catalogEntry(byo, "Claude Sonnet 5", true)],
			connected: [],
		});
		expect(summary.blocked).toBe(true);
		/** Being blocked does not hide the name: "unusable" and "what it is" are different facts. */
		expect(summary.text).toBe("Claude Sonnet 5 · Standard replies");
	});

	it("a connected BYO target is not blocked", () => {
		expect(
			roomGenerationSummary({
				...base,
				effective: effectiveFor(byo),
				models: [catalogEntry(byo, "Claude Sonnet 5", true)],
				connected: ["anthropic-byo"],
			}).blocked,
		).toBe(false);
	});

	it("blocked even with a connection on an account that can't use BYO", () => {
		/** Account eligibility is a separate axis from connection; having a key does not unlock it. */
		expect(
			roomGenerationSummary({
				...base,
				effective: effectiveFor(byo),
				models: [catalogEntry(byo, "Claude Sonnet 5", true)],
				connected: ["anthropic-byo"],
				byoAllowed: false,
			}).blocked,
		).toBe(true);
	});
});
