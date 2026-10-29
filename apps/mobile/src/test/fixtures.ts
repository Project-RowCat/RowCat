import type { ChatSeed } from "@rowcat/chat";
import { CHAT_SEED_VERSION } from "@rowcat/contracts";

/** One playback snapshot. The tests use it to check that a room is self-contained. */
export const seed = (title: string): ChatSeed => ({
	version: CHAT_SEED_VERSION,
	storyId: "story-1",
	title,
	tagline: "",
	adult: false,
	promptProtected: false,
	scenario: "Scenario",
	firstScene: "",
	playGuide: "",
	persona: null,
	characters: [],
	lore: [],
	startScenes: [],
	sceneImages: [],
});
