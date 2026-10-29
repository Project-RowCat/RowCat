import type { StoryPlayMode } from "@rowcat/domain";
import { STORY_START_LABEL } from "@rowcat/domain";

/**
 * The **copy** of the primary action — kept apart from the component that draws it.
 *
 * This app's tests do not render screens, and modules that pull in `@rowcat/ui-native` never load
 * in that environment (the native primitives come along). If the copy lived inside a component
 * file, the only way to check its value would be to try it by hand. The rule of this app — keep
 * pure decisions out of the screen — applies here too.
 *
 * This file once also held the collect copy (`Collect for 500 Churu`) and its failure branches. Collecting a
 * work was removed, so the primary action is always start, and the remaining axes are the play mode
 * and whether an action is in progress.
 */
export function storyStartLabel(
	pending: boolean,
	/**
	 * Play mode — this value decides the words.
	 *
	 * It passes through **the domain table** (`STORY_START_LABEL`) rather than a ternary. That table
	 * is a `Record`, so adding a mode breaks compilation, and the web reads the same table, so there
	 * is no place for the two apps' words to diverge.
	 *
	 * The default of `"chat"` is about **meaning**, not about any one call site: a place that does not
	 * state a play mode is a conversation. (In practice the server never omits the value, so only
	 * tests reach that default.)
	 */
	playMode: StoryPlayMode = "chat",
): string {
	/**
	 * The in-progress copy follows the play mode too. Drawing "starting the conversation" for a
	 * runtime work promises something other than what opens at that moment — the user would be left
	 * waiting for a conversation screen.
	 */
	if (pending)
		return playMode === "runtime" ? "Preparing" : "Starting the conversation";
	return STORY_START_LABEL[playMode];
}
