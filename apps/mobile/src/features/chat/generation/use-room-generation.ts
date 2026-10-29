import type { EffectiveGeneration, GenerationPreference } from "@rowcat/chat";
import {
	EMPTY_GENERATION_PREFERENCE,
	resolveEffectiveGeneration,
} from "@rowcat/chat";
import { useMemo } from "react";
import { useLocalLiveOn } from "../../../lib/local-data/live.ts";
import { useGenerationScope } from "../../../lib/local-data/scope.tsx";

/**
 * Subscribes to the generation settings that apply to this room.
 *
 * Not TanStack Query: this value is the original, not a cache, and wrapping it would create two
 * truths (see `lib/boundaries.test.ts`). The generation runtime does not use this hook. It reads
 * the store directly when a request starts, so which settings a request used does not depend on
 * render timing.
 *
 * Three axes answer different questions:
 * - room: what this room chose (the control's value; `null` means `Use default`).
 * - inherited: what applies if the room chose none (the name drawn in parentheses).
 * - effective: what applies right now (the summary line on the home pane).
 *
 * Merging is one shared pure function (`resolveEffectiveGeneration`). Rewriting `room ?? global ??
 * default` in a screen would make the summary and the detail name different models.
 */

/**
 * Subscribes to this device's global generation settings, the layer that knows no room.
 *
 * Split out because the story test has no room but still needs the inherited value; resubscribing
 * to `store.getGlobal()` there would resolve precedence in two places. Counterpart of web's
 * `useGlobalGenerationState` in `lib/local-generation/hooks.ts`.
 */
export interface GlobalGenerationState {
	/** What this device chose; each axis may be `null` (that axis follows the product default). */
	global: GenerationPreference;
	/** What applies when nothing is chosen: global > product default. */
	effective: EffectiveGeneration;
	/** The first result has not arrived; this is not the same as "unset". */
	loading: boolean;
}

export function useGlobalGenerationState(): GlobalGenerationState {
	const { store, signal, loading: opening } = useGenerationScope();

	// Memoized: a new function per render makes the subscription re-read and re-render (see
	// `live.ts`).
	const loadGlobal = useMemo(
		() => (store ? () => store.getGlobal() : null),
		[store],
	);
	const global = useLocalLiveOn(
		signal,
		loadGlobal,
		EMPTY_GENERATION_PREFERENCE,
	);

	return useMemo(
		() => ({
			global: global.value,
			effective: resolveEffectiveGeneration({ global: global.value }),
			// A failed read is not loading: the empty preference stays and the product default is drawn,
			// which beats a permanent placeholder.
			loading: opening || global.status === "loading",
		}),
		[global.value, global.status, opening],
	);
}

export interface RoomGenerationState {
	/** What this room chose; each axis may be `null` (that axis follows the layer above). */
	room: GenerationPreference;
	/**
	 * What applies if this room chose nothing: global > product default. Differs from `effective` once
	 * a room override exists; that difference is what `Use default (Standard)` means.
	 */
	inherited: EffectiveGeneration;
	/** What applies to this room now: room > global > product default. */
	effective: EffectiveGeneration;
	/**
	 * The first result has not arrived; not the same as "unset". Drawing the product default before
	 * the value arrives would flash it for someone who actually chose `Long`.
	 */
	loading: boolean;
	/** Where values are written; `null` until the scope opens, and the controls are disabled. */
	store: ReturnType<typeof useGenerationScope>["store"];
}

export function useRoomGenerationState(roomId: string): RoomGenerationState {
	const { store, signal } = useGenerationScope();
	// The upper layer belongs to the room-agnostic hook so precedence resolves in one place.
	const inheritedState = useGlobalGenerationState();

	const loadRoom = useMemo(
		() => (store ? () => store.getRoom(roomId) : null),
		[store, roomId],
	);
	const room = useLocalLiveOn(signal, loadRoom, EMPTY_GENERATION_PREFERENCE);

	return useMemo(() => {
		const effective = resolveEffectiveGeneration({
			global: inheritedState.global,
			room: room.value,
		});
		return {
			room: room.value,
			inherited: inheritedState.effective,
			effective,
			// Loading while the scope opens or either read lacks a first result. A failed read is not
			// loading: the empty preference stays and the product default is drawn.
			loading: inheritedState.loading || room.status === "loading",
			store,
		};
	}, [inheritedState, room.value, room.status, store]);
}
