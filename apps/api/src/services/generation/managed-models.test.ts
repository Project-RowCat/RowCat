import {
	PRODUCT_REASONING_EFFORT,
	resolveExecutableReasoning,
} from "@rowcat/chat";
import {
	DEFAULT_MANAGED_MODEL,
	ROWCAT_MANAGED_MODELS,
} from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import { resolveUpstreamReasoning } from "./chat.ts";
import { listManagedModels, resolveManagedModel } from "./managed-models.ts";
import { listGenerationModels } from "./models.ts";

/**
 * Managed routing: one identity goes to exactly one upstream. The vocabulary and the registry live
 * in different files (contract vs server), and a mismatched deployment fails silently ("400 after
 * send, only for users of that model"), so this file guards the pairing.
 */

describe("vocabulary ↔ registry", () => {
	it("every selectable managed model has an upstream path", () => {
		for (const id of ROWCAT_MANAGED_MODELS)
			expect(resolveManagedModel(id)?.upstream).toBeTruthy();
	});

	/**
	 * Also check the reverse: an identity only in the registry cannot be chosen by anyone, and nothing
	 * breaks so it would stay forever.
	 */
	it("the registry has no rows outside the vocabulary", () => {
		expect(listManagedModels().map((route) => route.id)).toEqual([
			...ROWCAT_MANAGED_MODELS,
		]);
	});

	/** Overlapping upstreams would send two entries to the same model with no way for users to know. */
	it("upstream slugs don't collide", () => {
		const upstreams = listManagedModels().map((route) => route.upstream);
		expect(new Set(upstreams).size).toBe(upstreams.length);
	});

	it("upstream slugs have the `provider/model` form", () => {
		for (const route of listManagedModels())
			expect(route.upstream).toMatch(/^[a-z0-9-]+\/[a-z0-9.-]+$/);
	});
});

