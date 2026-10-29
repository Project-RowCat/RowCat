import {
	CHAT_DEFAULT_OUTPUT_TOKENS,
	DEFAULT_MANAGED_MODEL,
	ROWCAT_MANAGED_MODELS,
} from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import {
	EMPTY_GENERATION_PREFERENCE,
	type GenerationPreference,
	type GenerationTarget,
	generationTargetKey,
	isByoProvider,
	isEmptyGenerationPreference,
	isGenerationProvider,
	isResponseLength,
	outputTokensFor,
	PRODUCT_GENERATION_TARGET,
	PRODUCT_REASONING_EFFORT,
	PRODUCT_RESPONSE_LENGTH,
	RESPONSE_LENGTH_TOKEN_CEILING,
	RESPONSE_LENGTHS,
	type ResponseLength,
	readGenerationTarget,
	resolveEffectiveGeneration,
	sameGenerationTarget,
} from "./generation-preference.ts";

/**
 * Precedence, checked without rendering.
 *
 * Breakage here is hard to spot on screen. If a room override cannot beat the global setting, it
 * looks like 'I changed the setting, but this room does not change'. If clearing an override copies
 * values, everything looks right at first, but when the default changes later only those rooms stay
 * on the old value.
 */

const pref = (responseLength: ResponseLength | null): GenerationPreference => ({
	responseLength,
	target: null,
	reasoningEffort: null,
});

/**
 * Helper for a layer that sets only the target. It makes visible that the two axes do not pull each
 * other along.
 */
const targetPref = (target: GenerationTarget | null): GenerationPreference => ({
	responseLength: null,
	target,
	reasoningEffort: null,
});

const ANTHROPIC: GenerationTarget = {
	provider: "anthropic-byo",
	model: "claude-sonnet-5",
};
const GEMINI: GenerationTarget = {
	provider: "gemini-byo",
	model: "gemini-3.7-flash",
};

describe("precedence: room > global > product default", () => {
	it("the product default when no layer decides", () => {
		const effective = resolveEffectiveGeneration({});
		expect(effective.responseLength).toBe(PRODUCT_RESPONSE_LENGTH);
		expect(effective.sources.responseLength).toBe("product");
	});

	it("an empty preference is the same as deciding nothing", () => {
		expect(
			resolveEffectiveGeneration({
				global: EMPTY_GENERATION_PREFERENCE,
				room: EMPTY_GENERATION_PREFERENCE,
			}),
		).toEqual(resolveEffectiveGeneration({}));
	});

	it("global wins when only global decides", () => {
		const effective = resolveEffectiveGeneration({ global: pref("long") });
		expect(effective.responseLength).toBe("long");
		expect(effective.sources.responseLength).toBe("global");
	});

	it("room beats global when the room decides", () => {
		const effective = resolveEffectiveGeneration({
			global: pref("long"),
			room: pref("short"),
		});
		expect(effective.responseLength).toBe("short");
		expect(effective.sources.responseLength).toBe("room");
	});

	it("room beats the product default when only the room decides", () => {
		const effective = resolveEffectiveGeneration({ room: pref("short") });
		expect(effective.responseLength).toBe("short");
		expect(effective.sources.responseLength).toBe("room");
	});

	/**
	 * These two assertions together hold that clearing a room's override does not copy values. After
	 * the room is cleared, a change to the global setting must reach that room too.
	 */
	it("clearing the room override inherits the global again", () => {
		const cleared = resolveEffectiveGeneration({
			global: pref("long"),
			room: EMPTY_GENERATION_PREFERENCE,
		});
		expect(cleared.responseLength).toBe("long");
		expect(cleared.sources.responseLength).toBe("global");

		const afterGlobalChange = resolveEffectiveGeneration({
			global: pref("short"),
			room: EMPTY_GENERATION_PREFERENCE,
		});
		expect(afterGlobalChange.responseLength).toBe("short");
	});

	it("clearing the global override inherits the product default again", () => {
		const effective = resolveEffectiveGeneration({
			global: EMPTY_GENERATION_PREFERENCE,
		});
		expect(effective.responseLength).toBe(PRODUCT_RESPONSE_LENGTH);
		expect(effective.sources.responseLength).toBe("product");
	});

	/**
	 * Changing the global setting leaves a room with its own override untouched. This records that the
	 * global settings screen never walks through the rooms to edit them.
	 */
	it("a room with an override keeps its value when the global changes", () => {
		const room = pref("short");
		expect(
			resolveEffectiveGeneration({ global: pref("long"), room }).responseLength,
		).toBe("short");
		expect(
			resolveEffectiveGeneration({ global: pref("standard"), room })
				.responseLength,
		).toBe("short");
	});
});

