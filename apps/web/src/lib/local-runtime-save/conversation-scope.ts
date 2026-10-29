import type { DomainScope } from "#/lib/local-data/domain-scope.ts";
import { useDomainScope } from "#/lib/local-data/domain-scope.ts";

/**
 * Local scope for the runtime library rows, and only that port. It is separate from scope.ts for
 * ownership. The code that writes and removes library rows (the play screen's first confirmation,
 * and the list's `Remove from list` action) has no reason to hold the player save port. If it did, it would
 * eventually use it, and library actions would reach saved progress.
 */
export type RuntimeConversationScope = DomainScope<"runtimeConversation">;

export const useRuntimeConversationScope = (): RuntimeConversationScope =>
	useDomainScope("runtimeConversation");
