/**
 * Whether a user turn has actually entered the conversation. The rule now lives in `@rowcat/chat`.
 *
 * The moment the input is cleared (when the conversation accepted the turn, not when it was sent)
 * is a product rule. Breaking it makes the user lose the sentence they just typed. If web and
 * mobile each wrote down this order, one side would drift and stay that way for a long time.
 *
 * This file remains for the same reason as `session.ts`: the path is the app's documented location.
 */
export {
	awaitsAnswer,
	type CommitUserTurnInput,
	commitUserTurn,
} from "@rowcat/chat";