describe("response length → output cap", () => {
	/**
	 * Keeps existing conversations unchanged. A user with no preferences gets the same ceiling as
	 * before. If this value diverged, the slice would have changed every room's behavior.
	 */
	it("without a preference the cap equals the contract default", () => {
		expect(resolveEffectiveGeneration({}).maxOutputTokens).toBe(
			CHAT_DEFAULT_OUTPUT_TOKENS,
		);
	});

	it("all three levels are within the contract cap", () => {
		for (const length of RESPONSE_LENGTHS) {
			const tokens = outputTokensFor(length);
			expect(tokens).toBeGreaterThan(0);
			expect(tokens).toBeLessThanOrEqual(RESPONSE_LENGTH_TOKEN_CEILING);
		}
	});

	it("longer means a larger cap", () => {
		expect(outputTokensFor("short")).toBeLessThan(outputTokensFor("standard"));
		expect(outputTokensFor("standard")).toBeLessThan(outputTokensFor("long"));
	});

	it("the resolved cap is the chosen level's cap", () => {
		expect(
			resolveEffectiveGeneration({ room: pref("long") }).maxOutputTokens,
		).toBe(outputTokensFor("long"));
	});
});

describe("reading boundary", () => {
	/**
	 * A stale or corrupted value left on the device, passed through, would map to `undefined` in the
	 * token table and fail generation for that room alone. A setting would block a conversation.
	 */
	it.each([
		["모르는 단계", "extra-long"],
		["빈 문자열", ""],
		["숫자", 2048],
		["null", null],
		["객체", { responseLength: "long" }],
	])("%s는 응답 길이가 아니다", (_label, value) => {
		expect(isResponseLength(value)).toBe(false);
	});

	it("every defined level passes", () => {
		for (const length of RESPONSE_LENGTHS)
			expect(isResponseLength(length)).toBe(true);
	});
});

describe("empty preference decision", () => {
	it("a preference that decides nothing is empty", () => {
		expect(isEmptyGenerationPreference(EMPTY_GENERATION_PREFERENCE)).toBe(true);
	});

	it("not empty when any one is decided", () => {
		expect(isEmptyGenerationPreference(pref("short"))).toBe(false);
	});

	/**
	 * When an axis is added, this check must be updated too. Otherwise a preference that sets only the
	 * new axis is cleared right after saving, which the user sees as 'picked but not saved'.
	 */
	it("not empty with only a target chosen", () => {
		expect(isEmptyGenerationPreference(targetPref(ANTHROPIC))).toBe(false);
	});

	it("empty only when all three axes are cleared", () => {
		expect(
			isEmptyGenerationPreference({
				responseLength: null,
				target: null,
				reasoningEffort: null,
			}),
		).toBe(true);
		expect(
			isEmptyGenerationPreference({
				responseLength: "long",
				target: ANTHROPIC,
				reasoningEffort: null,
			}),
		).toBe(false);
	});

	/**
	 * Forgetting to update `isEmptyGenerationPreference` when an axis is added means a preference that
	 * chose only inference is deleted right after saving, because the store deletes the row of an
	 * empty preference. Users who also chose another axis would not see the symptom.
	 */
	it("not empty with only reasoning chosen", () => {
		expect(
			isEmptyGenerationPreference({
				responseLength: null,
				target: null,
				reasoningEffort: "high",
			}),
		).toBe(false);
	});
});

