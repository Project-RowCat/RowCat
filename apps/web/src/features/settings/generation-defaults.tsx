import type {
	GenerationTarget,
	ReasoningEffort,
	ResponseLength,
} from "@rowcat/chat";
import { PRODUCT_GENERATION_TARGET } from "@rowcat/chat";
import { Button } from "@rowcat/ui-web/components/button";
import { ClientOnly } from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import type { RefObject } from "react";
import { useState } from "react";
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
import { useGenerationScope } from "#/lib/local-generation/scope.ts";
import { feedbackEnter, feedbackExit } from "#/lib/motion/feedback.ts";
import {
	SETTINGS_CONTROL_WIDTH,
	SETTINGS_ROW_FRAME_CLASS,
	SettingsGroup,
	SettingsRowFrame,
} from "./settings-parts.tsx";

/**
 * Generation defaults: the device-wide default for how conversations are generated.
 *
 * Rooms can override these values (`Conversation settings`), and rooms that do not override follow these. The
 * precedence rule itself is not in this file. One resolver owns it (`resolveEffectiveGeneration` in
 * @rowcat/chat). Re-writing `room ?? global ?? default` here would create two copies of the rule
 * that could give different answers on different screens.
 *
 * This section and the `AI providers` section on the same screen use separate stores:
 * - Response length and generation target: GenerationPreferenceStore (what to generate with).
 * - Provider connection: ProviderConnectionStore (whether this device can do it).
 *
 * So there is no save button at the bottom. No transaction spans both stores, and such a button
 * would report success when only part of it succeeded. Each pick writes immediately to its own
 * owner.
 *
 * The section order is intentional: generation first, then the connection that enables it.
 * Reversing them would make the first row look like it needs an API key, although RowCat-provided
 * models work with no connection at all.
 */
export function GenerationDefaultsGroup({
	providerHeadingRef,
}: {
	/**
	 * The place an unusable target's exit leads to: the provider section's title on this same screen.
	 * This component does not know where that is. The page passes it in while composing the two
	 * sections, and this component only moves focus to the received ref. Searching for it here would
	 * make this file depend on the neighboring section's markup.
	 */
	providerHeadingRef: RefObject<HTMLHeadingElement | null>;
}) {
	const { t } = useTranslation(["settings", "common"]);
	return (
		<SettingsGroup
			title={t("generationDefaults.generationDefaults")}
			description={t("generationDefaults.appliedToNewConversationsBy")}
		>
			{/*
			 * This section's values live in per-member IndexedDB. The server does not know them and must not.
			 * If the
			 * server render draws defaults and hydration then swaps in saved values, the user sees their
			 * setting
			 * vanish and reappear.
			 */}
			<ClientOnly fallback={<GenerationDefaultsFallback />}>
				<GenerationDefaults providerHeadingRef={providerHeadingRef} />
			</ClientOnly>
		</SettingsGroup>
	);
}

/**
 * Placeholder before the browser part arrives. It uses the same line and height as the real
 * controls.
 */
function GenerationDefaultsFallback() {
	return (
		<>
			<SettingsRowFrame>
				<ResponseLengthField
					value={null}
					inheritedLabel=""
					controlClassName={SETTINGS_CONTROL_WIDTH}
					loading
					onChange={() => {}}
				/>
			</SettingsRowFrame>
			<SettingsRowFrame>
				{/*
				 * The placeholder does not yet know what it inherits, so it uses the product's default target
				 * directly.
				 * A literal here would flash a different model name during loading on the day it diverged from the
				 * product default.
				 */}
				<ModelTargetField
					value={null}
					inherited={PRODUCT_GENERATION_TARGET}
					loading
					onChange={() => {}}
				/>
			</SettingsRowFrame>
		</>
	);
}

