import type { ByoProvider } from "@rowcat/chat";
import { newLocalId, nowIso } from "#/lib/local-data/clock.ts";
import type { LocalDb } from "#/lib/local-data/db.ts";
import { openCredential, sealCredential } from "./crypto.ts";
import {
	PROVIDER_CONNECTION_VERSION,
	type ProviderConnectionSummary,
	readProviderConnection,
} from "./record.ts";

/**
 * Provider connection store: the only place credentials are kept. It is split into two ports.
 * - ProviderConnectionStore: used by the screen. Summary, connect, disconnect. No plaintext goes
 *   out.
 * - ProviderCredentialAccess: used by the runtime. Opens the credential only at execution time,
 *   and is never handed to the screen. Merging them would give the settings component the decrypt
 *   function. Plaintext keys would then end up in React state, closures, devtools, error reports,
 *   and profiler snapshots. With the split, the types cannot construct that code.
 *
 * Not done here:
 * - Validation. Checking a key means sending a request to the provider, which belongs to the
 *   transport layer (lib/generation/*). Assembly calls connect only after validation succeeds, so a
 *   401 key never shows as connected.
 * - Preferences. Disconnect does not remove global or per-room overrides that point at the
 *   provider. Reconnecting should bring those rooms back without any action. Deleted overrides
 *   could not be restored, because nobody would know what was removed.
 * - Sync. No db.syncState in the transaction and no tombstones (same reasoning as
 *   local-generation/store.ts). Disconnect is a local state change, not a fact to tell other
 *   devices, so the row is actually deleted.
 */

/**
 * Port the screen sees. Plaintext never leaves it. Nothing here reads a secret, so a component
 * holding this type cannot offer a "show key" action.
 */
export interface ProviderConnectionStore {
	list(): Promise<ProviderConnectionSummary[]>;
	get(provider: ByoProvider): Promise<ProviderConnectionSummary | null>;
	/**
	 * Connects, or replaces the key. Both are one operation because the result is the same: exactly
	 * one valid key for this provider. Replacement issues a new wrapping key and a new connection id,
	 * so the key that opened the old ciphertext disappears together with its row.
	 */
	connect(provider: ByoProvider, secret: string): Promise<void>;
	/** Deletes the credential record only. Preferences are left as they are. */
	disconnect(provider: ByoProvider): Promise<void>;
	has(provider: ByoProvider): Promise<boolean>;
}

/**
 * Runtime-only port: opens the credential only at execution time. It passes the secret to a
 * callback instead of returning it. A returned Promise<string> would let callers keep the value in
 * variables, which spread into retry closures, module caches, and state objects. A callback keeps
 * the plaintext's lifetime bounded to one request. Reading from storage on every call is also
 * required. Another tab may have rotated or disconnected the key, and a cached copy would hide that
 * change from this tab.
 */
export interface ProviderCredentialAccess {
	/**
	 * If there is no connection or the seal cannot be opened, the callback is not called and null is
	 * returned. It does not throw, because the call site sits right before generation, and the caller
	 * must be able to show normal guidance for "no connection".
	 */
	withCredential<T>(
		provider: ByoProvider,
		use: (secret: string) => Promise<T>,
	): Promise<T | null>;
}

export function createProviderConnectionStore(
	db: LocalDb,
	viewerId: string,
): ProviderConnectionStore {
	return {
		list: async () =>
			(await db.providerConnections.toArray())
				.map(readProviderConnection)
				.filter((summary): summary is ProviderConnectionSummary =>
					Boolean(summary),
				),

		get: async (provider) =>
			readProviderConnection(await db.providerConnections.get(provider)),

		connect: async (provider, secret) => {
			/**
			 * Trims surrounding whitespace. Keys copied from a console often carry a trailing newline, which
			 * would otherwise surface as a provider 401.
			 */
			const trimmed = secret.trim();
			if (!trimmed) throw new Error("empty credentials are not saved");

			const connectionId = newLocalId();
			const sealed = await sealCredential({
				viewerId,
				provider,
				connectionId,
				secret: trimmed,
			});

			/**
			 * Replacement uses put, the same path as a new connection. Deleting the old row first and then
			 * inserting the new one would leave a window in which a failure loses the connection entirely.
			 */
			await db.providerConnections.put({
				provider,
				version: PROVIDER_CONNECTION_VERSION,
				connectionId,
				...sealed,
				updatedAt: nowIso(),
			});
		},

		/**
		 * Deleting a missing row succeeds (idempotent). Two tabs can press disconnect at the same time.
		 */
		disconnect: async (provider) => {
			await db.providerConnections.delete(provider);
		},

		has: async (provider) =>
			readProviderConnection(await db.providerConnections.get(provider)) !==
			null,
	};
}

/**
 * Creates the runtime-only accessor over the same db and member. A separate factory is the
 * boundary: only the assembly point calls it (local-data/activation.ts), and its result flows only
 * into the generation runtime. The settings screen receives only ProviderConnectionStore.
 */
export function createProviderCredentialAccess(
	db: LocalDb,
	viewerId: string,
): ProviderCredentialAccess {
	return {
		withCredential: async (provider, use) => {
			/**
			 * Reads at execution time. This line keeps tabs consistent: if another tab rotated the key, this
			 * request uses the new one, and if it disconnected, this returns null. A module-level cache
			 * would keep the old state in this tab only.
			 */
			const row = await db.providerConnections.get(provider);
			if (!row || !readProviderConnection(row)) return null;

			const secret = await openCredential(row, viewerId);
			if (secret === null) return null;

			/**
			 * Does not try to wipe the plaintext in try/finally. JavaScript strings are immutable and cannot
			 * be overwritten, so such code would look protective while doing nothing. What actually narrows
			 * is the lifetime of the reference, and the callback shape already narrows that, since the
			 * secret is never returned.
			 */
			return await use(secret);
		},
	};
}
