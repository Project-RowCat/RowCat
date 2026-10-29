import type {
	GenerationTarget,
	ReasoningEffort,
	ResponseLength,
} from "@rowcat/chat";
import {
	buildReasoningOptions,
	INHERIT_VALUE,
	RESPONSE_LENGTHS,
	reconcileReasoningOverride,
	targetForKey,
} from "@rowcat/chat";
import { space } from "@rowcat/design";
import { generationModelsQueryOptions } from "@rowcat/query";
import {
	Notice,
	Select,
	SelectGroupLabel,
	SelectOption,
	Separator,
	Spinner,
	Text,
} from "@rowcat/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { useGenerationScope } from "../../lib/local-data/scope.tsx";
import { useProviderConnections } from "../../lib/local-data/use-provider-connections.ts";
import { useViewerCapability } from "../../lib/viewer-capability.ts";
import {
	GENERATION_SAVE_FAILURE_MESSAGE,
	inheritLabel,
	MODEL_CATALOG_FAILURE_MESSAGE,
	MODEL_TARGET_FIELD,
	REASONING_EFFORT_FIELD,
	RESPONSE_LENGTH_FIELD,
	responseLengthLabel,
} from "../chat/generation/labels.ts";
import {
	buildModelOptions,
	unavailableMessage,
} from "../chat/generation/model-options.ts";
import { ReasoningEffortSelect } from "../chat/generation/reasoning-effort-select.tsx";
import { useGlobalGenerationState } from "../chat/generation/use-room-generation.ts";
import { useStaleReasoningReconcile } from "../generation/use-stale-reasoning-reconcile.ts";
import {
	GENERATION_DEFAULTS_DESCRIPTION,
	GENERATION_DEFAULTS_TITLE,
	GENERATION_DEVICE_NOTE,
} from "./generation-copy.ts";
import { SettingsField, SettingsSection } from "./settings-parts.tsx";

/**
 * Default generation: the defaults for how conversations are generated on this **device**.
 *
 * Same place and same two axes as the web's `features/settings/generation-defaults.tsx`. Values
 * here can be overridden per room (`Conversation settings`); rooms that are not overridden all follow these values.
 *
 * ## The precedence is not restated in this file
 *
 * `room ?? global ?? default` appears nowhere here. Resolution is done by
 * `resolveEffectiveGeneration` in `@rowcat/chat`, and this screen receives the value after that
 * resolution (`useGlobalGenerationState`). Restating it would make three copies of the rule (room
 * settings, story test, here), and when one goes stale, the summary and the settings name different
 * models.
 *
 * ## The store is the same as conversation settings
 *
 * It is the global slot of `GenerationPreferenceStore` (`getGlobal`·`setGlobal`); no second
 * settings store is created. The value **does not sync**, because provider connections differ per
 * device, which is why this section's copy ends with "applies only to this device".
 *
 * ## `Use default` does not copy the parent value
 *
 * It **clears** the override (`null`). Copying would tie that user to the old value the day the
 * product default changes, and nothing on any screen would show that.
 *
 * ## Room overrides are not touched
 *
 * This section writes one global slot. Values already chosen per room remain, and the value chosen
 * here applies only to **rooms without an override**. The absence of any code that walks existing
 * rooms and edits them is how that promise is expressed.
 *
 * ## The AI provider section sits **below** this screen
 *
 * The order is meaningful. Conversations work with RowCat-provided models without a personal API
 * key, so this section comes first and connections second; putting connections above would read as
 * if the app required a key (`provider-connections-section.tsx`).
 *
 * A BYO target without a connection is **visible but not selectable**, and the item name says why
 * (`model-options.ts`). That judgment now rests on the real connection list.
 */