describe("generation target: room > global > product default", () => {
	/**
	 * A user with no settings falls to the RowCat managed tier. That is this slice's safety property.
	 * If this assertion breaks, every existing user is suddenly asked to connect a provider.
	 */
	it("RowCat managed when no layer decides", () => {
		const effective = resolveEffectiveGeneration({});
		expect(effective.target).toEqual(PRODUCT_GENERATION_TARGET);
		expect(effective.target.provider).toBe("rowcat");
		/**
		 * Must be a real managed model, not a placeholder. The slot once held `default`, a name that
		 * pointed to a model chosen by a deployment environment variable. The value must now be a model
		 * that can be selected from the catalog.
		 */
		expect(effective.target.model).toBe(DEFAULT_MANAGED_MODEL);
		expect(effective.target.model).not.toBe("default");
		expect([...ROWCAT_MANAGED_MODELS]).toContain(effective.target.model);
		expect(effective.sources.target).toBe("product");
	});

	it("global wins when only global decides", () => {
		const effective = resolveEffectiveGeneration({
			global: targetPref(ANTHROPIC),
		});
		expect(effective.target).toEqual(ANTHROPIC);
		expect(effective.sources.target).toBe("global");
	});

	it("room beats global when the room decides", () => {
		const effective = resolveEffectiveGeneration({
			global: targetPref(ANTHROPIC),
			room: targetPref(GEMINI),
		});
		expect(effective.target).toEqual(GEMINI);
		expect(effective.sources.target).toBe("room");
	});

	it("clearing the room override inherits the global again", () => {
		const effective = resolveEffectiveGeneration({
			global: targetPref(ANTHROPIC),
			room: EMPTY_GENERATION_PREFERENCE,
		});
		expect(effective.target).toEqual(ANTHROPIC);
		expect(effective.sources.target).toBe("global");
	});

	it("clearing the global override inherits the product default target again", () => {
		const effective = resolveEffectiveGeneration({
			global: EMPTY_GENERATION_PREFERENCE,
		});
		expect(effective.target).toEqual(PRODUCT_GENERATION_TARGET);
		expect(effective.sources.target).toBe("product");
	});

	/**
	 * Room A has an override and room B inherits. The resolver is pure, so asking twice with the same
	 * global value splits the answers. Changing one room does not reach another.
	 */
	it("one room's override does not leak into another room", () => {
		const global = targetPref(ANTHROPIC);
		expect(
			resolveEffectiveGeneration({ global, room: targetPref(GEMINI) }).target,
		).toEqual(GEMINI);
		expect(
			resolveEffectiveGeneration({ global, room: EMPTY_GENERATION_PREFERENCE })
				.target,
		).toEqual(ANTHROPIC);
	});
});

describe("axes do not drag each other along", () => {
	/**
	 * This block is the reason for per-axis `sources`. If one axis's override pulled the other axes
	 * into the room, a value the user set once would become fixed. A single-axis `source` would
	 * wrongly show 'default settings in use' on one of the two controls.
	 */
	it("when a room covers only the target, length follows the global", () => {
		const effective = resolveEffectiveGeneration({
			global: {
				responseLength: "long",
				target: ANTHROPIC,
				reasoningEffort: null,
			},
			room: targetPref(GEMINI),
		});
		expect(effective.responseLength).toBe("long");
		expect(effective.target).toEqual(GEMINI);
		expect(effective.sources).toEqual({
			responseLength: "global",
			target: "room",
			reasoningEffort: "product",
		});
	});

	it("when a room covers only length, the target follows the global", () => {
		const effective = resolveEffectiveGeneration({
			global: {
				responseLength: "long",
				target: ANTHROPIC,
				reasoningEffort: null,
			},
			room: pref("short"),
		});
		expect(effective.responseLength).toBe("short");
		expect(effective.target).toEqual(ANTHROPIC);
		expect(effective.sources).toEqual({
			responseLength: "room",
			target: "global",
			reasoningEffort: "product",
		});
	});

	it("when global decides only the target, length is the product default", () => {
		const effective = resolveEffectiveGeneration({
			global: targetPref(ANTHROPIC),
		});
		expect(effective.responseLength).toBe(PRODUCT_RESPONSE_LENGTH);
		expect(effective.sources).toEqual({
			responseLength: "product",
			target: "global",
			reasoningEffort: "product",
		});
	});

	/**
	 * A row saved before the target axis existed has no such field. The store reader fills in `target:
	 * null` (`local-generation/record.ts`), so the resolver sees this shape.
	 */
	it("preferences from before the target and reasoning axes still read", () => {
		const legacy: GenerationPreference = {
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		};
		const effective = resolveEffectiveGeneration({ global: legacy });
		expect(effective.responseLength).toBe("long");
		expect(effective.target).toEqual(PRODUCT_GENERATION_TARGET);
		expect(effective.sources).toEqual({
			responseLength: "global",
			target: "product",
			reasoningEffort: "product",
		});
	});
});