describe("upstream mapping", () => {
	/**
	 * The v0.6.x lineup as-is. The whole table is pinned because these values set the invoice and the
	 * model's character: a row silently pointing at another slug makes users believe they got the
	 * model they chose.
	 */
	it("public identity → OpenRouter slug table", () => {
		expect(
			Object.fromEntries(
				listManagedModels().map((route) => [route.id, route.upstream]),
			),
		).toEqual({
			"gpt-6-astra": "openai/gpt-6-astra",
			"gpt-6.1-sol": "openai/gpt-6.1-sol",
			"gpt-6-sol": "openai/gpt-6-sol",
			"gpt-6-luna": "openai/gpt-6-luna",
			"gpt-5.6-luna": "openai/gpt-5.6-luna",
			"gpt-5.6-terra": "openai/gpt-5.6-terra",
			"gpt-5.6-sol": "openai/gpt-5.6-sol",
			"claude-fable-5-1": "anthropic/claude-fable-5.1",
			"claude-fable-5": "anthropic/claude-fable-5",
			"claude-opus-5-5": "anthropic/claude-opus-5.5",
			"claude-opus-5": "anthropic/claude-opus-5",
			"claude-sonnet-5-5": "anthropic/claude-sonnet-5.5",
			"claude-sonnet-5": "anthropic/claude-sonnet-5",
			/**
			 * A dot. This row alone was a hyphen for a while (`anthropic/claude-haiku-4-5`), a name the
			 * gateway lacks, so managed generation for this model failed outright.
			 */
			"claude-haiku-4-5": "anthropic/claude-haiku-4.5",
			"claude-opus-4-8": "anthropic/claude-opus-4.8",
			"claude-opus-4-7": "anthropic/claude-opus-4.7",
			"claude-opus-4-6": "anthropic/claude-opus-4.6",
			"claude-sonnet-4-6": "anthropic/claude-sonnet-4.6",
			"claude-sonnet-4-5": "anthropic/claude-sonnet-4.5",
			"gemini-3.8-flash": "google/gemini-3.8-flash",
			"gemini-3.7-flash": "google/gemini-3.7-flash",
			"gemini-3.6-flash": "google/gemini-3.6-flash",
			"gemini-3.5-flash": "google/gemini-3.5-flash",
			"gemini-3.5-flash-lite": "google/gemini-3.5-flash-lite",
			"deepseek-v4-pro": "deepseek/deepseek-v4-pro",
			"deepseek-v4.1-flash": "deepseek/deepseek-v4.1-flash",
			"deepseek-v4-flash": "deepseek/deepseek-v4-flash",
			"mimo-v2.6-flash": "xiaomi/mimo-v2.6-flash",
			"glm-5.3": "z-ai/glm-5.3",
			"glm-5.3-flash": "z-ai/glm-5.3-flash",
			"glm-5.2": "z-ai/glm-5.2",
		});
	});

	it("Claude Sonnet 5 goes to anthropic/claude-sonnet-5", () => {
		expect(resolveManagedModel("claude-sonnet-5")?.upstream).toBe(
			"anthropic/claude-sonnet-5",
		);
	});

	it("DeepSeek V4 Pro goes to deepseek/deepseek-v4-pro", () => {
		expect(resolveManagedModel("deepseek-v4-pro")?.upstream).toBe(
			"deepseek/deepseek-v4-pro",
		);
	});

	/** Labels are real model names, not constellation aliases. */
	it("the label is the real model name", () => {
		expect(
			Object.fromEntries(
				listManagedModels().map((route) => [route.id, route.label]),
			),
		).toEqual({
			"gpt-6-astra": "GPT-6 Astra",
			"gpt-6.1-sol": "GPT-6.1 Sol",
			"gpt-6-sol": "GPT-6 Sol",
			"gpt-6-luna": "GPT-6 Luna",
			"gpt-5.6-luna": "GPT-5.6 Luna",
			"gpt-5.6-terra": "GPT-5.6 Terra",
			"gpt-5.6-sol": "GPT-5.6 Sol",
			"claude-fable-5-1": "Claude Fable 5.1",
			"claude-fable-5": "Claude Fable 5",
			"claude-opus-5-5": "Claude Opus 5.5",
			"claude-opus-5": "Claude Opus 5",
			"claude-sonnet-5-5": "Claude Sonnet 5.5",
			"claude-sonnet-5": "Claude Sonnet 5",
			"claude-haiku-4-5": "Claude Haiku 4.5",
			"claude-opus-4-8": "Claude Opus 4.8",
			"claude-opus-4-7": "Claude Opus 4.7",
			"claude-opus-4-6": "Claude Opus 4.6",
			"claude-sonnet-4-6": "Claude Sonnet 4.6",
			"claude-sonnet-4-5": "Claude Sonnet 4.5",
			"gemini-3.8-flash": "Gemini 3.8 Flash",
			"gemini-3.7-flash": "Gemini 3.7 Flash",
			"gemini-3.6-flash": "Gemini 3.6 Flash",
			"gemini-3.5-flash": "Gemini 3.5 Flash",
			"gemini-3.5-flash-lite": "Gemini 3.5 Flash-Lite",
			"deepseek-v4-pro": "DeepSeek V4 Pro",
			"deepseek-v4.1-flash": "DeepSeek V4.1 Flash",
			"deepseek-v4-flash": "DeepSeek V4 Flash",
			"mimo-v2.6-flash": "MiMo v2.6 Flash",
			"glm-5.3": "GLM 5.3",
			"glm-5.3-flash": "GLM 5.3 Flash",
			"glm-5.2": "GLM 5.2",
		});
	});
});

describe("unknown identity", () => {
	/**
	 * Not substituted: falling back to the default model makes users think their chosen model is
	 * running and read a response of different character and cost as theirs.
	 */
	it.each([
		["the old single-model literal", "default"],
		["upstream slug", "anthropic/claude-sonnet-5"],
		["a model that exists only in the BYO catalogue", "claude-opus-4-5"],
		["provider name", "anthropic-byo"],
		["empty string", ""],
	])("%s gets no path", (_label, value) => {
		expect(resolveManagedModel(value)).toBeNull();
	});
});

