import type { DomainScope } from "#/lib/local-data/domain-scope.ts";
import { useDomainScope } from "#/lib/local-data/domain-scope.ts";

/**
 * The local scope that the generation preference sees: a narrow window, with the same rule as chat
 * and authoring (local-chat/scope.ts). Lifetime and account isolation belong to local-data. What
 * remains here is the boundary that settings screens see only the preference store. The global
 * settings screen has no reason to hold a ChatStore, and anything it holds will eventually be used.
 */
export type GenerationScope = DomainScope<"generation">;

export const useGenerationScope = (): GenerationScope =>
	useDomainScope("generation");
