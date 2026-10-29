import type { NativeAudioDeck } from "@rowcat/runtime-renderer-native/audio-deck";
import type { NativeRuntimeTreeStore } from "@rowcat/runtime-renderer-native/tree-store";
import { describe, expect, it, vi } from "vitest";
import {
	attachRuntimeAudio,
	type RuntimeAudioAppState,
} from "./runtime-audio-lifecycle.ts";

/**
 * Sound lifetime: what remains when the story changes and when the app is left.
 *
 * This app's tests do not render screens, so if the procedure lived inside the hook the only check
 * would be trying it by hand. The hook therefore holds only the wiring, and the procedure is split
 * out.
 */

const fakeDeck = () => {
	const deck = {
		suspend: vi.fn(),
		resume: vi.fn(),
		dispose: vi.fn(),
		size: 0,
	};
	return deck as NativeAudioDeck & typeof deck;
};

const fakeAppState = (initial = true) => {
	const listeners: ((active: boolean) => void)[] = [];
	let active = initial;
	const state: RuntimeAudioAppState = {
		isActive: () => active,
		subscribe: (listener) => {
			listeners.push(listener);
			return () => {
				const at = listeners.indexOf(listener);
				if (at >= 0) listeners.splice(at, 1);
			};
		},
	};
	return {
		state,
		listenerCount: () => listeners.length,
		go(next: boolean) {
			active = next;
			for (const listener of [...listeners]) listener(next);
		},
	};
};

const attach = (options: {
	deck: NativeAudioDeck;
	appState: RuntimeAudioAppState;
}) =>
	attachRuntimeAudio({
		store: {} as NativeRuntimeTreeStore,
		port: null,
		resolveAsset: () => null,
		dispatchEvent: () => undefined,
		appState: options.appState,
		createDeck: () => options.deck,
	});

describe("foreground state", () => {
	it("going to the background puts it to sleep and returning resumes it", () => {
		const deck = fakeDeck();
		const app = fakeAppState();
		attach({ deck, appState: app.state });

		expect(deck.suspend).not.toHaveBeenCalled();
		app.go(false);
		expect(deck.suspend).toHaveBeenCalledTimes(1);
		// Suspend, not dispose: the desired state stays and playback continues on resume.
		expect(deck.dispose).not.toHaveBeenCalled();
		app.go(true);
		expect(deck.resume).toHaveBeenCalledTimes(1);
	});

	// A screen can really mount while the app is in the background (entering from a notification).
	// Subscribing alone would let that session sound until the next state change.
	it("if already in the background it sleeps as soon as it's set up", () => {
		const deck = fakeDeck();
		const app = fakeAppState(false);
		attach({ deck, appState: app.state });
		expect(deck.suspend).toHaveBeenCalledTimes(1);
	});
});

describe("on leaving", () => {
	it("unsubscribes and disposes the deck", () => {
		const deck = fakeDeck();
		const app = fakeAppState();
		const detach = attach({ deck, appState: app.state });
		expect(app.listenerCount()).toBe(1);

		detach();
		expect(deck.dispose).toHaveBeenCalledTimes(1);
		expect(app.listenerCount()).toBe(0);
	});

	// Order is the rule: if the subscription is not cut first, a state change arriving during disposal
	// would touch the already-dead deck.
	it("state changes after leaving don't reach the deck", () => {
		const deck = fakeDeck();
		const app = fakeAppState();
		attach({ deck, appState: app.state })();
		vi.clearAllMocks();

		app.go(false);
		app.go(true);
		expect(deck.suspend).not.toHaveBeenCalled();
		expect(deck.resume).not.toHaveBeenCalled();
	});

	// Moving to another story ends the previous story's sound before the new deck stands. React's
	// effect cleanup guarantees that order; this test checks by value that the order produces that
	// result.
	it("on a story switch, the previous sound ends first", () => {
		const order: string[] = [];
		const first = fakeDeck();
		first.dispose.mockImplementation(() => order.push("dispose:A"));
		const second = fakeDeck();

		const app = fakeAppState();
		const detach = attach({ deck: first, appState: app.state });
		detach();
		order.push("attach:B");
		attachRuntimeAudio({
			store: {} as NativeRuntimeTreeStore,
			port: null,
			resolveAsset: () => null,
			dispatchEvent: () => undefined,
			appState: app.state,
			createDeck: () => second,
		});

		expect(order).toEqual(["dispose:A", "attach:B"]);
		expect(second.dispose).not.toHaveBeenCalled();
	});
});

describe("a deployment without a port", () => {
	// Without a player-creating port the result is silence, not failure; the session runs normally.
	it("stands up even with port null", () => {
		const deck = fakeDeck();
		expect(() =>
			attach({ deck, appState: fakeAppState().state }),
		).not.toThrow();
	});
});
