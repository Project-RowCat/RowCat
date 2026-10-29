import type { PlaytestStartScene } from "@rowcat/authoring";
import type { ResponseLength } from "@rowcat/chat";
import { Button } from "@rowcat/ui-web/components/button";
import { Label } from "@rowcat/ui-web/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@rowcat/ui-web/components/select";
import { Link } from "@tanstack/react-router";
import * as m from "motion/react-m";
import { useId } from "react";
import { useTranslation } from "react-i18next";
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
import { providerLabel } from "#/lib/generation/availability.ts";
import { useGlobalGenerationState } from "#/lib/local-generation/hooks.ts";
import { enterTransition, exitTransition } from "#/lib/motion/transitions.ts";
import type { PlaytestController } from "./use-playtest.ts";

/**
 * Test conditions inspector: three session-only values and two operations on the session itself.
 *
 * Nothing here is saved. The start scene does not touch the draft's `defaultStartSceneId`. The
 * model and response length are written neither to the device preference (`setGlobal`) nor to the
 * room override (`setRoom`). A test should not change every conversation default the user has, and
 * the draft has no place for these values anyway, since the model is not an authoring property.
 *
 * It is not always open. It was once fixed above the conversation, which made settings the main
 * content, the reverse of what a test workspace needs. The toolbar trigger now opens it, and while
 * it is closed the summary line states the conditions. Hiding it without a summary would send the
 * user off writing messages without knowing what they are testing.
 *
 * It is not a dialog. Choosing the start scene discards the conversation, so it asks for
 * confirmation. Inside a dialog, that confirmation would become a dialog within a dialog, with
 * overlapping focus traps. An in-screen panel avoids the overlap.
 *
 * The controls are the same ones used by the settings screen and conversation settings
 * (`features/generation/*`). The meaning of 'use default' and the display of unusable targets
 * should not diverge across three places, so this component only passes values and lifts selections
 * up.
 */

/**
 * Value for the draft's default opening. `Select` uses `null` to mean the same item was picked
 * again, so an empty choice cannot be expressed that way. A string that cannot collide with a scene
 * id is used instead (ids are UUIDs).
 *
 * Display only. This value is never written to storage or sent in the summary.
 */
const DEFAULT_SCENE_VALUE = "__default__";

