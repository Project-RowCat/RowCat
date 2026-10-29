import type { GenerationTarget } from "@rowcat/chat";
import { PRODUCT_GENERATION_TARGET } from "@rowcat/chat";
import { DEFAULT_MANAGED_MODEL } from "@rowcat/contracts";
import type { GenerationModel } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import {
	buildModelOptions,
	INHERIT_VALUE,
	targetForKey,
	unavailableMessage,
} from "./model-options.ts";

/**
 * Covers what the model selection control shows and what it blocks. Every failure here touches the
 * user's saved choice, and each one is silent and costly:
 * - Letting the user pick an unconnected entry creates a state that saves but cannot generate.
 * - Dropping a saved value from the list empties the trigger, so the user reads the choice as
 *   lost.
 * - Collapsing all reasons into one tells a connected provider to show `connect it`.
 * - Reading a catalog failure as 'gone' makes a network glitch look like a removed model.
 *
 * Rendering is not tested (this repo's web tests have no React). What is tested is the list and its
 * verdicts, which come from pure functions.
 */

const model = (
	provider: GenerationModel["provider"],
	name: string,
	label: string,
	requiresConnection: boolean,
	/**
	 * The company that made the model. When empty, the provider name is used as-is (BYO catalogs work
	 * this way).
	 */
	vendor?: string,
): GenerationModel => {
	const providerLabel =
		provider === "rowcat"
			? "RowCat"
			: provider === "anthropic-byo"
				? "Anthropic"
				: "Google Gemini";
	return {
		id: `${provider}:${name}`,
		provider,
		providerLabel,
		vendorLabel: vendor ?? providerLabel,
		label,
		model: name,
		requiresConnection,
		/**
		 * This file only checks the two-column lists. Reasoning capability is tested separately, so
		 * reasoning and promptPack stay null here.
		 */
		reasoning: null,
		promptPack: null,
	};
};

/**
 * The managed entries are now several, and one of them has the same name as a BYO group. The
 * overlap is intentional: the same model can be called with our key or with the user's own key, and
 * the group name says which. If list-building code starts looking up entries by `label` or `model`,
 * the two groups would mix. An entry's identity is its `id`.
 */
const MANAGED_DEFAULT = model(
	"rowcat",
	DEFAULT_MANAGED_MODEL,
	"DeepSeek V4 Pro",
	false,
	"DeepSeek",
);
const MANAGED_SONNET = model(
	"rowcat",
	"claude-sonnet-5",
	"Claude Sonnet 5",
	false,
	"Anthropic",
);
const SONNET = model(
	"anthropic-byo",
	"claude-sonnet-5",
	"Claude Sonnet 5",
	true,
);
const FLASH = model("gemini-byo", "gemini-3.7-flash", "Gemini 3.7 Flash", true);
const CATALOG = [MANAGED_DEFAULT, MANAGED_SONNET, SONNET, FLASH];

const MANAGED_KEY = `rowcat:${DEFAULT_MANAGED_MODEL}`;

const ANTHROPIC_TARGET: GenerationTarget = {
	provider: "anthropic-byo",
	model: "claude-sonnet-5",
};

/**
 * Finds an entry in the model column. The search is limited to the selected provider, which matches
 * how the column is rendered.
 */
const entry = (options: ReturnType<typeof buildModelOptions>, key: string) =>
	options.models.find((it) => it.key === key);

const providerEntry = (
	options: ReturnType<typeof buildModelOptions>,
	provider: string,
) => options.providers.find((it) => it.provider === provider);

const build = (input: Partial<Parameters<typeof buildModelOptions>[0]>) =>
	buildModelOptions({
		models: CATALOG,
		value: null,
		inherited: PRODUCT_GENERATION_TARGET,
		connected: [],
		byoAllowed: true,
		catalogLoaded: true,
		...input,
	});

/**
 * The effective target (`effectiveModel`). While inheriting, it points at the inherited target. An
 * empty model column and having no applicable target are different facts.
 */
