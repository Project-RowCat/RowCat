import type {
	ChatLoreDecision,
	ChatPromptBlockId,
	ChatPromptBlockSource,
	ConversationTurnRecord,
} from "@rowcat/chat";
import { APP_NAME } from "@rowcat/domain";
import { translator } from "#/lib/i18n/current.ts";

/**
 * The debugger's words, in the render's locale.
 *
 * `@rowcat/chat` owns the vocabulary these name (block ids, turn statuses, discard reasons) and the
 * rules over them; mobile has no debugger, so the names live only here. Each function takes the
 * vocabulary value itself, so a new value is a missing key rather than a silently blank cell.
 */

export const promptBlockLabel = (id: ChatPromptBlockId): string =>
	translator("playtest")(`debug.block.${id}`);

export const turnStatusLabel = (
	status: ConversationTurnRecord["status"],
): string => translator("playtest")(`debug.status.${status}`);

export const discardReasonLabel = (
	reason: NonNullable<ConversationTurnRecord["discardReason"]>,
): string => translator("playtest")(`debug.discard.${reason}`);

/** Who authored a block. The platform's blocks carry the product's own name, not a translated word. */
export const promptSourceLabel = (source: ChatPromptBlockSource): string =>
	source === "platform"
		? APP_NAME
		: translator("playtest")(`debug.source.${source}`);

export const loreReasonLabel = (reason: ChatLoreDecision["reason"]): string =>
	translator("playtest")(`debug.reason.${reason}`);

export const lorePositionLabel = (
	position: ChatLoreDecision["position"],
): string => translator("playtest")(`debug.position.${position}`);

const emptyCopy = (kind: "noPrompt" | "noTurn" | "noEvent") => {
	const t = translator("playtest");
	return { title: t(`debug.${kind}.title`), body: t(`debug.${kind}.body`) };
};

export const debugNoPromptCopy = () => emptyCopy("noPrompt");
export const debugNoTurnCopy = () => emptyCopy("noTurn");
export const debugNoEventCopy = () => emptyCopy("noEvent");
