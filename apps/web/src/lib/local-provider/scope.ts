import type { DomainScope } from "#/lib/local-data/domain-scope.ts";
import { useDomainScope } from "#/lib/local-data/domain-scope.ts";

/**
 * Local scope seen by provider connections. Kept narrow, following the same rule as chat and
 * generation preferences. Lifetime and account isolation belong to local-data. What remains here is
 * the boundary that the settings screen sees only the connection store. The port that opens
 * credentials is a separate hook (below), which the settings screen does not use.
 */
export type ProviderScope = DomainScope<"provider">;

/**
 * Hook for the settings screen. It offers only summary, connect, and disconnect, so there is no
 * route from it to the plaintext key.
 */
export const useProviderScope = (): ProviderScope => useDomainScope("provider");

/**
 * Runtime-only. The port that opens the credential when generation starts. The long name and this
 * warning are the only guard, because the type system cannot restrict call sites. Rule: no file
 * under features/settings and no file under features/chat/room-settings may call this hook. Only
 * the conversation generation hook calls it today, and that hook never sees plaintext. The port
 * goes straight to the transport router, decryption happens when the adapter is invoked, and the
 * plaintext lives only for that call (withCredential in lib/local-provider/store.ts). If more
 * callers appear, the boundary is breaking down.
 */
export type ProviderCredentialScope = DomainScope<"providerCredentials">;

export const useProviderCredentialScope = (): ProviderCredentialScope =>
	useDomainScope("providerCredentials");
