import type { GenerationModelDto } from "@rowcat/contracts/chat";
import { ModelReasoningDto, REASONING_EFFORTS } from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import type { GenerationTarget } from "./generation-preference.ts";
import {
	buildReasoningOptions,
	type ModelReasoningCapability,
	type ReasoningEffort,
	reasoningCapabilityFor,
	reasoningEffortForRequest,
	reasoningOverrideStale,
	reconcileReasoningOverride,
	resolveExecutableReasoning,
	supportsReasoningEffort,
} from "./reasoning.ts";

/**
 * Reasoning capability, checked without rendering. The failures here are hard to notice on screen.
 * A level the model cannot accept appearing in the list leads the user to believe a saved value
 * runs. A stale override that survives leaves the screen drawing a level different from the one
 * that runs. Neither produces an error; both show up only as a change in the character of
 * responses.
 */

const MANAGED: GenerationTarget = { provider: "rowcat", model: "gpt-5.6-sol" };
const CLAUDE: GenerationTarget = {
	provider: "rowcat",
	model: "claude-sonnet-5",
};
const FLASH_LITE: GenerationTarget = {
	provider: "rowcat",
	model: "gemini-3.5-flash-lite",
};
const BYO: GenerationTarget = {
	provider: "anthropic-byo",
	model: "claude-sonnet-5",
};

const FOUR: ModelReasoningCapability = {
	efforts: ["minimal", "low", "medium", "high"],
	defaultEffort: "medium",
};
const THREE: ModelReasoningCapability = {
	efforts: ["low", "medium", "high"],
	defaultEffort: "medium",
};

const entry = (
	target: GenerationTarget,
	reasoning: ModelReasoningCapability | null,
): GenerationModelDto => ({
	id: `${target.provider}:${target.model}`,
	provider: target.provider,
	providerLabel: target.provider === "rowcat" ? "RowCat" : "Anthropic",
	vendorLabel: "OpenAI",
	label: target.model,
	model: target.model,
	requiresConnection: target.provider !== "rowcat",
	reasoning,
	promptPack: null,
});

const CATALOG: GenerationModelDto[] = [
	entry(MANAGED, FOUR),
	entry(CLAUDE, THREE),
	entry(FLASH_LITE, null),
	entry(BYO, THREE),
];

describe("vocabulary", () => {
	/**
	 * Provider parameters must not leak into the vocabulary. If names such as `reasoning_effort` or
	 * `budget_tokens` came in here, then on the day a provider appeared that does not accept the
	 * value, saved preferences would lose their meaning.
	 */
	it("only four phases, in a fixed order", () => {
		expect([...REASONING_EFFORTS]).toEqual([
			"minimal",
			"low",
			"medium",
			"high",
		]);
	});
});

describe("capability lookup", () => {
	/**
	 * `null` and `undefined` are different facts. Folding the second into the first would make a brief
	 * network failure read as 'this model has no reasoning settings'.
	 */
	it("claims nothing when the catalogue did not arrive", () => {
		expect(
			reasoningCapabilityFor({
				models: [],
				catalogLoaded: false,
				target: MANAGED,
			}),
		).toBeUndefined();
	});

	it("answers unknown for a target missing from the catalogue too", () => {
		expect(
			reasoningCapabilityFor({
				models: CATALOG,
				catalogLoaded: true,
				target: { provider: "gemini-byo", model: "없는-모델" },
			}),
		).toBeUndefined();
	});

	/** Being unable to adjust is a known fact, so the answer is `null`. */
	it("a non-adjustable model is null", () => {
		expect(
			reasoningCapabilityFor({
				models: CATALOG,
				catalogLoaded: true,
				target: FLASH_LITE,
			}),
		).toBeNull();
	});

	it("joins targets and catalogue entries by the same key", () => {
		expect(
			reasoningCapabilityFor({
				models: CATALOG,
				catalogLoaded: true,
				target: BYO,
			}),
		).toEqual(THREE);
	});

	it("a different provider is a different entry", () => {
		const managed = reasoningCapabilityFor({
			models: [entry(CLAUDE, FOUR), entry(BYO, THREE)],
			catalogLoaded: true,
			target: CLAUDE,
		});
		expect(managed).toEqual(FOUR);
	});
});

