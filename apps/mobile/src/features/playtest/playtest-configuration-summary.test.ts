import type { GenerationModelDto } from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import {
	PLAYTEST_DEFAULT_SCENE_LABEL,
	PLAYTEST_UNTITLED_SCENE_LABEL,
	playtestConfigurationSummary,
} from "./playtest-configuration-summary.ts";

/**
 * The collapsed condition summary: can the user tell what the test runs on without opening the
 * dialog?
 *
 * When the controls moved into the dialog, this line became the only signal. Without it the user
 * sends a message without knowing the configuration, and a `blocked` state hides behind the dialog
 * with no indication on screen of why the conversation is stuck.
 */

const model = (over: Partial<GenerationModelDto> = {}): GenerationModelDto =>
	({
		id: "rowcat:claude-sonnet-5",
		provider: "rowcat",
		model: "claude-sonnet-5",
		label: "Claude Sonnet 5",
		providerLabel: "RowCat",
		vendorLabel: "Anthropic",
		/** This file checks the order of the parts; the reasoning axis has its own test. */
		reasoning: null,
		...over,
	}) as GenerationModelDto;

const summary = (
	over: Partial<Parameters<typeof playtestConfigurationSummary>[0]> = {},
) =>
	playtestConfigurationSummary({
		loading: false,
		effective: {
			responseLength: "standard",
			reasoningEffort: "medium",
			maxOutputTokens: 2048,
			target: { provider: "rowcat", model: "claude-sonnet-5" },
			sources: {
				responseLength: "product",
				target: "product",
				reasoningEffort: "product",
			},
		},
		models: [model()],
		catalogLoaded: true,
		connected: [],
		byoAllowed: true,
		startSceneTitle: null,
		...over,
	});

describe("when it can't say yet", () => {
	/** No product default is drawn before the real value arrives, so no parts are built. */
	it("no pieces while loading", () => {
		const result = summary({ loading: true });
		expect(result.parts).toEqual([]);
		expect(result.text).toBeNull();
	});
});

describe("three pieces", () => {
	it("states model, response length and opening scene in order", () => {
		const result = summary();
		expect(result.parts.map((part) => part.label)).toEqual([
			"Model",
			"Response length",
			"Opening scenes",
		]);
		expect(result.parts[0]?.value).toBe("Claude Sonnet 5");
		expect(result.parts[2]?.value).toBe(PLAYTEST_DEFAULT_SCENE_LABEL);
	});

	/**
	 * The label is read together with the value. A line of bare values is three words to someone who
	 * cannot see the screen, with no way to tell which one is the model.
	 */
	it("labels ride along on one line", () => {
		expect(summary().text).toContain("Model Claude Sonnet 5");
	});

	it("states the chosen scene's title as is", () => {
		expect(summary({ startSceneTitle: "Rooftop" }).parts[2]?.value).toBe(
			"Rooftop",
		);
	});

	/**
	 * A scene with a blank title is not folded into the default opening. That would be false: the user
	 * explicitly picked another scene. Folding would make the summary of someone with an override look
	 * the same as someone who picked nothing.
	 */
	it("doesn't fold an unnamed scene into the default opening", () => {
		expect(summary({ startSceneTitle: "  " }).parts[2]?.value).toBe(
			PLAYTEST_UNTITLED_SCENE_LABEL,
		);
	});
});

describe("unusable targets", () => {
	/**
	 * A BYO target with no connection on this device. The fact must remain visible without opening the
	 * dialog: hiding it leaves the user sending messages without knowing why the conversation is
	 * blocked.
	 */
	it("no connection means blocked", () => {
		const result = summary({
			effective: {
				responseLength: "standard",
				reasoningEffort: "medium",
				maxOutputTokens: 2048,
				target: { provider: "anthropic-byo", model: "claude-sonnet-4-5" },
				sources: {
					responseLength: "product",
					target: "room",
					reasoningEffort: "product",
				},
			},
			models: [
				model({
					id: "anthropic-byo:claude-sonnet-4-5",
					provider: "anthropic-byo",
					model: "claude-sonnet-4-5",
					label: "Claude Sonnet 4.5",
				}),
			],
			connected: [],
		});
		expect(result.blocked).toBe(true);
	});

	it("usable means not blocked", () => {
		expect(summary().blocked).toBe(false);
	});
});