describe("maker", () => {
	it("every row has a company", () => {
		for (const route of listManagedModels())
			expect(route.vendor.length).toBeGreaterThan(0);
	});

	/**
	 * Not derived from the upstream namespace: that makes routing data the source of a screen string,
	 * and the vendor name would change when the gateway renames a slug. The current values must still
	 * agree; if not, one of the two is a typo.
	 */
	it("the company and the upstream namespace agree", () => {
		const namespaceOf: Record<string, string> = {
			OpenAI: "openai",
			Anthropic: "anthropic",
			Google: "google",
			DeepSeek: "deepseek",
			Xiaomi: "xiaomi",
			"Z.ai": "z-ai",
		};
		for (const route of listManagedModels())
			expect(route.upstream.split("/")[0]).toBe(namespaceOf[route.vendor]);
	});

	/** The screen only groups adjacent same-company rows, so scattering shows the same title twice. */
	it("the same company isn't scattered in the list", () => {
		const vendors = listManagedModels().map((route) => route.vendor);
		const runs = vendors.filter((vendor, i) => vendor !== vendors[i - 1]);
		expect(runs.length).toBe(new Set(vendors).size);
	});
});

describe("product default", () => {
	/** A real managed model, not a placeholder like `"default"`. */
	it("is a real managed model", () => {
		expect(DEFAULT_MANAGED_MODEL).toBe("deepseek-v4-pro");
		expect(resolveManagedModel(DEFAULT_MANAGED_MODEL)?.upstream).toBe(
			"deepseek/deepseek-v4-pro",
		);
	});
});

describe("immutability", () => {
	it("the next call is intact even when a caller modifies the result", () => {
		const first = listManagedModels();
		const before = first.length;
		first.splice(0, first.length);
		expect(listManagedModels()).toHaveLength(before);
	});
});

/**
 * Reasoning capability table, model by model.
 *
 * Lumping by company would only confirm our habits. The values come from each provider's current
 * docs and the gateway's `supported_parameters` (2026-08-29). The whole table is pinned because
 * mismatches are silent: an unlisted level going upstream is a 400, and if the gateway folds it to
 * a nearby value the screen and the run diverge with no error at all.
 */
