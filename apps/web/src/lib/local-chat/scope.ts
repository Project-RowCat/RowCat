import type { DomainScope } from "#/lib/local-data/domain-scope.ts";
import { useDomainScope } from "#/lib/local-data/domain-scope.ts";

/**
 * The local scope the chat screen sees: a narrow window. The real lifecycle (member confirmation,
 * opening the database, account switching, rejecting late activation) lives in `local-data`. This
 * file keeps only the boundary that the chat screen sees the chat store alone. That boundary
 * matters because the local database is now shared with the authoring domain. If chat code could
 * reach the draft store, components would hold it, and whatever is held eventually gets used.
 */
export type ChatScope = DomainScope<"chat">;

export const useChatScope = (): ChatScope => useDomainScope("chat");