describe("the target that applies now", () => {
	it("points at the inherited target while inheriting", () => {
		const options = build({ value: null });
		expect(options.modelValue).toBeNull();
		expect(options.effectiveModel?.id).toBe(MANAGED_KEY);
	});

	it("points at the override when there is one", () => {
		const options = build({
			value: ANTHROPIC_TARGET,
			connected: ["anthropic-byo"],
		});
		expect(options.effectiveModel?.id).toBe("anthropic-byo:claude-sonnet-5");
	});

	/**
	 * Being unusable and what would apply are different facts, so a target blocked by a missing
	 * connection is still reported.
	 */
	it("also points at a target blocked for lack of connection", () => {
		const options = build({ value: ANTHROPIC_TARGET, connected: [] });
		expect(options.unavailable?.reason).toBe("provider_not_connected");
		expect(options.effectiveModel?.id).toBe("anthropic-byo:claude-sonnet-5");
	});

	/**
	 * A managed model that exists in the vocabulary but not in this deployment's catalog (retired).
	 * The target must not be pointed at.
	 */
	it("does not point at a target missing from the list", () => {
		const options = build({
			models: [MANAGED_DEFAULT, SONNET, FLASH],
			value: {
				provider: "rowcat",
				model: "claude-sonnet-5",
			} as GenerationTarget,
		});
		expect(options.effectiveModel).toBeNull();
	});

	it("stays silent when the catalog did not arrive", () => {
		expect(
			build({ models: [], catalogLoaded: false, value: null }).effectiveModel,
		).toBeNull();
	});
});

describe("two columns — provider first, then model", () => {
	it("the provider column holds every provider in catalog order", () => {
		expect(build({}).providers.map((it) => it.provider)).toEqual([
			"rowcat",
			"anthropic-byo",
			"gemini-byo",
		]);
	});

	it("the first item is always inheritance", () => {
		expect(build({}).providerItems[0]?.value).toBe(INHERIT_VALUE);
	});

	/**
	 * While inheriting, no provider is selected, so the model column is empty. That column shows the
	 * inherited name instead, because leaving it blank would hide what currently applies.
	 */
	it("while inheriting, the model column is empty and shows the inherited name", () => {
		const options = build({ value: null });
		expect(options.providerValue).toBe(INHERIT_VALUE);
		expect(options.modelValue).toBeNull();
		expect(options.models).toEqual([]);
		expect(options.inheritedModelLabel).toBe("DeepSeek V4 Pro");
	});

	it("with an override both columns point at it", () => {
		const options = build({ value: ANTHROPIC_TARGET });
		expect(options.providerValue).toBe("anthropic-byo");
		expect(options.modelValue).toBe("anthropic-byo:claude-sonnet-5");
	});

	/**
	 * The model column contains only the selected provider's models. If another provider's models
	 * mixed in, the reason for splitting the choice into two columns would disappear.
	 */
	it("the model column does not mix in other providers' models", () => {
		const options = build({
			value: { provider: "rowcat", model: "claude-sonnet-5" },
		});
		expect(options.models.map((it) => it.key)).toEqual([
			MANAGED_KEY,
			"rowcat:claude-sonnet-5",
		]);
	});
});

