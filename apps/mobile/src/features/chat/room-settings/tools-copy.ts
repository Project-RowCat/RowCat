import { type ChatUserTool, userToolActiveIn } from "@rowcat/chat";
import { translator } from "../../../lib/i18n/instance.ts";

/**
 * Copy for the room's tools pane; the rules live in `user-tool.ts` of `@rowcat/chat`
 * (`userToolActiveIn` decides what is on). Same place as `user-note-copy.ts`.
 */

/**
 * Settings-home row summary: how many of the library's live tools are on in this room. `null` while
 * the library is still being read: a placeholder would flash "none on" and be read as the setting.
 */
export function toolsRowSummary(
	room: { toolOverrides?: Readonly<Record<string, boolean>> },
	tools: readonly ChatUserTool[] | null,
): string | null {
	if (tools === null) return null;
	const t = translator("tools");
	const live = tools.filter((tool) => tool.deletedAt === null);
	if (live.length === 0) return t("room.summaryEmpty");
	const on = live.filter((tool) => userToolActiveIn(room, tool)).length;
	if (on === 0) return t("room.summaryNoneOn");
	return t("room.summaryOn", { on, total: live.length });
}
