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
import type { ReactNode } from "react";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../../lib/api.ts";
import { useProviderConnections } from "../../../lib/local-data/use-provider-connections.ts";
import { useViewerCapability } from "../../../lib/viewer-capability.ts";
import { useStaleReasoningReconcile } from "../../generation/use-stale-reasoning-reconcile.ts";
import {
	GENERATION_INHERITANCE_BODY,
	GENERATION_INHERITANCE_TITLE,
	GENERATION_SAVE_FAILURE_MESSAGE,
	inheritLabel,
	MODEL_CATALOG_FAILURE_MESSAGE,
	MODEL_TARGET_FIELD,
	REASONING_EFFORT_FIELD,
	RESPONSE_LENGTH_FIELD,
	responseLengthLabel,
} from "../generation/labels.ts";
import {
	buildModelOptions,
	unavailableMessage,
} from "../generation/model-options.ts";
import { ReasoningEffortSelect } from "../generation/reasoning-effort-select.tsx";
import { useRoomGenerationState } from "../generation/use-room-generation.ts";

/**
 * Generation settings for this conversation: response length, generation target, reasoning effort.
 * Same place, axes and layout as the web's `features/chat/room-settings/generation.tsx`.
 *
 * ```text
 * response length   [standard      v]
 * ------------------------------------
 * target            provider
 *                   [RowCat        v]
 *                   model
 *                   [Claude Sonnet v]
 *                   (if unusable) one-line reason
 * ------------------------------------
 * reasoning effort  [standard      v]   <- only for adjustable models
 * ------------------------------------
 * inheritance footnote
 * ```
 *
 * - Two fields for the target, as on the web: the same model name appears under two providers
 *   (managed RowCat and Anthropic BYO) whose billing and prompt path differ, and one field would
 *   leave the distinction in a group title only. An unconnected BYO provider is visible but not
 *   selectable, and the item name says why; the basis is this device's real connection list and the
 *   fix is `Settings → AI`.
 * - The model list and availability rules are not here: `buildModelOptions` in `@rowcat/chat`
 *   owns them and the web calls the same function. What remains is drawing and waiting on two async
 *   sources.
 * - The model override is stored in preferences, not on the room record: that record syncs, and
 *   an Anthropic model picked on a Mac would arrive on a device with no connection as an unusable
 *   setting.
 * - No save button: picking writes immediately. The three axes are used at different moments and
 *   no transaction spans them, so one button would report partial success as success.
 * - The third row exists only sometimes: any model takes a response length, but reasoning effort
 *   depends on the server catalogue. For a non-adjustable model the row is absent, not replaced by
 *   a disabled control reading `Not supported`.
 */