describe("the model column is grouped by maker", () => {
	/**
	 * Under the managed provider, models from several companies appear. Without grouping they would
	 * form one unordered run, and users would have to scan for the company they recognize.
	 */
	it("managed folds into per-company subgroups", () => {
		const options = build({ value: PRODUCT_GENERATION_TARGET });
		expect(
			options.modelGroups.map((group) => [
				group.label,
				group.entries.map((entry) => entry.key),
			]),
		).toEqual([
			["DeepSeek", [MANAGED_KEY]],
			["Anthropic", ["rowcat:claude-sonnet-5"]],
		]);
	});

	/**
	 * Groups keep catalog order; do not re-sort by company. Re-sorting would hide a registry mistake
	 * in which one company's models are scattered, and that mistake would never surface.
	 */
	it("does not re-sort by company — scattered entries appear twice", () => {
		const options = build({
			models: [
				model("rowcat", "claude-opus-5", "Claude Opus 5", false, "Anthropic"),
				model(
					"rowcat",
					"deepseek-v4-pro",
					"DeepSeek V4 Pro",
					false,
					"DeepSeek",
				),
				model(
					"rowcat",
					"claude-sonnet-5",
					"Claude Sonnet 5",
					false,
					"Anthropic",
				),
			],
			value: { provider: "rowcat", model: "claude-opus-5" },
		});
		expect(
			options.modelGroups.map((group) => [
				group.label,
				group.entries.map((entry) => entry.key),
			]),
		).toEqual([
			["Anthropic", ["rowcat:claude-opus-5"]],
			["DeepSeek", ["rowcat:deepseek-v4-pro"]],
			["Anthropic", ["rowcat:claude-sonnet-5"]],
		]);
	});

	/**
	 * With only one company there is no heading, because the provider column already says it and
	 * repeating it would be redundant. BYO always looks like this.
	 */
	it("no heading when there is only one company", () => {
		const options = build({
			value: ANTHROPIC_TARGET,
			connected: ["anthropic-byo"],
		});
		expect(options.modelGroups).toHaveLength(1);
		expect(options.modelGroups[0]?.label).toBeNull();
		expect(options.modelGroups[0]?.entries.map((it) => it.key)).toEqual([
			"anthropic-byo:claude-sonnet-5",
		]);
	});

	/**
	 * Flattening the subgroups must reproduce the model column exactly; grouping must not drop
	 * entries.
	 */
	it("the subgroups together equal the model column", () => {
		const options = build({ value: PRODUCT_GENERATION_TARGET });
		expect(options.modelGroups.flatMap((group) => group.entries)).toEqual(
			options.models,
		);
	});

	it("no subgroups while inheriting", () => {
		expect(build({ value: null }).modelGroups).toEqual([]);
	});
});

describe("what can be chosen and what can run", () => {
	it("managed can be chosen without a connection", () => {
		const options = build({ value: PRODUCT_GENERATION_TARGET });
		expect(providerEntry(options, "rowcat")?.disabled).toBe(false);
		expect(entry(options, MANAGED_KEY)?.disabled).toBe(false);
		expect(entry(options, "rowcat:claude-sonnet-5")?.disabled).toBe(false);
		expect(options.unavailable).toBeNull();
	});

	/**
	 * No connection guidance is attached to managed entries anywhere. If it were, users would hunt for
	 * a setup procedure that does not exist (RowCat managed needs no connection).
	 */
	it("managed has no suffix", () => {
		const options = build({ value: PRODUCT_GENERATION_TARGET });
		expect(providerEntry(options, "rowcat")?.label).toBe("RowCat");
		expect(options.models).toHaveLength(2);
		for (const item of options.models) {
			expect(item.disabled).toBe(false);
			expect(item.label).not.toContain("connect");
			expect(item.label).not.toContain("under 14");
		}
	});

	/**
	 * The same model name under two providers does not open or block the other. RowCat's Claude Sonnet
	 * 5 is open without a connection, while Anthropic's same name requires one.
	 */
	it("managed and BYO items with the same name are independent", () => {
		const managed = build({
			value: { provider: "rowcat", model: "claude-sonnet-5" },
		});
		expect(entry(managed, "rowcat:claude-sonnet-5")?.disabled).toBe(false);
		const byo = build({ value: ANTHROPIC_TARGET });
		expect(entry(byo, "anthropic-byo:claude-sonnet-5")?.disabled).toBe(true);
	});

	it("an unconnected BYO provider is shown but cannot be chosen", () => {
		const item = providerEntry(build({}), "anthropic-byo");
		expect(item).toBeDefined();
		expect(item?.disabled).toBe(true);
		/**
		 * The reason for being blocked must be inside the label itself (`Connect the provider first`). A gray state alone
		 * is not readable.
		 */
		expect(item?.label).toContain("Connect the provider first");
	});

	it("with a connection it can be chosen and has no suffix", () => {
		const options = build({ connected: ["anthropic-byo"] });
		const item = providerEntry(options, "anthropic-byo");
		expect(item?.disabled).toBe(false);
		expect(item?.label).toBe("Anthropic");
	});

	it("one provider's connection does not open another", () => {
		const options = build({ connected: ["anthropic-byo"] });
		expect(providerEntry(options, "gemini-byo")?.disabled).toBe(true);
	});

	/**
	 * Connection and credential status is stated once, by the provider column. Repeating the same
	 * sentence in the model column would make it stop being read.
	 */
	it("connection guidance is only in the provider column", () => {
		const options = build({ value: ANTHROPIC_TARGET });
		expect(providerEntry(options, "anthropic-byo")?.label).toContain(
			"Connect the provider first",
		);
		for (const item of options.models)
			expect(item.label).not.toContain("Connect the provider first");
	});
});

