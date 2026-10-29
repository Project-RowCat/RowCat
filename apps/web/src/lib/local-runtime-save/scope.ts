import type { DomainScope } from "#/lib/local-data/domain-scope.ts";
import { useDomainScope } from "#/lib/local-data/domain-scope.ts";

/**
 * Local scope the play screen sees: player save only. Same reason as chat and creation
 * (local-chat/scope.ts). The play screen has no reason to hold the conversation or draft stores. If
 * it did, it would use them in passing, and creator code running on the play screen could reach the
 * author's manuscripts.
 */
export type RuntimeSaveScope = DomainScope<"runtimeSave">;

export const useRuntimeSaveScope = (): RuntimeSaveScope =>
	useDomainScope("runtimeSave");
