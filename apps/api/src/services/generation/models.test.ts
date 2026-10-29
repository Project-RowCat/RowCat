import {
	DEFAULT_MANAGED_MODEL,
	GenerationModelListDto,
	REASONING_EFFORTS,
	ROWCAT_MANAGED_MODELS,
} from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import { listManagedModels } from "./managed-models.ts";
import { listGenerationModels } from "./models.ts";

/**
 * Catalogue: what goes out and what does not. Most assertions here are "absent": the catalogue
 * growing is normal, but an upstream slug or price leaking into it takes one line and breaks no
 * other test.
 */

describe("contract", () => {
	it("the response satisfies the contract schema", () => {
		expect(() =>
			GenerationModelListDto.parse({ models: listGenerationModels() }),
		).not.toThrow();
	});

	/** The picker looks entries up by id, so a duplicate would never be selectable. */
	it("ids don't collide", () => {
		const ids = listGenerationModels().map((model) => model.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	/**
	 * The id is `provider:model`. It must match the client's `generationTargetKey` for a stored target
	 * to meet its catalogue entry; otherwise the user's chosen model looks removed.
	 */
	it("ids are assembled from provider and model", () => {
		for (const model of listGenerationModels())
			expect(model.id).toBe(`${model.provider}:${model.model}`);
	});

	it("labels aren't empty", () => {
		for (const model of listGenerationModels()) {
			expect(model.label.length).toBeGreaterThan(0);
			expect(model.providerLabel.length).toBeGreaterThan(0);
		}
	});
});

describe("managed entries", () => {
	const managed = () =>
		listGenerationModels().filter((model) => model.provider === "rowcat");

	/**
	 * Every model RowCat says it provides must be listed. If one is missing nobody can choose it (the
	 * catalogue is the picker's only source) and it shows only as "that model isn't there".
	 */
	it("every managed model appears", () => {
		expect(managed().map((model) => model.model)).toEqual([
			...ROWCAT_MANAGED_MODELS,
		]);
	});

	/**
	 * If the product default target left the catalogue, the preference of someone who configured
	 * nothing would be judged "points at a missing model".
	 */
	it("the product default model is among them", () => {
		expect(managed().map((model) => model.model)).toContain(
			DEFAULT_MANAGED_MODEL,
		);
	});

	/**
	 * Managed calls with the server's own key and does not need a personal API key. A `true` would
	 * draw that model disabled for users with no connection, and they would hunt for a connection
	 * procedure that does not exist.
	 */
	it("none require a connection", () => {
		expect(managed().length).toBeGreaterThan(0);
		for (const model of managed()) expect(model.requiresConnection).toBe(false);
	});

	/**
	 * The most important assertion in this file. The upstream slug must appear nowhere in the
	 * response: it is our gateway contract and routing data, and a browser that knew it would turn the
	 * managed path into an arbitrary-model proxy.
	 */
	it("doesn't expose upstream slugs", () => {
		const serialized = JSON.stringify(listGenerationModels());
		for (const route of listManagedModels())
			expect(serialized).not.toContain(route.upstream);
		expect(serialized).not.toContain("openrouter");
	});

	/**
	 * Labels are real model names with no branding alias. An alias hides what the user is choosing
	 * and, with the same model also in the BYO group, cannot say whether the two are the same.
	 */
	it("doesn't use branding aliases as labels", () => {
		const aliases = [
			"\ub8e8\ub098",
			"\ud14c\ub77c",
			"\uc194\ub77c",
			"\uc2dc\ub9ac\uc6b0\uc2a4",
			"\uc548\ud0c0\ub808\uc2a4",
			"\ub9ac\ub77c",
			"\ub178\ubc14",
			"\uc624\ub9ac\uc628",
			"\ucf54\uba67",
			"\ubca0\uac00",
			"RowCat \uc81c\uacf5",
		];
		for (const model of managed())
			for (const alias of aliases) expect(model.label).not.toContain(alias);
	});

	/**
	 * Upstream metadata (context length, upstream status, upstream price) is not carried.
	 *
	 * The whole key set is counted: written as "no sensitive fields", it would pass while leaking the
	 * day the registry gains an axis (the registry has the upstream slug, this response does not).
	 *
	 * What has grown so far is the narration-pack capability (`promptPack`, density only; neither the
	 * body nor the pack alias), which is not routing. Managed generation is unmetered, so there is no
	 * price field either.
	 */
	it("carries no upstream metadata", () => {
		for (const model of listGenerationModels())
			expect(Object.keys(model).sort()).toEqual([
				"id",
				"label",
				"model",
				"promptPack",
				"provider",
				"providerLabel",
				"reasoning",
				"requiresConnection",
				"vendorLabel",
			]);
	});

	/**
	 * One managed provider holds models from several companies and the screen folds by company; with
	 * an empty company name those rows fall into an untitled group.
	 */
	it("each model carries its maker", () => {
		for (const model of managed()) {
			expect(model.vendorLabel.length).toBeGreaterThan(0);
			/** A different axis from the provider: if they were equal on managed there would be nothing to fold by. */
			expect(model.vendorLabel).not.toBe("RowCat");
		}
		expect(
			new Set(managed().map((model) => model.vendorLabel)).size,
		).toBeGreaterThan(1);
	});

	/**
	 * Same-company models must be adjacent. The screen groups adjacent rows without re-sorting, so
	 * scattering would show the same company twice.
	 */
	it("models from the same company aren't scattered in the list", () => {
		const vendors = managed().map((model) => model.vendorLabel);
		const runs = vendors.filter((vendor, i) => vendor !== vendors[i - 1]);
		expect(runs.length).toBe(new Set(vendors).size);
	});

	/** For BYO the provider is the company. */
	it("BYO uses the provider name as the company", () => {
		for (const model of listGenerationModels().filter(
			(entry) => entry.provider !== "rowcat",
		))
			expect(model.vendorLabel).toBe(model.providerLabel);
	});

	/**
	 * The group title says the access path. `Claude Sonnet 5` in both the RowCat and Anthropic groups
	 * is normal; the two are not given different names.
	 */
	it("the same model in both groups isn't given different names", () => {
		const rowcat = managed().find((model) => model.model === "claude-sonnet-5");
		const anthropic = listGenerationModels().find(
			(model) =>
				model.provider === "anthropic-byo" && model.model === "claude-sonnet-5",
		);
		expect(rowcat?.label).toBe("Claude Sonnet 5");
		expect(anthropic?.label).toBe("Claude Sonnet 5");
		expect(rowcat?.providerLabel).toBe("RowCat");
		expect(anthropic?.providerLabel).toBe("Anthropic");
	});
});

/**
 * Absence of a price axis. Managed generation runs on the operator's key and is unmetered, so the
 * catalogue carries no value to charge users. The assertions below lock that absence.
 */
describe("absence of the pricing axis", () => {
	/**
	 * No cost, exchange rate or currency in the response: the price is a value we set, and no axis
	 * suggesting it tracks upstream cost goes out.
	 */
	it("no cost or currency vocabulary in the response", () => {
		const serialized = JSON.stringify(listGenerationModels()).toLowerCase();
		for (const forbidden of [
			"upstream",
			"openrouter",
			"usd",
			"costusd",
			"cost_usd",
			"providercost",
			"margin",
			"gatewaymodel",
			"usagecost",
			"usage.cost",
			"discount",
			"exchangerate",
			"krw",
		])
			expect(serialized).not.toContain(forbidden);
	});
});

describe("BYO entries", () => {
	const byo = () =>
		listGenerationModels().filter((model) => model.provider !== "rowcat");

	it("all require a connection", () => {
		expect(byo().length).toBeGreaterThan(0);
		for (const model of byo()) expect(model.requiresConnection).toBe(true);
	});

	/**
	 * The browser puts this string verbatim into the provider request. Whitespace or the slug form
	 * (`provider/model`) would be a provider 400 only for users of that entry, after they start
	 * generating.
	 */
	it("the provider's canonical model id form", () => {
		for (const model of byo()) {
			expect(model.model).not.toContain(" ");
			expect(model.model).not.toContain("/");
		}
	});

	/**
	 * Aliases are used. Storing a dated snapshot id would make users of that target "missing" the day
	 * the version retires, and room overrides already stored on devices would keep pointing at the old
	 * string.
	 */
	it("no dated snapshot ids", () => {
		for (const model of byo()) expect(model.model).not.toMatch(/-20\d{6}$/);
	});

	it("only providers with adapters appear", () => {
		const providers = new Set(byo().map((model) => model.provider));
		expect([...providers].sort()).toEqual(["anthropic-byo", "gemini-byo"]);
	});
});

describe("immutability", () => {
	/**
	 * If a route sorted or filtered the received array in place, the mutation would persist for the
	 * life of the process.
	 */
	it("the next call is intact even when a caller modifies the result", () => {
		const first = listGenerationModels();
		const before = first.length;
		first.splice(0, first.length);
		expect(listGenerationModels()).toHaveLength(before);
	});
});

/**
 * Reasoning capability: the catalogue is the only source of this fact.
 *
 * If screens start guessing it from model id, provider or company name, every added model needs a
 * frontend conditional fix and a deployment that misses it draws entries that can be chosen but do
 * not run; that failure arrives after the user sends.
 */
describe("reasoning capability", () => {
	const managed = () =>
		listGenerationModels().filter((model) => model.provider === "rowcat");

	/** No level outside the vocabulary may appear on any entry; such a value cannot go out on any path. */
	it("every declared level is within the product vocabulary", () => {
		for (const model of listGenerationModels())
			for (const effort of model.reasoning?.efforts ?? [])
				expect(REASONING_EFFORTS).toContain(effort);
	});

	/**
	 * A default outside the list makes normalization fall to an unsupported level every time; upstream
	 * rejects that request, silently, for users of that model only.
	 */
	it("the default level is always in the supported list", () => {
		for (const model of listGenerationModels()) {
			if (!model.reasoning) continue;
			expect(model.reasoning.efforts).toContain(model.reasoning.defaultEffort);
		}
	});

	it("no entry has an empty list", () => {
		for (const model of listGenerationModels())
			if (model.reasoning)
				expect(model.reasoning.efforts.length).toBeGreaterThan(0);
	});

	/**
	 * A model with no adjustable reasoning is `null`. An empty array would mean "selectable but
	 * nothing to select" and the screen would draw a control with no items.
	 */
	it("models that can't be adjusted really exist, and their value is null", () => {
		const none = managed().filter((model) => model.reasoning === null);
		expect(none.length).toBeGreaterThan(0);
		for (const model of none) expect(model.reasoning).toBeNull();
	});

	/**
	 * A projection of the registry, not a copy. Rewriting values here would update only one side when
	 * models change; the symptom is a level on screen that the server drops in normalization.
	 */
	it("the managed capability is the same object as the registry's", () => {
		const routes = new Map(
			listManagedModels().map(
				(route) => [route.id as string, route.reasoning] as const,
			),
		);
		for (const model of managed())
			expect(model.reasoning).toBe(routes.get(model.model));
	});

	/**
	 * The translation table belongs to the execution boundary. Budget numbers in this response would
	 * give the screen code that reads them and make the catalogue a provider-parameter channel.
	 */
	it("no thinking budget or provider parameter names in the response", () => {
		const serialized = JSON.stringify(listGenerationModels());
		expect(serialized).not.toContain("budget");
		expect(serialized).not.toContain("thinking");
		expect(serialized).not.toContain("reasoning_effort");
		expect(serialized).not.toContain("thinkingBudget");
	});

	/**
	 * Per-model differences are pinned by value.
	 *
	 * Written as "all Claude are EFFORT_THREE" or "all Gemini Flash have four", this check would only
	 * confirm a company name, and the capability table would reflect our habits rather than the
	 * provider docs; the values below were verified in each provider's current docs (2026-08-29).
	 */
	const effortsOf = (id: string): readonly string[] | null => {
		const model = listGenerationModels().find((entry) => entry.id === id);
		if (!model) throw new Error(`entry not in the catalogue: ${id}`);
		return model.reasoning ? [...model.reasoning.efforts] : null;
	};

	describe("differences per model", () => {
		/**
		 * Anthropic has no `minimal`: its effort vocabulary starts at `low` and the extended-thinking
		 * budget floor is 1,024, so neither method has a slot for that level.
		 */
		it.each([
			"claude-fable-5-1",
			"claude-fable-5",
			"claude-opus-5-5",
			"claude-opus-5",
			"claude-sonnet-5-5",
			"claude-sonnet-5",
			"claude-haiku-4-5",
			"claude-opus-4-8",
			"claude-opus-4-7",
			"claude-opus-4-6",
			"claude-sonnet-4-6",
			"claude-sonnet-4-5",
			"claude-opus-4-5",
		])("anthropic-byo:%s has no minimal", (model) => {
			expect(effortsOf(`anthropic-byo:${model}`)).toEqual([
				"low",
				"medium",
				"high",
			]);
		});

		/**
		 * It differs within Gemini. `thinkingLevel` has no `minimal` on 3.8, 3.7 Flash and 3.1 Pro, and
		 * 2.5 Pro has a budget floor of 128 so it does not accept 0; lumping by company lists an absent
		 * level and the provider rejects that request.
		 */
		it.each([
			["gemini-3.8-flash", ["low", "medium", "high"]],
			["gemini-3.7-flash", ["low", "medium", "high"]],
			["gemini-3.6-flash", ["minimal", "low", "medium", "high"]],
			["gemini-3.5-flash", ["minimal", "low", "medium", "high"]],
			["gemini-3.5-flash-lite", ["minimal", "low", "medium", "high"]],
			["gemini-3.1-pro-preview", ["low", "medium", "high"]],
			["gemini-3.1-flash-lite", ["minimal", "low", "medium", "high"]],
			["gemini-3-flash-preview", ["minimal", "low", "medium", "high"]],
			["gemini-2.5-pro", ["low", "medium", "high"]],
			["gemini-2.5-flash", ["minimal", "low", "medium", "high"]],
		] as [string, string[]][])("gemini-byo:%s", (model, efforts) => {
			expect(effortsOf(`gemini-byo:${model}`)).toEqual(efforts);
		});

		/**
		 * Thinking is off by default and the budget floor is 512, so "off" cannot be expressed: offering
		 * levels would let the inherited `Standard` turn that model's thinking on with nothing to go back to.
		 */
		it("gemini-2.5-flash-lite has no adjustable reasoning", () => {
			expect(effortsOf("gemini-byo:gemini-2.5-flash-lite")).toBeNull();
		});

		/**
		 * Capability can differ per path for the same model. The 4.5 generation is extended-only with no
		 * effort-level concept and the gateway exposes no such parameter, so on managed a chosen level
		 * would be silently ignored (`null`); BYO sends the budget itself, so three.
		 */
		it.each([
			"claude-haiku-4-5",
			"claude-sonnet-4-5",
		])("%s is absent on managed and present on BYO", (model) => {
			expect(effortsOf(`rowcat:${model}`)).toBeNull();
			expect(effortsOf(`anthropic-byo:${model}`)).toEqual([
				"low",
				"medium",
				"high",
			]);
		});

		/**
		 * OpenAI has no `minimal`: GPT-5.6 and GPT-6 Sol/Luna go `none` then `low`, and GPT-6 Astra
		 * starts at `low` (reasoning cannot be turned off).
		 */
		it.each([
			"gpt-6-astra",
			"gpt-6.1-sol",
			"gpt-6-sol",
			"gpt-6-luna",
			"gpt-5.6-luna",
			"gpt-5.6-terra",
			"gpt-5.6-sol",
		])("rowcat:%s has no minimal", (model) => {
			expect(effortsOf(`rowcat:${model}`)).toEqual(["low", "medium", "high"]);
		});

		/** Managed Gemini says the same as BYO; if they diverge the same model differs in two places. */
		it.each([
			["gemini-3.8-flash", ["low", "medium", "high"]],
			["gemini-3.7-flash", ["low", "medium", "high"]],
			["gemini-3.6-flash", ["minimal", "low", "medium", "high"]],
			["gemini-3.5-flash", ["minimal", "low", "medium", "high"]],
			["gemini-3.5-flash-lite", ["minimal", "low", "medium", "high"]],
		] as [string, string[]][])("rowcat:%s", (model, efforts) => {
			expect(effortsOf(`rowcat:${model}`)).toEqual(efforts);
		});

		/** If `minimal` is only in the vocabulary and on no entry, that level is dead. */
		it("some entry actually has minimal", () => {
			expect(
				listGenerationModels().filter((model) =>
					model.reasoning?.efforts.includes("minimal"),
				).length,
			).toBeGreaterThan(0);
		});
	});

	/** The key set of the capability object is counted too, so a new axis cannot go out silently. */
	it("the capability object has only two axes", () => {
		for (const model of listGenerationModels()) {
			if (!model.reasoning) continue;
			expect(Object.keys(model.reasoning).sort()).toEqual([
				"defaultEffort",
				"efforts",
			]);
		}
	});
});