describe("executable levels", () => {
	it("supported levels go out as is", () => {
		expect(resolveExecutableReasoning(FOUR, "minimal")).toBe("minimal");
	});

	/**
	 * Never falls back to a different model. The function returns a level or `null`, and it takes no
	 * target argument, so it cannot switch models.
	 */
	it("unsupported levels fold to that model's default", () => {
		expect(resolveExecutableReasoning(THREE, "minimal")).toBe("medium");
	});

	it("a non-adjustable model has no parameter", () => {
		expect(resolveExecutableReasoning(null, "high")).toBeNull();
	});

	it("the support check is the list as is", () => {
		expect(supportsReasoningEffort(THREE, "minimal")).toBe(false);
		expect(supportsReasoningEffort(THREE, "high")).toBe(true);
		expect(supportsReasoningEffort(null, "high")).toBe(false);
	});
});

describe("the value to put on the request", () => {
	const capabilityOf = (target: GenerationTarget) =>
		reasoningCapabilityFor({
			models: CATALOG,
			catalogLoaded: true,
			target,
		});

	it("normalized when confirmed", () => {
		expect(
			reasoningEffortForRequest({
				target: CLAUDE,
				effort: "minimal",
				capability: capabilityOf(CLAUDE),
			}),
		).toBe("medium");
	});

	it("puts nothing on a non-adjustable target", () => {
		expect(
			reasoningEffortForRequest({
				target: FLASH_LITE,
				effort: "high",
				capability: capabilityOf(FLASH_LITE),
			}),
		).toBeNull();
	});

	/**
	 * The behavior differs by path. For managed, the server re-checks against its own registry, so
	 * sending an unverified value is safe. Not sending it would permanently lose the level chosen by a
	 * user whose catalog failed to load. For BYO, this browser is the last check. Sending an
	 * unverified value gets it rejected by the provider, which blocks the conversation.
	 */
	it("an unconfirmed managed target sends as is", () => {
		expect(
			reasoningEffortForRequest({
				target: MANAGED,
				effort: "high",
				capability: undefined,
			}),
		).toBe("high");
	});

	it("an unconfirmed BYO target puts nothing", () => {
		expect(
			reasoningEffortForRequest({
				target: BYO,
				effort: "high",
				capability: undefined,
			}),
		).toBeNull();
	});
});

describe("clears an override that became unusable when the target changes", () => {
	const reconcile = (
		reasoningEffort: Parameters<
			typeof reconcileReasoningOverride
		>[0]["reasoningEffort"],
		target: GenerationTarget,
		catalogLoaded = true,
	) =>
		reconcileReasoningOverride({
			reasoningEffort,
			target,
			models: CATALOG,
			catalogLoaded,
		});

	it("an override that is still usable stays", () => {
		expect(reconcile("high", CLAUDE)).toBe("high");
	});

	/**
	 * Does not move the value to another level. Saving a level the user never chose as an explicit
	 * choice would be wrong.
	 */
	it("an unusable override is cleared", () => {
		expect(reconcile("minimal", CLAUDE)).toBeNull();
	});

	it("switching to a non-adjustable model clears it", () => {
		expect(reconcile("high", FLASH_LITE)).toBeNull();
	});

	it("does nothing without an override", () => {
		expect(reconcile(null, FLASH_LITE)).toBeNull();
	});

	/**
	 * If the check cannot be made, do not delete. A brief network failure must not delete the user's
	 * setting; that loss cannot be undone.
	 */
	it("leaves it alone when the catalogue did not arrive", () => {
		expect(reconcile("minimal", CLAUDE, false)).toBe("minimal");
	});
});