describe("choosing a provider also sets the model", () => {
	/**
	 * A provider-only selection cannot be stored, because the saved model has no slot for it. So
	 * choosing a provider also decides one target.
	 */
	it("that provider's first model is set too", () => {
		expect(providerEntry(build({}), "rowcat")?.defaultTarget).toEqual(
			PRODUCT_GENERATION_TARGET,
		);
	});

	/**
	 * Usable first. Executability is per provider, so it usually matches the first line. But there are
	 * real cases where every catalog entry of an unconnected provider is blocked while only the saved
	 * value is open. Re-selecting that provider must then return to the current value. Selecting a
	 * blocked model would give the user a target they never chose and cannot use.
	 */
	it("without a connection the saved value becomes that provider's default", () => {
		const stored: GenerationTarget = {
			provider: "anthropic-byo",
			model: "claude-retired-1",
		};
		const options = build({ value: stored, connected: [] });
		expect(providerEntry(options, "anthropic-byo")?.defaultTarget).toEqual(
			stored,
		);
	});

	it("with a connection it is the catalog's first model", () => {
		const options = build({ connected: ["anthropic-byo"] });
		expect(providerEntry(options, "anthropic-byo")?.defaultTarget).toEqual(
			ANTHROPIC_TARGET,
		);
	});

	/**
	 * Does not cross providers: even when nothing in the provider is usable, the choice stays within
	 * that provider rather than taking someone else's model.
	 */
	it("chooses within that provider even when nothing is usable", () => {
		const target = providerEntry(build({}), "gemini-byo")?.defaultTarget;
		expect(target?.provider).toBe("gemini-byo");
	});
});

describe("a saved value is not erased", () => {
	it("a target missing from the catalog still has a place in the list", () => {
		const gone: GenerationTarget = {
			provider: "anthropic-byo",
			model: "claude-retired-1",
		};
		const options = build({ value: gone, connected: ["anthropic-byo"] });
		const item = entry(options, "anthropic-byo:claude-retired-1");
		expect(item).toBeDefined();
		/**
		 * The current (saved) value must stay selectable. If it were disabled, the trigger would render
		 * empty.
		 */
		expect(item?.disabled).toBe(false);
		expect(item?.label).toContain("claude-retired-1");
	});

	it("connected but missing from the list names the list", () => {
		const gone: GenerationTarget = {
			provider: "anthropic-byo",
			model: "claude-retired-1",
		};
		const options = build({ value: gone, connected: ["anthropic-byo"] });
		expect(entry(options, "anthropic-byo:claude-retired-1")?.label).toContain(
			"Not in the list",
		);
		expect(options.unavailable?.reason).toBe("model_unavailable");
		/**
		 * The verdict must not change the value. The target passed along is the one the user chose.
		 */
		expect(options.unavailable?.target).toEqual(gone);
	});

	it("without a connection the missing connection comes first", () => {
		const gone: GenerationTarget = {
			provider: "anthropic-byo",
			model: "claude-retired-1",
		};
		const options = build({ value: gone, connected: [] });
		expect(options.unavailable?.reason).toBe("provider_not_connected");
		/**
		 * That fact is stated by the provider column, because connection is a fact about the provider.
		 */
		expect(providerEntry(options, "anthropic-byo")?.label).toContain(
			"Connect the provider first",
		);
	});

	/**
	 * The saved value's provider must remain selectable. If it were disabled, the provider trigger
	 * would render empty and the user would read their choice as gone.
	 */
	it("the saved value's provider can be chosen even without a connection", () => {
		const options = build({ value: ANTHROPIC_TARGET, connected: [] });
		expect(providerEntry(options, "anthropic-byo")?.disabled).toBe(false);
		expect(providerEntry(options, "gemini-byo")?.disabled).toBe(true);
		/** Still, say why it cannot be used. Selectable and usable are different things. */
		expect(providerEntry(options, "anthropic-byo")?.label).toContain(
			"Connect the provider first",
		);
		expect(options.unavailable?.reason).toBe("provider_not_connected");
	});

	/** Within that provider, only the saved model is selectable; the rest remain unusable. */
	it("only the saved model is open", () => {
		const options = build({
			value: { provider: "anthropic-byo", model: "claude-retired-1" },
			connected: [],
		});
		expect(entry(options, "anthropic-byo:claude-retired-1")?.disabled).toBe(
			false,
		);
		expect(entry(options, "anthropic-byo:claude-sonnet-5")?.disabled).toBe(
			true,
		);
	});
});

