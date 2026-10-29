import type { GenerationTarget, ReasoningEffort } from "@rowcat/chat";
import {
	buildReasoningOptions,
	INHERIT_VALUE,
	reconcileReasoningOverride,
	targetForKey,
} from "@rowcat/chat";
import { space } from "@rowcat/design";
import { generationModelsQueryOptions } from "@rowcat/query";
import {
	Dialog,
	Notice,
	Select,
	SelectGroupLabel,
	SelectOption,
	Separator,
	Spinner,
	Text,
} from "@rowcat/ui-native";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { useProviderConnections } from "../../lib/local-data/use-provider-connections.ts";
import { useViewerCapability } from "../../lib/viewer-capability.ts";
import {
	GENERATION_SAVE_FAILURE_MESSAGE,
	MODEL_CATALOG_FAILURE_MESSAGE,
	MODEL_TARGET_FIELD,
	REASONING_EFFORT_FIELD,
} from "../chat/generation/labels.ts";
import {
	buildModelOptions,
	unavailableMessage,
} from "../chat/generation/model-options.ts";
import { ReasoningEffortSelect } from "../chat/generation/reasoning-effort-select.tsx";
import { useStaleReasoningReconcile } from "../generation/use-stale-reasoning-reconcile.ts";
import { RUNTIME_PLAYER_COPY } from "./runtime-player-copy.ts";
import { useRuntimeGenerationState } from "./use-runtime-generation-state.ts";

/**
 * This work's generation settings: the same two controls as the generation pane of conversation
 * settings, under a different storage key (`GenerationPreferenceStore.setRuntime(storyId)`,
 * device-local, member-scoped).
 *
 * - Response length is absent. The runtime output cap comes from the creator's request
 *   (`maxOutputCharacters`), and no sentence says so either.
 * - It is not the conversation pane itself: that one saves by room id (`setRoom`), and a
 *   playthrough has no room. The shared rules (`buildModelOptions`, `buildReasoningOptions`,
 *   `reconcileReasoningOverride`) already come from `@rowcat/chat`, which web, conversation
 *   settings and the playtest also call.
 * - No save button. Each choice is written on selection: the two axes are used at different
 *   moments and no transaction spans them, so one button would report a partial success as success.
 *   The next generation request re-reads the store.
 * - Copy stays out of `runtime-player-copy.ts`. That table is parity-checked by regex, and these
 *   sentences mix conversation-settings labels with lines only this dialog uses. Only the title
 *   comes from that table, since it must match the header trigger's word.
 */
const RUNTIME_GENERATION_SETTINGS_COPY = {
	description: "The model and reasoning effort for this story's AI generation.",
	modelDescription: "The model that generates for this story.",
	reasoningDescription: "How deeply to think before answering in this story.",
	inheritTitle: "Default settings",
	/**
	 * The footnote ends with "from the next generation request" because it differs from the session.
	 * AI permission freezes into this playthrough (`RUNTIME_PLAYER_AI_COPY.note`), but the target is
	 * read from the store on each request. Without saying so, someone who changed the model cannot
	 * tell whether to restart.
	 *
	 * The device axis is kept: this value does not sync, and that is what happens to someone opening
	 * the same work on another device.
	 */
	inheritBody:
		"Anything this story doesn't set separately follows your default AI settings. Values chosen here apply only on this device and are used from the next generation request.",
	/** Subject of the unusable-reason sentence; this screen has no room. */
	unavailableSubject: "this story",
} as const;

export function RuntimeGenerationSettingsDialog({
	storyId,
	open,
	onOpenChange,
}: {
	storyId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog
			title={RUNTIME_PLAYER_COPY.generationSettings}
			description={RUNTIME_GENERATION_SETTINGS_COPY.description}
			open={open}
			onOpenChange={onOpenChange}
			/**
			 * Docks to the bottom on narrow screens only. Same value as the conversation settings window, so
			 * both read as one product in the same container. It is still a `Dialog`, not a sheet: only the
			 * position changes.
			 */
			placement="adaptive"
			headerDivider
			scroll
		>
			<RuntimeGenerationSettings storyId={storyId} />
		</Dialog>
	);
}