describe("reasoning capability", () => {
	const efforts = (id: string): readonly string[] | null => {
		const route = resolveManagedModel(id);
		if (!route) throw new Error(`model not in the registry: ${id}`);
		return route.reasoning ? [...route.reasoning.efforts] : null;
	};

	const THREE = ["low", "medium", "high"];
	const FOUR = ["minimal", "low", "medium", "high"];

	it("public identity → selectable levels table", () => {
		expect(
			Object.fromEntries(
				listManagedModels().map((route) => [
					route.id,
					route.reasoning ? [...route.reasoning.efforts] : null,
				]),
			),
		).toEqual({
			/**
			 * GPT-6 Astra's effort vocabulary starts at `low` and reasoning cannot be turned off
			 * (`mandatory: true`). The three levels overlapping ours are distinct runs, so `THREE`.
			 */
			"gpt-6-astra": THREE,
			/**
			 * The effort vocabulary of GPT-6 Sol/Luna and GPT-5.6 goes `none` then `low`, with no `minimal`.
			 * The first two can turn reasoning off unlike Astra (`mandatory: false`) but the conclusion is
			 * the same.
			 */
			"gpt-6.1-sol": THREE,
			"gpt-6-sol": THREE,
			"gpt-6-luna": THREE,
			"gpt-5.6-luna": THREE,
			"gpt-5.6-terra": THREE,
			"gpt-5.6-sol": THREE,
			/**
			 * Anthropic's effort vocabulary starts at `low`. Fable 5.1 and Opus 5.5 cannot turn thinking off
			 * (`mandatory: true`) but our vocabulary has no off value, so same result.
			 */
			"claude-fable-5-1": THREE,
			"claude-fable-5": THREE,
			"claude-opus-5-5": THREE,
			"claude-opus-5": THREE,
			"claude-sonnet-5-5": THREE,
			"claude-sonnet-5": THREE,
			/**
			 * The 4.5 generation is extended-thinking only with no concept of effort levels, and the gateway
			 * exposes no such parameter, so a chosen level would be silently ignored: `null`. On BYO it is
			 * three (we send the budget ourselves; see `chat-models.test.ts`).
			 */
			"claude-haiku-4-5": null,
			"claude-sonnet-4-5": null,
			"claude-opus-4-8": THREE,
			"claude-opus-4-7": THREE,
			"claude-opus-4-6": THREE,
			"claude-sonnet-4-6": THREE,
			/** It differs within the same Gemini: 3.8 and 3.7 Flash have no `minimal`. */
			"gemini-3.8-flash": THREE,
			"gemini-3.7-flash": THREE,
			"gemini-3.6-flash": FOUR,
			"gemini-3.5-flash": FOUR,
			"gemini-3.5-flash-lite": FOUR,
			/**
			 * Both V4 models are `null` because upstream is the same: the gateway answers only
			 * `["xhigh","high"]` for both (2026-08-29) and just `high` overlaps our vocabulary, so there is
			 * nothing to choose. Pro was `THREE` for a while and then low, standard and high all folded to
			 * `high` upstream.
			 *
			 * The "same upstream capability" test below locks the fact that these must be equal; this table
			 * alone cannot stop reverting only one of them.
			 */
			"deepseek-v4-pro": null,
			/** The six below are targets where RowCat chose not to offer adjustable reasoning. */
			"deepseek-v4.1-flash": null,
			"deepseek-v4-flash": null,
			"mimo-v2.6-flash": null,
			"glm-5.3": null,
			"glm-5.3-flash": null,
			"glm-5.2": null,
		});
	});

	/** Records by value that capability really differs within one company. */
	it("models from the same company have different capabilities", () => {
		expect(efforts("gemini-3.7-flash")).not.toEqual(
			efforts("gemini-3.5-flash"),
		);
		expect(efforts("claude-sonnet-5")).not.toEqual(
			efforts("claude-sonnet-4-5"),
		);
	});

	/** The default effort is always inside the list; outside it, normalization falls to a missing value every time. */
	it("the default level is in the list", () => {
		for (const route of listManagedModels())
			if (route.reasoning)
				expect(route.reasoning.efforts).toContain(
					route.reasoning.defaultEffort,
				);
	});

	/**
	 * Targets with the same upstream capability get the same ruling.
	 *
	 * The table above pins each value but cannot say why they must match: reverting one to `THREE` is
	 * a one-line change that looks like an ordinary diff in review. The gateway answered the same
	 * `["xhigh","high"]` for all three (2026-08-29), so their rulings are the same.
	 */
	it("targets with the same upstream capability don't get split decisions", () => {
		/** Targets where the gateway answers only `["xhigh","high"]`; one level overlaps our vocabulary. */
		const sameUpstreamCapability = [
			"deepseek-v4-pro",
			"deepseek-v4-flash",
			"glm-5.2",
		];
		for (const id of sameUpstreamCapability) expect(efforts(id)).toBeNull();
	});
});

/**
 * Continuation shape table, which differs even within Anthropic.
 *
 * Anthropic rows were verified with real continuation requests on 2026-09-23: 4.6 and later
 * rejected prefill with a 400 ("This model does not support assistant message prefill…") and the
 * result was the same without reasoning; only the 4.5 generation accepted it. The whole table is
 * pinned because the failure is silent: if one row reverts to `prefill`, `Continue generating` always fails for
 * users of that model and the screen shows a cause-less `Generation failed.`.
 */
describe("continuation shape", () => {
	it("public identity → continuation shape table", () => {
		expect(
			Object.fromEntries(
				listManagedModels().map((route) => [route.id, route.continuation]),
			),
		).toEqual({
			/**
			 * Non-Anthropic rows are not verified values: they are the shape sent before this axis existed
			 * (see `continuation` in the registry). A commit that changes them comes after the same
			 * verification.
			 */
			"gpt-6-astra": "prefill",
			"gpt-6.1-sol": "prefill",
			"gpt-6-sol": "prefill",
			"gpt-6-luna": "prefill",
			"gpt-5.6-luna": "prefill",
			"gpt-5.6-terra": "prefill",
			"gpt-5.6-sol": "prefill",
			/** 4.6 and later do not accept prefill, whether or not thinking can be turned off. */
			"claude-fable-5-1": "nudge",
			"claude-fable-5": "nudge",
			"claude-opus-5-5": "nudge",
			"claude-opus-5": "nudge",
			"claude-sonnet-5-5": "nudge",
			"claude-sonnet-5": "nudge",
			/** The 4.5 generation accepts prefill (but not together with a thinking-enabled request). */
			"claude-haiku-4-5": "prefill",
			"claude-sonnet-4-5": "prefill",
			"claude-opus-4-8": "nudge",
			"claude-opus-4-7": "nudge",
			"claude-opus-4-6": "nudge",
			"claude-sonnet-4-6": "nudge",
			"gemini-3.8-flash": "prefill",
			"gemini-3.7-flash": "prefill",
			"gemini-3.6-flash": "prefill",
			"gemini-3.5-flash": "prefill",
			"gemini-3.5-flash-lite": "prefill",
			"deepseek-v4-pro": "prefill",
			"deepseek-v4.1-flash": "prefill",
			"deepseek-v4-flash": "prefill",
			"mimo-v2.6-flash": "prefill",
			"glm-5.3": "prefill",
			"glm-5.3-flash": "prefill",
			"glm-5.2": "prefill",
		});
	});

	/**
	 * It differs within one company: records by value that a company-name rule (`anthropic/` means
	 * nudge) is wrong.
	 */
	it("models from the same company have different shapes", () => {
		expect(resolveManagedModel("claude-sonnet-5")?.continuation).toBe("nudge");
		expect(resolveManagedModel("claude-sonnet-4-5")?.continuation).toBe(
			"prefill",
		);
	});
});

