import {
	type EffectiveGeneration,
	EMPTY_GENERATION_PREFERENCE,
	type GenerationPreference,
	resolveEffectiveGeneration,
} from "@rowcat/chat";
import { useLiveQuery } from "dexie-react-hooks";
import { useGenerationScope } from "./scope.ts";

/**
 * Hook that subscribes to generation preferences. It is the window the settings screen reads. It
 * does not use TanStack Query, unlike chat and drafts. That is a cache of remote server state,
 * while this value is the source itself. Wrapping it in useQuery would create two sources of truth,
 * and missing one invalidation would show a stale default. liveQuery is used because of tabs:
 * changing the default in another tab updates this subscription by itself, with no notification
 * code and no BroadcastChannel. The generation runtime does not use this hook. It reads the store
 * directly when a request starts (features/chat/use-chat-generation.ts). Going through render state
 * would leave a window where a value just changed in another tab has not arrived yet.
 */

export interface LocalPreferenceState<T> {
	value: T;
	/** Still waiting for the first result. This is distinct from 'no preference set'. */
	loading: boolean;
}

/**
 * Global generation preference for this device and member. loading is separate to avoid flicker.
 * Before the value arrives, showing 'default in use' would make a user who picked `Long` see the
 * default flash every time settings open, then switch to their choice. They could not tell what is
 * actually stored.
 */
export function useGlobalGenerationPreference(): LocalPreferenceState<GenerationPreference> {
	const { store, status } = useGenerationScope();
	const value = useLiveQuery(
		() => (store ? store.getGlobal() : Promise.resolve(undefined)),
		[store],
	);
	return {
		value: value ?? EMPTY_GENERATION_PREFERENCE,
		loading: status !== "ready" || value === undefined,
	};
}

/**
 * Override for one room. If none is set, this is an empty preference, and the room follows the
 * global one.
 */
export function useRoomGenerationPreference(
	roomId: string,
): LocalPreferenceState<GenerationPreference> {
	const { store, status } = useGenerationScope();
	const value = useLiveQuery(
		() => (store ? store.getRoom(roomId) : Promise.resolve(undefined)),
		[store, roomId],
	);
	return {
		value: value ?? EMPTY_GENERATION_PREFERENCE,
		loading: status !== "ready" || value === undefined,
	};
}

/**
 * The two values the room settings screen needs: this room's override, and the value used when
 * there is no override. The screen does not compute the second value itself. The label `Use default settings
 * (Standard)` shows the result of a priority rule, and one resolver (@rowcat/chat) owns that rule. If the
 * screen started writing global.responseLength ?? 'standard', the rule would exist in two places.
 */
export interface RoomGenerationState {
	room: GenerationPreference;
	/** Value applied when this room sets nothing: the global value, or the product default. */
	inherited: EffectiveGeneration;
	/** Value actually in effect now. Its `source` field says which layer it came from. */
	effective: EffectiveGeneration;
	loading: boolean;
}

export function useRoomGenerationState(roomId: string): RoomGenerationState {
	const global = useGlobalGenerationPreference();
	const room = useRoomGenerationPreference(roomId);

	return {
		room: room.value,
		inherited: resolveEffectiveGeneration({ global: global.value }),
		effective: resolveEffectiveGeneration({
			global: global.value,
			room: room.value,
		}),
		loading: global.loading || room.loading,
	};
}

/**
 * Override for one runtime story. If none is set, it is an empty preference and the story follows
 * the global one. It has the same shape as the room override with a different key. A runtime
 * playthrough is not a room, but the question 'what to generate with on this device for this
 * target' is the same (GenerationPreferenceStore.getRuntime).
 */
export function useRuntimeGenerationPreference(
	storyId: string,
): LocalPreferenceState<GenerationPreference> {
	const { store, status } = useGenerationScope();
	const value = useLiveQuery(
		() => (store ? store.getRuntime(storyId) : Promise.resolve(undefined)),
		[store, storyId],
	);
	return {
		value: value ?? EMPTY_GENERATION_PREFERENCE,
		loading: status !== "ready" || value === undefined,
	};
}

/**
 * The values the runtime generation settings screen needs. The shape matches RoomGenerationState. A
 * story's override enters the resolver's `room` layer, which is named for the narrow layer the
 * resolver uses. The screen reads whether an override exists, not the layer names in sources, so
 * the name never reaches the screen. The resolver has no fourth layer for stories. A story and a
 * room occupy the same position (one generation has only one of them). A fourth layer would express
 * impossible combinations such as 'room overrides story'.
 */
export interface RuntimeGenerationState {
	override: GenerationPreference;
	inherited: EffectiveGeneration;
	effective: EffectiveGeneration;
	loading: boolean;
}

export function useRuntimeGenerationState(
	storyId: string,
): RuntimeGenerationState {
	const global = useGlobalGenerationPreference();
	const override = useRuntimeGenerationPreference(storyId);

	return {
		override: override.value,
		inherited: resolveEffectiveGeneration({ global: global.value }),
		effective: resolveEffectiveGeneration({
			global: global.value,
			room: override.value,
		}),
		loading: global.loading || override.loading,
	};
}

/**
 * The two values the global settings screen needs: the saved preference, and the product default
 * used when nothing is saved. The symmetry with the room screen is intentional. Both screens
 * receive state of the same shape, so they can share one control
 * (features/generation/response-length-field.tsx), and the meaning of 'use default' cannot diverge
 * between them.
 */
export interface GlobalGenerationState {
	global: GenerationPreference;
	inherited: EffectiveGeneration;
	effective: EffectiveGeneration;
	loading: boolean;
}

export function useGlobalGenerationState(): GlobalGenerationState {
	const global = useGlobalGenerationPreference();
	return {
		global: global.value,
		inherited: resolveEffectiveGeneration({}),
		effective: resolveEffectiveGeneration({ global: global.value }),
		loading: global.loading,
	};
}