describe("the list the control draws", () => {
	const options = (
		over: Partial<Parameters<typeof buildReasoningOptions>[0]> = {},
	) =>
		buildReasoningOptions({
			models: CATALOG,
			catalogLoaded: true,
			target: MANAGED,
			value: null,
			inherited: "medium",
			...over,
		});

	it("the row stands for an adjustable target", () => {
		const result = options();
		expect(result.available).toBe(true);
		expect([...result.efforts]).toEqual(["minimal", "low", "medium", "high"]);
	});

	/** The list is filtered by this model's capabilities, so levels it cannot accept are not drawn. */
	it("levels the model lacks are not in the list", () => {
		expect([...options({ target: CLAUDE }).efforts]).toEqual([
			"low",
			"medium",
			"high",
		]);
	});

	/** The whole row disappears rather than showing a disabled control in its place. */
	it("no row for a non-adjustable target", () => {
		const result = options({ target: FLASH_LITE });
		expect(result.available).toBe(false);
		expect(result.efforts).toEqual([]);
	});

	it("no row when the catalogue did not arrive", () => {
		expect(options({ catalogLoaded: false, models: [] }).available).toBe(false);
	});

	/**
	 * The text in parentheses must be the effective value. Showing an inherited level as-is would
	 * promise something other than what runs, because such a room actually runs on the model default.
	 */
	it("inherited values pass this model's capability too", () => {
		expect(
			options({ target: CLAUDE, inherited: "minimal" }).inheritedEffort,
		).toBe("medium");
		expect(options({ inherited: "minimal" }).inheritedEffort).toBe("minimal");
	});

	/** While inheriting, the control holds no value; that empty slot is the first item. */
	it("the value is null without an override", () => {
		expect(options().value).toBeNull();
	});

	/**
	 * A stored value the target cannot achieve is not inserted into the list; it is marked stale. The
	 * list used to append such a value, on the grounds that an empty trigger would otherwise appear.
	 * That assumed a short window in which the catalog changed under the screen. The window never
	 * closes when a parent layer changes the model: this layer's model selector is never pressed, so
	 * cleanup never runs, and the screen keeps drawing a level that does not execute. The inherited
	 * item is always present, so the empty-trigger reason no longer applies.
	 */
	it("a stored value outside the capability is not in the list and is marked stale", () => {
		const result = options({ target: CLAUDE, value: "minimal" });
		expect(result.stale).toBe(true);
		expect(result.efforts).not.toContain("minimal");
	});

	/**
	 * The value about to be saved is previewed. Once cleanup deletes the override, this layer
	 * inherits, and the value that runs is `inheritedEffort`. The screen and execution therefore
	 * converge on the same value.
	 */
	it("a stale value shows folded to inheritance", () => {
		const result = options({ target: CLAUDE, value: "minimal" });
		expect(result.value).toBeNull();
		expect(result.inheritedEffort).toBe("medium");
	});

	/** A usable override is not stale. This keeps the removal check from returning true by mistake. */
	it("a usable override is not stale", () => {
		const result = options({ target: CLAUDE, value: "high" });
		expect(result.stale).toBe(false);
		expect(result.value).toBe("high");
	});

	/** With no override there is nothing to remove, so this condition is never the path to true. */
	it("not stale while inheriting", () => {
		expect(options({ target: CLAUDE }).stale).toBe(false);
	});

	/**
	 * An unverified state is never called stale. If it were, the screen would delete the user's
	 * override, and the loss would be the cost of a brief network blip.
	 */
	it("not stale when the catalogue did not arrive", () => {
		const result = options({
			catalogLoaded: false,
			models: [],
			value: "minimal",
		});
		expect(result.stale).toBe(false);
		expect(result.value).toBe("minimal");
	});

	/** Nothing is deleted even for a target that cannot be adjusted; the row is simply absent. */
	it("not stale for a non-adjustable target", () => {
		expect(options({ target: FLASH_LITE, value: "high" }).stale).toBe(false);
	});
});

/**
 * The case where a parent layer changes the target. This layer's model selector was never pressed.
 * `reconcileReasoningOverride` covers 'this layer chose a target'. This function covers 'the
 * effective target changed outside this layer'. Both use the same rule but are asked at different
 * moments. If nobody asks the second question, a saved explicit preference can keep a meaning
 * different from what it says, permanently.
 */