/**
 * Reasoning path of the product default target.
 *
 * `deepseek-v4-pro` is the default model, so this is the path of someone who never opened AI
 * settings. The product default effort is `medium` (`PRODUCT_REASONING_EFFORT` in `@rowcat/chat`)
 * but this target cannot run it, so the question is what happens where they meet. The answer must
 * be nothing: an inherited `medium` is not forced onto a target with no capability.
 */
describe("default target", () => {
	it("the product default model has no adjustable reasoning", () => {
		expect(resolveManagedModel(DEFAULT_MANAGED_MODEL)?.reasoning).toBeNull();
	});

	/**
	 * The inherited product default effort is not promoted to an executed level for this target. The
	 * server normalization and the pure layer must agree (both `null`), and that value is "no
	 * `reasoning` key in the request body"; `services/generation/chat.test.ts` checks the body.
	 */
	it("the product default level isn't forced on the default model", () => {
		const capability =
			resolveManagedModel(DEFAULT_MANAGED_MODEL)?.reasoning ?? null;
		expect(resolveUpstreamReasoning(capability, PRODUCT_REASONING_EFFORT)).toBe(
			null,
		);
		expect(
			resolveExecutableReasoning(capability, PRODUCT_REASONING_EFFORT),
		).toBe(null);
	});

	/**
	 * The value the catalogue tells the screen must match too: if the registry is `null` but the
	 * catalogue drew levels, users would read them as selectable. Records that the projection is
	 * single.
	 */
	it("the catalogue projection equals the registry", () => {
		const entry = listGenerationModels().find(
			(model) => model.id === `rowcat:${DEFAULT_MANAGED_MODEL}`,
		);
		expect(entry?.reasoning).toBeNull();
	});
});

/**
 * Checks only the consistency of the narration-pack capability table. Which model gets what is a
 * product decision, so values are not rewritten here (that would add a copy of the registry).
 *
 * It catches self-contradicting rows instead: with two densities on a reduced lineage the screen
 * draws a choice while the body has only one, and the mismatch shows only as "the prose is slightly
 * off".
 */
describe("narration pack capability", () => {
	it("the reduced variant has only one density", () => {
		for (const model of listManagedModels()) {
			if (model.promptPack?.lineage !== "reduced") continue;
			expect(model.promptPack.densities).toEqual(["light"]);
		}
	});

	it("the density list is non-empty with no duplicates", () => {
		for (const model of listManagedModels()) {
			const densities = model.promptPack?.densities;
			if (!densities) continue;
			expect(densities.length).toBeGreaterThan(0);
			expect(new Set(densities).size).toBe(densities.length);
		}
	});

	/**
	 * If the model a user with no settings receives has no pack, the feature is invisible in the
	 * default state (the screen only draws "this model does not support narration packs"). This makes
	 * whoever changes the default model meet that fact here.
	 */
	it("the product default model takes packs", () => {
		const fallback = listManagedModels().find(
			(model) => model.id === DEFAULT_MANAGED_MODEL,
		);
		expect(fallback?.promptPack).not.toBeNull();
	});
});
