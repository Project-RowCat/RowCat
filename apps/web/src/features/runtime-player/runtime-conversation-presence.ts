import type { StoryPlaybackDto } from "@rowcat/contracts";
import { runtimeConversationPresenceAllowed } from "@rowcat/runtime-persistence";

/**
 * Decides whether the library row may be created. The rule lives in a shared function that mobile
 * also calls; this wrapper only folds the playback response into that function's input. It stays
 * out of a component effect because the web tests here do not render React. A mistake here is
 * silent: an unentitled user gets a row, or an entitled user gets none.
 */
export function shouldTouchRuntimeConversation(input: {
	/**
	 * Current playback query value; `undefined` while it is still loading or after the request failed.
	 */
	playback: StoryPlaybackDto | undefined;
	/**
	 * Whether the story title is settled: it has arrived, or the lookup failed and there is nothing
	 * left to wait for.
	 */
	storyResolved: boolean;
}): boolean {
	return runtimeConversationPresenceAllowed({
		playbackKind: input.playback?.kind ?? null,
		storyResolved: input.storyResolved,
	});
}
