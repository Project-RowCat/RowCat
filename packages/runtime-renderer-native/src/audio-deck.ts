import { classifyRuntimeAssetValue } from "@rowcat/runtime/asset";
import {
	createNativeAudioController,
	type NativeAudioController,
	type NativeRuntimeAudioPort,
} from "./audio.ts";
import type { NativeRuntimeAssetResolverOf } from "./image-source.ts";
import type { NativeRuntimeTreeStore } from "./tree-store.ts";

/**
 * Live sounds: the reconciliation between the host tree and the audio players. After a successful
 * commit, the store calls the subscriber once and the deck walks the tree. New audio nodes get a
 * controller. Existing nodes get only changed props. Removed nodes are disposed, which stops the
 * sound.
 * - Not React. On web, sounds are DOM nodes, so the renderer's imperative path owns their
 *   lifetime. On native, the tree lives in the store and React only draws it. Putting sounds in
 *   components would tie their lifetime to React's mount rules. A parent View re-rendering could
 *   restart a sound, and StrictMode's double mount would create two players.
 * - Sounds are never drawn. Keeping their lifetime in the drawing layer would force that layer to
 *   stay alive for something it does not display.
 * - Failed batches never reach the deck. The store notifies subscribers only after successful
 *   commits, with the revert journal ahead of that, so a half-run batch cannot turn a sound on.
 */

/** Asset reference to an address the player can open. null means silence. */
export type NativeRuntimeAudioResolver = NativeRuntimeAssetResolverOf<string>;

export interface NativeAudioDeckOptions {
	readonly store: NativeRuntimeTreeStore;
	/**
	 * The app's handle for creating players. `null` means this build has no audio. That is silence,
	 * not failure, and the creator's session runs normally.
	 */
	readonly port: NativeRuntimeAudioPort | null;
	readonly resolveAsset: NativeRuntimeAudioResolver;
	/** Natural end maps to a handler number. The route from there to the VM belongs to the caller. */
	readonly dispatchEvent: (handler: number) => void;
}

export interface NativeAudioDeck {
	/** The app went to background. Only actual playback stops. */
	suspend(): void;
	resume(): void;
	dispose(): void;
	/** For diagnostics and tests only: the number of live sounds right now. */
	readonly size: number;
}

interface Live {
	readonly controller: NativeAudioController;
	/** Last values sent. These are the baseline used to send only changed values. */
	source: string | null;
	playing: boolean;
	loop: boolean;
	volume: number;
	muted: boolean;
	restartKey: string | number | null;
}

export function createNativeAudioDeck(
	options: NativeAudioDeckOptions,
): NativeAudioDeck {
	const { store, port } = options;
	const live = new Map<number, Live>();
	let suspended = false;
	let disposed = false;

	const audioIds = (): number[] =>
		store.ids().filter((id) => store.node(id)?.kind === "audio");

	const urlFor = (asset: string | null): string | null => {
		if (asset === null) return null;
		const target = classifyRuntimeAssetValue(asset);
		if (target === null) return null;
		/**
		 * Asks for the sound. A name bound to the rendered picture, if resolved here, would make the
		 * player fetch image bytes, and that request could target media this session may not open. The
		 * permission decision belongs to the binding layer (bindRuntimeAssetResolver). On a mismatch the
		 * answer is null. Remote addresses also become null on this path, since sounds in this build are
		 * managed assets only.
		 */
		return options.resolveAsset(target, "audio");
	};

	const reconcile = (): void => {
		if (disposed) return;
		const seen = new Set<number>();
		for (const id of audioIds()) {
			seen.add(id);
			const node = store.node(id);
			if (node === null) continue;
			const props = node.props;
			let entry = live.get(id);
			if (entry === undefined) {
				/** Without a port, no controller is created. This is silence, not failure. */
				if (port === null) continue;
				const controller = createNativeAudioController({
					player: port(),
					onEnded: () => {
						/**
						 * The handler number is read at call time. Caching it as a value would make the old number
						 * fire after the creator passes a different function, and that event would be dropped
						 * silently.
						 */
						const handler = store.node(id)?.props.onEnded ?? null;
						if (handler === null || disposed) return;
						options.dispatchEvent(handler);
					},
				});
				entry = {
					controller,
					source: null,
					playing: false,
					loop: false,
					volume: 1,
					muted: false,
					restartKey: null,
				};
				live.set(id, entry);
				if (suspended) controller.suspend();
			}
			/**
			 * Order is the rule: source first. If playback started first, a controller with no source would
			 * remember the play request and start when the source arrived. If loop or volume changed between
			 * those two lines, the first frame would play at default values.
			 */
			const url = urlFor(props.audioAsset);
			if (url !== entry.source) {
				entry.controller.setSource(url);
				entry.source = url;
			}
			if (props.loop !== entry.loop) {
				entry.controller.setLoop(props.loop);
				entry.loop = props.loop;
			}
			if (props.volume !== entry.volume) {
				entry.controller.setVolume(props.volume);
				entry.volume = props.volume;
			}
			if (props.muted !== entry.muted) {
				entry.controller.setMuted(props.muted);
				entry.muted = props.muted;
			}
			if (props.restartKey !== entry.restartKey) {
				entry.controller.setRestartKey(props.restartKey);
				entry.restartKey = props.restartKey;
			}
			if (props.playing !== entry.playing) {
				entry.controller.setPlaying(props.playing);
				entry.playing = props.playing;
			}
		}
		/** A sound removed from the tree ends right there. It does not wait for the session to end. */
		for (const [id, entry] of [...live]) {
			if (seen.has(id)) continue;
			entry.controller.dispose();
			live.delete(id);
		}
	};

	const unsubscribe = store.subscribe(reconcile);
	/** Reconciles once, for attaching to a store that already has nodes (reattaching). */
	reconcile();

	return {
		get size() {
			return live.size;
		},
		suspend() {
			if (disposed || suspended) return;
			suspended = true;
			for (const entry of live.values()) entry.controller.suspend();
		},
		resume() {
			if (disposed || !suspended) return;
			suspended = false;
			for (const entry of live.values()) entry.controller.resume();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			unsubscribe();
			for (const entry of live.values()) entry.controller.dispose();
			live.clear();
		},
	};
}
