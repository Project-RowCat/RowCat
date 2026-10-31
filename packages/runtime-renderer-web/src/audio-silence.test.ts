// @vitest-environment jsdom
import type { RuntimePatchBatch } from "@rowcat/runtime-host/patches";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createWebRuntimeRenderer,
	type WebRuntimeRenderer,
} from "./renderer.ts";

/**
 * `silenceAudio()` is how a host ends a session's sound without ending its picture. A transition,
 * a dead VM or a blocked save keeps the last tree mounted (hidden, or behind a failure notice), and
 * CSS visibility does not pause a media element. Before this, only reset() and dispose() stopped
 * sound, and the playback screen calls neither on those paths, so the previous work's looped music
 * kept playing under a failure screen.
 *
 * jsdom's media element has no play() and never pauses by itself, so play/pause are counted on the
 * prototype; what is asserted is what this renderer asked the element to do.
 */

let playing: Set<HTMLMediaElement>;

beforeEach(() => {
	document.body.innerHTML = "";
	playing = new Set();
	vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
		this: HTMLMediaElement,
	) {
		playing.add(this);
		return Promise.resolve();
	});
	vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
		this: HTMLMediaElement,
	) {
		playing.delete(this);
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

const LOOPED_MUSIC: RuntimePatchBatch = {
	revision: 1,
	patches: [
		{ op: "create", id: 1, kind: "stack" },
		{ op: "create", id: 2, kind: "audio" },
		{ op: "set-prop", id: 2, name: "loop", value: true },
		{ op: "set-prop", id: 2, name: "source", value: { $asset: "audio/bgm" } },
		{ op: "set-prop", id: 2, name: "playing", value: true },
		{ op: "insert", parent: 1, child: 2, index: 0 },
		{ op: "create", id: 3, kind: "text" },
		{ op: "insert", parent: 1, child: 3, index: 1 },
		{ op: "insert", parent: 0, child: 1, index: 0 },
	],
};

function mount(): { renderer: WebRuntimeRenderer; root: HTMLElement } {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const renderer = createWebRuntimeRenderer({
		container,
		dispatchEvent: () => undefined,
		resolveAsset: () => "https://media.example.test/bgm.m4a",
	});
	const root = container.shadowRoot?.querySelector(
		'[data-rc="root"]',
	) as HTMLElement;
	return { renderer, root };
}

describe("silencing a session's sound", () => {
	it("stops every sound and leaves the drawn tree in place", () => {
		const { renderer, root } = mount();
		renderer.apply(LOOPED_MUSIC);
		expect(playing.size).toBe(1);

		renderer.silenceAudio();

		expect(playing.size).toBe(0);
		expect(renderer.size).toBe(3);
		expect(renderer.revision).toBe(1);
		expect(root.querySelector("audio")).not.toBeNull();
		expect(renderer.failed).toBe(false);
	});

	it("a later commit, interaction or visibility change does not bring it back", () => {
		const { renderer } = mount();
		renderer.apply(LOOPED_MUSIC);
		renderer.silenceAudio();

		renderer.apply({
			revision: 2,
			patches: [
				{ op: "set-prop", id: 2, name: "playing", value: false },
				{ op: "set-prop", id: 2, name: "playing", value: true },
				{ op: "create", id: 4, kind: "audio" },
				{ op: "set-prop", id: 4, name: "source", value: { $asset: "audio/b" } },
				{ op: "set-prop", id: 4, name: "playing", value: true },
				{ op: "insert", parent: 1, child: 4, index: 2 },
			],
		});
		renderer.activateAudio();
		document.dispatchEvent(new Event("visibilitychange"));

		expect(playing.size).toBe(0);
		expect(renderer.failed).toBe(false);
		expect(renderer.audioActivationRequired).toBe(false);
	});

	it("reset() lifts it for the next session", () => {
		const { renderer } = mount();
		renderer.apply(LOOPED_MUSIC);
		renderer.silenceAudio();
		renderer.reset();
		renderer.apply(LOOPED_MUSIC);
		expect(playing.size).toBe(1);
	});

	it("reaches a sound created but not yet inserted", () => {
		const { renderer } = mount();
		renderer.apply({
			revision: 1,
			patches: [
				{ op: "create", id: 1, kind: "audio" },
				{ op: "set-prop", id: 1, name: "source", value: { $asset: "a" } },
				{ op: "set-prop", id: 1, name: "playing", value: true },
			],
		});
		expect(playing.size).toBe(1);
		renderer.silenceAudio();
		expect(playing.size).toBe(0);
	});
});