describe("when the catalog did not arrive", () => {
	it("does not say the model is gone", () => {
		const options = buildModelOptions({
			models: [],
			value: ANTHROPIC_TARGET,
			inherited: PRODUCT_GENERATION_TARGET,
			connected: ["anthropic-byo"],
			byoAllowed: true,
			catalogLoaded: false,
		});
		expect(options.unavailable).toBeNull();
		/** No suffix is added here. Whether this model works is a fact we do not know. */
		expect(entry(options, "anthropic-byo:claude-sonnet-5")?.label).toBe(
			"claude-sonnet-5",
		);
	});

	it("connection is a fact of this device, so it is judged as is", () => {
		const options = buildModelOptions({
			models: [],
			value: ANTHROPIC_TARGET,
			inherited: PRODUCT_GENERATION_TARGET,
			connected: [],
			byoAllowed: true,
			catalogLoaded: false,
		});
		expect(options.unavailable?.reason).toBe("provider_not_connected");
	});

	it("the managed default is fine without the catalog", () => {
		const options = buildModelOptions({
			models: [],
			value: null,
			inherited: PRODUCT_GENERATION_TARGET,
			connected: [],
			byoAllowed: true,
			catalogLoaded: false,
		});
		expect(options.unavailable).toBeNull();
	});
});

describe("the judged value is the one that applies now", () => {
	it("without an override the inherited target is judged", () => {
		const options = build({ value: null, inherited: ANTHROPIC_TARGET });
		expect(options.unavailable?.reason).toBe("provider_not_connected");
		expect(options.unavailable?.target).toEqual(ANTHROPIC_TARGET);
	});

	it("silent when the inherited target can run", () => {
		const options = build({
			value: null,
			inherited: ANTHROPIC_TARGET,
			connected: ["anthropic-byo"],
		});
		expect(options.unavailable).toBeNull();
	});

	it("with an override that one is judged", () => {
		const options = build({
			value: PRODUCT_GENERATION_TARGET,
			inherited: ANTHROPIC_TARGET,
			connected: [],
		});
		expect(options.unavailable).toBeNull();
	});

	/**
	 * An inherited entry sits in the provider column, so its parenthetical names the provider. The
	 * model column shows the model name, so the two columns do not repeat the same string.
	 */
	it("the inherit item names the inherited provider", () => {
		const options = build({ inherited: ANTHROPIC_TARGET });
		expect(options.inheritLabel).toBe("Use default (Anthropic)");
		expect(options.inheritedModelLabel).toBe("Claude Sonnet 5");
	});

	it("an inherited model missing from the catalog is drawn by its model string", () => {
		const options = build({
			inherited: { provider: "anthropic-byo", model: "claude-retired-1" },
		});
		expect(options.inheritLabel).toBe("Use default (Anthropic)");
		expect(options.inheritedModelLabel).toBe("claude-retired-1");
	});
});

describe("the message differs per reason", () => {
	it("without a connection it names that provider", () => {
		const message = unavailableMessage({
			target: ANTHROPIC_TARGET,
			provider: "anthropic-byo",
			reason: "provider_not_connected",
		});
		expect(message).toContain("Anthropic");
		expect(message).toContain("connect");
	});

	it("does not talk about connecting when gone from the list", () => {
		const message = unavailableMessage({
			target: ANTHROPIC_TARGET,
			provider: "anthropic-byo",
			reason: "model_unavailable",
		});
		expect(message).not.toContain("connect");
	});

	/**
	 * Telling a child to connect a provider sends them off to get a key, and then they are blocked
	 * again. The message must also say what still works; otherwise the conversation reads as entirely
	 * blocked.
	 */
	it("the child restriction names what works, not connecting", () => {
		const message = unavailableMessage({
			target: ANTHROPIC_TARGET,
			provider: "anthropic-byo",
			reason: "byo_not_permitted",
		});
		expect(message).toContain("under 14");
		expect(message).not.toContain("needs to be connected");
		expect(message).toContain("RowCat");
	});
});

