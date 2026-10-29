import type { ChatGenerationRequest } from "@rowcat/contracts/chat";
import type { ChatLoreDecision } from "./lore.ts";

/**
 * The structure of an assembled prompt: names attached to values the assembler already holds. The
 * file must never re-parse the assembled string. Splitting `system` on double newlines to rebuild
 * blocks would create a parser that silently breaks when assembly order changes, and the inspector
 * would then mislead creators into editing their text for the wrong reason. Structure is captured
 * before the values become strings.
 *
 * It lives here rather than in `@rowcat/contracts` because it never crosses a boundary: no server,
 * no storage, no sync record. The contracts package is for shapes that do cross the wire.
 */

/**
 * Block vocabulary in assembly order; this array is the ordering itself. The `Record` type requires
 * a label for every id, so adding a value forces the commit to supply a label and a source. If the
 * assembler adds a block without extending this list, compilation fails. That is the only guarantee
 * that the inspector does not omit part of the prompt.
 */
export const CHAT_PROMPT_BLOCK_IDS = [
	"absolute-guard",
	"rating-guard",
	"minor-guard",
	"house-rules",
	"lore-system-top",
	"roleplay-rules",
	"narration-pack",
	"gm-preamble",
	"scenario",
	"characters",
	"persona",
	"play-guide",
	"lore-system-bottom",
	"lore-before-history",
	"summary",
	"memory",
	"user-note",
	"intensity",
	"tail-guard",
] as const;
export type ChatPromptBlockId = (typeof CHAT_PROMPT_BLOCK_IDS)[number];

/**
 * Who wrote this text. This is provenance, not rating. `platform` is our rules, `creator` is the
 * work's manuscript, `viewer` is what the person in this conversation typed, and `narration` is a
 * narration pack, which is an original work. The safety guard wraps all four sources at both ends.
 * That fact is the real content of the assembly order, and the list must make it checkable at a
 * glance.
 */
export type ChatPromptBlockSource =
	| "platform"
	| "creator"
	| "viewer"
	| "narration";

export const CHAT_PROMPT_BLOCK_SOURCE: Record<
	ChatPromptBlockId,
	ChatPromptBlockSource
> = {
	"absolute-guard": "platform",
	"rating-guard": "platform",
	"minor-guard": "platform",
	"house-rules": "platform",
	"lore-system-top": "creator",
	"roleplay-rules": "platform",
	"narration-pack": "narration",
	"gm-preamble": "platform",
	scenario: "creator",
	characters: "creator",
	persona: "viewer",
	"play-guide": "creator",
	"lore-system-bottom": "creator",
	"lore-before-history": "creator",
	summary: "viewer",
	memory: "viewer",
	"user-note": "viewer",
	/**
	 * The wording is ours, but the user chooses the value. It is tagged `viewer`, not `platform`,
	 * because tagging it `platform` would read as an always-on rule. This block only applies when the
	 * user opts in, which is why the injection boundary must be scannable at a glance.
	 */
	intensity: "viewer",
	"tail-guard": "platform",
};

/**
 * The on-screen label, in Korean. The id is the contract; the label is only copy. If the renderer
 * branched on `block.label === "Lore"`, that string would become the contract, and rewording a label
 * would silently change the screen.
 */
export const CHAT_PROMPT_BLOCK_LABEL: Record<ChatPromptBlockId, string> = {
	"absolute-guard": "Absolute rules",
	"rating-guard": "Rating guard",
	"minor-guard": "Minor character guard",
	"house-rules": "House rules",
	"lore-system-top": "Lore (top)",
	"roleplay-rules": "Roleplay rules",
	"narration-pack": "Narration pack",
	"gm-preamble": "Narrator preamble",
	scenario: "World / situation",
	characters: "Characters",
	persona: "User (counterpart)",
	"play-guide": "Play guide",
	"lore-system-bottom": "Lore (bottom)",
	"lore-before-history": "Lore (before generation)",
	summary: "Summary",
	memory: "Memory",
	"user-note": "User note",
	intensity: "Intensity",
	"tail-guard": "Tail guard",
};

