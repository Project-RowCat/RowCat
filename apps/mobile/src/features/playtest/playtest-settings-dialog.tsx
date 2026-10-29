import type { PlaytestStartScene } from "@rowcat/authoring";
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
	Button,
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
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { useProviderConnections } from "../../lib/local-data/use-provider-connections.ts";
import { useViewerCapability } from "../../lib/viewer-capability.ts";
import {
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
import { startSceneHeadline } from "../create/editor-copy.ts";
import { useStaleReasoningReconcile } from "../generation/use-stale-reasoning-reconcile.ts";
import { PLAYTEST_DEFAULT_SCENE_LABEL } from "./playtest-configuration-summary.ts";
import {
	PLAYTEST_MODEL_FIELD_DESCRIPTION,
	PLAYTEST_REASONING_FIELD_DESCRIPTION,
	PLAYTEST_RELOAD_FAILURE,
	PLAYTEST_RELOAD_LABEL,
	PLAYTEST_RELOAD_PENDING_LABEL,
	PLAYTEST_RESET_LABEL,
	PLAYTEST_RESPONSE_LENGTH_FIELD_DESCRIPTION,
	PLAYTEST_SESSION_GROUP_LABEL,
	PLAYTEST_SETTINGS,
	PLAYTEST_START_SCENE_FIELD,
} from "./playtest-copy.ts";
import type { PlaytestController } from "./use-playtest.ts";

/**
 * Test conditions: **three values that live only in this session, and two operations on the session
 * itself.**
 *
 * Nothing here is saved; that is this component's nature. The start scene does not touch the
 * draft's `defaultStartSceneId` (it never calls `setDefaultStartScene`). The model and response
 * length are written neither to device preferences (`setGlobal`) nor to room overrides (`setRoom`).
 * One test must not change the person's default for every conversation, and the draft has no slot
 * for these values in the first place (the model is not an authoring attribute). A static scan
 * locks that absence.
 *
 * ## Why it is not always expanded
 *
 * The conversation is this screen's body. Standing the condition controls above it leaves two lines
 * of bubbles on a 320pt device, and that layout says "settings are the body and the conversation
 * sits below", the reverse of a test workspace. While collapsed, the conditions are stated by the
 * **one-line summary** under the header (`playtest-configuration-summary.ts`).
 *
 * ## The container is `Dialog size="full"`
 *
 * There are four controls, and two session operations below them. In a centered box the bottom part
 * would shift on devices with large accessibility text, and the layer a `Select` opens would also
 * have to stand above that box. It is not a sheet because this interaction does not answer "does
 * rising from the bottom earn its place" (the presentation table in `docs/design/ARCHITECTURE.md`).
 *
 * ## The confirmation is not inside this
 *
 * Changing the start scene, resetting and reloading **discard the conversation**, so they need
 * confirmation. Opening that here would stack a window on this surface, and the Android back
 * gesture would become unpredictable about which one it closes (the memory panel confirms inline
 * for the same reason). So this component only **raises the intent**: closing the window and
 * opening the confirmation is one screen's job.
 */

export function PlaytestSettingsDialog({
	open,
	onOpenChange,
	playtest,
	reloading,
	reloadFailed,
	onSelectStartScene,
	onReset,
	onReloadLatest,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	playtest: PlaytestController;
	reloading: boolean;
	reloadFailed: boolean;
	/**
	 * Selecting a scene discards the conversation, so **the screen asks for confirmation first.** That
	 * is why this does not call the controller directly.
	 */
	onSelectStartScene: (startSceneId: string | null) => void;
	onReset: () => void;
	onReloadLatest: () => void;
}) {
	/**
	 * The inherited value: the setting that actually applies when this test has picked nothing.
	 *
	 * The screen does not re-write `global ?? default`. The rule is to take the value the precedence
	 * resolver returns as-is, so the parenthesized part of `Use default (Standard)` matches the value that
	 * actually goes out.
	 */
	const inherited = useGlobalGenerationState();
	const catalog = useQuery(generationModelsQueryOptions(getRowCatClient()));
	const capability = useViewerCapability();
	/**
	 * The providers this device has connected. This is the **same store** as the summary line and the
	 * generation runtime; if they diverged, an item selectable inside the dialog would be blocked on
	 * send.
	 */
	const connections = useProviderConnections();

	const { preference, snapshot, generation } = playtest;
	/** Conditions do not change during generation; this request was already fixed to the values at its start. */
	const busy = generation.generating;

	const setTarget = (target: GenerationTarget | null) =>
		playtest.setPreference({ ...preference, target });
	const setResponseLength = (responseLength: ResponseLength | null) =>
		playtest.setPreference({ ...preference, responseLength });
	const setReasoningEffort = (reasoningEffort: ReasoningEffort | null) =>
		playtest.setPreference({ ...preference, reasoningEffort });

	const loading =
		inherited.loading ||
		catalog.isPending ||
		capability.loading ||
		connections.loading;

	return (
		<Dialog
			title={PLAYTEST_SETTINGS.title}
			description={PLAYTEST_SETTINGS.description}
			open={open}
			onOpenChange={onOpenChange}
			size="full"
			scroll
		>
			{loading ? (
				<View style={settings.loading}>
					<Spinner />
				</View>
			) : (
				<View>
					<StartSceneField
						scenes={snapshot.startScenes}
						value={playtest.startSceneId}
						disabled={busy}
						onChange={onSelectStartScene}
					/>

					<GenerationFields
						preference={preference}
						inheritedTarget={inherited.effective.target}
						inheritedResponseLength={inherited.effective.responseLength}
						inheritedReasoningEffort={inherited.effective.reasoningEffort}
						models={catalog.data ?? []}
						catalogLoaded={catalog.isSuccess}
						connected={connections.providers}
						byoAllowed={capability.byo}
						disabled={busy}
						onTarget={setTarget}
						onResponseLength={setResponseLength}
						onReasoningEffort={setReasoningEffort}
					/>

					{catalog.isError ? (
						<View style={settings.notice}>
							<Notice message={MODEL_CATALOG_FAILURE_MESSAGE} />
						</View>
					) : null}

					<Separator />

					{/*
					 * Session operations are not generation conditions. The three above answer "how the next response is
					 * built"; these two answer "how this test is run right now". Without a line between them, `Reset test`
					 * would read as a value to choose.
					 *
					 * The two operations also do **different things**. `Reset` starts over under the same conditions,
					 * while `New test with the latest draft` re-reads the revised manuscript. Merging them would make someone who
					 * restarted because they disliked a response unknowingly test a different version.
					 */}
					<View style={settings.session}>
						<Text variant="label" tone="muted-foreground">
							{PLAYTEST_SESSION_GROUP_LABEL}
						</Text>
						<Button
							label={
								reloading
									? PLAYTEST_RELOAD_PENDING_LABEL
									: PLAYTEST_RELOAD_LABEL
							}
							variant="outline"
							disabled={reloading}
							onPress={onReloadLatest}
						/>
						<Button
							label={PLAYTEST_RESET_LABEL}
							variant="ghost"
							/**
							 * Nothing to discard, nothing to press. Enabling it from the label alone would make a button
							 * that does nothing when pressed, indistinguishable from a broken one.
							 */
							disabled={playtest.messages.length === 0}
							onPress={onReset}
						/>
						{reloadFailed ? (
							<Notice tone="destructive" message={PLAYTEST_RELOAD_FAILURE} />
						) : null}
					</View>
				</View>
			)}
		</Dialog>
	);
}

/**
 * Start scene: **it stands only when there is more than one to choose from.**
 *
 * With one or none, no control is drawn. A disabled selection standing there would read as an
 * unbuilt feature, and that misreading is especially costly on this screen (the creator must learn
 * from the screen that their draft has no scenes).
 */
function StartSceneField({
	scenes,
	value,
	disabled,
	onChange,
}: {
	scenes: readonly PlaytestStartScene[];
	value: string | null;
	disabled: boolean;
	onChange: (startSceneId: string | null) => void;
}) {
	if (scenes.length <= 1) return null;

	const selected =
		value === null
			? PLAYTEST_DEFAULT_SCENE_LABEL
			: (scenes.find((scene) => scene.id === value)?.title ?? "");

	return (
		<Field
			label={PLAYTEST_START_SCENE_FIELD.label}
			description={PLAYTEST_START_SCENE_FIELD.description}
		>
			<Select
				label={PLAYTEST_START_SCENE_FIELD.label}
				value={
					selected ? startSceneHeadline(selected) : PLAYTEST_DEFAULT_SCENE_LABEL
				}
				disabled={disabled}
			>
				<SelectOption
					label={PLAYTEST_DEFAULT_SCENE_LABEL}
					selected={value === null}
					onSelect={() => onChange(null)}
				/>
				{scenes.map((scene) => (
					<SelectOption
						key={scene.id}
						label={startSceneHeadline(scene.title)}
						selected={scene.id === value}
						onSelect={() => onChange(scene.id)}
					/>
				))}
			</Select>
		</Field>
	);
}

/**
 * Generation target and response length: **the same two axes and rules as conversation settings.**
 *
 * The list and availability decision belong to `buildModelOptions` in `@rowcat/chat`, and **the web
 * and conversation settings call the same function**. What remains here is drawing, and writing the
 * chosen value **to memory**.
 */
function GenerationFields({
	preference,
	inheritedTarget,
	inheritedResponseLength,
	inheritedReasoningEffort,
	models,
	catalogLoaded,
	connected,
	byoAllowed,
	disabled,
	onTarget,
	onResponseLength,
	onReasoningEffort,
}: {
	preference: PlaytestController["preference"];
	inheritedTarget: GenerationTarget;
	inheritedResponseLength: ResponseLength;
	inheritedReasoningEffort: ReasoningEffort;
	models: Parameters<typeof buildModelOptions>[0]["models"];
	catalogLoaded: boolean;
	/** The providers this device has connected; the screen passes them through as received, without recounting. */
	connected: Parameters<typeof buildModelOptions>[0]["connected"];
	byoAllowed: boolean;
	disabled: boolean;
	onTarget: (target: GenerationTarget | null) => void;
	onResponseLength: (responseLength: ResponseLength | null) => void;
	onReasoningEffort: (effort: ReasoningEffort | null) => void;
}) {
	const options = buildModelOptions({
		models,
		value: preference.target,
		inherited: inheritedTarget,
		/**
		 * This is **the same value** the generation runtime passes, so an option drawn as selectable here
		 * never turns out to be blocked in practice.
		 */
		connected,
		byoAllowed,
		catalogLoaded,
	});

	/** The reasoning list is decided by the capability of **the target now in effect** (override ?? inherited value). */
	const reasoning = buildReasoningOptions({
		models,
		catalogLoaded,
		target: preference.target ?? inheritedTarget,
		value: preference.reasoningEffort,
		inherited: inheritedReasoningEffort,
	});

	/**
	 * Changing the target **also clears the reasoning override that became unusable**, the same rule
	 * as conversation settings.
	 *
	 * This override is stored nowhere (it is playtest-only), but it rides on requests in the meantime,
	 * so no stage that will not run may remain.
	 */
	const changeTarget = (next: GenerationTarget | null): void => {
		onTarget(next);
		const kept = reconcileReasoningOverride({
			reasoningEffort: preference.reasoningEffort,
			target: next ?? inheritedTarget,
			models,
			catalogLoaded,
		});
		if (kept !== preference.reasoningEffort) onReasoningEffort(kept);
	};

	/**
	 * While this test inherits the model, **if the global changes**, the override here also becomes an
	 * unusable value. It is not stored, but it rides on requests in the meantime, so the same cleanup
	 * is needed. The rule is **the same hook** as conversation settings: being playtest-only does not
	 * exempt it from cleanup.
	 */
	useStaleReasoningReconcile({
		reasoningEffort: preference.reasoningEffort,
		target: preference.target ?? inheritedTarget,
		ready: catalogLoaded,
		persist: onReasoningEffort,
	});

	const providerValueLabel =
		options.providerItems.find((item) => item.value === options.providerValue)
			?.label ?? options.inheritLabel;

	return (
		<>
			<Separator />

			<Field
				label={MODEL_TARGET_FIELD.label}
				description={PLAYTEST_MODEL_FIELD_DESCRIPTION}
			>
				<SubField label="Provider">
					<Select
						label={`${MODEL_TARGET_FIELD.label} provider`}
						value={providerValueLabel}
						disabled={disabled}
					>
						<SelectOption
							label={options.inheritLabel}
							selected={options.providerValue === INHERIT_VALUE}
							onSelect={() => changeTarget(null)}
						/>
						{options.providers.map((entry) => (
							<SelectOption
								key={entry.provider}
								label={entry.label}
								selected={entry.provider === options.providerValue}
								disabled={entry.disabled}
								onSelect={() => changeTarget(entry.defaultTarget)}
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
						disabled={disabled || options.modelValue === null}
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
											 * Choosing again an entry that is not in the catalog (the value picked now) **keeps the
											 * value as-is.** Dropping it to `null` would make re-pressing one's own selection in the
											 * list erase the override.
											 */
											changeTarget(
												targetForKey(entry.key, models) ?? preference.target,
											)
										}
									/>
								))}
							</View>
						))}
					</Select>
				</SubField>

				{/**
				 * The reason it is unavailable is **one line below the control**. That sentence now also states the
				 * next step (`Connect it in Settings → AI, or…`). It once stated only the fact, because this app had no
				 * connection screen; that premise is gone. No separate button stands here, because it is **one failure,
				 * one piece of guidance**: the sentence already names the way forward, and a control beside it would
				 * read the same fact twice.
				 */}
				{options.unavailable ? (
					<Text variant="caption" tone="destructive">
						{unavailableMessage(options.unavailable)}
					</Text>
				) : null}
			</Field>

			<Separator />

			<Field
				label={RESPONSE_LENGTH_FIELD.label}
				description={PLAYTEST_RESPONSE_LENGTH_FIELD_DESCRIPTION}
			>
				<Select
					label={RESPONSE_LENGTH_FIELD.label}
					value={
						preference.responseLength
							? responseLengthLabel(preference.responseLength)
							: inheritLabel(responseLengthLabel(inheritedResponseLength))
					}
					disabled={disabled}
				>
					<SelectOption
						label={inheritLabel(responseLengthLabel(inheritedResponseLength))}
						selected={preference.responseLength === null}
						onSelect={() => onResponseLength(null)}
					/>
					{RESPONSE_LENGTHS.map((length) => (
						<SelectOption
							key={length}
							label={responseLengthLabel(length)}
							selected={preference.responseLength === length}
							onSelect={() => onResponseLength(length)}
						/>
					))}
				</Select>
			</Field>

			{/*
			 * Reasoning effort: **the row exists only for models whose reasoning can be adjusted.** The separator
			 * folds with it (a stray line would otherwise stand with no reason).
			 */}
			{reasoning.available ? (
				<>
					<Separator />
					<Field
						label={REASONING_EFFORT_FIELD.label}
						description={PLAYTEST_REASONING_FIELD_DESCRIPTION}
					>
						<ReasoningEffortSelect
							options={reasoning}
							disabled={disabled}
							onChange={onReasoningEffort}
						/>
					</Field>
				</>
			) : null}
		</>
	);
}

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
			<Text accessibilityRole="header" variant="label">
				{label}
			</Text>
			<Text variant="caption" tone="muted-foreground">
				{description}
			</Text>
			{children}
		</View>
	);
}

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
	field: { gap: space.xs, paddingVertical: space.md },
	subField: { gap: space.xs },
	notice: { paddingBottom: space.md },
	session: { gap: space.sm, paddingVertical: space.md },
});
