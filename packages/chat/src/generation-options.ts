import type { GenerationModelDto } from "@rowcat/contracts/chat";
import type { GenerationBlockedReason } from "./generation-availability.ts";
import { resolveGenerationExecution } from "./generation-availability.ts";
import type {
	GenerationProvider,
	GenerationTarget,
} from "./generation-preference.ts";
import {
	generationTargetKey,
	readGenerationTarget,
} from "./generation-preference.ts";

/**
 * The model selector's list, with rules that can be checked without rendering.
 *
 * Shared because two apps draw the same two selectors (provider and model). Separate lists would
 * let a saved value vanish from one app, or let disabled-state rules diverge.
 * - Only the container differs per app: web uses `Select`s, mobile uses anchored menus.
 * - Logic stays out of components. Visibility, selectability and 'currently unusable' must hold
 *   without a rendered screen, and the web tests do not render React.
 * - Model options are grouped by vendor. The same name can appear under RowCat and BYO (for
 *   example `Claude Sonnet 5`), and the two routes differ in billing and server, so the access
 *   route is chosen first.
 * - One value is stored (`GenerationTarget`). Storing provider and model separately would allow
 *   combinations that save but cannot run.
 * - Availability is not re-derived here. `resolveGenerationExecution` decides it, and the
 *   generation hook calls the same function before running, so the screen cannot promise a model
 *   that the send path blocks.
 * - No substitution. An unusable target is never replaced; the selected value is drawn as-is.
 */

/**
 * Sentinel for 'not chosen', the first item of the provider selector.
 *
 * Inheritance applies to the whole target, not per axis. 'Inherit the provider but pick the model'
 * has no slot in storage, so the model selector shows the inherited name and is disabled.
 *
 * `Select` uses `null` to mean 'the same item was picked again', so an empty choice cannot be
 * `null`. Catalog ids are `provider:model`, so this string cannot collide with one.
 */
export const INHERIT_VALUE = "__inherit__";

export interface ModelOptionEntry {
	key: string;
	label: string;
	disabled: boolean;
	/** The target this entry represents, so the screen never re-derives it from the key. */
	target: GenerationTarget;
}

/**
 * A group of model entries under one vendor (the company that made the model).
 *
 * `label` is `null` when no heading should be drawn. A single-vendor list (every BYO list) would
 * repeat what the provider selector already says, and such a heading soon stops being read. The
 * rule lives here so every app renders the same shape.
 */
export interface ModelOptionGroup {
	label: string | null;
	entries: ModelOptionEntry[];
}

export interface ProviderOptionEntry {
	provider: GenerationProvider;
	label: string;
	disabled: boolean;
	/**
	 * The target that applies as soon as this provider is chosen.
	 *
	 * A provider alone cannot be stored, so choosing one also picks a model: the provider's first
	 * usable model, or its first model if none is usable. Either way it stays inside the provider the
	 * user chose, so there is no silent cross-provider fallback.
	 */
	defaultTarget: GenerationTarget;
}

/**
 * The target in effect cannot be used on this device. The reason comes with it.
 *
 * The reason is not collapsed to a boolean because the user's next action differs. With no
 * connection, the next step is to connect that provider; if the model left the list, it is to pick
 * another model. One message for both would be a dead end for one of them. Telling a connected
 * provider to 'connect' would be false.
 *
 * `target` travels with the reason, so the screen can say which target is set, and it is visible
 * that the verdict does not change the saved preference.
 */
export interface TargetUnavailability {
	/** The target in effect: the override if set, otherwise the inherited value. */
	target: GenerationTarget;
	provider: GenerationProvider;
	reason: GenerationBlockedReason;
}

export interface ModelOptions {
	/** Provider selector entries. The first entry is always inheritance. */
	providerItems: { value: string; label: string }[];
	providers: ProviderOptionEntry[];
	providerValue: string;
	inheritLabel: string;

