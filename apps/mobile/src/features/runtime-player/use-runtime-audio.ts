import type {
	NativeRuntimeAudioResolver,
	NativeRuntimeTreeStore,
} from "@rowcat/runtime-renderer-native";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { nativeRuntimeAudioPort } from "./audio-port.ts";
import {
	attachRuntimeAudio,
	type RuntimeAudioAppState,
} from "./runtime-audio-lifecycle.ts";

/**
 * This screen **owns the sound of the running session**: it sets up, quiets and ends the deck.
 *
 * ```text
 * session (host tree store) ─▶ attachRuntimeAudio ─▶ deck ─▶ controllers ─▶ expo-audio
 *        │                           ▲
 *        └ calls subscribers on each commit   └ suspends when AppState leaves the foreground
 * ```
 *
 * ## Why here and not inside the renderer
 *
 * `NativeRuntimeSurface` is the component that **draws**, and sound is not drawn. Inside it, the
 * sound's lifetime would be bound to React's mount rules: an ordinary re-render of the parent
 * `View` could restart the sound, and StrictMode's double mount would create two players (see the
 * `audio-deck.ts` header).
 *
 * ## The store is the session's identity
 *
 * The sole dependency of this effect is `store`, and that is the whole of the isolation between
 * works. Switching works starts a new session and therefore a new store object, which runs the
 * cleanup at that moment: **the previous work's sound ends right there**, before the new deck is
 * set up, so the two works' sounds never overlap in one frame.
 *
 * The resolver and the event channel are kept out of the dependencies. Their identity changes when
 * the session header settles, and rebuilding the deck then would **cut the background music that is
 * playing**. Holding them in refs means the deck always calls the latest ones.
 *
 * ## The rules are not in this file
 *
 * The steps for setting up, quieting and ending live in `runtime-audio-lifecycle.ts`. This app's
 * tests do not render screens, so if those steps lived in the hook, checking them would mean trying
 * it by hand.
 */
export function useNativeRuntimeAudio(
	store: NativeRuntimeTreeStore | null,
	resolveAsset: NativeRuntimeAudioResolver,
	dispatchEvent: (handler: number) => void,
): void {
	const resolveRef = useRef(resolveAsset);
	resolveRef.current = resolveAsset;
	const dispatchRef = useRef(dispatchEvent);
	dispatchRef.current = dispatchEvent;

	useEffect(() => {
		if (store === null) return;
		/**
		 * Only `active` counts as foreground. iOS's `inactive` also means the user is looking at
		 * something else.
		 */
		const appState: RuntimeAudioAppState = {
			isActive: () => AppState.currentState === "active",
			subscribe: (listener) => {
				const subscription = AppState.addEventListener("change", (next) => {
					listener(next === "active");
				});
				return () => subscription.remove();
			},
		};

		return attachRuntimeAudio({
			store,
			port: nativeRuntimeAudioPort,
			resolveAsset: (target, expect) => resolveRef.current(target, expect),
			dispatchEvent: (handler) => dispatchRef.current(handler),
			appState,
		});
	}, [store]);
}