function StartSceneField({
	scenes,
	value,
	disabled,
	onChange,
}: {
	scenes: readonly PlaytestStartScene[];
	value: string | null;
	disabled?: boolean;
	onChange: (startSceneId: string | null) => void;
}) {
	const { t } = useTranslation(["playtest", "common"]);
	const id = useId();
	const descriptionId = `${id}-description`;
	const options = [
		{
			value: DEFAULT_SCENE_VALUE,
			label: t("playtestInspector.draftSDefaultOpening"),
		},
		...scenes.map((scene) => ({ value: scene.id, label: scene.title })),
	];

	return (
		<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
			<div className="min-w-0">
				<Label htmlFor={id} className="text-sm font-medium">
					{t("playtestInspector.openingScene")}
				</Label>
				{/*
				 * The description is bound to the control, as the panel's other two rows (`Model`, `Response length`)
				 * already do. This field was the only one missing it, which was a defect.
				 */}
				<p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
					{t("playtestInspector.anOpeningUsedOnlyIn")}
				</p>
			</div>
			<Select
				items={options}
				value={value ?? DEFAULT_SCENE_VALUE}
				onValueChange={(next) => {
					if (next === null) return;
					onChange(next === DEFAULT_SCENE_VALUE ? null : next);
				}}
				disabled={disabled}
			>
				<SelectTrigger
					id={id}
					size="sm"
					aria-describedby={descriptionId}
					className="h-9 w-full shrink-0 sm:h-8 sm:w-52"
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

export function PlaytestInspector({
	id,
	playtest,
	onSelectStartScene,
	onReset,
	onReloadLatest,
	reloading,
}: {
	/** The id that the trigger's `aria-controls` points to. The toolbar issues it. */
	id: string;
	playtest: PlaytestController;
	/**
	 * Choosing a start scene discards the conversation, so the screen asks for confirmation first.
	 * That is why the controller is not called directly here: the page owns the confirmation dialog.
	 */
	onSelectStartScene: (startSceneId: string | null) => void;
	onReset: () => void;
	onReloadLatest: () => void;
	reloading: boolean;
}) {
	const { t } = useTranslation(["playtest", "common"]);
	/**
	 * The inherited value: the setting that actually applies when this test has picked nothing.
	 *
	 * The screen does not re-derive `global ?? default`. It takes the value the precedence resolver
	 * returns, as a rule (`local-generation/hooks.ts`). That makes the parenthetical in `Use default
	 * (Standard)` match the value that will actually be sent.
	 */
	const inherited = useGlobalGenerationState();
	const reconcileReasoning = useReasoningReconcile();

	/**
	 * While this test inherits the model, the global setting may change in another tab, making the
	 * local override unusable. The value is not saved, but it is still sent with requests in the
	 * meantime, so it needs the same cleanup. The rule uses the same hook as the room settings. Being
	 * playtest-only does not exempt it from cleanup.
	 */
	useStaleReasoningReconcile({
		reasoningEffort: playtest.preference.reasoningEffort,
		target: playtest.preference.target ?? inherited.effective.target,
		ready: !inherited.loading,
		persist: (reasoningEffort) =>
			playtest.setPreference({ ...playtest.preference, reasoningEffort }),
	});

	/**
	 * The way out of an unusable target. Shown only when the connection is missing.
	 *
	 * No link is given when the model has disappeared from the list. In that case the fix is to pick
	 * another model in the control just above. Sending the user to settings would take them somewhere
	 * that fixes nothing (the chat settings make the same decision).
	 */
	const renderRecovery = (unavailable: TargetUnavailability) =>
		unavailable.reason === "provider_not_connected" ? (
			<Link to="/settings/ai" className="text-sm underline underline-offset-2">
				{t("inspector.connect", {
					provider: providerLabel(unavailable.provider),
				})}
			</Link>
		) : null;

	return (
		/*
		 * Does not animate height. The global `MotionConfig reducedMotion="user"` removes transforms, and
		 * opening by height would keep the expansion for users who reduce motion. Only opacity and a
		 * small shift are used, so that check applies automatically (same shape as the error line on the
		 * same screen).
		 */
		<m.section
			id={id}
			/** Names the panel, so focus entering it announces which settings these are. */
			aria-label={t("playtestInspector.testConditions")}
			className="shrink-0 rounded-lg border bg-card/40 p-3"
			initial={{ opacity: 0, y: -4 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0, y: -4, transition: exitTransition }}
			transition={enterTransition}
		>
			<div className="flex flex-col gap-3">
				{/*
				 * With one or no scenes there is nothing to choose, so no control is drawn. A disabled select
				 * would read as an unbuilt feature.
				 */}
				{playtest.snapshot.startScenes.length > 1 && (
					<StartSceneField
						scenes={playtest.snapshot.startScenes}
						value={playtest.startSceneId}
						disabled={playtest.generation.generating}
						onChange={onSelectStartScene}
					/>
				)}

				<ModelTargetField
					value={playtest.preference.target}
					inherited={inherited.effective.target}
					description={t("playtestInspector.aModelUsedOnlyIn")}
					loading={inherited.loading}
					disabled={playtest.generation.generating}
					/*
					 * Changing the target also clears the reasoning override that is no longer usable, as the chat
					 * settings do. This override is stored nowhere (it is playtest-only), but it is still sent
					 * with requests in the meantime, so no unused step may remain.
					 */
					onChange={(target) =>
						playtest.setPreference({
							...playtest.preference,
							target,
							reasoningEffort: reconcileReasoning({
								reasoningEffort: playtest.preference.reasoningEffort,
								target: target ?? inherited.effective.target,
							}),
						})
					}
					renderRecovery={renderRecovery}
				/>

				<ReasoningEffortField
					value={playtest.preference.reasoningEffort}
					inherited={inherited.effective.reasoningEffort}
					target={playtest.preference.target ?? inherited.effective.target}
					description={t("playtestInspector.appliesOnlyInThisTest")}
					loading={inherited.loading}
					disabled={playtest.generation.generating}
					onChange={(reasoningEffort) =>
						playtest.setPreference({
							...playtest.preference,
							reasoningEffort,
						})
					}
				/>

				<ResponseLengthField
					value={playtest.preference.responseLength}
					inheritedLabel={responseLengthLabel(
						inherited.effective.responseLength,
					)}
					description={t("playtestInspector.appliesOnlyInThisTest")}
					loading={inherited.loading}
					disabled={playtest.generation.generating}
					onChange={(responseLength: ResponseLength | null) =>
						playtest.setPreference({
							...playtest.preference,
							responseLength,
						})
					}
				/>
			</div>

			{/*
			 * Session operations are not generation properties. The three above answer how the next response
			 * is produced; these two answer how this test is run. Without a line between them, `Reset test`
			 * reads like a value to choose.
			 *
			 * The two operations also differ from each other. `Reset` starts over with the same conditions.
			 * `New test from latest draft` re-reads the revised draft. Merging them would let someone who restarted
			 * because they disliked the response unknowingly test a different version.
			 */}
			<div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
				<span className="text-xs font-medium text-muted-foreground">
					{t("playtestInspector.session")}
				</span>
				<div className="flex flex-wrap gap-2">
					<Button
						size="sm"
						variant="outline"
						disabled={reloading}
						onClick={onReloadLatest}
					>
						{reloading
							? t("common:state.loading")
							: t("playtestInspector.newTestWithTheLatest")}
					</Button>
					<Button
						size="sm"
						variant="ghost"
						disabled={playtest.messages.length === 0}
						onClick={onReset}
					>
						{t("playtestInspector.resetTest")}
					</Button>
				</div>
			</div>
		</m.section>
	);
}
