import {
	type ChatUserTool,
	roomToolOverrides,
	userToolActiveIn,
} from "@rowcat/chat";
import { translator } from "#/lib/i18n/current.ts";
import { formatNumber } from "#/lib/i18n/format.ts";

/**
 * Summary for the settings home's tools row: how many of the user's tools are on here. A count,
 * not names: names at this row width would truncate to the first one, which reads as "only this
 * one is on". "None yet" and "none on" are different sentences, because the next step differs
 * (make one in settings, or switch one on here).
 */
export function toolRowSummary(
	room: { toolOverrides?: Readonly<Record<string, boolean>> },
	tools: readonly ChatUserTool[],
): string {
	const t = translator("tools");
	const live = tools.filter((tool) => tool.deletedAt === null);
	if (live.length === 0) return t("room.summary.none");
	const on = live.filter((tool) => userToolActiveIn(room, tool)).length;
	return on === 0
		? t("room.summary.off")
		: t("room.summary.on", { count: formatNumber(on) });
}

/** Whether this room has its own choice for the tool, as opposed to following its default. */
export const roomOverridesTool = (
	room: { toolOverrides?: Readonly<Record<string, boolean>> },
	toolId: string,
): boolean => Object.hasOwn(roomToolOverrides(room), toolId);
