import { describe, expect, it } from "vitest";
import {
	publishRuntimeChatControls,
	readRuntimeChatControls,
	requestPlaythroughReset,
} from "./runtime-chat-controls.ts";

/**
 * Checks the header-to-canvas bridge rules without rendering. When the bridge breaks, the symptoms
 * are silent: a reset button appears on a screen whose session has not started, or a reset for
 * another work clears this screen. Neither produces an error.
 */
describe("header controls for runtime playback", () => {
	it("no control is offered before the canvas sets one", () => {
		expect(readRuntimeChatControls("story-none")).toEqual({
			resetAvailable: false,
			generationSettingsAvailable: false,
		});
	});

	it("what the canvas sets reads as is, and disappears when released", () => {
		publishRuntimeChatControls("story-a", {
			resetAvailable: true,
			generationSettingsAvailable: true,
		});
		expect(readRuntimeChatControls("story-a").resetAvailable).toBe(true);
		expect(readRuntimeChatControls("story-a").generationSettingsAvailable).toBe(
			true,
		);
		publishRuntimeChatControls("story-a", null);
		expect(readRuntimeChatControls("story-a")).toEqual({
			resetAvailable: false,
			generationSettingsAvailable: false,
		});
	});

	/**
	 * The two booleans are separate conditions. Generation settings may be offered while the AI
	 * disclosure is showing, before the session starts; reset must not be offered then. Folding them
	 * into one would make the generation settings unreachable while the disclosure is showing.
	 */
	it("generation settings and reset turn on separately", () => {
		publishRuntimeChatControls("story-a", {
			resetAvailable: false,
			generationSettingsAvailable: true,
		});
		expect(readRuntimeChatControls("story-a")).toEqual({
			resetAvailable: false,
			generationSettingsAvailable: true,
		});
		publishRuntimeChatControls("story-a", null);
	});

	/** A late click must not clear another work's playthrough, so state is keyed by work id. */
	it("split by story id", () => {
		publishRuntimeChatControls("story-a", {
			resetAvailable: true,
			generationSettingsAvailable: true,
		});
		expect(readRuntimeChatControls("story-b").resetAvailable).toBe(false);
		publishRuntimeChatControls("story-a", null);
	});

	it("a reset request with no listener just disappears", () => {
		expect(() => requestPlaythroughReset("story-nobody")).not.toThrow();
	});
});