describe("target reading boundary", () => {
	/**
	 * This reader is lenient at one point only: generation time. Throwing on an unknown shape would
	 * make the user see a broken conversation rather than a settings issue. Casting it through would
	 * let an arbitrary string become a provider name and flow down to the router.
	 */
	it("accepts a valid BYO target", () => {
		expect(
			readGenerationTarget({
				provider: "anthropic-byo",
				model: "claude-sonnet-5",
			}),
		).toEqual(ANTHROPIC);
		expect(
			readGenerationTarget({
				provider: "gemini-byo",
				model: "gemini-3.7-flash",
			}),
		).toEqual(GEMINI);
	});

	/**
	 * Managed is now several models. The reader must accept the whole vocabulary of the contract, not
	 * one product default. Accepting only one would make a preference for any other model fall back to
	 * the upper layer every time, so it looks as though it is never saved.
	 */
	it.each([
		...ROWCAT_MANAGED_MODELS,
	])("accepts the managed target %s", (model) => {
		expect(readGenerationTarget({ provider: "rowcat", model })).toEqual({
			provider: "rowcat",
			model,
		});
	});

	it("the product default target is within that vocabulary too", () => {
		expect(
			readGenerationTarget({
				provider: "rowcat",
				model: DEFAULT_MANAGED_MODEL,
			}),
		).toEqual(PRODUCT_GENERATION_TARGET);
	});

	it.each([
		["모르는 제공자", { provider: "openai-byo", model: "gpt-5" }],
		["제공자 없음", { model: "claude-sonnet-5" }],
		["모델 없음", { provider: "anthropic-byo" }],
		["빈 모델", { provider: "anthropic-byo", model: "" }],
		["모델이 문자열이 아님", { provider: "anthropic-byo", model: 7 }],
		/**
		 * An upstream slug is not a managed identity. If it passed, the value would be sent with the
		 * request, and the saved preference would become an arbitrary-model routing surface.
		 */
		[
			"관리형인데 상류 슬러그",
			{ provider: "rowcat", model: "anthropic/claude-sonnet-5" },
		],
		/** The old single-model literal. No compatibility path is kept, so it is an unknown value. */
		["관리형인데 옛 리터럴", { provider: "rowcat", model: "default" }],
		/** A model that exists only in the BYO catalog cannot be chosen as managed. */
		[
			"관리형인데 BYO 카탈로그에만 있는 모델",
			{ provider: "rowcat", model: "claude-opus-4-5" },
		],
		["객체가 아님", "anthropic-byo"],
		["null", null],
		["배열", ["anthropic-byo", "claude-sonnet-5"]],
	])("%s는 대상이 아니다", (_label, value) => {
		expect(readGenerationTarget(value)).toBeNull();
	});

	it("unknown provider names are not in the vocabulary", () => {
		expect(isGenerationProvider("openai-byo")).toBe(false);
		expect(isGenerationProvider("rowcat")).toBe(true);
		expect(isGenerationProvider("anthropic-byo")).toBe(true);
		expect(isGenerationProvider("gemini-byo")).toBe(true);
	});

	it("only providers whose credentials the device holds are BYO", () => {
		expect(isByoProvider("rowcat")).toBe(false);
		expect(isByoProvider("anthropic-byo")).toBe(true);
		expect(isByoProvider("gemini-byo")).toBe(true);
	});
});