describe("when the inherited target changed elsewhere", () => {
	const stale = (
		reasoningEffort: ReasoningEffort | null,
		target: GenerationTarget,
		catalogLoaded = true,
	) =>
		reasoningOverrideStale({
			reasoningEffort,
			target,
			models: CATALOG,
			catalogLoaded,
		});

	it("not stale while still usable", () => {
		expect(stale("high", CLAUDE)).toBe(false);
	});

	it("stale when the inherited model lacks that level", () => {
		expect(stale("minimal", CLAUDE)).toBe(true);
	});

	it("stale when inheriting a non-adjustable model", () => {
		expect(stale("high", FLASH_LITE)).toBe(true);
	});

	/**
	 * If there is no override there is nothing to delete, so this always returns false. That is why no
	 * save loop exists.
	 */
	it("not stale without an override", () => {
		expect(stale(null, FLASH_LITE)).toBe(false);
		expect(stale(null, CLAUDE)).toBe(false);
	});

	/** After a deletion the condition stays false, so save and re-check stop after one pass. */
	it("a cleared result does not become stale again", () => {
		const cleaned = reconcileReasoningOverride({
			reasoningEffort: "minimal",
			target: CLAUDE,
			models: CATALOG,
			catalogLoaded: true,
		});
		expect(cleaned).toBeNull();
		expect(stale(cleaned, CLAUDE)).toBe(false);
	});

	it("not stale when the catalogue did not arrive", () => {
		expect(stale("minimal", CLAUDE, false)).toBe(false);
	});

	it("not stale for a target missing from the list", () => {
		expect(
			stale("minimal", { provider: "gemini-byo", model: "사라진-모델" }),
		).toBe(false);
	});

	/**
	 * The two functions must apply the same rule. If they diverge, the screen and the saved state
	 * change at different moments.
	 */
	it("decides the same as the cleanup function", () => {
		for (const target of [MANAGED, CLAUDE, FLASH_LITE])
			for (const effort of [
				null,
				"minimal",
				"low",
				"medium",
				"high",
			] as const) {
				const input = {
					reasoningEffort: effort,
					target,
					models: CATALOG,
					catalogLoaded: true,
				};
				expect(reasoningOverrideStale(input)).toBe(
					effort !== null && reconcileReasoningOverride(input) === null,
				);
			}
	});
});

describe("contract schema", () => {
	/**
	 * A default that is not in the list is rejected. Otherwise normalization would drop it to an
	 * unsupported level on every read.
	 */
	it("refuses a default level outside the list", () => {
		expect(() =>
			ModelReasoningDto.parse({ efforts: ["low"], defaultEffort: "high" }),
		).toThrow();
	});

	it("refuses an empty list", () => {
		expect(() =>
			ModelReasoningDto.parse({ efforts: [], defaultEffort: "high" }),
		).toThrow();
	});

	it("refuses levels outside the vocabulary", () => {
		expect(() =>
			ModelReasoningDto.parse({
				efforts: ["insane"],
				defaultEffort: "insane",
			}),
		).toThrow();
	});
});

/**
 * The screen and execution converge on the same value. This slice's most silent defect is a
 * mismatch between them: no error, no log, and the user believes the level they chose is running.
 * So the results of the two functions are compared in a single matrix: what `buildReasoningOptions`
 * puts in the control, and what `reasoningEffortForRequest` puts in the request.
 */
describe("screen and execution converge", () => {
	const TARGETS: GenerationTarget[] = [MANAGED, CLAUDE, FLASH_LITE];
	const VALUES: (ReasoningEffort | null)[] = [
		null,
		"minimal",
		"low",
		"medium",
		"high",
	];

	const executed = (
		stored: ReasoningEffort | null,
		target: GenerationTarget,
		inherited: ReasoningEffort,
	) =>
		reasoningEffortForRequest({
			target,
			effort: stored ?? inherited,
			capability: reasoningCapabilityFor({
				models: CATALOG,
				catalogLoaded: true,
				target,
			}),
		});

	it.each(
		TARGETS.map((target) => [`${target.provider}:${target.model}`, target]),
	)("%s에서 정리 뒤의 화면 값이 곧 실행 값이다", (_label, target) => {
		for (const stored of VALUES)
			for (const inherited of ["minimal", "medium", "high"] as const) {
				/** Cleanup runs each time the screen opens. This is how the product is wired. */
				const cleaned = reconcileReasoningOverride({
					reasoningEffort: stored,
					target: target as GenerationTarget,
					models: CATALOG,
					catalogLoaded: true,
				});
				const view = buildReasoningOptions({
					models: CATALOG,
					catalogLoaded: true,
					target: target as GenerationTarget,
					value: cleaned,
					inherited,
				});
				const runs = executed(cleaned, target as GenerationTarget, inherited);

				expect(view.stale).toBe(false);
				if (!view.available) {
					expect(runs).toBeNull();
					continue;
				}
				expect(view.value ?? view.inheritedEffort).toBe(runs);
			}
	});

	/**
	 * Even before cleanup the screen does not mislead. A stale value shows as inherited, which is the
	 * value that will run after deletion. At most the screen leads by one frame; it never diverges.
	 */
	it("a stale value before cleanup draws the execution value after clearing", () => {
		const view = buildReasoningOptions({
			models: CATALOG,
			catalogLoaded: true,
			target: CLAUDE,
			value: "minimal",
			inherited: "high",
		});
		expect(view.stale).toBe(true);
		expect(view.value ?? view.inheritedEffort).toBe(
			executed(null, CLAUDE, "high"),
		);
	});
});
