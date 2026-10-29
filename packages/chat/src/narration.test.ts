import type { GenerationModelDto } from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import type { GenerationTarget } from "./generation-preference.ts";
import { roleplayRules } from "./guards.ts";
import {
	applyRoomNarration,
	type ChatNarrationSettings,
	DEFAULT_NARRATION_SETTINGS,
	NARRATION_PACK_KEYS,
	NARRATION_SCOPES,
	narrationBlockedReason,
	narrationInjection,
	narrationWritesUser,
	promptPackCapabilityFor,
	promptPackKey,
	readNarrationSettings,
	resolveNarrationExecution,
} from "./narration.ts";

const MANAGED: GenerationTarget = {
	provider: "rowcat",
	model: "deepseek-v4-pro",
};
const GPT: GenerationTarget = { provider: "rowcat", model: "gpt-6-astra" };
const OPUS: GenerationTarget = { provider: "rowcat", model: "claude-opus-5" };

const entry = (
	target: GenerationTarget,
	promptPack: GenerationModelDto["promptPack"],
): GenerationModelDto => ({
	id: `${target.provider}:${target.model}`,
	provider: target.provider,
	providerLabel: "RowCat",
	vendorLabel: "vendor",
	label: target.model,
	model: target.model,
	requiresConnection: false,
	reasoning: null,
	promptPack,
});

const CATALOG: GenerationModelDto[] = [
	entry(MANAGED, { lineage: "reduced", densities: ["light"] }),
	entry(GPT, { lineage: "standard", densities: ["light", "rich"] }),
	entry(OPUS, null),
];

const settings = (
	patch: Partial<ChatNarrationSettings> = {},
): ChatNarrationSettings => ({ ...DEFAULT_NARRATION_SETTINGS, ...patch });

const capabilityOf = (target: GenerationTarget) =>
	promptPackCapabilityFor({ models: CATALOG, catalogLoaded: true, target });

describe("vocabulary", () => {
	it("the four narration scopes have a fixed order", () => {
		expect(NARRATION_SCOPES).toEqual([
			"strict",
			"reactive",
			"assisted",
			"auto",
		]);
	});

	it("only the right two of the dial write the user's character", () => {
		expect(NARRATION_SCOPES.map(narrationWritesUser)).toEqual([
			false,
			false,
			true,
			true,
		]);
	});

	/**
	 * Pins the defaults as product decisions: the neutral scope, the light density, and the
	 * character-card panel being off.
	 */
	it("turning on a pack starts neutral with character cards off", () => {
		expect(DEFAULT_NARRATION_SETTINGS).toEqual({
			scope: "reactive",
			density: "light",
			castTracking: false,
		});
	});

	it("the vocabulary's product equals the 24 packs", () => {
		expect(NARRATION_PACK_KEYS).toHaveLength(24);
		expect(promptPackKey("standard", settings())).toBe("hedge:basic:compact");
		expect(promptPackKey("standard", settings({ density: "rich" }))).toBe(
			"thumbs:basic:compact",
		);
		expect(promptPackKey("reduced", settings({ scope: "auto" }))).toBe(
			"deepseek:auto:compact",
		);
		expect(promptPackKey("standard", settings({ castTracking: true }))).toBe(
			"hedge:basic:sim",
		);
	});
});

describe("reading stored values", () => {
	it("unknown shapes are null rather than throwing", () => {
		for (const bad of [
			null,
			undefined,
			"reactive",
			{},
			{ scope: "narrate" },
			{ scope: "auto", density: "ultra", castTracking: false },
			{ scope: "auto", density: "light" },
			{ scope: "auto", density: "light", castTracking: "yes" },
		])
			expect(readNarrationSettings(bad)).toBeNull();
	});

	it("sound values pass as is", () => {
		expect(
			readNarrationSettings({
				scope: "auto",
				density: "rich",
				castTracking: true,
				extra: 1,
			}),
		).toEqual({ scope: "auto", density: "rich", castTracking: true });
	});
});

describe("the representation of absence", () => {
	it("turning the pack off removes the key itself", () => {
		const room = { id: "r1", narration: settings() };
		const cleared = applyRoomNarration(room, null);
		expect("narration" in cleared).toBe(false);
		expect(applyRoomNarration(cleared, settings({ scope: "auto" }))).toEqual({
			id: "r1",
			narration: settings({ scope: "auto" }),
		});
	});
});