function GenerationDefaults({
	providerHeadingRef,
}: {
	providerHeadingRef: RefObject<HTMLHeadingElement | null>;
}) {
	const { t } = useTranslation(["settings", "common"]);
	const { store } = useGenerationScope();
	const { global, inherited, loading } = useGlobalGenerationState();
	const [error, setError] = useState<string | null>(null);
	const reconcileReasoning = useReasoningReconcile();

	/**
	 * Writes immediately on each pick. `null` clears the override; it does not copy the current
	 * product default. Copying would pin this user to an old value after the default changed.
	 *
	 * The two axes are written one at a time. The store deletes the row when given an empty
	 * preference, so clearing one axis must still send the other axis unchanged, or it would clear
	 * that too.
	 */
	const apply = async (
		patch: Partial<{
			responseLength: ResponseLength | null;
			target: GenerationTarget | null;
			reasoningEffort: ReasoningEffort | null;
		}>,
	): Promise<void> => {
		if (!store) return;
		setError(null);
		try {
			await store.setGlobal({ ...global, ...patch });
		} catch (failure) {
			console.error(
				"[settings] couldn't save the generation defaults",
				failure,
			);
			setError(t("generationDefaults.couldnTSaveTheSettings"));
		}
	};

	/**
	 * While global picks nothing and inherits the product default, a change to that default would also
	 * raise a stale-override notice here, since a deployment changes the effective model. This is the
	 * same hook the room settings use, and what it clears is the reasoning axis only.
	 */
	useStaleReasoningReconcile({
		reasoningEffort: global.reasoningEffort,
		target: global.target ?? inherited.target,
		ready: !loading && store !== null,
		persist: (reasoningEffort) => void apply({ reasoningEffort }),
	});

	/**
	 * The exit from an unusable target. Shown only when no connection exists.
	 *
	 * The router is not used. What is needed is a point inside this screen (the provider section is on
	 * the same `/settings/ai` page), and expressing it as navigation would create an address that does
	 * not exist.
	 *
	 * When the model has disappeared from the list, no button is shown. The action there is to pick
	 * another model from the list above, and that control sits directly above this sentence. Sending
	 * the user to provider connection would lead to a place that fixes nothing.
	 *
	 * The preference is not repaired here. A button that switches the target back to RowCat would be a
	 * substitution, and the value that returns on reconnecting would be lost.
	 */
	const renderRecovery = (unavailable: TargetUnavailability) =>
		unavailable.reason === "provider_not_connected" ? (
			<Button
				variant="outline"
				size="sm"
				className="h-8 self-start"
				onClick={() => {
					providerHeadingRef.current?.scrollIntoView({ block: "nearest" });
					providerHeadingRef.current?.focus();
				}}
			>
				{t("generationDefaults.connect", {
					provider: providerLabel(unavailable.provider),
				})}
			</Button>
		) : null;

	return (
		<>
			<SettingsRowFrame>
				<ResponseLengthField
					value={global.responseLength}
					inheritedLabel={responseLengthLabel(inherited.responseLength)}
					description={t("generationDefaults.theDefaultLengthOfReplies")}
					/*
					 * Same width as the generation target control below. If the two rows' controls do not start at
					 * the same edge, the misalignment makes the whole screen look unaligned.
					 */
					controlClassName={SETTINGS_CONTROL_WIDTH}
					loading={loading}
					disabled={!store}
					onChange={(next) => void apply({ responseLength: next })}
				/>
			</SettingsRowFrame>

			<SettingsRowFrame>
				<ModelTargetField
					value={global.target}
					inherited={inherited.target}
					description={t(
						"generationDefaults.theModelThatGeneratesConversations",
					)}
					loading={loading}
					disabled={!store}
					/*
					 * Changing the target also clears a reasoning override that became unusable. Room settings
					 * follow the same rule. The axis is cleared rather than moved to another step, since it must
					 * return to inheritance (the product default). Response length is not touched.
					 */
					onChange={(next) =>
						void apply({
							target: next,
							reasoningEffort: reconcileReasoning({
								reasoningEffort: global.reasoningEffort,
								target: next ?? inherited.target,
							}),
						})
					}
					renderRecovery={renderRecovery}
				/>
			</SettingsRowFrame>

			{/*
			 * Reasoning effort. This row exists only for models that can be tuned. It sits after the generation
			 * target
			 * because the options depend on the model picked above. The component draws its own frame: wrapping
			 * it in
			 * `SettingsRowFrame` would leave a divider line on models without this row.
			 */}
			<ReasoningEffortField
				value={global.reasoningEffort}
				inherited={inherited.reasoningEffort}
				target={global.target ?? inherited.target}
				description={t("generationDefaults.howDeeplyToThinkBefore")}
				frameClassName={SETTINGS_ROW_FRAME_CLASS}
				controlClassName={SETTINGS_CONTROL_WIDTH}
				loading={loading}
				disabled={!store}
				onChange={(next) => void apply({ reasoningEffort: next })}
			/>

			{/*
			 * A save failure appears just below the row that was just picked (`lib/motion/feedback.ts`). In
			 * this
			 * section the only action is picking one value, so an answer that appeared silently would leave the
			 * user
			 * unable to tie it to what they pressed. It is the last child, so when it disappears it does not
			 * push
			 * content below it.
			 */}
			<AnimatePresence initial={false}>
				{error && (
					<m.p
						key="defaults-error"
						role="alert"
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						exit={feedbackExit}
						transition={feedbackEnter.transition}
						className="mt-4 text-sm text-destructive"
					>
						{error}
					</m.p>
				)}
			</AnimatePresence>
		</>
	);
}