export function GenerationDefaultsSection() {
	const { global, effective, loading } = useGlobalGenerationState();
	const { store } = useGenerationScope();
	const catalog = useQuery(generationModelsQueryOptions(getRowCatClient()));
	const capability = useViewerCapability();
	/**
	 * The providers this device has actually connected. This is **the same store** the generation
	 * runtime reads (`lib/local-data/use-provider-connections.ts`). If the two diverged, an item drawn
	 * as selectable here would be blocked the moment sending is pressed.
	 */
	const connections = useProviderConnections();
	const [error, setError] = useState<string | null>(null);

	/**
	 * Writes on selection — **there is no `Save settings` button at the bottom.**
	 *
	 * The two axes are values used at different moments and no transaction spans them, so a single
	 * committing button would report a partially successful state as success.
	 *
	 * Each axis is written **one at a time**, carrying the others unchanged. The store deletes the row
	 * when given an empty preference, so resetting one axis to `Use default` must not clear the other
	 * axes.
	 */
	const apply = (patch: {
		responseLength?: ResponseLength | null;
		target?: GenerationTarget | null;
		reasoningEffort?: ReasoningEffort | null;
	}): void => {
		/**
		 * **Writes to the store that existed when the operation started.** It is not swapped for the
		 * currently open scope because of account switching: otherwise a save started on Alice's screen
		 * would complete in Bob's database. The store instance changes together with the scope, and a
		 * write aimed at the old instance goes to a closed connection and fails.
		 */
		if (!store) return;
		setError(null);
		void store.setGlobal({ ...global, ...patch }).catch(() => {
			setError(GENERATION_SAVE_FAILURE_MESSAGE);
		});
	};

	/**
	 * While global selects nothing and **inherits the product default target**, a change to that
	 * default raises the same warning here (one deploy changes the effective model). This is the same
	 * hook as conversation settings, and it must sit above the early return below (hooks cannot be
	 * called conditionally).
	 */
	useStaleReasoningReconcile({
		reasoningEffort: global.reasoningEffort,
		target: global.target ?? effective.target,
		ready: !loading && store !== null,
		persist: (reasoningEffort) => apply({ reasoningEffort }),
	});

	/**
	 * Waits for all three. Drawing when only the catalog has arrived would show items in one state for
	 * a frame before they change (conversation settings makes the same decision).
	 */
	if (loading || catalog.isPending || capability.loading || connections.loading)
		return (
			<SettingsSection title={GENERATION_DEFAULTS_TITLE} first>
				<View style={generation.loading}>
					<Spinner />
				</View>
			</SettingsSection>
		);

	const models = catalog.data ?? [];
	const options = buildModelOptions({
		models,
		value: global.target,
		/**
		 * Beyond global there is **only the product default**. This is the same axis that room settings
		 * inherit from global; the name drawn in parentheses is that value.
		 */
		inherited: effective.target,
		/**
		 * The providers this device has connected. This is the **same value** the generation runtime
		 * passes, so an item drawn as selectable never turns out blocked.
		 */
		connected: connections.providers,
		byoAllowed: capability.byo,
		/** The catalog is used as evidence **only when the lookup succeeded**; on failure it is an empty list. */
		catalogLoaded: catalog.isSuccess,
	});

	/**
	 * Reasoning options — **the capability of the target now in effect** decides them. Beyond global
	 * there is only the product default, so an inherited target also comes from that layer.
	 */
	const reasoning = buildReasoningOptions({
		models,
		catalogLoaded: catalog.isSuccess,
		target: global.target ?? effective.target,
		value: global.reasoningEffort,
		inherited: effective.reasoningEffort,
	});

	/**
	 * Changing the target **also clears the reasoning override that became unusable**. This is the
	 * same rule and the same pure function as conversation settings. It clears rather than moving the
	 * value because that axis must return to inheritance (the product default). Response length is not
	 * touched at all.
	 */
	const applyTarget = (next: GenerationTarget | null): void =>
		apply({
			target: next,
			reasoningEffort: reconcileReasoningOverride({
				reasoningEffort: global.reasoningEffort,
				target: next ?? effective.target,
				models,
				catalogLoaded: catalog.isSuccess,
			}),
		});

	const providerValueLabel =
		options.providerItems.find((item) => item.value === options.providerValue)
			?.label ?? options.inheritLabel;

	return (
		<SettingsSection
			title={GENERATION_DEFAULTS_TITLE}
			description={GENERATION_DEFAULTS_DESCRIPTION}
			first
		>
			<SettingsField
				label={RESPONSE_LENGTH_FIELD.label}
				description={RESPONSE_LENGTH_FIELD.description}
			>
				<Select
					label={RESPONSE_LENGTH_FIELD.label}
					value={
						global.responseLength
							? responseLengthLabel(global.responseLength)
							: inheritLabel(responseLengthLabel(effective.responseLength))
					}
					disabled={!store}
				>
					{/**
					 * The first item is always inheritance; the name in parentheses is **the name of what is inherited now**.
					 * Choosing it does not copy the parent value; it **clears** the override.
					 */}
					<SelectOption
						label={inheritLabel(responseLengthLabel(effective.responseLength))}
						selected={global.responseLength === null}
						onSelect={() => apply({ responseLength: null })}
					/>
					{RESPONSE_LENGTHS.map((length) => (
						<SelectOption
							key={length}
							label={responseLengthLabel(length)}
							selected={global.responseLength === length}
							onSelect={() => apply({ responseLength: length })}
						/>
					))}
				</Select>
			</SettingsField>

			<Separator />

			<SettingsField
				label={MODEL_TARGET_FIELD.label}
				description={MODEL_TARGET_FIELD.description}
			>
				<SubField label="Provider">
					<Select
						label={`${MODEL_TARGET_FIELD.label} provider`}
						value={providerValueLabel}
						disabled={!store}
					>
						<SelectOption
							label={options.inheritLabel}
							selected={options.providerValue === INHERIT_VALUE}
							onSelect={() => applyTarget(null)}
						/>
						{options.providers.map((entry) => (
							<SelectOption
								key={entry.provider}
								/** Why it cannot be chosen is stated **inside the item name**. */
								label={entry.label}
								selected={entry.provider === options.providerValue}
								disabled={entry.disabled}
								/** The shared module decides which model it is (`defaultTarget`). */
								onSelect={() => applyTarget(entry.defaultTarget)}
							/>
						))}
					</Select>
				</SubField>

				<SubField label="Model">
					<Select
						label={`${MODEL_TARGET_FIELD.label} model`}
						value={
							options.models.find((entry) => entry.key === options.modelValue)
								?.label ?? options.inheritedModelLabel
						}
						disabled={!store || options.modelValue === null}
					>
						{options.modelGroups.map((group) => (
							<View key={group.label ?? "__flat__"}>
								{group.label ? <SelectGroupLabel label={group.label} /> : null}
								{group.entries.map((entry) => (
									<SelectOption
										key={entry.key}
										label={entry.label}
										selected={entry.key === options.modelValue}
										disabled={entry.disabled}
										onSelect={() =>
											/**
											 * Re-selecting an item that is not in the catalog (the value saved now) **leaves the
											 * value as is**. Dropping to `null` would make pressing the current selection again
											 * clear the override.
											 */
											applyTarget(
												targetForKey(entry.key, models) ?? global.target,
											)
										}
									/>
								))}
							</View>
						))}
					</Select>
				</SubField>

				{/**
				 * The fact that the effective target is unavailable is **stated below the row**. The value is not
				 * cleared or switched to another model; overwriting would make the user run a model they never chose.
				 */}
				{options.unavailable ? (
					<Text variant="label" tone="destructive">
						{unavailableMessage(options.unavailable)}
					</Text>
				) : null}

				{/**
				 * The catalog could not be loaded — **do not write "no models".** The saved value remains and its row
				 * is still drawn, so all that can be said here is that the list could not be loaded. **Response length
				 * can still be changed**; that axis has nothing to do with the catalog.
				 */}
				{catalog.isError ? (
					<Notice
						tone="destructive"
						message={MODEL_CATALOG_FAILURE_MESSAGE}
						actionLabel="Try again"
						onAction={() => void catalog.refetch()}
					/>
				) : null}
			</SettingsField>

			{/**
			 * Reasoning effort — **this row exists only for models that can be adjusted.**
			 *
			 * It stands after the target because the dependency runs that way: what can be chosen depends on the
			 * model picked in the field above. For a model that cannot be adjusted, the whole `SettingsField`
			 * disappears; leaving an empty line and a separator would make the user read that something should be below.
			 */}
			{reasoning.available ? (
				<SettingsField
					label={REASONING_EFFORT_FIELD.label}
					description={REASONING_EFFORT_FIELD.description}
				>
					<ReasoningEffortSelect
						options={reasoning}
						disabled={!store}
						onChange={(next) => apply({ reasoningEffort: next })}
					/>
				</SettingsField>
			) : null}

			{/**
			 * Failures **end here**. Sending them to a global notice would show text after the user has left the
			 * screen, and that text could not say what was not saved.
			 */}
			{error ? <Notice tone="destructive" message={error} /> : null}

			<Text variant="caption" tone="muted-foreground">
				{GENERATION_DEVICE_NOTE}
			</Text>
		</SettingsSection>
	);
}

/** One control inside a field; the same name and hierarchy as in conversation settings. */
function SubField({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<View style={generation.subField}>
			<Text variant="caption" tone="muted-foreground">
				{label}
			</Text>
			{children}
		</View>
	);
}

const generation = StyleSheet.create({
	loading: { alignItems: "center", paddingVertical: space.xl },
	subField: { gap: space.xs },
});
