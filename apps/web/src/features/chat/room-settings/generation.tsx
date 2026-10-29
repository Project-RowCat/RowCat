import type {
	GenerationTarget,
	ReasoningEffort,
	ResponseLength,
} from "@rowcat/chat";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { TargetUnavailability } from "#/features/generation/model-options.ts";
import { ModelTargetField } from "#/features/generation/model-target-field.tsx";
import { ReasoningEffortField } from "#/features/generation/reasoning-effort-field.tsx";
import {
	ResponseLengthField,
	responseLengthLabel,
} from "#/features/generation/response-length-field.tsx";
import {
	useReasoningReconcile,
	useStaleReasoningReconcile,
} from "#/features/generation/use-reasoning-reconcile.ts";
import { useSettingsReturnSearch } from "#/features/settings/settings-return.ts";
import { providerLabel } from "#/lib/generation/availability.ts";
import { useRoomGenerationState } from "#/lib/local-generation/hooks.ts";
import { useGenerationScope } from "#/lib/local-generation/scope.ts";

/**
 * Response length and generation target for this conversation. Ownership is unchanged from the
 * settings home:
 * - Response length and target: GenerationPreferenceStore (device-local, per member)
 * - Provider connection (API key): not owned here. This screen only links to /settings/ai
 *
 * The model override is stored in the preference, not on the room record. The room record syncs, so
 * a model chosen on a Mac would arrive on a phone without that provider connection and block the
 * conversation there.
 *
 * There is no API key input here. Two screens handling credentials would break the rule that
 * plaintext exists in one place. The link goes to /settings/ai rather than /settings, because
 * /settings is now `General`, and the user would have to look for the provider section from there. There
 * is no automatic navigation: the user came to see this conversation's settings and decides whether
 * to follow the link.
 *
 * There is no `Save settings` button. Values apply on selection. The two axes are used at different times
 * and no transaction covers both, so one commit could report partial success as success. Reverting
 * costs nothing: choose again.
 */