	/** Model selector entries, only those of the selected provider. Empty while inheriting. */
	modelItems: { value: string; label: string }[];
	models: ModelOptionEntry[];
	/**
	 * Model selector entries grouped by vendor. With a single vendor, there is one group with no
	 * heading.
	 */
	modelGroups: ModelOptionGroup[];
	/** The model selector's value. `null` while inheriting, and the selector is disabled then. */
	modelValue: string | null;
	/** Name shown by the inherited model selector. It still states what currently applies. */
	inheritedModelLabel: string;

	unavailable: TargetUnavailability | null;

	/**
	 * Catalog entry for the target in effect (override, else inherited), read by the price cell.
	 *
	 * Unlike `modelValue`, which is `null` while inheriting, pricing follows what the conversation
	 * actually generates with. An inheriting conversation still has a price.
	 *
	 * Null when the target is missing from the catalog (retired model or failed lookup). Nothing is
	 * invented: a price guessed for an unknown model would be wrong.
	 */
	effectiveModel: GenerationModelDto | null;
}

export interface ModelOptionsInput {
	models: readonly GenerationModelDto[];
	/** The target this layer chose; `null` means inherit from the layer above. */
	value: GenerationTarget | null;
	inherited: GenerationTarget;
	connected: readonly GenerationProvider[];
	/**
	 * Whether this account may use BYO (false if under 14). Kept separate from `connected`.
	 *
	 * Folding it into an emptied connection list would show a child the screen 'connect a provider
	 * first', a dead end, since even a key cannot be connected for them.
	 */
	byoAllowed: boolean;
	/**
	 * The provider's human-readable name, supplied by the app.
	 *
	 * The catalog carries `providerLabel`, but a stored value that is missing from the catalog has
	 * nothing to read the name from. The app's table is passed in so the name is always available.
	 */
	providerLabel: (provider: GenerationProvider) => string;
	/**
	 * Labels appended to item names. The copy comes from the app, which keeps this pure module
	 * locale-free and reusable by a later app. The module still decides where each label goes, so both
	 * apps' lists share one shape.
	 */
	labels: ModelOptionLabels;
	/**
	 * Whether the catalog was actually received.
	 *
	 * Without this, a failed lookup would make `models` an empty array, and 'the saved model is not in
	 * the list' would mark every model the user picked as gone. A brief network hiccup would read as
	 * 'that model no longer exists'. When the catalog was not received, existence is not checked at
	 * all. Device-level connection status is still judged.
	 */
	catalogLoaded: boolean;
}

export interface ModelOptionLabels {
	inherit: (providerName: string) => string;
	byoNotPermitted: string;
	providerNotConnected: string;
	missingFromCatalog: string;
}

/**
 * Catalog, this device's connections and the stored value in; the two selectors' lists and
 * availability out.
 *
 * Five rules are intertwined:
 * 1. The provider selector holds every provider with at least one catalog entry, in catalog
 *    order.
 * 2. A provider with no usable model is shown but cannot be picked. Without seeing what a
 *    connection would unlock, the user would have to dig through settings.
 * 3. A stored value's provider and model are always selectable. Otherwise `Select` finds no
 *    matching item, shows an empty trigger, and the user reads their selection as lost.
 * 4. Each fact is said once. Connection and account eligibility are stated by the provider
 *    selector; absence from the catalog is stated by the model selector.
 * 5. Availability is judged on the value in effect (override, else inherited). If the inherited
 *    target is unusable, the room cannot generate either, and that must be visible even without an
 *    override.
 */
