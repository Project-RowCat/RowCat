/**
 * Ownership of a generation turn. The rules live in `conversation.ts` of `@rowcat/chat`.
 *
 * Web and mobile both call the same pure rules. A copy here would let the two platforms decide
 * differently when a late response is discarded, and that divergence would reproduce on one
 * platform only.
 *
 * This file stays for the same reason as `session.ts`: the path is the app's documented location.
 */
export {
	type ConversationSessionKey,
	canPersistGeneration,
	type GenerationOwner,
	ownsHistory,
	ownsSession,
	releaseOwnSlot,
} from "@rowcat/chat";