/**
 * A block that was actually emitted. Empty blocks never appear here because the assembler does not
 * create them.
 */
export interface ChatPromptBlock {
	id: ChatPromptBlockId;
	text: string;
}

/**
 * A record of one assembly pass. The request itself is not here. `system` and `messages` are not
 * copied, because they already live on `ChatGenerationRequest`. A copy would raise the question of
 * which one was actually sent, and that answer could eventually differ by screen.
 */
export interface ChatPromptTrace {
	/**
	 * In the order the model receives them. Joining this array with a blank-line separator yields
	 * `deliveredChatSystem(request)`. The outer guards belong to the transport layer, not the
	 * assembler (they are not in `request.system`), and the same function that builds the labels
	 * places them here.
	 */
	blocks: ChatPromptBlock[];
	/** This scene's lore decisions, including both activated and inactive entries. */
	lore: ChatLoreDecision[];
	/** The text the lore decision scanned: this input plus the last few turns. */
	loreScanText: string;
	/** Speaker name attached to user turns. It is the value `{{user}}` was substituted with. */
	personaName: string;
	/** Number of history messages actually included, nudges and primers included. */
	historyLength: number;
	/**
	 * Whether this turn was assembled as all-ages. This value separates the rating guard from the tail
	 * guard.
	 */
	allAges: boolean;
}

/**
 * Joins blocks into the actual system prompt. The assembler and the inspector use this same
 * function. That makes 'joining the block list yields what is sent' a structural fact. If the
 * screen joined them its own way, the claim would be a promise nothing could check.
 */
export const chatSystemPromptText = (
	blocks: readonly ChatPromptBlock[],
): string => blocks.map((block) => block.text).join("\n\n");

/**
 * The generation request the screen may draw. This is an allow-list. The provider-neutral request
 * has no credentials today; keys, headers and cookies belong to transport. Picking fields anyway is
 * because that fact holds only today. A screen that dumps the request object would draw any field
 * the contract adds later, automatically, and what that field is would be decided on the day it
 * appears. Omitting known fields only blocks the names known today. The response key-set test
 * enforces this boundary.
 */
/**
 * Not the contract's `ChatGenerationMessage`, because that type is a discriminated union. Tool call
 * arguments and call ids may one day be carried in this array. This screen would then draw them
 * without anyone deciding to. What is drawn must be decided now, not on that day.
 */
export interface SafeChatDebugMessage {
	role: "user" | "assistant" | "tool";
	content: string;
	/** Only the tool call's name. Arguments and call id are deliberately omitted. */
	toolCallName: string | null;
}

export interface SafeChatRequestDebug {
	system: string;
	messages: SafeChatDebugMessage[];
	maxOutputTokens: number;
	reasoningEffort: string | null;
	requestedMode: "all-ages" | "adult";
	continuation: boolean;
	/**
	 * Carries only the number of tool declarations. It is always 0 today because the assembler never
	 * sends tools.
	 */
	toolCount: number;
	/**
	 * Whether this conversation has a routing-affinity key. The value is not included. The value is an
	 * opaque random number we issued, not a secret. Written here, though, it would travel with
	 * screenshots and bug reports. The inspector only needs to answer whether this request carried
	 * that axis, which yes or no covers. Replay sessions never have one.
	 */
	hasRoutingSession: boolean;
}

export function safeChatRequestDebug(
	request: ChatGenerationRequest,
): SafeChatRequestDebug {
	return {
		system: request.system,
		messages: request.messages.map((message) => ({
			role: message.role,
			content: message.content,
			toolCallName:
				message.role === "assistant" ? (message.toolCall?.name ?? null) : null,
		})),
		maxOutputTokens: request.maxOutputTokens,
		reasoningEffort: request.reasoningEffort ?? null,
		requestedMode: request.context.requestedMode,
		continuation: request.continuation,
		toolCount: request.tools.length,
		hasRoutingSession: Boolean(request.routingSessionId),
	};
}