describe("target identity", () => {
	it("equal only when provider and model both match", () => {
		expect(sameGenerationTarget(ANTHROPIC, { ...ANTHROPIC })).toBe(true);
		expect(
			sameGenerationTarget(ANTHROPIC, {
				provider: "anthropic-byo",
				model: "claude-opus-5",
			}),
		).toBe(false);
		expect(sameGenerationTarget(ANTHROPIC, GEMINI)).toBe(false);
	});

	/**
	 * The key must stay `provider:model`, so a stored preference matches its catalog entry (the same
	 * shape as the server's `modelId`).
	 */
	it("the key is provider:model", () => {
		expect(generationTargetKey(ANTHROPIC)).toBe(
			"anthropic-byo:claude-sonnet-5",
		);
		expect(generationTargetKey(PRODUCT_GENERATION_TARGET)).toBe(
			`rowcat:${DEFAULT_MANAGED_MODEL}`,
		);
		expect(
			generationTargetKey({ provider: "rowcat", model: "claude-sonnet-5" }),
		).toBe("rowcat:claude-sonnet-5");
	});
});

/**
 * The third axis. It must follow exactly the same rules as the other two.
 *
 * This block exists because a new axis can quietly behave differently. A special rule borrowed from
 * inheritance (for example, overriding the target also pulling reasoning into the room) would make
 * a value set once become fixed, and the symptom appears only when the global value changes later.
 */
describe("reasoning effort", () => {
	const reasoningPref = (
		reasoningEffort: GenerationPreference["reasoningEffort"],
	): GenerationPreference => ({
		responseLength: null,
		target: null,
		reasoningEffort,
	});

	it("the product default when nobody decides", () => {
		const effective = resolveEffectiveGeneration({});
		expect(effective.reasoningEffort).toBe(PRODUCT_REASONING_EFFORT);
		expect(effective.sources.reasoningEffort).toBe("product");
	});

	it("the global value stands when global decides", () => {
		const effective = resolveEffectiveGeneration({
			global: reasoningPref("high"),
		});
		expect(effective.reasoningEffort).toBe("high");
		expect(effective.sources.reasoningEffort).toBe("global");
	});

	it("room beats global", () => {
		const effective = resolveEffectiveGeneration({
			global: reasoningPref("high"),
			room: reasoningPref("low"),
		});
		expect(effective.reasoningEffort).toBe("low");
		expect(effective.sources.reasoningEffort).toBe("room");
	});

	/**
	 * `null` means 'not chosen', not 'off'. If the two are not distinguished, choosing `Use default`
	 * copies the current global value into the room, and that room then stops following later
	 * changes to the global setting.
	 */
	it("a room's null follows the global", () => {
		const effective = resolveEffectiveGeneration({
			global: reasoningPref("high"),
			room: reasoningPref(null),
		});
		expect(effective.reasoningEffort).toBe("high");
		expect(effective.sources.reasoningEffort).toBe("global");
	});

	it("covering only reasoning leaves the other two following upstream", () => {
		const effective = resolveEffectiveGeneration({
			global: {
				responseLength: "long",
				target: ANTHROPIC,
				reasoningEffort: null,
			},
			room: reasoningPref("minimal"),
		});
		expect(effective.responseLength).toBe("long");
		expect(effective.target).toEqual(ANTHROPIC);
		expect(effective.sources).toEqual({
			responseLength: "global",
			target: "global",
			reasoningEffort: "room",
		});
	});

	it("covering only the target leaves reasoning following the global", () => {
		const effective = resolveEffectiveGeneration({
			global: {
				responseLength: null,
				target: null,
				reasoningEffort: "high",
			},
			room: targetPref(GEMINI),
		});
		expect(effective.reasoningEffort).toBe("high");
		expect(effective.sources).toEqual({
			responseLength: "product",
			target: "room",
			reasoningEffort: "global",
		});
	});

	/**
	 * This axis does not export derived values. Response length becomes a token count through a table,
	 * but reasoning steps differ by model. A value fixed here would become a promise that the request
	 * goes out with it, and this layer, unaware of model capabilities, cannot keep that promise.
	 */
	it("the resolved result has no derived parameters", () => {
		const effective = resolveEffectiveGeneration({});
		expect(Object.keys(effective).sort()).toEqual([
			"maxOutputTokens",
			"reasoningEffort",
			"responseLength",
			"sources",
			"target",
		]);
	});
});
