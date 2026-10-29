/**
 * Everything one generation turn needs to know about the conversation. The port lives in
 * `@rowcat/chat`.
 *
 * It moved because three consumers now use it: the web local room, the web story test, and the
 * mobile local room. They differ only in storage. Prompt assembly, safety guards and ownership must
 * match exactly, and per-app copies would diverge on one platform only (for example, a reply
 * attaching to another account's room on mobile after an account switch).
 *
 * This file stays for its path. `features/conversation/session.ts` is where this app's two
 * conversations meet. Moving the path would turn this change into a web refactor.
 */
export type { ConversationSession } from "@rowcat/chat";
