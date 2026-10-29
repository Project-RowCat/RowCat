import type { ChatSeedLoreDto } from "@rowcat/contracts/chat";
import type { ChatTool } from "./tool.ts";
import { chatLoreTool } from "./tool-lore.ts";

/**
 * The one place that decides what this conversation can call. If two apps each built the list, the
 * same work would get different tools on different devices, and the difference would show as
 * response quality, not as an error. The apps only pass this list to the router.
 *
 * Tools that do not apply are left out. Each tool knows its own condition and returns `null`
 * (`chatLoreTool`), so a tool with nothing to do is never declared. A conversation where no tool
 * applies sends a request byte for byte identical to before this axis existed, which pairs with the
 * router not wrapping transport when the list is empty.
 *
 * Declarations go out with every prompt and count as input tokens each turn, so an unconditional
 * tool would bill conversations that never use it.
 *
 * Not here: user settings (a switch would have to explain what it improves, and the screen has
 * nothing to weigh that with yet), creator settings (choosing tools is a runtime matter, not a
 * conversation one), and storage or transport (a tool that reads storage would take the
 * registration as an argument).
 */
export function chatConversationTools(room: {
	seed: { lore: readonly ChatSeedLoreDto[] };
}): ChatTool[] {
	return [chatLoreTool(room.seed.lore)].filter(
		(tool): tool is ChatTool => tool !== null,
	);
}
