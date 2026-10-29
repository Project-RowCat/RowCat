import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { TargetUnavailability } from "#/features/generation/model-options.ts";
import { ModelTargetField } from "#/features/generation/model-target-field.tsx";
import { ReasoningEffortField } from "#/features/generation/reasoning-effort-field.tsx";
import {
	useReasoningReconcile,
	useStaleReasoningReconcile,
} from "#/features/generation/use-reasoning-reconcile.ts";
import { useSettingsReturnSearch } from "#/features/settings/settings-return.ts";
import { providerLabel } from "#/lib/generation/availability.ts";
import { deferredTranslator } from "#/lib/i18n/current.ts";
import {
	type RuntimeGenerationState,
	useRuntimeGenerationState,
} from "#/lib/local-generation/hooks.ts";
import { useGenerationScope } from "#/lib/local-generation/scope.ts";

const tr = deferredTranslator("settings");

/**
 * Generation settings dialog for this work. It has the same controls as the chat room's `Generation settings`
 * surface, with different copy.
 * - No response-length control: the creator's request sets the output cap, so the control and its
 *   copy are omitted.
 * - The copy lives here, not in runtime-player-copy.ts. The mobile parity check regex-scans that
 *   file for key: "value" pairs, and this dialog's `saveFailed` would shadow the same-named
 *   save-failure key. The dialog is web-only for now, so it does not belong in that table.
 * - The final line says the change applies from the next generation request. AI permission is
 *   fixed for the session (`RUNTIME_PLAYER_AI_COPY.note`), but the target is read from storage on
 *   each request. Without that line, a user who changes the model cannot tell whether a restart is
 *   needed.
 */
const RUNTIME_GENERATION_SETTINGS_COPY = {
	get title() {
		return tr("runtimeGeneration.title");
	},
	get description() {
		return tr("runtimeGeneration.description");
	},
	get modelDescription() {
		return tr("runtimeGeneration.modelDescription");
	},
	get reasoningDescription() {
		return tr("runtimeGeneration.reasoningDescription");
	},
	get saveFailed() {
		return tr("runtimeGeneration.saveFailed");
	},
	get inheritTitle() {
		return tr("runtimeGeneration.inheritTitle");
	},
	get inheritBefore() {
		return tr("runtimeGeneration.inheritBefore");
	},
	get inheritLink() {
		return tr("runtimeGeneration.inheritLink");
	},
	get inheritAfter() {
		return tr("runtimeGeneration.inheritAfter");
	},
	/** `{provider}` is replaced with the provider name. The sentence matches the chat room's hint. */
	connectProvider: (provider: string) =>
		tr("runtimeGeneration.connectProvider", { provider }),
} as const;

/**
 * Generation settings for this work: the same two controls as the chat room, stored under different
 * keys.
 * - Target and reasoning effort are saved with GenerationPreferenceStore.setRuntime(storyId),
 *   which is device-local and scoped to the member. Response length is absent because the creator's
 *   request sets the output cap. The provider connection (API key) is not owned here; the dialog
 *   only links to /settings/ai.
 * - It does not reuse room-settings-generation.tsx, which takes a room id to call the store,
 *   while a runtime playthrough has only a story id. Both share the behavior-heavy controls in
 *   features/generation/*. Storage rules, precedence and reset semantics match the chat side (null
 *   clears the override instead of copying the parent value) and must stay in sync.
 * - It does not import @rowcat/chat. The folder boundary test blocks that package so runtime
 *   playthroughs stay distinct from chat rooms. The preference vocabulary comes from
 *   lib/local-generation/hooks.ts, and the patch shape is read from the override field of
 *   RuntimeGenerationState. Do not widen the boundary test: that would let ChatStore through the
 *   same door.
 * - No save button. Each choice is written immediately. The two axes are written at different
 *   times with no shared transaction, so one commit could report success after only one write
 *   succeeded. Reverting is cheap, because the next generation request re-reads storage. Only the
 *   AI permission is held per session.
 */
export function RuntimeGenerationSettingsDialog({
	storyId,
	onClose,
}: {
	storyId: string;
	onClose: () => void;
}) {
	return (
		<Dialog
			open
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			{/*
			 * On narrow screens the geometry below uses the same values as the chat room's settings dialog, so
			 * the two read as one product. The classes are copied rather than imported, because that dialog
			 * takes
			 * a `ChatRoom` prop.
			 */}
			<DialogContent className="top-auto bottom-0 flex max-h-[85dvh] w-full max-w-full flex-col gap-0 rounded-t-xl rounded-b-none p-0 sm:top-1/2 sm:bottom-auto sm:max-w-md sm:rounded-xl">
				<DialogHeader className="min-w-0 border-b py-4 pr-14 pl-5 text-left">
					<DialogTitle>{RUNTIME_GENERATION_SETTINGS_COPY.title}</DialogTitle>
					<DialogDescription className="mt-1">
						{RUNTIME_GENERATION_SETTINGS_COPY.description}
					</DialogDescription>
				</DialogHeader>
				<div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 py-4">
					<RuntimeGenerationSettings storyId={storyId} onLeave={onClose} />
				</div>
			</DialogContent>
		</Dialog>
	);
}

