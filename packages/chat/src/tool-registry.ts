import type {
	ChatCreatorToolDto,
	ChatCustomToolDto,
	ChatSeedLoreDto,
} from "@rowcat/contracts/chat";
import { CHAT_MAX_TOOLS } from "@rowcat/contracts/chat";
import type { ChatTool } from "./tool.ts";
import { type ChatCustomToolPorts, chatCustomTool } from "./tool-custom.ts";
import { chatLoreTool } from "./tool-lore.ts";
import { creatorToolActiveIn } from "./user-tool.ts";

/**
 * The one place that decides what this conversation can call. If two apps (and the server's
 * protected-room loop) each built the list, the same work would get different tools on different
 * devices, and the difference would show as response quality, not as an error. Callers only pass
 * this list to the router.
 *
 * Three sources, in this order:
 * 1. Built in: lore search, when the room has something to find (`chatLoreTool`).
 * 2. The creator's tools, carried in the seed (`seed.tools`). Their `http` tools only where the
 *    reader switched them on (`creatorToolActiveIn`).
 * 3. The user's own tools that are on for this room (`activeUserTools` in `user-tool.ts`).
 *
 * The order is the precedence. A name already taken is skipped, so a user tool can never shadow the
 * work's tool of the same name, and the work's can never shadow lore search. Shadowing would change
 * what an existing call means without anyone editing the tool. The list stops at `CHAT_MAX_TOOLS`,
 * the contract's cap, for the same reason: a request over the cap is a 400 on every turn.
 *
 * Tools that do not apply are left out. A custom tool whose kind needs a port the caller did not
 * pass is left out too (`chatCustomTool`). Without `ports`, only lore search is built: that is the
 * shape of every caller before custom tools existed, and their requests stay byte for byte the same.
 *
 * Declarations go out with every prompt and count as input tokens each turn, so an unconditional
 * tool would bill conversations that never use it.
 */
export interface ChatToolRegistryOptions {
	/** The user's tools already filtered to this room (`activeUserTools`). */
	userTools?: readonly ChatCustomToolDto[];
	/** What custom tools need from outside. Absent: no custom tool is built. */
	ports?: ChatCustomToolPorts;
	/**
	 * The room's tool switches (`ChatRoom.toolOverrides`), read at turn start. The creator's `http`
	 * tools run only where the reader switched them on (`creatorToolActiveIn`); absent means none
	 * of them run.
	 */
	toolOverrides?: Readonly<Record<string, boolean>>;
}

export function chatConversationTools(
	room: {
		seed: {
			lore: readonly ChatSeedLoreDto[];
			/**
			 * Optional because rooms stored before this field have no key, and that absence means the work
			 * has no tools.
			 */
			tools?: readonly ChatCreatorToolDto[];
		};
	},
	options: ChatToolRegistryOptions = {},
): ChatTool[] {
	const tools: ChatTool[] = [];
	const taken = new Set<string>();
	const add = (tool: ChatTool | null) => {
		if (!tool || tools.length >= CHAT_MAX_TOOLS) return;
		if (taken.has(tool.declaration.name)) return;
		taken.add(tool.declaration.name);
		tools.push(tool);
	};

	add(chatLoreTool(room.seed.lore));

	const { ports } = options;
	if (ports) {
		const switches = { toolOverrides: options.toolOverrides };
		for (const tool of room.seed.tools ?? [])
			if (creatorToolActiveIn(switches, tool)) add(chatCustomTool(tool, ports));
		for (const tool of options.userTools ?? [])
			add(chatCustomTool(tool, ports));
	}

	return tools;
}
