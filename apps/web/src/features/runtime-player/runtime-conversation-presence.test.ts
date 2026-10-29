import type { StoryPlaybackDto } from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import { shouldTouchRuntimeConversation } from "./runtime-conversation-presence.ts";

/**
 * The library row appears only for a verified runtime playback response. The point of this test is
 * the negative cases. A missing story, no entitlement, purchase required and subscription required
 * all arrive as a failed query (undefined). A conversation story arrives as `chat`, and a malformed
 * response fails contract validation and also comes back as undefined. None of these may create a
 * row.
 */

const runtime: StoryPlaybackDto = {
	version: 1,
	kind: "runtime",
	artifact: {},
	capabilities: [],
	managedAssets: [],
};

describe("when a library row appears", () => {
	it("a runtime response plus a settled title creates it", () => {
		expect(
			shouldTouchRuntimeConversation({
				playback: runtime,
				storyResolved: true,
			}),
		).toBe(true);
	});

	it("waits while the title is not settled", () => {
		expect(
			shouldTouchRuntimeConversation({
				playback: runtime,
				storyResolved: false,
			}),
		).toBe(false);
	});

	it("no response (missing story, no entitlement, purchase required, corrupt) creates nothing", () => {
		expect(
			shouldTouchRuntimeConversation({
				playback: undefined,
				storyResolved: true,
			}),
		).toBe(false);
	});

	it("a chat story's response creates nothing", () => {
		const chat = {
			version: 1,
			kind: "chat",
			seed: {},
		} as unknown as StoryPlaybackDto;
		expect(
			shouldTouchRuntimeConversation({ playback: chat, storyResolved: true }),
		).toBe(false);
	});
});
