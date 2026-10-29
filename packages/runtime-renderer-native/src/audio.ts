/**
 * Lifetime of one sound: the gap between the state the creator wants and the state the platform
 * allows.
 * - The controller remembers the desired state (playing, loop, volume, muted, restartKey, source)
 *   and brings the actual player into line through the port. The app's audio layer makes the final
 *   call.
 *
 * Why this package does not include Expo: its dependency list has no apps/mobile and no Expo
 * (boundaries.test.ts). Creating the player here would break that list and make this package's
 * tests require a simulator. Every test in this folder runs by value, and that is what makes this
 * renderer's rules checkable. The player is therefore a port, implemented by the app
 * (NativeRuntimeAudioPort).
 *
 * Same state machine as web, and that is the risk. @rowcat/runtime-renderer-web's audio.ts has the
 * same transitions. Per this repo's rule the two renderers share no render code, so the machine
 * exists twice, and this is where only one copy gets fixed. Divergence produces no error. The same
 * work would sound different on each device. For now, both packages' tests compare the same
 * transition table by value. When a shared pure layer exists that both renderers can depend on, the
 * two will be merged.
 */

/**
 * A single player. The app creates it and this package drives it. The shape is deliberately narrow.
 * Seeking, playback rate, fades, and audio session setup are absent, so no capability outside the
 * public contract can leak in through the port.
 */
export interface NativeRuntimeAudioPlayer {
	/** Prepares the address for playback. Does not start playback. */
	load(url: string): void;
	play(): Promise<void>;
	pause(): void;
	rewind(): void;
	setLoop(loop: boolean): void;
	setVolume(volume: number): void;
	setMuted(muted: boolean): void;
	/** Signals natural end. Not called while looping (the controller also guards against this). */
	onEnded(listener: () => void): () => void;
	release(): void;
}

export type NativeRuntimeAudioPort = () => NativeRuntimeAudioPlayer;

export interface NativeAudioControllerOptions {
	readonly player: NativeRuntimeAudioPlayer;
	readonly onEnded: () => void;
}

export interface NativeAudioController {
	setSource(url: string | null): void;
	setPlaying(next: boolean): void;
	setLoop(next: boolean): void;
	setVolume(next: number): void;
	setMuted(next: boolean): void;
	setRestartKey(next: string | number | null): void;
	/** The app went to background. Only actual playback stops. The desired state is kept. */
	suspend(): void;
	resume(): void;
	dispose(): void;
}

export function createNativeAudioController(
	options: NativeAudioControllerOptions,
): NativeAudioController {
	const { player } = options;

	let desiredPlaying = false;
	let suspended = false;
	let ended = false;
	let source: string | null = null;
	let restartKey: string | number | null = null;
	let disposed = false;
	let loop = false;

	const start = (): void => {
		if (disposed || suspended || !desiredPlaying || source === null) return;
		if (ended) {
			player.rewind();
			ended = false;
		}
		/**
		 * Play failures are swallowed. On native, a failed play means the file is not ready yet or the
		 * device did not grant audio focus. Neither is a runtime failure, and one sound should not stop a
		 * story from opening. Web's attempt counter is absent here. On web, the counter keeps a late
		 * play() rejection from setting the state to 'waiting for permission'. Here a rejection sets no
		 * state, so there is nothing to count. The difference between the platforms is intended.
		 */
		void player.play().catch(() => undefined);
	};

	const stop = (): void => {
		player.pause();
	};

	const stopEnded = player.onEnded(() => {
		/**
		 * A loop boundary is not an end. Treating both as one event would run the end handling on every
		 * iteration.
		 */
		if (disposed || loop) return;
		ended = true;
		options.onEnded();
	});

	return {
		setSource(url) {
			if (disposed || url === source) return;
			/** The old sound must not continue under the new source, so it is stopped and rewound first. */
			stop();
			ended = false;
			source = url;
			if (url === null) {
				player.rewind();
				return;
			}
			player.load(url);
			player.rewind();
			start();
		},
		setPlaying(next) {
			if (disposed || next === desiredPlaying) return;
			desiredPlaying = next;
			if (next) start();
			else stop();
		},
		setLoop(next) {
			if (disposed) return;
			loop = next;
			player.setLoop(next);
		},
		setVolume(next) {
			if (disposed) return;
			player.setVolume(next);
		},
		setMuted(next) {
			if (disposed) return;
			player.setMuted(next);
		},
		setRestartKey(next) {
			if (disposed || next === restartKey) return;
			restartKey = next;
			player.rewind();
			ended = false;
			/** Rewinds only. A sound that was paused stays paused at the start. */
			if (desiredPlaying) start();
		},
		suspend() {
			if (disposed || suspended) return;
			suspended = true;
			player.pause();
		},
		resume() {
			if (disposed || !suspended) return;
			suspended = false;
			start();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			stopEnded();
			player.pause();
			player.release();
		},
	};
}