function RuntimeGenerationSettings({ storyId }: { storyId: string }) {
	const { override, inherited, loading, store } =
		useRuntimeGenerationState(storyId);
	const catalog = useQuery(generationModelsQueryOptions(getRowCatClient()));
	const capability = useViewerCapability();
	/**
	 * Provider connections this device holds. Read from the same store the playback generation adapter
	 * reads; if they diverged, an option drawn as selectable here would be blocked in the creator
	 * code's generation.
	 */
	const connections = useProviderConnections();
	const [error, setError] = useState<string | null>(null);

	/**
	 * Writes on selection.
	 *
	 * `null` clears the override; it does not copy the parent value. Copying would keep this work from
	 * following a later change to the global or product default.
	 *
	 * One axis is written at a time, with the other spread through unchanged. The store deletes a row
	 * when given an empty preference, so resetting one axis to inherit must not clear the other.
	 *
	 * Response length is neither built nor changed here. The spread carries only what the store
	 * already holds, and no screen in this work writes that axis, so in practice it is always `null`.
	 * It is not written out explicitly, because that would suggest this dialog manages that axis.
	 */
	const apply = (patch: {
		target?: GenerationTarget | null;
		reasoningEffort?: ReasoningEffort | null;
	}): void => {
		if (!store) return;
		setError(null);
		void store.setRuntime(storyId, { ...override, ...patch }).catch(() => {
			setError(GENERATION_SAVE_FAILURE_MESSAGE);
		});
	};

	/**
	 * If the global model changes while this work inherits its model, a reasoning override nobody
	 * touched becomes an unusable value, because `applyTarget` below never runs. Same hook as the
	 * conversation settings. It sits above the early return because hooks cannot be called
	 * conditionally.
	 */
	useStaleReasoningReconcile({
		reasoningEffort: override.reasoningEffort,
		target: override.target ?? inherited.target,
		ready: !loading && store !== null,
		persist: (reasoningEffort) => apply({ reasoningEffort }),
	});

	/**
	 * Waits for all four. Drawing once only the catalog has loaded shows items in one state for a
	 * frame, then changes them. The conversation settings make the same call for the same reason.
	 */
	if (loading || catalog.isPending || capability.loading || connections.loading)
		return (
			<View style={settings.loading}>
				<Spinner />
			</View>
		);

	const models = catalog.data ?? [];
	const options = buildModelOptions({
		models,
		value: override.target,
		inherited: inherited.target,
		connected: connections.providers,
		byoAllowed: capability.byo,
		/**
		 * Uses the catalog only when the query succeeded. On failure the list is empty, and judging
		 * against it would mark every saved model as not in the list.
		 */
		catalogLoaded: catalog.isSuccess,
	});

	/**
	 * Reasoning options. The capability of the target that applies now decides them (override ??
	 * inherited).
	 */
	const reasoning = buildReasoningOptions({
		models,
		catalogLoaded: catalog.isSuccess,
		target: override.target ?? inherited.target,
		value: override.reasoningEffort,
		inherited: inherited.reasoningEffort,
	});

	/**
	 * Changing the target also clears the reasoning override that became unusable. It is cleared, not
	 * moved, so that axis returns to inheriting. Same shared pure function as the conversation
	 * settings.
	 */
	const applyTarget = (next: GenerationTarget | null): void =>
		apply({
			target: next,
			reasoningEffort: reconcileReasoningOverride({
				reasoningEffort: override.reasoningEffort,
				target: next ?? inherited.target,
				models,
				catalogLoaded: catalog.isSuccess,
			}),
		});

	/**
	 * Label of the provider for the target that applies now. Falls back to the inherit label when it
	 * is not among the options.
	 */
	const providerValueLabel =
		options.providerItems.find((item) => item.value === options.providerValue)
			?.label ?? options.inheritLabel;

	return (
		<View>
			<Field
				label={MODEL_TARGET_FIELD.label}
				description={RUNTIME_GENERATION_SETTINGS_COPY.modelDescription}
			>
				{/* Provider: choose the access path first. Inheritance also lives in this field. */}
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
								/**
								 * Why an option cannot be picked is in its label. Dimming alone would leave a disabled item
								 * with no reason for anyone not looking at the screen.
								 */
								label={entry.label}
								selected={entry.provider === options.providerValue}
								disabled={entry.disabled}
								/**
								 * Picking a provider also picks that provider's target. Which model that is comes from the
								 * shared module (`defaultTarget`).
								 */
								onSelect={() => applyTarget(entry.defaultTarget)}
							/>
						))}
					</Select>
				</SubField>

				{/* Model: pick only within the chosen provider. While inheriting, show the inherited name as disabled; a blank would hide what is in effect. */}
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
											 * Re-picking an item that is not in the catalog (the value currently stored) keeps the
											 * value. Dropping it to null would make re-pressing the item already selected clear the
											 * override.
											 */
											applyTarget(
												targetForKey(entry.key, models) ?? override.target,
											)
										}
									/>
								))}
							</View>
						))}
					</Select>
				</SubField>

				{/* Drawn while inheriting as well: the inherited target can be unusable too. */}
				{/* Says below the line that the target in effect cannot be used. The value is not cleared or swapped for another model: if we overwrote it, the user would run the creator's code on a model they never chose. */}
				{options.unavailable ? (
					<Text variant="label" tone="destructive">
						{unavailableMessage(
							options.unavailable,
							RUNTIME_GENERATION_SETTINGS_COPY.unavailableSubject,
						)}
					</Text>
				) : null}

				{/** The catalog could not be loaded. Do not write "no models": the saved value stays and its line still draws. */}
				{catalog.isError ? (
					<Notice
						tone="destructive"
						message={MODEL_CATALOG_FAILURE_MESSAGE}
						actionLabel="Try again"
						onAction={() => void catalog.refetch()}
					/>
				) : null}
			</Field>

			{/* Reasoning effort: this row exists only for models that can be tuned. The separator folds with it, since a bare line would be an unexplained rule on screen. It comes after the generation target because it depends on it. */}
			{reasoning.available ? (
				<>
					<Separator />
					<Field
						label={REASONING_EFFORT_FIELD.label}
						description={RUNTIME_GENERATION_SETTINGS_COPY.reasoningDescription}
					>
						<ReasoningEffortSelect
							options={reasoning}
							disabled={!store}
							onChange={(next) => apply({ reasoningEffort: next })}
						/>
					</Field>
				</>
			) : null}

			{/** The failure ends here. A notice shown after the dialog closes cannot say what was not saved. It sits below both axes because it does not know which one failed. */}
			{error ? (
				<>
					<Separator />
					<View style={settings.notice}>
						<Notice tone="destructive" message={error} />
					</View>
				</>
			) : null}

			<Separator />

			{/** Inherited: a footnote of this pane, not a section (same rank as the conversation settings). */}
			<View style={settings.footer}>
				<Text
					accessibilityRole="header"
					variant="caption"
					tone="muted-foreground"
				>
					{RUNTIME_GENERATION_SETTINGS_COPY.inheritTitle}
				</Text>
				<Text variant="label" tone="muted-foreground">
					{RUNTIME_GENERATION_SETTINGS_COPY.inheritBody}
				</Text>
			</View>
		</View>
	);
}

/**
 * Label, description, and the controls below: same shape as the matching field in conversation
 * settings. The axes are split by a rule line rather than boxed, since boxing would make two axes
 * that follow one rule read as two forms.
 */
function Field({
	label,
	description,
	children,
}: {
	label: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<View style={settings.field}>
			<View style={settings.fieldHead}>
				<Text variant="body" weight="medium">
					{label}
				</Text>
				<Text variant="label" tone="muted-foreground">
					{description}
				</Text>
			</View>
			{children}
		</View>
	);
}

/** One control inside a field. The small label does not compete with the outer title (`Generation target`). */
function SubField({ label, children }: { label: string; children: ReactNode }) {
	return (
		<View style={settings.subField}>
			<Text variant="caption" tone="muted-foreground">
				{label}
			</Text>
			{children}
		</View>
	);
}

const settings = StyleSheet.create({
	loading: { alignItems: "center", paddingVertical: space.xl },
	notice: { paddingBottom: space.sm },
	field: { gap: space.sm, paddingVertical: space.md },
	fieldHead: { gap: space.px },
	subField: { gap: space.xs },
	footer: { gap: space.xs, paddingTop: space.md },
});
