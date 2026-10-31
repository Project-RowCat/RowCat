/**
 * Imported via subpaths. The package root pulls React Native in as a value; if this file pulled
 * that in, the procedure could not be checked without a simulator (this app's tests do not set up
 * RN). The file that holds the deck does not know RN.
 */

import type { NativeRuntimeAudioPort } from "@rowcat/runtime-renderer-native/audio";
import {
	createNativeAudioDeck,
	type NativeAudioDeck,
	type NativeRuntimeAudioResolver,
} from "@rowcat/runtime-renderer-native/audio-deck";
import type { NativeRuntimeTreeStore } from "@rowcat/runtime-renderer-native/tree-store";

/**
 * Sets up one running session's sound and attaches it to the app's foreground state. It does not
 * know React.
 *
 * The procedure is split from the hook because this app's tests do not render screens: if the rules
 * lived inside the hook, the only check would be trying it by hand. Here three facts can be checked
 * by value: going to the background stops it, returning resumes it, and nothing remains after
 * leaving.
 *
 * ## Only the foreground plays
 *
 * It also stops on iOS `inactive` (phone calls, notification center, the app switcher). That state
 * means the user is looking at something else; if sound kept playing there, the user could not tell
 * where it comes from.
 *
 * `shouldPlayInBackground: false` makes the OS stop it too in most cases, but this does not rely on
 * that. Behavior differs by platform and version, and **a mismatch in that direction is bad** (the
 * user left the app and sound keeps playing).
 *
 * ## Suspend, not stop
 *
 * `suspend()` **does not clear the desired state.** If the creator's `playing` turned off because
 * of a background transition, that would be a state change the story never made, and nothing would
 * know what to turn back on after returning.
 */

// The channel for listening to app foreground state. The platform is passed in as an argument, so
// this file does not know RN.
export interface RuntimeAudioAppState {
	// Whether it is in the foreground now; used for the initial check only.
	isActive(): boolean;
	// Called on every state change. The returned function unsubscribes.
	subscribe(listener: (active: boolean) => void): () => void;
}

export interface RuntimeAudioAttachment {
	readonly store: NativeRuntimeTreeStore;
	readonly port: NativeRuntimeAudioPort | null;
	readonly resolveAsset: NativeRuntimeAudioResolver;
	readonly dispatchEvent: (handler: number) => void;
	readonly appState: RuntimeAudioAppState;
	// Where tests swap in a different deck; product code never fills it.
	readonly createDeck?: typeof createNativeAudioDeck;
}

// Creates the deck and returns a cleanup function.
//
// Cleanup order is the rule: unsubscribe first, then dispose the deck. Reversed, a state change
// arriving during disposal would touch the already-dead deck.
export function attachRuntimeAudio(
	options: RuntimeAudioAttachment,
): () => void {
	const deck: NativeAudioDeck = (options.createDeck ?? createNativeAudioDeck)({
		store: options.store,
		port: options.port,
		resolveAsset: options.resolveAsset,
		dispatchEvent: options.dispatchEvent,
	});

	const unsubscribe = options.appState.subscribe((active) => {
		if (active) deck.resume();
		else deck.suspend();
	});

	// It may already be in the background: a screen can really mount there (entering from a
	// notification). Subscribing alone would let that session sound until the **next state change**.
	if (!options.appState.isActive()) deck.suspend();

	return () => {
		unsubscribe();
		deck.dispose();
	};
}

/**
 * The store whose sound may play now: the session's tree store while that session is `starting` or
 * `running`, otherwise none.
 *
 * Keyed on the store alone, the deck outlived the session that made the sound. The store keeps the
 * last tree through a failure (the screen may still want it) and through a stop whose unmount commit
 * never arrived — a harness that hung or crashed, or a transition blocked on its save — so the
 * previous playthrough's looped music played on behind a failed or syncing screen. Keeping the
 * visible tree and keeping the sound are separate decisions; this is the second one.
 *
 * `stopping` is silent too: restart and reset stop the old session the moment their transition
 * begins, and the music should end with the press, not after the save flushed.
 */
export function runtimeAudioStore<S>(
	native: { readonly status: string },
	store: S | null,
): S | null {
	if (store === null) return null;
	return native.status === "starting" || native.status === "running"
		? store
		: null;
}
