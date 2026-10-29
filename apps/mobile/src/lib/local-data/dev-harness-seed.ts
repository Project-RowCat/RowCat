import type { ChatSeed } from "@rowcat/chat";
import { CHAT_SEED_VERSION } from "@rowcat/contracts";

/**
 * Minimal playback snapshot used by the self-diagnostics.
 *
 * It lives in its own file so the harness does **not build this value in product code**. Creating a
 * room needs a snapshot. If the assembler lived inside the harness, a product screen might one day
 * pick it up. A real snapshot comes from a work the server has published.
 */
export const seedFromTitle = (title: string): ChatSeed => ({
	version: CHAT_SEED_VERSION,
	storyId: "dev-harness",
	title,
	tagline: "",
	adult: false,
	promptProtected: false,
	scenario: "",
	firstScene: "",
	playGuide: "",
	persona: null,
	characters: [],
	lore: [],
	startScenes: [],
	sceneImages: [],
});
