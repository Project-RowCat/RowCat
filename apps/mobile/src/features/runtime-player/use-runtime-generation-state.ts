import type { EffectiveGeneration, GenerationPreference } from "@rowcat/chat";
import { EMPTY_GENERATION_PREFERENCE } from "@rowcat/chat";
import { useMemo } from "react";
import { useLocalLiveOn } from "../../lib/local-data/live.ts";
import { useGenerationScope } from "../../lib/local-data/scope.tsx";
import { useGlobalGenerationState } from "../chat/generation/use-room-generation.ts";

/**
 * Subscribes to this **work's** generation override: the window the playback generation settings
 * dialog reads.
 *
 * Same place and same three axes as `useRuntimeGenerationState` in the web's
 * `lib/local-generation/hooks.ts`. It has the same shape as the room override under a different
 * key: a playthrough is not a room, but the question "what should this device generate this target
 * with" is the same (`GenerationPreferenceStore.getRuntime`).
 *
 * ## Do not re-resolve the upper layers here
 *
 * `useGlobalGenerationState` answers what is inherited. If this hook subscribed to
 * `store.getGlobal()` itself, precedence would be resolved in two places, and the mismatch would
 * show only as the value inside `Use default (Standard)` differing from what actually goes out, while the
 * screen still draws fine. The playtest calls the same hook for the same reason
 * (`features/playtest/playtest-settings-dialog.tsx`).
 *
 * ## Do not add a fourth layer to the resolver
 *
 * The work's override enters the resolver's **`room` layer**. The name `room` is what the resolver
 * calls its narrow layer. The screen reads whether an override exists, not the word in `sources`,
 * so the name never reaches the screen. Adding a layer would express a **combination that does not
 * exist**, such as "the room overrides the work": one generation has only one of the two.
 *
 * ## The generation runtime does not use this hook
 *
 * It reads directly from the store when a request starts (`use-runtime-generation.ts`). Routing it
 * through render state would make "which settings this request went out with" depend on render
 * timing, a difference that cannot be reproduced. So a value chosen in this window is used **from
 * the next generation request** (only AI permission freezes into the session).
 */
export interface RuntimeGenerationState {
	/** What this work set. Each axis may be `null` (that axis follows the layer above). */
	override: GenerationPreference;
	/**
	 * The value that applies when this work sets nothing: global, then product default.
	 *
	 * **It is the name drawn in the parentheses**, not the value in effect now. When an override
	 * exists the two differ, and that difference is all that `Use default (Standard)` means.
	 */
	inherited: EffectiveGeneration;
	/**
	 * The first result has not arrived yet. **This is not the same as "unset".**
	 *
	 * If the product default were drawn before the value arrives, a person who had actually picked
	 * another model would see the default flash once each time the dialog opens, before their own
	 * choice replaces it.
	 */
	loading: boolean;
	/**
	 * Where values are written. `null` until the scope opens, and the controls stay disabled
	 * meanwhile.
	 */
	store: ReturnType<typeof useGenerationScope>["store"];
}

export function useRuntimeGenerationState(
	storyId: string,
): RuntimeGenerationState {
	const { store, signal } = useGenerationScope();
	const inheritedState = useGlobalGenerationState();

	/**
	 * **Memoize the read.** A new function each render would make the subscription re-read on every
	 * render, and the result would change state and render again (`live.ts` records that rule).
	 */
	const loadOverride = useMemo(
		() => (store ? () => store.getRuntime(storyId) : null),
		[store, storyId],
	);
	const override = useLocalLiveOn(
		signal,
		loadOverride,
		EMPTY_GENERATION_PREFERENCE,
	);

	return useMemo(
		() => ({
			override: override.value,
			inherited: inheritedState.effective,
			/**
			 * **A failed read is not loading.** When a read fails, the held value (an empty preference)
			 * stays and the screen draws the product default. That matches the result before this feature
			 * existed, and it beats keeping the dialog as a permanent placeholder because one setting could
			 * not be read.
			 */
			loading: inheritedState.loading || override.status === "loading",
			store,
		}),
		[inheritedState, override.value, override.status, store],
	);
}
