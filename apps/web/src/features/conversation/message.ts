/**
 * The message shape the conversation view actually draws. It lives in `@rowcat/chat`.
 *
 * The narrow shape sits in the shared package to block one thing: a non-persisted line (a streaming
 * response or a story test) inventing sync metadata to get into the list. Web and mobile face that
 * temptation alike.
 */
export type { ConversationDisplayMessage } from "@rowcat/chat";
