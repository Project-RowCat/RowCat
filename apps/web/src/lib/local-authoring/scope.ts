import type { DomainScope } from "#/lib/local-data/domain-scope.ts";
import { useDomainScope } from "#/lib/local-data/domain-scope.ts";

/**
 * The local scope the authoring screen sees: the same database as chat, a different window.
 *
 * The point is to not set up a new scope and only add an adapter. If authoring ran its own
 * activation, two places would each open and close a database of the same name. Depending on logout
 * order, one could keep using a connection the other had already closed. The
 * one-connection-per-member rule is enforced by local-data.
 */
export type AuthoringScope = DomainScope<"authoring">;

export const useAuthoringScope = (): AuthoringScope =>
	useDomainScope("authoring");
