import { DEFAULT_DEBUG_TRACE_LIMITS } from "@rowcat/chat";
import { useMemo, useRef, useState } from "react";
import {
	emptyRuntimeDebugState,
	type RuntimeDebugState,
	reduceRuntimeDebug,
	runtimeDebugGenerationResult,
	runtimeDebugRun,
} from "./runtime-preview-debug.ts";
import type { RuntimePreviewDebugSink } from "./runtime-preview-debug-sink.ts";

/**
 * React wiring for runtime observation records; the rules live in a pure reducer. The hook does
 * three things: supplies the clock, holds state and creates the sink. Whether the cap drops the
 * oldest entries, whether migration runs only on hydration and whether other generations' messages
 * are ignored can all be checked by value, without rendering (`runtime-preview-debug.test.ts`). The
 * sink's identity must never change. The preview hook captures it in a ref, but the layer above
 * (the work-test screen) may pass a new object on each render. The sink is therefore created once
 * here.
 */
export function useRuntimeDebug(): {
	state: RuntimeDebugState;
	sink: RuntimePreviewDebugSink;
} {
	const [state, setState] = useState(emptyRuntimeDebugState);
	/**
	 * The reducer reads a ref, not render state. One commit sends `commit`, `story-state` and
	 * `persistent-state` back to back in the same task. Reading render state would fold the second and
	 * third messages over a state that has not yet seen the first, so the 'previous value' would be
	 * two commits old.
	 */
	const ref = useRef(state);

	const sink = useMemo<RuntimePreviewDebugSink>(() => {
		const commit = (next: RuntimeDebugState) => {
			ref.current = next;
			setState(next);
		};
		return {
			run: (input) => {
				commit(
					runtimeDebugRun(ref.current, input, {
						at: Date.now(),
						limits: DEFAULT_DEBUG_TRACE_LIMITS,
					}),
				);
			},
			message: (message) => {
				commit(
					reduceRuntimeDebug(ref.current, message, {
						at: Date.now(),
						limits: DEFAULT_DEBUG_TRACE_LIMITS,
					}),
				);
			},
			generationResult: (input) => {
				commit(
					runtimeDebugGenerationResult(ref.current, input, {
						at: Date.now(),
						limits: DEFAULT_DEBUG_TRACE_LIMITS,
					}),
				);
			},
		};
	}, []);

	return { state, sink };
}
