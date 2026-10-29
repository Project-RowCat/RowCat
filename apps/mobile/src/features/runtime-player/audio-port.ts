import type {
	NativeRuntimeAudioPlayer,
	NativeRuntimeAudioPort,
} from "@rowcat/runtime-renderer-native";
import {
	type AudioPlayer,
	type AudioStatus,
	createAudioPlayer,
	setAudioModeAsync,
} from "expo-audio";

/**
 * The Expo implementation of `NativeRuntimeAudioPort`: the handle this app passes to the renderer.
 *
 * ```text
 * @rowcat/runtime-renderer-native   knows only the port (imports neither Expo nor apps/mobile)
 * this file                         fills that port with expo-audio
 * ```
 *
 * The renderer package does not take Expo; its header explains why. A boundary check blocks it by
 * value, and otherwise that package's tests would require a simulator. So the vendor name ends in
 * this file.
 *
 * Why not a hook: `useAudioPlayer()` exists but is not used. Sound lifetime is held by the host
 * tree (`audio-deck.ts`), which moves on a rhythm different from React's mount rules. Tying it to a
 * hook would restart sound whenever a parent `View` re-renders, and StrictMode's double mount would
 * create two players. The imperative `createAudioPlayer()` leaves that lifetime to the deck.
 *
 * Natural end: expo-audio delivers one status update (`playbackStatusUpdate`) carrying
 * `didJustFinish`. That value can be true during looped playback too, which is the riskiest point
 * here. The loop boundary is not filtered in this adapter: the controller already reads `loop` and
 * guards it (`audio.ts`), and a second check would diverge the day one of them changes.
 *
 * Rewind: `seekTo(0)` returns a `Promise`, but the port's `rewind()` is synchronous. The adapter
 * absorbs that mismatch. A rewind failure has nothing to tell the user (usually the sound is still
 * loading), and halting the runtime over one sound would close the story over one sound.
 *
 * Audio session: whether sound plays with the iOS silent switch on, or interrupts other apps, is a
 * product decision, not the creator's (the public contract has no such axis). V1 picks the quietest
 * option: respect the silent switch, mix with other apps, and do not play in the background. A
 * story's background music has no reason to interrupt calls or music, and background playback is a
 * separate product decision (lock-screen controls, notifications, battery).
 */

// The audio session is configured once; calling it per player would rewrite the same value once per
// track.
let audioModeConfigured = false;

function configureAudioMode(): void {
	if (audioModeConfigured) return;
	audioModeConfigured = true;
	// The failure is swallowed. Playback usually still works if this call fails, and if it does not,
	// the result is silence rather than an error; the runtime startup path has no reason to surface
	// it.
	void setAudioModeAsync({
		playsInSilentMode: false,
		shouldPlayInBackground: false,
		interruptionMode: "mixWithOthers",
	}).catch(() => undefined);
}

function createPlayer(): NativeRuntimeAudioPlayer {
	configureAudioMode();
	// Created without a source. The port contract is "create, then `load(url)`", so the address is
	// unknown here; that order is the deck building nodes first and receiving the resolver's answer
	// later.
	const player: AudioPlayer = createAudioPlayer(null);
	const listeners = new Set<() => void>();

	const subscription = player.addListener(
		"playbackStatusUpdate",
		(status: AudioStatus) => {
			if (!status.didJustFinish) return;
			for (const listener of listeners) listener();
		},
	);

	let released = false;

	return {
		load(url) {
			if (released) return;
			player.replace({ uri: url });
		},
		async play() {
			if (released) return;
			player.play();
		},
		pause() {
			if (released) return;
			player.pause();
		},
		rewind() {
			if (released) return;
			void player.seekTo(0).catch(() => undefined);
		},
		setLoop(loop) {
			if (released) return;
			player.loop = loop;
		},
		setVolume(volume) {
			if (released) return;
			player.volume = volume;
		},
		setMuted(muted) {
			if (released) return;
			player.muted = muted;
		},
		onEnded(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		release() {
			if (released) return;
			released = true;
			listeners.clear();
			subscription.remove();
			// `remove()` releases the native resource. The extra pause before it guards against a native
			// implementation that releases in the wrong order and leaves sound playing; the cost is nil.
			player.pause();
			player.remove();
		},
	};
}

/**
 * This app's player factory; the deck calls it once per sound.
 *
 * It is a constant because of identity: a new function per render would rebuild the deck and cut
 * off the sound that is playing at that moment.
 */
export const nativeRuntimeAudioPort: NativeRuntimeAudioPort = createPlayer;
