import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * The bridge between the header and the canvas, for one trusted runtime action: reset.
 * - Why it exists: the reset trigger sits in the header's context area, where the chat room's
 *   settings sit, but the action itself lives in the canvas's playback lifecycle
 *   (`useRuntimePlayer`). The two render in different route layers.
 * - Why it is booleans only: search only needs to pass an event, but reset must let the header
 *   know whether it may be offered now. If it were offered before a session exists, the first
 *   visible thing would be an irreversible action when the user likely needs to restart or go back.
 *   So the module holds only "may this action be offered?" flags. Titles, save status, errors,
 *   generation, and the chosen model do not cross. The state clears when the canvas passes null.
 * - The second flag (`generationSettingsAvailable`) says whether this work uses generation. The
 *   canvas already reads that fact from the play response's capability list. A header that
 *   re-queried it could reach a different judgment, showing a button without its disclosure or the
 *   reverse.
 * - Not a provider. Both would be wrapped only by the app layout route
 *   (`routes/(app)/route.tsx`). A runtime-specific context there would make the shell know a
 *   feature's state, and that file knows no feature by rule.
 * - Keyed by work id. A late click must not reset another work. If nothing is listening, the
 *   request simply disappears; keeping it would mean a reset running later, a destruction the user
 *   never asked for.
 */

export interface RuntimeChatControls {
	/** Whether `Reset play` may be offered now. True only while the creator screen is rendered. */
	resetAvailable: boolean;
	/**
	 * Whether `Generation settings` may be offered. True only when this work uses the generation capability.
	 *
	 * Session startup is not a condition. The setting may be offered while the AI disclosure is
	 * showing, so the user can choose a model before allowing it. The disclosure's `with your current AI settings`
	 * refers to exactly this setting. A work that does not use generation has nothing to choose, so
	 * the button is not shown.
	 */
	generationSettingsAvailable: boolean;
}

const NONE: RuntimeChatControls = {
	resetAvailable: false,
	generationSettingsAvailable: false,
};

type Listener = () => void;

const controls = new Map<string, RuntimeChatControls>();
const controlListeners = new Map<string, Set<Listener>>();
const resetListeners = new Map<string, Set<Listener>>();

/** Called by the canvas. `null` means this work's play screen has disappeared. */
export function publishRuntimeChatControls(
	storyId: string,
	next: RuntimeChatControls | null,
): void {
	if (next === null) controls.delete(storyId);
	else controls.set(storyId, next);
	for (const listener of controlListeners.get(storyId) ?? []) listener();
}

export function readRuntimeChatControls(storyId: string): RuntimeChatControls {
	return controls.get(storyId) ?? NONE;
}

function subscribe(
	registry: Map<string, Set<Listener>>,
	storyId: string,
	listener: Listener,
): () => void {
	const set = registry.get(storyId) ?? new Set<Listener>();
	set.add(listener);
	registry.set(storyId, set);
	return () => {
		set.delete(listener);
		// Does not leave empty shells behind. Names of past works would otherwise accumulate for the
		// whole life of the tab.
		if (set.size === 0) registry.delete(storyId);
	};
}

export function useRuntimeChatControls(storyId: string): RuntimeChatControls {
	return useSyncExternalStore(
		(listener) => subscribe(controlListeners, storyId, listener),
		() => readRuntimeChatControls(storyId),
		() => NONE,
	);
}

/**
 * Called by the header's trigger only after the user confirms. With no listener, nothing happens.
 */
export function requestPlaythroughReset(storyId: string): void {
	for (const listener of resetListeners.get(storyId) ?? []) listener();
}

/**
 * Listens for this work's reset requests. Only the play screen for this work responds.
 *
 * The callback is held in a ref so the subscription is not re-attached on every render.
 * Re-attaching each render would unsubscribe and resubscribe, and requests arriving in between
 * would be lost.
 */
export function useRuntimeChatResetRequests(
	storyId: string,
	onRequest: () => void,
): void {
	const handler = useRef(onRequest);
	handler.current = onRequest;
	useEffect(
		() => subscribe(resetListeners, storyId, () => handler.current()),
		[storyId],
	);
}
