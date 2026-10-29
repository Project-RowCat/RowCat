import { sha256 } from "@noble/hashes/sha2.js";
import { type ByoProvider, isByoProviderName } from "@rowcat/chat";
import { bytesToHex, utf8ToBytes } from "@rowcat/sync";

/**
 * The **physical shape** of a stored provider credential, and the read boundary for it.
 *
 * This is the same place as `lib/local-provider/record.ts` on the web, but **the storage medium
 * differs**. There, IndexedDB can hold a non-extractable `CryptoKey`, so the sealed bytes sit in
 * the plaintext database. Here the OS secure store exists: Keychain and Keystore fill that role, so
 * we do not imitate a second encryption layer on top (a layer built that way keeps its key in the
 * same store, and all it adds is complexity).
 *
 * So this file guards one boundary: **the API key lives only in Keychain/Keystore.** It is not in
 * SQLite, AsyncStorage, the query cache, sync records, React state (outside an input form being
 * edited), or the server.
 *
 * What is deliberately **absent**, and why:
 * - **Sync axes** (`dirty`, `rev`, `serverVersion`, tombstones). Their absence shows directly in
 *   the shape. If they existed, someone would fill them eventually, and at that moment the user's
 *   key would travel to the server.
 * - **Endpoint URLs.** The Anthropic and Gemini addresses are constants in the adapters.
 *   Accepting an arbitrary endpoint would make this app a tool that sends conversations to any
 *   host.
 * - **Key fingerprints, last four characters, hashes.** There is no place to show them
 *   ("connected / not connected" is enough). A fingerprint is by itself information usable for
 *   offline matching.
 */

/**
 * The providers this app draws connection rows for. **The order is fixed too.**
 *
 * The rule is that this list is not built from the catalogue. The user connects a provider before
 * choosing a model, and that screen must stay up even if the catalogue lookup fails. If the list
 * came from a server response, one network hiccup would make "cannot fix the connection" the
 * outcome (the same judgment as the web's `BYO_PROVIDERS`).
 */
export const MOBILE_BYO_PROVIDERS: readonly ByoProvider[] = [
	"anthropic-byo",
	"gemini-byo",
];

/**
 * Storage format version. Only 1 exists so far.
 *
 * The version exists because this value **stays on the user's device for a long time**. On the day
 * the shape changes, if nothing lets old entries be recognized, the only option is to discard them
 * entirely, and that means the user has to paste the key in again. An unknown version is read as
 * **no connection**. That is better than taking a secret out and using it while only half
 * understanding it.
 */
export const PROVIDER_CREDENTIAL_VERSION = 1;

/**
 * The value that goes wholesale into one SecureStore entry.
 *
 * **The secret lives inside this object.** That is why this type covers only the store
 * implementation and the runtime accessor, and screens see only the summary below. That separation
 * is the entire security boundary of this slice.
 */
export interface StoredProviderCredential {
	version: number;
	provider: ByoProvider;
	/**
	 * The identity of this connection record. Issued anew each time the key is replaced.
	 *
	 * It is not drawn on screen nor sent to the server. It is kept for diagnosis: this is the only
	 * axis that can ask, without any value, "is what is stored now the key that was just entered?"
	 */
	connectionId: string;
	/** When the connection was last made or the key replaced (ISO). */
	updatedAt: string;
	/** The user's API key. **This field is the reason this file exists.** */
	secret: string;
}

/**
 * What the screen sees: **a summary with no secret.**
 *
 * Half the reason this type exists is this file's point. No key reaches the values React handles.
 * If a component held `secret`, the value would be carried along in some render-tree state,
 * closure, or error report.
 */
export interface ProviderConnectionSummary {
	provider: ByoProvider;
	connected: true;
	updatedAt: string;
}

/**
 * Stored string → value. **It never throws on any input.**
 *
 * A damaged entry, an unknown version and an empty secret are all "no connection" (`null`). A throw
 * would fail the whole settings screen, and the user would not even get the chance to connect
 * again: the recovery path is "connect again", so that screen must stay up.
 *
 * **Do not half-understand.** If it tried to read a future version on its own, that failure would
 * be indistinguishable from "the key was wrong", and the user would go to re-issue a perfectly good
 * key.
 */
export function readStoredProviderCredential(
	raw: string | null,
	provider: ByoProvider,
): StoredProviderCredential | null {
	if (!raw) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const row = parsed as Partial<StoredProviderCredential>;
	if (row.version !== PROVIDER_CREDENTIAL_VERSION) return null;
	/**
	 * The item name already determines the provider, but the name inside the value is also compared. A
	 * mismatched entry means another provider's key was copied into this slot, and sending a request
	 * with that key would send **the user's secret to a provider the user did not choose.**
	 */
	if (!isByoProviderName(row.provider) || row.provider !== provider)
		return null;
	if (typeof row.secret !== "string" || row.secret.length === 0) return null;
	if (typeof row.connectionId !== "string" || row.connectionId.length === 0)
		return null;
	return {
		version: PROVIDER_CREDENTIAL_VERSION,
		provider,
		connectionId: row.connectionId,
		updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
		secret: row.secret,
	};
}

/** Value → summary. **This one place** is where the secret is dropped. */
export const summaryOf = (
	row: StoredProviderCredential,
): ProviderConnectionSummary => ({
	provider: row.provider,
	connected: true,
	updatedAt: row.updatedAt,
});

const ENTRY_PREFIX = "rowcat.provider.";

/**
 * Member + provider → SecureStore entry name.
 *
 * **It does not reuse the name space of the sync key** (`rowcat.sync.dek.`). The two values belong
 * to different security domains: one is our protocol's key, and the other is a credential the user
 * obtained from a third party. If the names overlapped, cleaning up one would take the other along.
 *
 * The viewer id is passed through SHA-256 rather than used directly, for the same reason as in
 * `device-key.ts`. One reason is format: SecureStore key names allow a fixed set of characters, and
 * the filtering approach can **fold two different members into the same name**, at which point Bob
 * could retrieve Alice's API key. The other is traces: keychain entry names persist into backups
 * and diagnostic tools.
 *
 * The provider name is used as-is. It is not a user identifier, and **deleting one exact entry**
 * (account deletion or local reset) must be able to derive that name deterministically. The price
 * of that is the rule that no deletion sweeps by prefix.
 */
export const providerCredentialEntry = (
	viewerId: string,
	provider: ByoProvider,
): string =>
	`${ENTRY_PREFIX}${bytesToHex(sha256(utf8ToBytes(viewerId)))}.${provider}`;

/** Every provider entry of this member. The side that deletes must be able to enumerate them. */
export const providerCredentialEntries = (viewerId: string): string[] =>
	MOBILE_BYO_PROVIDERS.map((provider) =>
		providerCredentialEntry(viewerId, provider),
	);
