import { describe, expect, it, vi } from "vitest";
import { createWebAudioController, type WebAudioMedia } from "./audio.ts";

/**
 * Sound lifecycle, checked by value without real sound. JSDOM's HTMLAudioElement has no play(), and
 * even with one, it cannot produce an autoplay rejection or a natural end as values. That is why
 * the controller accepts a narrow interface. The transitions tested here are what this code
 * promises, not the browser's implementation.
 */

interface FakeMedia extends WebAudioMedia {
	readonly calls: string[];
	/** Makes the next play() reject, the way the autoplay policy does. */
	reject: boolean;
	end(): void;
}

function fakeMedia(): FakeMedia {
	const listeners = new Set<() => void>();
	const calls: string[] = [];
	const media: FakeMedia = {
		calls,
		reject: false,
		src: "",
		loop: false,
		volume: 1,
		muted: false,
		currentTime: 0,
		play() {
			calls.push("play");
			return media.reject
				? Promise.reject(new Error("NotAllowedError"))
				: Promise.resolve();
		},
		pause() {
			calls.push("pause");
		},
		removeAttribute(name) {
			calls.push(`remove:${name}`);
			media.src = "";
		},
		addEventListener(_type, listener) {
			listeners.add(listener);
		},
		removeEventListener(_type, listener) {
			listeners.delete(listener);
		},
		end() {
			for (const listener of [...listeners]) listener();
		},
	};
	return media;
}

function harness() {
	const media = fakeMedia();
	const onEnded = vi.fn();
	const pending: boolean[] = [];
	const audio = createWebAudioController({
		media,
		onEnded,
		onPendingChange: (value) => pending.push(value),
	});
	return { media, audio, onEnded, pending };
}

/** play() returns a promise, so one microtask must flush before the state settles. */
const settle = (): Promise<void> => Promise.resolve().then(() => undefined);