type OverridePatch = Partial<RuntimeGenerationState["override"]>;

function RuntimeGenerationSettings({
	storyId,
	onLeave,
}: {
	storyId: string;
	/**
	 * Called when a link that leaves this dialog (to settings) is clicked. If the dialog stayed open
	 * during navigation, it would survive the route change, and the user would see the arrival screen
	 * behind it.
	 */
	onLeave: () => void;
}) {
	const { store: preferences } = useGenerationScope();
	const { override, inherited, loading } = useRuntimeGenerationState(storyId);
	const [error, setError] = useState<string | null>(null);
	const reconcileReasoning = useReasoningReconcile();

	/**
	 * Each choice is written immediately, one axis at a time, and the other axis is sent unchanged.
	 * The store deletes the row when it receives an empty preference, so resetting one axis to `Use default
	 * settings` would otherwise wipe the other axis too. Response length is always sent as `null`. The
	 * dialog has no control for it, and a stored value would never reach execution anyway.
	 */
	const apply = async (patch: OverridePatch): Promise<void> => {
		if (!preferences) return;
		setError(null);
		try {
			await preferences.setRuntime(storyId, { ...override, ...patch });
		} catch (failure) {
			// Raw Dexie errors are not shown to the user, because they do not say what the user can do. The
			// details go to the console instead.
			console.error("[runtime] could not save generation settings", failure);
			setError(RUNTIME_GENERATION_SETTINGS_COPY.saveFailed);
		}
	};

	/**
	 * If the global model changes while this work inherits its model, the reasoning override becomes
	 * unusable without anyone touching it. The dialog closes that case with the same rule as the chat
	 * room's matching surface.
	 */
	useStaleReasoningReconcile({
		reasoningEffort: override.reasoningEffort,
		target: override.target ?? inherited.target,
		ready: !loading && preferences !== null,
		persist: (reasoningEffort) => void apply({ reasoningEffort }),
	});

	/**
	 * The two links out to settings carry the return location, so the user comes back here
	 * (settings-return.ts).
	 */
	const returnSearch = useSettingsReturnSearch();
	const renderRecovery = (unavailable: TargetUnavailability) =>
		unavailable.reason === "provider_not_connected" ? (
			<Link
				to="/settings/ai"
				search={returnSearch}
				className="text-sm underline underline-offset-2"
				onClick={onLeave}
			>
				{RUNTIME_GENERATION_SETTINGS_COPY.connectProvider(
					providerLabel(unavailable.provider),
				)}
			</Link>
		) : null;

	return (
		<div className="flex flex-col divide-y">
			<div className="pb-4">
				<ModelTargetField
					value={override.target}
					inherited={inherited.target}
					description={RUNTIME_GENERATION_SETTINGS_COPY.modelDescription}
					loading={loading}
					disabled={!preferences}
					/*
					 * Changing the target also clears any reasoning override the new target cannot use. It is
					 * cleared rather than migrated, so that axis goes back to inheriting. Same function as in the
					 * chat room.
					 */
					onChange={(next) =>
						void apply({
							target: next,
							reasoningEffort: reconcileReasoning({
								reasoningEffort: override.reasoningEffort,
								target: next ?? inherited.target,
							}),
						})
					}
					renderRecovery={renderRecovery}
				/>
			</div>

			{/*
			 * This row appears only for models whose reasoning effort can be adjusted.
			 * It comes after the target because it depends on it.
			 */}
			<ReasoningEffortField
				value={override.reasoningEffort}
				inherited={inherited.reasoningEffort}
				target={override.target ?? inherited.target}
				description={RUNTIME_GENERATION_SETTINGS_COPY.reasoningDescription}
				frameClassName="py-4"
				loading={loading}
				disabled={!preferences}
				onChange={(next) => void apply({ reasoningEffort: next })}
			/>

			{/*
			 * Failures end here, inside the dialog. A toast shown after the dialog closes could not say which
			 * change was not saved.
			 */}
			{error && (
				<p role="alert" className="py-4 text-sm text-destructive">
					{error}
				</p>
			)}

			<div className="pt-4">
				<h3 className="text-xs font-medium text-muted-foreground">
					{RUNTIME_GENERATION_SETTINGS_COPY.inheritTitle}
				</h3>
				<p className="mt-1 text-sm text-muted-foreground">
					{RUNTIME_GENERATION_SETTINGS_COPY.inheritBefore}
					<Link
						to="/settings/ai"
						search={returnSearch}
						className="underline underline-offset-2"
						onClick={onLeave}
					>
						{RUNTIME_GENERATION_SETTINGS_COPY.inheritLink}
					</Link>
					{RUNTIME_GENERATION_SETTINGS_COPY.inheritAfter}
				</p>
			</div>
		</div>
	);
}
