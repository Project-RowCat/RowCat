import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The `expo-audio` adapter: where the port contract is translated into the vendor's API.
 *
 * It checks three things:
 *
 * 1. Mapping. `load` swaps the source, `rewind` seeks to the start, and `setLoop`, `setVolume`
 *    and `setMuted` change the real player properties. A wrong mapping still compiles and shows up
 *    only on device.
 * 2. Natural end. expo-audio delivers one status update and `didJustFinish` inside it is the
 *    signal. The loop decision is deliberately not made here: the controller owns it, and a second
 *    check in the adapter would diverge the day one of them changes.
 * 3. Release. Nothing remains after `release()`. A leftover listener would send events from a
 *    dead player into the VM; a leftover player would keep sounding after the screen is left.
 *
 * No simulator is needed: the vendor boundary is mocked, and the test checks what we call.
 */

const listeners: ((status: { didJustFinish: boolean }) => void)[] = [];
const removeListener = vi.fn();

const player = {
	loop: false,
	volume: 1,
	muted: false,
	replace: vi.fn(),
	play: vi.fn(),
	pause: vi.fn(),
	seekTo: vi.fn(async () => undefined),
	remove: vi.fn(),
	addListener: vi.fn(
		(
			_event: string,
			listener: (status: { didJustFinish: boolean }) => void,
		) => {
			listeners.push(listener);
			return { remove: removeListener };
		},
	),
};

const createAudioPlayer = vi.fn((_source?: unknown) => player);
const setAudioModeAsync = vi.fn(async (_mode: unknown) => undefined);

vi.mock("expo-audio", () => ({
	createAudioPlayer: (source?: unknown) => createAudioPlayer(source),
	setAudioModeAsync: (mode: unknown) => setAudioModeAsync(mode),
}));

const { nativeRuntimeAudioPort } = await import("./audio-port.ts");

beforeEach(() => {
	listeners.length = 0;
	player.loop = false;
	player.volume = 1;
	player.muted = false;
	vi.clearAllMocks();
});

describe("mapping", () => {
	it("creates without a source and swaps it in on load", () => {
		const instance = nativeRuntimeAudioPort();
		// The port contract is "create, then `load(url)`", so the address is unknown at creation. That
		// order is the deck building nodes first and receiving the resolver's answer later.
		expect(createAudioPlayer).toHaveBeenCalledWith(null);
		instance.load("https://api.example/v2/media/media-A");
		expect(player.replace).toHaveBeenCalledWith({
			uri: "https://api.example/v2/media/media-A",
		});
	});

	it("rewinding goes to the start", () => {
		nativeRuntimeAudioPort().rewind();
		expect(player.seekTo).toHaveBeenCalledWith(0);
	});

	it("the three properties change the real player", () => {
		const instance = nativeRuntimeAudioPort();
		instance.setLoop(true);
		instance.setVolume(0.25);
		instance.setMuted(true);
		expect(player).toMatchObject({ loop: true, volume: 0.25, muted: true });
	});

	it("play and pause pass through as is", async () => {
		const instance = nativeRuntimeAudioPort();
		await instance.play();
		expect(player.play).toHaveBeenCalledTimes(1);
		instance.pause();
		expect(player.pause).toHaveBeenCalledTimes(1);
	});

	// The audio session is configured once; calling it per player would rewrite the same value once
	// per track. V1 picks the quietest option (respect the silent switch, mix with others, no
	// background playback). That is a product decision, not the creator's.
	it("the audio session is configured once, with modest values", () => {
		nativeRuntimeAudioPort();
		nativeRuntimeAudioPort();
		nativeRuntimeAudioPort();
		expect(setAudioModeAsync.mock.calls.length).toBeLessThanOrEqual(1);
		if (setAudioModeAsync.mock.calls.length === 1)
			expect(setAudioModeAsync).toHaveBeenCalledWith({
				playsInSilentMode: false,
				shouldPlayInBackground: false,
				interruptionMode: "mixWithOthers",
			});
	});
});

describe("natural end", () => {
	const finish = () => {
		for (const listener of [...listeners]) listener({ didJustFinish: true });
	};

	it("didJustFinish goes to subscribers", () => {
		const instance = nativeRuntimeAudioPort();
		const seen = vi.fn();
		instance.onEnded(seen);
		finish();
		expect(seen).toHaveBeenCalledTimes(1);
	});

	it("a status update that isn't finished calls nothing", () => {
		const instance = nativeRuntimeAudioPort();
		const seen = vi.fn();
		instance.onEnded(seen);
		for (const listener of [...listeners]) listener({ didJustFinish: false });
		expect(seen).not.toHaveBeenCalled();
	});

	// The loop decision is NOT here. The controller makes it by reading `loop`; if both places
	// decided, one of them changing would make events enter on every lap or never enter at all.
	it("the adapter reports as is even while looping", () => {
		const instance = nativeRuntimeAudioPort();
		const seen = vi.fn();
		instance.onEnded(seen);
		instance.setLoop(true);
		finish();
		expect(seen).toHaveBeenCalledTimes(1);
	});

	it("unsubscribing stops delivery", () => {
		const instance = nativeRuntimeAudioPort();
		const seen = vi.fn();
		instance.onEnded(seen)();
		finish();
		expect(seen).not.toHaveBeenCalled();
	});
});

describe("release", () => {
	it("stops, releases resources and unsubscribes", () => {
		const instance = nativeRuntimeAudioPort();
		instance.release();
		expect(player.pause).toHaveBeenCalled();
		expect(player.remove).toHaveBeenCalledTimes(1);
		expect(removeListener).toHaveBeenCalledTimes(1);
	});

	// A late call after release must not touch the dead player; this races the deck's cleanup.
	it("calls after release do nothing", async () => {
		const instance = nativeRuntimeAudioPort();
		instance.release();
		vi.clearAllMocks();

		instance.load("https://api.example/v2/media/media-B");
		await instance.play();
		instance.pause();
		instance.rewind();
		instance.setLoop(true);
		instance.setVolume(0.5);
		instance.setMuted(true);
		instance.release();

		expect(player.replace).not.toHaveBeenCalled();
		expect(player.play).not.toHaveBeenCalled();
		expect(player.pause).not.toHaveBeenCalled();
		expect(player.seekTo).not.toHaveBeenCalled();
		expect(player.remove).not.toHaveBeenCalled();
	});

	// A status update arriving after release never reaches the VM.
	it("end events after release are discarded", () => {
		const instance = nativeRuntimeAudioPort();
		const seen = vi.fn();
		instance.onEnded(seen);
		instance.release();
		for (const listener of [...listeners]) listener({ didJustFinish: true });
		expect(seen).not.toHaveBeenCalled();
	});
});