export function RoomSettingsGeneration({ roomId }: { roomId: string }) {
	const { room, inherited, loading, store } = useRoomGenerationState(roomId);
	const catalog = useQuery(generationModelsQueryOptions(getRowCatClient()));
	const capability = useViewerCapability();
	/** Providers this device connected: the same store the generation runtime reads, or an item drawn as selectable would be blocked at send time. */
	const connections = useProviderConnections();
	const [error, setError] = useState<string | null>(null);

	/**
	 * Writes immediately. `null` clears the override rather than copying the parent value, which would
	 * stop this room following later global or product-default changes. One axis is written at a time
	 * with the others carried along: the store deletes the row on an empty preference, so reverting
	 * one axis to `Use default` must not erase the rest.
	 */
	const apply = (patch: {
		responseLength?: ResponseLength | null;
		target?: GenerationTarget | null;
		reasoningEffort?: ReasoningEffort | null;
	}): void => {
		if (!store) return;
		setError(null);
		void store.setRoom(roomId, { ...room, ...patch }).catch(() => {
			setError(GENERATION_SAVE_FAILURE_MESSAGE);
		});
	};

	/**
	 * If the global target changes while this room inherits its model, the reasoning override becomes
	 * unusable with nothing touching it (`applyTarget` was never pressed); the screen would draw a
	 * tier that does not run. Must stay above the early return below (hooks cannot be conditional).
	 * The rule is a shared pure function and only the reasoning axis is cleared.
	 */
	useStaleReasoningReconcile({
		reasoningEffort: room.reasoningEffort,
		target: room.target ?? inherited.target,
		ready: !loading && store !== null,
		persist: (reasoningEffort) => apply({ reasoningEffort }),
	});

	/** Wait for all three; drawing on the catalogue alone shows items in a different state for one frame (same decision as the web). */
	if (loading || catalog.isPending || capability.loading || connections.loading)
		return (
			<View style={generation.loading}>
				<Spinner />
			</View>
		);

	const models = catalog.data ?? [];
	const options = buildModelOptions({
		models,
		value: room.target,
		inherited: inherited.target,
		connected: connections.providers,
		byoAllowed: capability.byo,
		/** Use the catalogue only when the query succeeded; on failure the list is empty and every stored model would read as "not in the list". */
		catalogLoaded: catalog.isSuccess,
	});

	/** Reasoning options are decided by the currently effective target, inherited ones included: even if this room set no model, the model that actually runs decides what can be picked. */
	const reasoning = buildReasoningOptions({
		models,
		catalogLoaded: catalog.isSuccess,
		target: room.target ?? inherited.target,
		value: room.reasoningEffort,
		inherited: inherited.reasoningEffort,
	});

	/**
	 * Changing the target also clears a reasoning override that became unusable. The axes are
	 * independent but one bounds the other: a room set to `High` moved to a model without that tier
	 * stores an override no request can express. It is cleared, not moved to another tier, so the axis
	 * returns to inheritance; response length is untouched. The rule is a shared pure function.
	 */
	const applyTarget = (next: GenerationTarget | null): void =>
		apply({
			target: next,
			reasoningEffort: reconcileReasoningOverride({
				reasoningEffort: room.reasoningEffort,
				target: next ?? inherited.target,
				models,
				catalogLoaded: catalog.isSuccess,
			}),
		});

	const providerValueLabel =
		options.providerItems.find((item) => item.value === options.providerValue)
			?.label ?? options.inheritLabel;

	return (
		<View>
			<Field
				label={RESPONSE_LENGTH_FIELD.label}
				description={RESPONSE_LENGTH_FIELD.description}
			>
				<Select
					label={RESPONSE_LENGTH_FIELD.label}
					value={
						room.responseLength
							? responseLengthLabel(room.responseLength)
							: inheritLabel(responseLengthLabel(inherited.responseLength))
					}
					disabled={!store}
				>
					{/** The first item is always inheritance, with the currently inherited name in parentheses. Choosing it clears the override instead of copying the parent value. */}
					<SelectOption
						label={inheritLabel(responseLengthLabel(inherited.responseLength))}
						selected={room.responseLength === null}
						onSelect={() => apply({ responseLength: null })}
					/>
					{RESPONSE_LENGTHS.map((length) => (
						<SelectOption
							key={length}
							label={responseLengthLabel(length)}
							selected={room.responseLength === length}
							onSelect={() => apply({ responseLength: length })}
						/>
					))}
				</Select>
			</Field>

			<Separator />

			<Field
				label={MODEL_TARGET_FIELD.label}
				description={MODEL_TARGET_FIELD.description}
			>
				{/* Provider: the access path is chosen first; inheritance lives in this field too. */}
				<SubField label="Provider">
					<Select
						/** Reads the outer title and this field's name together. */
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
								/** Why an item is unselectable is in its name (`… · Not usable on this device`); dimming alone leaves a reasonless block for users not looking at the screen. */
								label={entry.label}
								selected={entry.provider === options.providerValue}
								disabled={entry.disabled}
								/** Picking a provider also picks one of its targets; the shared module decides which (`defaultTarget`), so "usable first" is not buried where it cannot be checked without rendering. */
								onSelect={() => applyTarget(entry.defaultTarget)}
							/>
						))}
					</Select>
				</SubField>

				{/*
				 * Model: chosen only within the picked provider. While inheriting it is disabled but
				 * shows the inherited name; empty would hide what applies, and a second `Use default`
				 * here would promise the inexpressible "inherit provider, pick only the model".
				 */}
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
								{/** The managed list groups by the company that made the model (several companies stand under one provider); a single-company list (BYO) has a `null` title and draws none. The shared module decides. */}
								{group.label ? <SelectGroupLabel label={group.label} /> : null}
								{group.entries.map((entry) => (
									<SelectOption
										key={entry.key}
										label={entry.label}
										selected={entry.key === options.modelValue}
										disabled={entry.disabled}
										onSelect={() =>
											/** Re-picking an item missing from the catalogue (the stored value) keeps it; falling to `null` would turn re-pressing one's own choice into clearing the override. */
											applyTarget(
												targetForKey(entry.key, models) ?? room.target,
											)
										}
									/>
								))}
							</View>
						))}
					</Select>
				</SubField>

				{/* State below the row that the effective target is unusable; do not clear or swap the model, or the user would run one they never chose. */}
				{options.unavailable ? (
					<Text variant="label" tone="destructive">
						{unavailableMessage(options.unavailable)}
					</Text>
				) : null}

				{/** Catalogue not received: do not claim "no models". The stored value and its row remain, so the only fact available is that the list failed to load. */}
				{catalog.isError ? (
					<Notice
						tone="destructive"
						message={MODEL_CATALOG_FAILURE_MESSAGE}
						actionLabel="Try again"
						onAction={() => void catalog.refetch()}
					/>
				) : null}
			</Field>

			{/*
			 * Reasoning effort: present only for adjustable models. The separator folds away with
			 * it, since a lone rule reads as something missing below. It follows the target because
			 * it depends on the model picked just above, which explains the row appearing and vanishing.
			 */}
			{reasoning.available ? (
				<>
					<Separator />
					<Field
						label={REASONING_EFFORT_FIELD.label}
						description={REASONING_EFFORT_FIELD.description}
					>
						<ReasoningEffortSelect
							options={reasoning}
							disabled={!store}
							onChange={(next) => apply({ reasoningEffort: next })}
						/>
					</Field>
				</>
			) : null}

			{/** Failure ends here, not in a global notice: it belongs to the control just touched, and a notice after the window closes cannot say what was not saved. It stands below the axes since the failed axis is unknown. */}
			{error ? (
				<>
					<Separator />
					<View style={generation.notice}>
						<Notice tone="destructive" message={error} />
					</View>
				</>
			) : null}

			<Separator />

			{/**
			 * Inheritance is a footnote of this pane, not a third section, so its title matches the
			 * home group title in size and colour: it does not compete with the axes above and scans
			 * as a named fact. The device axis stays: that this value does not sync really happens to
			 * someone opening the same conversation on another device.
			 */}
			<View style={generation.footer}>
				<Text
					accessibilityRole="header"
					variant="caption"
					tone="muted-foreground"
				>
					{GENERATION_INHERITANCE_TITLE}
				</Text>
				<Text variant="label" tone="muted-foreground">
					{GENERATION_INHERITANCE_BODY}
				</Text>
			</View>
		</View>
	);
}

/**
 * One cell of the property list: label, description, controls below. The web puts name and
 * description left and the control right, stacking when narrow; this app has no wide layout, so it
 * is always the stacked branch, matching the web's narrow one. Axes are split by a rule rather than
 * boxed, since boxes make two axes following one rule read as two forms.
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
		<View style={generation.field}>
			<View style={generation.fieldHead}>
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

/**
 * One control within a field: a small label above it. The label is small and muted so it does not
 * compete with the outer title (`Generation target`), matching the web (`text-xs font-normal
 * text-muted-foreground`); that hierarchy says the two controls are one setting, so no grouping
 * box.
 */
function SubField({ label, children }: { label: string; children: ReactNode }) {
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
	notice: { paddingBottom: space.sm },
	field: { gap: space.sm, paddingVertical: space.md },
	fieldHead: { gap: space.px },
	subField: { gap: space.xs },
	footer: { gap: space.xs, paddingTop: space.md },
});
