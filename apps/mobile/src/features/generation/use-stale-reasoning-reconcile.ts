import type { GenerationTarget, ReasoningEffort } from "@rowcat/chat";
import { reasoningOverrideStale } from "@rowcat/chat";
import { generationModelsQueryOptions } from "@rowcat/query";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { getRowCatClient } from "../../lib/api.ts";

/**
 * Clears a reasoning override that became unusable without this layer ever changing its target.
 *
 * Example: a room inherits its target (`target = null`) and holds `reasoningEffort = "high"`; the
 * global target switches A -> B, which has no such tier. The override stays stored and execution
 * runs on B's default tier while the screen still draws `High`. This is the only place where a stored
 * explicit preference means something other than what it says.
 *
 * Mirrors `apps/web/src/features/generation/use-reasoning-reconcile.ts`; the rule is the shared
 * pure `reasoningOverrideStale`, so do not re-write `efforts.includes(...)` here. Four gates, any
 * false one writes nothing: store opened, preferences read, catalogue received, override present.
 *
 * No loop: the value written is always `null`, and a `null` override can never be stale. The last
 * written key is remembered so a re-render before the write lands does not issue it twice.
 */
export function useStaleReasoningReconcile(input: {
	reasoningEffort: ReasoningEffort | null;
	target: GenerationTarget;
	/** Whether stored preferences were actually read; an empty preference is not "not yet known". */
	ready: boolean;
	persist: (reasoningEffort: null) => void;
}): void {
	const catalog = useQuery(generationModelsQueryOptions(getRowCatClient()));

	const stale =
		input.ready &&
		reasoningOverrideStale({
			reasoningEffort: input.reasoningEffort,
			target: input.target,
			models: catalog.data ?? [],
			/** Never clear when the catalogue is unconfirmed; the pure function already decides that. */
			catalogLoaded: catalog.isSuccess,
		});

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
