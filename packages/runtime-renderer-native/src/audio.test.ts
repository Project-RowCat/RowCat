import type { RuntimePatch } from "@rowcat/runtime-host/patches";
import { describe, expect, it, vi } from "vitest";
import type { NativeRuntimeAudioPlayer } from "./audio.ts";
import { createNativeAudioController } from "./audio.ts";
import { createNativeAudioDeck } from "./audio-deck.ts";
import { createNativeRuntimeTreeStore } from "./tree-store.ts";

/**
 * Native sound, checked by value with no device. The player is a port for this reason. If Expo's
 * audio were created here, this file would need a simulator, and facts such as 'does dispose
 * actually stop the sound' would not be checked anywhere. That failure is silent: the screen looks
 * fine while the music keeps playing. The transition table checks the same facts as the web
 * renderer's audio.test.ts. The two renderers do not share render code, so the state machine exists
 * twice. Their divergence is this slice's quietest risk, so both sides pin the same facts by value.
 */

interface FakePlayer extends NativeRuntimeAudioPlayer {
	readonly calls: string[];
	end(): void;
}

function fakePlayer(): FakePlayer {
	const listeners = new Set<() => void>();
	const calls: string[] = [];
	return {
		calls,
		load(url) {
			calls.push(`load:${url}`);
		},
		play() {
			calls.push("play");
			return Promise.resolve();
		},
		pause() {
			calls.push("pause");
		},
		rewind() {
			calls.push("rewind");
		},
		setLoop(loop) {
			calls.push(`loop:${loop}`);
		},
		setVolume(volume) {
			calls.push(`volume:${volume}`);
		},
		setMuted(muted) {
			calls.push(`muted:${muted}`);
		},
		onEnded(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		release() {
			calls.push("release");
		},
		end() {
			for (const listener of [...listeners]) listener();
		},
	};
}

describe("native sound controller", () => {
	function harness() {
		const player = fakePlayer();
		const onEnded = vi.fn();
		const audio = createNativeAudioController({ player, onEnded });
		return { player, audio, onEnded };
	}

	it("playing alone does not play without a source", () => {
		const h = harness();
		h.audio.setPlaying(true);
		expect(h.player.calls).not.toContain("play");
	});

	it("plays as desired once a source arrives", () => {
		const h = harness();
		h.audio.setPlaying(true);
		h.audio.setSource("https://cdn.example.com/a.mp3");
		expect(h.player.calls).toContain("load:https://cdn.example.com/a.mp3");
		expect(h.player.calls).toContain("play");
	});

	/**
	 * The same value arriving again must not restart playback. Rewinding on each commit would cut the
	 * sound.
	 */
	it("does nothing when playing stays the same", () => {
		const h = harness();
		h.audio.setSource("https://cdn.example.com/a.mp3");
		h.audio.setPlaying(true);
		const before = h.player.calls.length;
		h.audio.setPlaying(true);
		expect(h.player.calls).toHaveLength(before);
	});

	it("changing the source stops and rewinds first", () => {
		const h = harness();
		h.audio.setPlaying(true);
		h.audio.setSource("https://cdn.example.com/a.mp3");
		h.player.calls.length = 0;
		h.audio.setSource("https://cdn.example.com/b.mp3");
		expect(h.player.calls[0]).toBe("pause");
		expect(h.player.calls).toContain("load:https://cdn.example.com/b.mp3");
	});

	it("a changed restartKey rewinds and sounds again", () => {
		const h = harness();
		h.audio.setSource("https://cdn.example.com/a.mp3");
		h.audio.setPlaying(true);
		h.player.calls.length = 0;
		h.audio.setRestartKey(1);
		expect(h.player.calls).toEqual(["rewind", "play"]);
	});

	it("when stopped, restartKey only rewinds", () => {
		const h = harness();
		h.audio.setSource("https://cdn.example.com/a.mp3");
		h.player.calls.length = 0;
		h.audio.setRestartKey("shot");
		expect(h.player.calls).toEqual(["rewind"]);
	});

	it("reports a natural end unless looping", () => {
		const h = harness();
		h.audio.setSource("https://cdn.example.com/a.mp3");
		h.audio.setPlaying(true);
		h.player.end();
		expect(h.onEnded).toHaveBeenCalledTimes(1);
	});

	it("does not tell while looping", () => {
		const h = harness();
		h.audio.setLoop(true);
		h.audio.setSource("https://cdn.example.com/a.mp3");
		h.audio.setPlaying(true);
		h.player.end();
		expect(h.onEnded).not.toHaveBeenCalled();
	});

	it("going to the background stops and returning resumes: the desire stays", () => {
		const h = harness();
		h.audio.setSource("https://cdn.example.com/a.mp3");
		h.audio.setPlaying(true);
		h.player.calls.length = 0;
		h.audio.suspend();
		expect(h.player.calls).toEqual(["pause"]);
		h.audio.resume();
		expect(h.player.calls).toEqual(["pause", "play"]);
	});

	it("a sound not wanted does not sound on return", () => {
		const h = harness();
		h.audio.setSource("https://cdn.example.com/a.mp3");
		h.audio.suspend();
		h.player.calls.length = 0;
		h.audio.resume();
		expect(h.player.calls).not.toContain("play");
	});

	it("disposing leaves neither sound, player nor listeners", () => {
		const h = harness();
		h.audio.setSource("https://cdn.example.com/a.mp3");
		h.audio.setPlaying(true);
		h.audio.dispose();
		expect(h.player.calls).toContain("pause");
		expect(h.player.calls).toContain("release");
		h.player.end();
		expect(h.onEnded).not.toHaveBeenCalled();
	});

	it("props after disposal do nothing", () => {
		const h = harness();
		h.audio.dispose();
		const before = h.player.calls.length;
		h.audio.setSource("https://cdn.example.com/a.mp3");
		h.audio.setPlaying(true);
		expect(h.player.calls).toHaveLength(before);
	});
});

describe("sound deck", () => {
	const AUDIO = "audio/bgm/main";

	function deckHarness(options?: { port?: null }) {
		const store = createNativeRuntimeTreeStore();
		const players: FakePlayer[] = [];
		const dispatchEvent = vi.fn();
		const deck = createNativeAudioDeck({
			store,
			port:
				options?.port === null
					? null
					: () => {
							const player = fakePlayer();
							players.push(player);
							return player;
						},
			/**
			 * Only managed assets become sounds. The binding layer already returns null for remote sources.
			 */
			resolveAsset: (target, expect_) =>
				target.kind === "logical" && expect_ === "audio"
					? `https://rowcat.test/media/${target.path}`
					: null,
			dispatchEvent,
		});
		let revision = 0;
		const apply = (...patches: RuntimePatch[]): void => {
			revision += 1;
			store.apply({ revision, patches });
		};
		return { store, players, deck, dispatchEvent, apply };
	}

	const createAudio = (id: number): RuntimePatch[] => [
		{ op: "create", id, kind: "audio" },
		{ op: "insert", parent: 0, child: id, index: 0 },
	];

	it("stands a player when an audio node appears", () => {
		const h = deckHarness();
		h.apply(...createAudio(1), {
			op: "set-prop",
			id: 1,
			name: "source",
			value: { $asset: AUDIO },
		});
		expect(h.deck.size).toBe(1);
		expect(h.players[0]?.calls).toContain(
			`load:https://rowcat.test/media/${AUDIO}`,
		);
	});

	/**
	 * Only changed values are passed. Sending every prop on each commit would rewind the sound each
	 * time.
	 */
	it("unchanged props do not reach the player", () => {
		const h = deckHarness();
		h.apply(...createAudio(1), {
			op: "set-prop",
			id: 1,
			name: "source",
			value: { $asset: AUDIO },
		});
		const player = h.players[0] as FakePlayer;
		player.calls.length = 0;
		h.apply({ op: "set-prop", id: 1, name: "volume", value: 0.5 });
		expect(player.calls).toEqual(["volume:0.5"]);
	});

	/**
	 * Removal ends the sound right there. If it waited for the session to end, a common conditional
	 * pattern such as {music && <Audio/>} would leave the sound playing.
	 */
	it("disposes on the spot when the node vanishes", () => {
		const h = deckHarness();
		h.apply(...createAudio(1), {
			op: "set-prop",
			id: 1,
			name: "source",
			value: { $asset: AUDIO },
		});
		const player = h.players[0] as FakePlayer;
		h.apply({ op: "remove", id: 1 });
		expect(h.deck.size).toBe(0);
		expect(player.calls).toContain("release");
	});

	it("a natural end goes out as a handler number", () => {
		const h = deckHarness();
		h.apply(...createAudio(1), {
			op: "set-prop",
			id: 1,
			name: "source",
			value: { $asset: AUDIO },
		});
		h.apply({
			op: "set-prop",
			id: 1,
			name: "onEnded",
			value: { $handler: 7 },
		});
		(h.players[0] as FakePlayer).end();
		expect(h.dispatchEvent).toHaveBeenCalledWith(7);
	});

	/** A deployment without a port is silence, not failure. The session runs normally. */
	it("quietly does nothing without a port", () => {
		const h = deckHarness({ port: null });
		expect(() =>
			h.apply(...createAudio(1), {
				op: "set-prop",
				id: 1,
				name: "source",
				value: { $asset: AUDIO },
			}),
		).not.toThrow();
		expect(h.deck.size).toBe(0);
	});

	it("disposing ends every live sound", () => {
		const h = deckHarness();
		h.apply(
			...createAudio(1),
			{ op: "set-prop", id: 1, name: "source", value: { $asset: AUDIO } },
			{ op: "create", id: 2, kind: "audio" },
			{ op: "insert", parent: 0, child: 2, index: 1 },
			{ op: "set-prop", id: 2, name: "source", value: { $asset: "audio/sfx" } },
		);
		expect(h.deck.size).toBe(2);
		h.deck.dispose();
		expect(h.deck.size).toBe(0);
		for (const player of h.players) expect(player.calls).toContain("release");
	});

	/**
	 * A failed batch never reaches the deck, because the store does not notify subscribers for it. A
	 * half-run commit cannot turn a sound on.
	 */
	it("a failed bundle makes no sound", () => {
		const h = deckHarness();
		expect(() =>
			h.apply(
				...createAudio(1),
				/** A value outside the contract. The whole batch is rolled back. */
				{ op: "set-prop", id: 1, name: "volume", value: 5 },
			),
		).toThrow();
		expect(h.deck.size).toBe(0);
	});
});