export function buildModelOptions(input: ModelOptionsInput): ModelOptions {
	const connectedFor = (provider: GenerationProvider): boolean =>
		input.connected.includes(provider);
	const executable = (model: GenerationModelDto): boolean =>
		!model.requiresConnection ||
		(input.byoAllowed && connectedFor(model.provider));

	/**
	 * Why one provider is blocked. Account eligibility comes before connection.
	 *
	 * The order is the rule. Showing `Connect a provider first` to an under-14 user would
	 * send them to obtain a key, only to find the connection itself blocked. When both apply, the
	 * first thing the user must learn is that this account cannot use the provider, which connecting
	 * does not fix.
	 *
	 * Managed models are blocked by neither check: there is no connection step for them.
	 */
	const providerSuffix = (provider: GenerationProvider): string => {
		if (provider === "rowcat") return "";
		if (!input.byoAllowed) return input.labels.byoNotPermitted;
		return connectedFor(provider) ? "" : input.labels.providerNotConnected;
	};

	const selected = input.value;
	const selectedKey = selected ? generationTargetKey(selected) : null;
	const selectedInCatalog = input.models.some(
		(model) => model.id === selectedKey,
	);

	interface Bucket {
		provider: GenerationProvider;
		label: string;
		/**
		 * An entry together with the vendor that made it. Sub-groups are formed from this order, without
		 * re-sorting.
		 */
		entries: (ModelOptionEntry & { vendor: string })[];
	}
	const buckets: Bucket[] = [];
	const bucketFor = (provider: GenerationProvider, label: string): Bucket => {
		const existing = buckets.find((bucket) => bucket.provider === provider);
		if (existing) return existing;
		const created: Bucket = { provider, label, entries: [] };
		buckets.push(created);
		return created;
	};

	for (const model of input.models) {
		const target = readGenerationTarget({
			provider: model.provider,
			model: model.model,
		});
		/**
		 * Entries the registry rejected are skipped. A value outside the current vocabulary would be
		 * selectable but never storable, so the click would appear to do nothing.
		 */
		if (!target) continue;
		bucketFor(model.provider, model.providerLabel).entries.push({
			key: model.id,
			/**
			 * The model selector states only facts about the model. Connection and eligibility are already
			 * stated by the provider selector.
			 */
			label: model.label,
			disabled: !executable(model),
			target,
			vendor: model.vendorLabel,
		});
	}

	/**
	 * The saved value is not in the catalog: the model was withdrawn, or this deployment's list
	 * differs. The preference is not erased, so both selectors get a slot for it. The label is the raw
	 * model string, since no display name is known.
	 *
	 * The label states only what is known. If the catalog was received and the value is absent, the
	 * model has disappeared from the list. If it was not received, no claim is made.
	 */
	if (selected && selectedKey && !selectedInCatalog)
		bucketFor(
			selected.provider,
			input.providerLabel(selected.provider),
		).entries.push({
			key: selectedKey,
			label: `${selected.model}${
				input.catalogLoaded ? input.labels.missingFromCatalog : ""
			}`,
			/**
			 * It is the current value and must stay selectable. If disabled, the trigger would render empty.
			 */
			disabled: false,
			target: selected,
			/**
			 * The vendor is unknown because the value is not in the catalog. Rather than invent one, the
			 * provider's name is used. If that is the only vendor, no heading is drawn anyway. If there are
			 * several, this line stands as its own sub-group, so 'an unknown entry' is visible as such.
			 */
			vendor: input.providerLabel(selected.provider),
		});

	const providers: ProviderOptionEntry[] = buckets.flatMap((bucket) => {
		/**
		 * Choosing a provider settles the first usable model inside it. If none is usable, the first
		 * model is used; that provider is disabled anyway, except when it holds the saved value, where
		 * the first item is the saved value itself.
		 *
		 * Buckets exist only when they have entries, so the empty case cannot occur here. Still, no
		 * default is invented: the provider is dropped from the list. Writing a product default here
		 * would place that value in two spots, and a provider the user never chose would point at another
		 * provider's model.
		 */
		const first =
			bucket.entries.find((entry) => !entry.disabled) ?? bucket.entries[0];
		if (!first) return [];
		return [
			{
				provider: bucket.provider,
				label: `${bucket.label}${providerSuffix(bucket.provider)}`,
				/**
				 * A provider holding the saved value is never disabled, because the trigger is currently
				 * showing it.
				 */
				disabled:
					bucket.provider !== selected?.provider &&
					bucket.entries.every((entry) => entry.disabled),
				defaultTarget: first.target,
			},
		];
	});

	const activeBucket = selected
		? buckets.find((bucket) => bucket.provider === selected.provider)
		: undefined;
	const models: ModelOptionEntry[] = (activeBucket?.entries ?? []).map(
		({ vendor: _vendor, ...entry }) => entry,
	);

	/**
	 * Sub-groups by vendor. Adjacent entries from the same vendor are grouped, but the list is not
	 * re-sorted.
	 *
	 * Sorting by vendor would have the screen silently fix same-vendor entries scattered in the
	 * registry. The order is the server's (`managed-models.ts` keeps vendors adjacent). If entries are
	 * scattered, the same heading appears twice, which makes the problem visible; the fix belongs in
	 * the registry.
	 *
	 * No heading is drawn when there is only one vendor, since the provider selector already said it.
	 * The decision counts distinct vendors, not contiguous runs. A vendor split in two by another
	 * vendor's entries should not lose its headings.
	 */
	const entries = activeBucket?.entries ?? [];
	const distinctVendors = new Set(entries.map((entry) => entry.vendor)).size;
	const modelGroups: ModelOptionGroup[] = [];
	for (const { vendor, ...entry } of entries) {
		const last = modelGroups.at(-1);
		if (last && last.label === (distinctVendors > 1 ? vendor : null))
			last.entries.push(entry);
		else
			modelGroups.push({
				label: distinctVendors > 1 ? vendor : null,
				entries: [entry],
			});
	}

	/**
	 * The catalog entry the price cell reads: the currently applied target, not the model selector's
	 * value. It is `null` when the catalog was not received.
	 *
	 * As with `catalogLoaded`, a network failure and a removed model are different facts, and the
	 * price cell is silent on both.
	 */
	const effectiveTarget = selected ?? input.inherited;
	const effectiveModel = input.catalogLoaded
		? (input.models.find(
				(model) => model.id === generationTargetKey(effectiveTarget),
			) ?? null)
		: null;

	const inheritedModel = input.models.find(
		(model) => model.id === generationTargetKey(input.inherited),
	);
	const inheritedModelLabel = inheritedModel?.label ?? input.inherited.model;
	const inheritLabel = input.labels.inherit(
		buckets.find((bucket) => bucket.provider === input.inherited.provider)
			?.label ?? input.providerLabel(input.inherited.provider),
	);

	/**
	 * The verdict is the same function the generation hook uses. The catalog is passed only when it
	 * was received (see `catalogLoaded`).
	 */
	const execution = resolveGenerationExecution({
		target: selected ?? input.inherited,
		connectedProviders: input.connected,
		byoAllowed: input.byoAllowed,
		catalog: input.catalogLoaded
			? input.models.map((model) => ({
					provider: model.provider,
					model: model.model,
				}))
			: undefined,
	});

	return {
		providerItems: [
			{ value: INHERIT_VALUE, label: inheritLabel },
			...providers.map((entry) => ({
				value: entry.provider,
				label: entry.label,
			})),
		],
		providers,
		providerValue: selected?.provider ?? INHERIT_VALUE,
		inheritLabel,
		modelItems: models.map((entry) => ({
			value: entry.key,
			label: entry.label,
		})),
		models,
		modelGroups,
		modelValue: selectedKey,
		inheritedModelLabel,
		unavailable:
			execution.status === "blocked"
				? {
						target: execution.target,
						provider: execution.target.provider,
						reason: execution.reason,
					}
				: null,
		effectiveModel,
	};
}

/**
 * Converts a chosen catalog id into a target, using the catalog entry rather than splitting the id.
 *
 * Model names may contain `:`, and nothing guarantees they do not. Building from the registry also
 * ensures that only values in the current vocabulary are stored.
 */
export function targetForKey(
	key: string,
	models: readonly GenerationModelDto[],
): GenerationTarget | null {
	const model = models.find((entry) => entry.id === key);
	if (!model) return null;
	return readGenerationTarget({ provider: model.provider, model: model.model });
}