describe("accounts under 14 — before connection", () => {
	/**
	 * The restriction holds even when a provider is connected. A device where a child already
	 * connected a key (an account later confirmed to be under 14) must get the same answer. If it fell
	 * back to 'connected, so it works', this restriction would block nothing.
	 */
	it("cannot choose a BYO provider even when connected", () => {
		const options = build({
			byoAllowed: false,
			connected: ["anthropic-byo"],
		});
		expect(providerEntry(options, "anthropic-byo")?.disabled).toBe(true);
	});

	/**
	 * If the label were `Connect the provider first`, the person would go get a key and only then learn that the
	 * connection itself is blocked. When both problems apply, the first thing to learn is that this
	 * account cannot use it, and connecting does not resolve that.
	 */
	it("the suffix does not ask for a connection", () => {
		const options = build({ byoAllowed: false, connected: [] });
		const label = providerEntry(options, "anthropic-byo")?.label ?? "";
		expect(label).toContain("under 14");
		expect(label).not.toContain("Connect the provider first");
	});

	/** Managed stays open as before. The child loses only BYO. */
	it("managed provider and model can both be chosen as is", () => {
		const options = build({
			byoAllowed: false,
			value: PRODUCT_GENERATION_TARGET,
		});
		expect(providerEntry(options, "rowcat")?.disabled).toBe(false);
		expect(entry(options, MANAGED_KEY)?.disabled).toBe(false);
		expect(entry(options, "rowcat:claude-sonnet-5")?.disabled).toBe(false);
	});

	it("a chosen BYO target is blocked for the child restriction", () => {
		const options = build({
			byoAllowed: false,
			value: ANTHROPIC_TARGET,
			connected: ["anthropic-byo"],
		});
		expect(options.unavailable).toMatchObject({
			provider: "anthropic-byo",
			reason: "byo_not_permitted",
		});
	});

	/** Do not clear the saved preference. At 14 it comes back as before. */
	it("the chosen target is carried as is even when blocked", () => {
		const options = build({ byoAllowed: false, value: ANTHROPIC_TARGET });
		expect(options.unavailable?.target).toEqual(ANTHROPIC_TARGET);
	});
});

describe("chosen key → target", () => {
	it("maps a catalog item to a target", () => {
		expect(targetForKey("anthropic-byo:claude-sonnet-5", CATALOG)).toEqual(
			ANTHROPIC_TARGET,
		);
	});

	it("an unknown key is not a target (the caller keeps the current value)", () => {
		expect(targetForKey("anthropic-byo:claude-retired-1", CATALOG)).toBeNull();
	});

	it("a managed item maps its public identity to a target", () => {
		expect(targetForKey(MANAGED_KEY, CATALOG)).toEqual(
			PRODUCT_GENERATION_TARGET,
		);
		expect(targetForKey("rowcat:claude-sonnet-5", CATALOG)).toEqual({
			provider: "rowcat",
			model: "claude-sonnet-5",
		});
	});

	/**
	 * The same model name with a different key is a different target. Different access paths mean
	 * different billing, and the prompt passes through different servers.
	 */
	it("two items with the same name become different targets", () => {
		expect(targetForKey("rowcat:claude-sonnet-5", CATALOG)?.provider).toBe(
			"rowcat",
		);
		expect(
			targetForKey("anthropic-byo:claude-sonnet-5", CATALOG)?.provider,
		).toBe("anthropic-byo");
	});

	/**
	 * The old single-model literal has no compatibility path. It is not in the catalog, so it is
	 * simply an unknown key, and the caller keeps the current value.
	 */
	it("the old rowcat:default key is not a target", () => {
		expect(targetForKey("rowcat:default", CATALOG)).toBeNull();
	});
});
