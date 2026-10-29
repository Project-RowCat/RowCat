import type { ConversationDebugEvent } from "@rowcat/chat";
import type { RuntimeDebugEvent } from "#/features/runtime-preview/runtime-preview-debug.ts";
import type { TimelineRow, TimelineTone } from "./timeline-tab.tsx";

/**
 * Events to timeline rows: two lanes, two tables, one shape. The tables are `Record` types on
 * purpose: adding an event kind to a lane forces a tone decision, and omitting it breaks
 * compilation. If the renderer guessed tone from human-readable sentences, those sentences would
 * become a contract. The order is reversed (newest first), since people look for what just
 * happened. The sort axis is still `id`, not time.
 */

const CONVERSATION_TONE: Record<ConversationDebugEvent["kind"], TimelineTone> =
	{
		"session-started": "accent",
		"session-reset": "accent",
		"session-reloaded": "accent",
		"scene-selected": "accent",
		"turn-started": "accent",
		"input-accepted": "normal",
		"input-rejected": "danger",
		"lore-selected": "normal",
		"prompt-assembled": "normal",
		"provider-request": "normal",
		"provider-response": "normal",
		"generation-failed": "danger",
		"turn-committed": "normal",
		"turn-discarded": "warn",
	};

const RUNTIME_TONE: Record<RuntimeDebugEvent["kind"], TimelineTone> = {
	"run-requested": "accent",
	"session-started": "accent",
	commit: "normal",
	commands: "normal",
	"durable-commit": "normal",
	migration: "warn",
	diagnostic: "warn",
	"root-error": "danger",
	"generation-request": "normal",
	"generation-result": "normal",
	"session-failed": "danger",
	"session-stopped": "accent",
};

export const conversationTimelineRows = (
	events: readonly ConversationDebugEvent[],
): TimelineRow[] =>
	[...events].reverse().map((event) => ({
		id: event.id,
		at: event.at,
		turnId: event.turnId,
		kind: event.kind,
		summary: event.summary,
		tone: CONVERSATION_TONE[event.kind],
	}));

export const runtimeTimelineRows = (
	events: readonly RuntimeDebugEvent[],
): TimelineRow[] =>
	[...events].reverse().map((event) => ({
		id: event.id,
		at: event.at,
		turnId: event.turnId,
		kind: event.kind,
		summary: event.summary,
		tone: RUNTIME_TONE[event.kind],
	}));