describe("capability", () => {
	it("claims nothing when the catalogue did not arrive", () => {
		expect(
			promptPackCapabilityFor({
				models: [],
				catalogLoaded: false,
				target: GPT,
			}),
		).toBeUndefined();
	});

	it("claims nothing for a target missing from the catalogue", () => {
		expect(
			promptPackCapabilityFor({
				models: CATALOG,
				catalogLoaded: true,
				target: { provider: "anthropic-byo", model: "sonnet" },
			}),
		).toBeUndefined();
	});

	it("a target the server says lacks it is null", () => {
		expect(capabilityOf(OPUS)).toBeNull();
	});
});

describe("execution", () => {
	it("rides as chosen on a model that supports the density", () => {
		expect(
			resolveNarrationExecution({
				settings: settings({ scope: "auto", density: "rich" }),
				capability: capabilityOf(GPT),
			}),
		).toEqual({
			packKey: "thumbs:auto:compact",
			scope: "auto",
			density: "rich",
			castTracking: false,
			densityFolded: false,
		});
	});

	it("a density the model cannot do folds, and the stored value is untouched", () => {
		const stored = settings({ scope: "assisted", density: "rich" });
		const execution = resolveNarrationExecution({
			settings: stored,
			capability: capabilityOf(MANAGED),
		});
		expect(execution).toEqual({
			packKey: "deepseek:imp:compact",
			scope: "assisted",
			density: "light",
			castTracking: false,
			densityFolded: true,
		});
		expect(stored.density).toBe("rich");
	});

	it("nothing rides without a setting or when the model cannot take it", () => {
		for (const capability of [capabilityOf(OPUS), undefined])
			expect(
				resolveNarrationExecution({ settings: settings(), capability }),
			).toBeNull();
		expect(
			resolveNarrationExecution({
				settings: null,
				capability: capabilityOf(GPT),
			}),
		).toBeNull();
	});
});

describe("⚠️ without a pack standing, the protective sentences stay", () => {
	it("without a body no delegation decision is built at all", () => {
		const execution = resolveNarrationExecution({
			settings: settings({ scope: "auto" }),
			capability: capabilityOf(GPT),
		});
		expect(execution).not.toBeNull();
		expect(narrationInjection(execution, "")).toBeNull();
		expect(narrationInjection(execution, "   \n ")).toBeNull();
		expect(narrationInjection(null, "본문이 있어도")).toBeNull();
	});

	it("the delegation decision is true only with a body", () => {
		const execution = resolveNarrationExecution({
			settings: settings({ scope: "auto" }),
			capability: capabilityOf(GPT),
		});
		const injection = narrationInjection(execution, "PACK");
		expect(injection?.writesUser).toBe(true);
		/**
		 * The body must start the injection, with the policy following it. Placed first, the pack body's
		 * recency would override the policy.
		 */
		expect(injection?.text.startsWith("PACK")).toBe(true);
	});

	it("non-delegating scopes keep the protective sentences even with a body", () => {
		for (const scope of ["strict", "reactive"] as const) {
			const execution = resolveNarrationExecution({
				settings: settings({ scope }),
				capability: capabilityOf(GPT),
			});
			expect(narrationInjection(execution, "PACK")?.writesUser).toBe(false);
		}
	});

	/**
	 * Consent wording stays in every scope. An earlier draft dropped the first block in delegated
	 * scopes and dropped this sentence too. That would leave nothing stopping the AI from writing the
	 * user's sexual consent in autoplay with adult mode on.
	 */
	it("the consent sentence stands in delegating scopes too", () => {
		for (const writesUser of [false, true])
			expect(roleplayRules(writesUser)).toContain("동의");
		expect(roleplayRules(false)).toContain("대신 묘사하지 마세요");
		expect(roleplayRules(true)).not.toContain("대신 묘사하지 마세요");
		expect(roleplayRules(true)).toContain("되돌릴 수 없는 결정");
	});
});

describe("reasons for blocking", () => {
	it("the three branches do not fold into each other", () => {
		expect(
			narrationBlockedReason({ settings: null, capability: capabilityOf(GPT) }),
		).toBe("not-configured");
		expect(
			narrationBlockedReason({ settings: settings(), capability: undefined }),
		).toBe("catalog-unknown");
		expect(
			narrationBlockedReason({
				settings: settings(),
				capability: capabilityOf(OPUS),
			}),
		).toBe("model-unsupported");
		expect(
			narrationBlockedReason({
				settings: settings(),
				capability: capabilityOf(GPT),
			}),
		).toBeNull();
	});
});