describe("sound controller", () => {
	describe("play and stop", () => {
		it("playing alone does not play without a source", () => {
			const h = harness();
			h.audio.setPlaying(true);
			expect(h.media.calls).not.toContain("play");
		});

		it("plays as desired once a source arrives", () => {
			const h = harness();
			h.audio.setPlaying(true);
			h.audio.setSource("https://cdn.example.com/a.mp3");
			expect(h.media.src).toBe("https://cdn.example.com/a.mp3");
			expect(h.media.calls).toContain("play");
		});

		it("false → true → false is play and stop", () => {
			const h = harness();
			h.audio.setSource("https://cdn.example.com/a.mp3");
			h.audio.setPlaying(true);
			h.audio.setPlaying(false);
			expect(h.media.calls.filter((call) => call === "play")).toHaveLength(1);
		});

		/**
		 * A repeated identical value must not restart playback. Every prop is re-sent on each change as
		 * the normal protocol state, so calling play() on each commit would rewind the sound every time.
		 */
		it("does nothing when playing stays the same", () => {
			const h = harness();
			h.audio.setSource("https://cdn.example.com/a.mp3");
			h.audio.setPlaying(true);
			const before = h.media.calls.length;
			h.audio.setPlaying(true);
			h.audio.setVolume(0.5);
			h.audio.setLoop(true);
			expect(h.media.calls).toHaveLength(before);
		});
	});

	describe("source swap", () => {
		it("stops the old sound first and rewinds to the start", () => {
			const h = harness();
			h.audio.setPlaying(true);
			h.audio.setSource("https://cdn.example.com/a.mp3");
			h.media.currentTime = 42;
			h.audio.setSource("https://cdn.example.com/b.mp3");
			expect(h.media.currentTime).toBe(0);
			expect(h.media.src).toBe("https://cdn.example.com/b.mp3");
			expect(h.media.calls.indexOf("pause")).toBeLessThan(
				h.media.calls.lastIndexOf("play"),
			);
		});

		it("does not rewind when the same source comes again", () => {
			const h = harness();
			h.audio.setSource("https://cdn.example.com/a.mp3");
			h.media.currentTime = 42;
			h.audio.setSource("https://cdn.example.com/a.mp3");
			expect(h.media.currentTime).toBe(42);
		});

		/**
		 * A null from the resolver is a normal state: the sound is not uploaded yet, or the kind does not
		 * match.
		 */
		it("null is silence and takes src away", () => {
			const h = harness();
			h.audio.setPlaying(true);
			h.audio.setSource("https://cdn.example.com/a.mp3");
			h.audio.setSource(null);
			expect(h.media.calls).toContain("remove:src");
			expect(h.media.src).toBe("");
		});
	});

	describe("restartKey", () => {
		it("a change rewinds to the start and sounds again", () => {
			const h = harness();
			h.audio.setSource("https://cdn.example.com/a.mp3");
			h.audio.setPlaying(true);
			h.media.currentTime = 30;
			h.audio.setRestartKey(1);
			expect(h.media.currentTime).toBe(0);
			expect(h.media.calls.filter((call) => call === "play")).toHaveLength(2);
		});

		it("when stopped it only rewinds and does not play", () => {
			const h = harness();
			h.audio.setSource("https://cdn.example.com/a.mp3");
			h.media.currentTime = 30;
			h.audio.setRestartKey("shot");
			expect(h.media.currentTime).toBe(0);
			expect(h.media.calls).not.toContain("play");
		});

		it("does nothing for the same value", () => {
			const h = harness();
			h.audio.setSource("https://cdn.example.com/a.mp3");
			h.audio.setPlaying(true);
			h.audio.setRestartKey(1);
			const before = h.media.calls.length;
			h.audio.setRestartKey(1);
			expect(h.media.calls).toHaveLength(before);
		});
	});

	describe("natural end", () => {
		it("tells the creator unless looping", () => {
			const h = harness();
			h.audio.setSource("https://cdn.example.com/a.mp3");
			h.audio.setPlaying(true);
			h.media.end();
			expect(h.onEnded).toHaveBeenCalledTimes(1);
		});

		/**
		 * A loop boundary is not the same as the end. Giving both one name would run the end handler on
		 * every cycle.
		 */
		it("does not tell while looping", () => {
			const h = harness();
			h.audio.setLoop(true);
			h.audio.setSource("https://cdn.example.com/a.mp3");
			h.audio.setPlaying(true);
			h.media.end();
			expect(h.onEnded).not.toHaveBeenCalled();
		});

		it("does not sound again when an unrelated prop changes after the end", () => {
			const h = harness();
			h.audio.setSource("https://cdn.example.com/a.mp3");
			h.audio.setPlaying(true);
			h.media.end();
			const before = h.media.calls.filter((call) => call === "play").length;
			h.audio.setVolume(0.2);
			h.audio.setMuted(true);
			expect(h.media.calls.filter((call) => call === "play")).toHaveLength(
				before,
			);
		});

		it("turning playing off and on sounds again from the start", () => {
			const h = harness();
			h.audio.setSource("https://cdn.example.com/a.mp3");
			h.audio.setPlaying(true);
			h.media.currentTime = 90;
			h.media.end();
			h.audio.setPlaying(false);
			h.audio.setPlaying(true);
			expect(h.media.currentTime).toBe(0);
		});
	});

	describe("autoplay policy", () => {
		it("a refusal is waiting, not failure", async () => {
			const h = harness();
			h.media.reject = true;
			h.audio.setSource("https://cdn.example.com/a.mp3");
			h.audio.setPlaying(true);
			await settle();
			expect(h.audio.pendingActivation).toBe(true);
			expect(h.pending).toEqual([true]);
		});

		it("when permission comes, it resumes what was waiting", async () => {
			const h = harness();
			h.media.reject = true;
			h.audio.setSource("https://cdn.example.com/a.mp3");
			h.audio.setPlaying(true);
			await settle();
			h.media.reject = false;
			h.audio.activate();
			await settle();
			expect(h.audio.pendingActivation).toBe(false);
			expect(h.pending).toEqual([true, false]);
		});

		/**
		 * A controller that is not waiting ignores the permission. Otherwise every gesture would replay
		 * the sound.
		 */
		it("when not waiting, permission does not start playback", async () => {
			const h = harness();
			h.audio.setSource("https://cdn.example.com/a.mp3");
			h.audio.setPlaying(true);
			await settle();
			const before = h.media.calls.filter((call) => call === "play").length;
			h.audio.activate();
			expect(h.media.calls.filter((call) => call === "play")).toHaveLength(
				before,
			);
		});

		/**
		 * A late rejection must not turn the new state into 'waiting'. That bug shows up as no sound
		 * right after a source change, and it stays until the next interaction.
		 */
		it("an old refusal arriving after the source changed is dropped", async () => {
			const h = harness();
			h.media.reject = true;
			h.audio.setPlaying(true);
			h.audio.setSource("https://cdn.example.com/a.mp3");
			h.media.reject = false;
			h.audio.setSource("https://cdn.example.com/b.mp3");
			await settle();
			expect(h.audio.pendingActivation).toBe(false);
		});
	});

	describe("document visibility", () => {
		it("stops when hidden and resumes when visible again", () => {
			const h = harness();
			h.audio.setSource("https://cdn.example.com/a.mp3");
			h.audio.setPlaying(true);
			h.audio.suspend();
			expect(h.media.calls[h.media.calls.length - 1]).toBe("pause");
			h.audio.resume();
			expect(h.media.calls[h.media.calls.length - 1]).toBe("play");
		});

		/** Does not touch the desired state. A sound that was stopped stays silent when shown again. */
		it("a sound not wanted does not sound when visible again", () => {
			const h = harness();
			h.audio.setSource("https://cdn.example.com/a.mp3");
			h.audio.suspend();
			h.audio.resume();
			expect(h.media.calls).not.toContain("play");
		});

		it("being hidden does not read as a natural end", () => {
			const h = harness();
			h.audio.setSource("https://cdn.example.com/a.mp3");
			h.audio.setPlaying(true);
			h.audio.suspend();
			expect(h.onEnded).not.toHaveBeenCalled();
		});
	});

	describe("disposal", () => {
		it("leaves neither sound nor listeners", () => {
			const h = harness();
			h.audio.setSource("https://cdn.example.com/a.mp3");
			h.audio.setPlaying(true);
			h.audio.dispose();
			expect(h.media.calls).toContain("pause");
			expect(h.media.calls).toContain("remove:src");
			/** The listener is gone, so a late end event does not reach the creator. */
			h.media.end();
			expect(h.onEnded).not.toHaveBeenCalled();
		});

		it("props after disposal do nothing", () => {
			const h = harness();
			h.audio.setSource("https://cdn.example.com/a.mp3");
			h.audio.dispose();
			const before = h.media.calls.length;
			h.audio.setPlaying(true);
			h.audio.setSource("https://cdn.example.com/b.mp3");
			h.audio.activate();
			expect(h.media.calls).toHaveLength(before);
		});

		it("waiting is released with disposal", async () => {
			const h = harness();
			h.media.reject = true;
			h.audio.setSource("https://cdn.example.com/a.mp3");
			h.audio.setPlaying(true);
			await settle();
			h.audio.dispose();
			expect(h.audio.pendingActivation).toBe(false);
			expect(h.pending).toEqual([true, false]);
		});
	});
});