export function RoomSettingsGeneration({
	roomId,
	onLeave,
}: {
	roomId: string;
	/**
	 * Called when a link out of this dialog is pressed (leaving for settings). The dialog must close;
	 * otherwise it stays open over the new route and the user sees the destination behind it.
	 */
	onLeave: () => void;
}) {
	const { t } = useTranslation(["chat", "common"]);
	/**
	 * The two links to settings carry a return location (settings-return.ts). This dialog floats over
	 * the conversation, so the current URL is that location. If the user leaves by closing the dialog,
	 * returning would mean finding this room in the list again.
	 */
	const returnSearch = useSettingsReturnSearch();
	const { store: preferences } = useGenerationScope();
	const {
		room: roomPreference,
		inherited,
		loading,
	} = useRoomGenerationState(roomId);
	const [error, setError] = useState<string | null>(null);
	const reconcileReasoning = useReasoningReconcile();

	/**
	 * Applies on selection. `null` clears the override rather than copying the inherited value, so
	 * later changes to the global default still reach this room.
	 */
	const apply = async (
		patch: Partial<{
			responseLength: ResponseLength | null;
			target: GenerationTarget | null;
			reasoningEffort: ReasoningEffort | null;
		}>,
	): Promise<void> => {
		if (!preferences) return;
		setError(null);
		try {
			/**
			 * The two axes are written one at a time. The store deletes the row when it receives an empty
			 * preference, so resetting one axis to `Use default` must send the other axis's current value
			 * along. Otherwise it would erase the other axis too.
			 */
			await preferences.setRoom(roomId, { ...roomPreference, ...patch });
		} catch (failure) {
			// Raw Dexie error text is not shown. The message is a generic sentence that does not say what
			// the user can do.
			console.error("[chat] couldn't save the conversation settings", failure);
			setError(t("generation.couldnTSaveTheSettings"));
		}
	};

	/**
	 * If this room inherits the model and the global setting changes, the room's override is never
	 * touched by the user, yet it can become unusable. The screen would then show a step that does not
	 * run, and the saved preference would mean something other than what it says. Only the
	 * reasoning-effort axis is cleared; response length and target are kept.
	 */
	useStaleReasoningReconcile({
		reasoningEffort: roomPreference.reasoningEffort,
		target: roomPreference.target ?? inherited.target,
		ready: !loading && preferences !== null,
		persist: (reasoningEffort) => void apply({ reasoningEffort }),
	});

	/**
	 * Exit route for an unusable target, shown only when no provider connection exists. If the model
	 * has simply disappeared from the catalog, no link is shown: the fix is choosing another model in
	 * the control above, and settings would not help. An inherited unusable target gets the same
	 * guidance, since the override ?? inherited check decides whether generation is blocked.
	 */
	const renderRecovery = (unavailable: TargetUnavailability) =>
		unavailable.reason === "provider_not_connected" ? (
			<Link
				to="/settings/ai"
				search={returnSearch}
				className="text-sm underline underline-offset-2"
				onClick={onLeave}
			>
				{t("generation.connect", {
					provider: providerLabel(unavailable.provider),
				})}
			</Link>
		) : null;

	return (
		/*
		 * A single attribute list, not a set of cards. Both controls share one row shape (name and
		 * description on the left, the choice on the right), and a divider line rather than a box makes
		 * that visible. The margins match SETTINGS_ROW_FRAME_CLASS in
		 * features/settings/settings-parts.tsx on purpose, but the constant is deliberately not imported:
		 * the two screens use different containers (canvas vs dialog), and a shared name would let a
		 * change to the settings page margins alter this dialog's geometry. What must be shared is the
		 * two heavy-behavior controls, and they already are.
		 */
		<div className="flex flex-col divide-y">
			<div className="pb-4">
				<ResponseLengthField
					value={roomPreference.responseLength}
					inheritedLabel={responseLengthLabel(inherited.responseLength)}
					description={t("generation.howLongTheRepliesIn")}
					loading={loading}
					disabled={!preferences}
					onChange={(next) => void apply({ responseLength: next })}
				/>
			</div>

			{/*
			 * `Use default` does not copy the current global target into this room; it clears the override.
			 * Copying would stop this room from following later changes to the global setting.
			 */}
			<div className="py-4">
				<ModelTargetField
					value={roomPreference.target}
					inherited={inherited.target}
					description={t("generation.theModelThatGeneratesThis")}
					loading={loading}
					disabled={!preferences}
					/*
					 * Changing the target also clears the reasoning override if it is no longer valid. The two
					 * axes are independent, but the target defines the range of the other. Setting `High` on a model
					 * without that step would save the override while no request could express it: the screen
					 * would show a step the user never chose, and generation would run a different one. The
					 * override is cleared rather than moved, so the axis returns to inheritance. Response length
					 * is not touched.
					 */
					onChange={(next) =>
						void apply({
							target: next,
							reasoningEffort: reconcileReasoning({
								reasoningEffort: roomPreference.reasoningEffort,
								target: next ?? inherited.target,
							}),
						})
					}
					renderRecovery={renderRecovery}
				/>
			</div>

			{/*
			 * Reasoning effort, shown only for models that support adjusting it. It follows the generation
			 * target,
			 * not response length, because the available options depend on the model chosen just above. Reading
			 * in
			 * that order explains why the row appears and disappears.
			 */}
			<ReasoningEffortField
				value={roomPreference.reasoningEffort}
				inherited={inherited.reasoningEffort}
				target={roomPreference.target ?? inherited.target}
				description={t("generation.howDeeplyToThinkBefore")}
				frameClassName="py-4"
				loading={loading}
				disabled={!preferences}
				onChange={(next) => void apply({ reasoningEffort: next })}
			/>

			{/*
			 * Failures are handled here, not in a global toast. The failure belongs to the control just
			 * changed, and
			 * a toast shown after the dialog closes cannot say what was not saved. The failing axis is unknown,
			 * so the
			 * error sits below both rows on its own line, separated by a rule.
			 */}
			{error && (
				<p role="alert" className="py-4 text-sm text-destructive">
					{error}
				</p>
			)}

			{/*
			 * Inherited: a footnote for this surface, not a third section. The title uses the same size and
			 * color as
			 * the group titles on home (text-xs, muted), so it does not compete with the two rows above and
			 * reads as a
			 * named fact. Priority is stated in user terms only; phrases like 'the global preference sits below
			 * the room
			 * override' are implementation vocabulary. The device-local axis is kept: that these values do not
			 * sync
			 * matters to someone opening the same conversation on another device.
			 */}
			<div className="pt-4">
				<h3 className="text-xs font-medium text-muted-foreground">
					{t("generation.defaults")}
				</h3>
				<p className="mt-1 text-sm text-muted-foreground">
					<Trans
						t={t}
						i18nKey="generation.defaultsNote"
						components={{
							link: (
								<Link
									to="/settings/ai"
									search={returnSearch}
									className="underline underline-offset-2"
									onClick={onLeave}
								/>
							),
						}}
					/>
				</p>
			</div>
		</div>
	);
}
