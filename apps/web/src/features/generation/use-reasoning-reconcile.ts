import type { GenerationTarget, ReasoningEffort } from "@rowcat/chat";
import {
	reasoningOverrideStale,
	reconcileReasoningOverride,
} from "@rowcat/chat";
import { generationModelsQueryOptions } from "@rowcat/query";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { getRowCatClient } from "#/lib/api.ts";

/**
 * The one thing a screen that changes the target must clean up as well: a reasoning override that
 * became unusable. The rule is a pure function (`reconcileReasoningOverride` in `@rowcat/chat`);
 * this hook only supplies the catalog that function asks for.
 *
 * If the three screens (room settings, default AI settings, work test) each wired their own query,
 * one would forget. Only that screen would keep a saved step that no longer runs after the model
 * changes, and since the screen draws the step, nothing would look wrong.
 *
 * The query uses the same key as the model selector, so no extra request is made. The hook touches
 * no other axis: it returns one reasoning value, and the response length and target are passed
 * through unchanged. Choosing a target must not silently change other settings.
 */
export function useReasoningReconcile(): (input: {
	/** This layer's explicit override. */
	reasoningEffort: ReasoningEffort | null;
	/** The effective target after the change: this layer's override, or else the inherited value. */
	target: GenerationTarget;
}) => ReasoningEffort | null {
	const catalog = useQuery(generationModelsQueryOptions(getRowCatClient()));
	return (input) =>
		reconcileReasoningOverride({
			reasoningEffort: input.reasoningEffort,
			target: input.target,
			models: catalog.data ?? [],
			/**
			 * If the catalog cannot be confirmed, do not clear. A brief network blip must not erase the
			 * user's setting, and that loss cannot be undone.
			 */
			catalogLoaded: catalog.isSuccess,
		});
}

/**
 * Clears a reasoning override that became unusable when this layer did not change its own target.
 * The hook above cannot cover one window, and that is why this hook exists.
 *
 * The room inherits the target and has an explicit `High`. The global target changes from A to
 * B, but the room's model selector was never pressed, so nothing in the room ran. If B lacks high,
 * the room's override stays saved and execution runs B's default step, while the screen still draws
 * `High`. An explicitly saved preference would then mean something other than what the screen says.
 * This is the only place in this slice where that property breaks.
 *
 * Why here and not in the inheritance layer: `resolveEffectiveGeneration` must not know the
 * catalog. If the pure rule depended on model capability, priorities could not be checked without
 * the app. Cleanup therefore happens in the layer that knows capabilities, where the saved value is
 * brought up to the screen.
 *
 * Four gates keep it from acting too early:
 * - storage not yet open: do nothing, since nothing should be written to an unread record
 * - preference not yet read: same (an empty preference and 'not known yet' differ)
 * - catalog not received: same (the pure function already treats the override as not stale)
 * - no override exists: same (nothing to clear)
 *
 * There is no loop. The value written is always `null`, and a `null` override can never be stale.
 * After one write the condition is permanently false, so save, re-render, save does not repeat. The
 * last written key is remembered so the same verdict does not fire on two frames: writes are
 * asynchronous, so a re-render can happen before the subscription updates, and a second request
 * would be wasteful.
 *
 * Only the reasoning axis is touched. `persist` receives that axis alone, and the caller passes the
 * rest through.
 */
export function useStaleReasoningReconcile(input: {
	/** The layer's explicit override. */
	reasoningEffort: ReasoningEffort | null;
	/** The effective target currently applied: this layer's override, or else the inherited value. */
	target: GenerationTarget;
	/**
	 * Whether the stored preference has actually been read. While loading, an empty preference comes
	 * back, and judging with it would see no override and do nothing. That is safe today, but the
	 * condition is written out so the safety does not depend on chance.
	 */
	ready: boolean;
	/** Clears this layer's reasoning override. The other axes stay as they are. */
	persist: (reasoningEffort: null) => void;
}): void {
	const catalog = useQuery(generationModelsQueryOptions(getRowCatClient()));
	const models = catalog.data ?? [];
	const catalogLoaded = catalog.isSuccess;

	const stale =
		input.ready &&
		reasoningOverrideStale({
			reasoningEffort: input.reasoningEffort,
			target: input.target,
			models,
			catalogLoaded,
		});

	/**
	 * The last (target, step) pair that was cleared. Prevents writing again on a re-render that
	 * happens before the write lands.
	 */
	const written = useRef<string | null>(null);
	const key = `${input.target.provider}:${input.target.model}:${input.reasoningEffort}`;
	const { persist } = input;

	useEffect(() => {
		if (!stale) {
			written.current = null;
			return;
		}
		if (written.current === key) return;
		written.current = key;
		persist(null);
	}, [stale, key, persist]);
}
