import type { ByoProvider } from "@rowcat/chat";
import { newLocalId, nowIso } from "../local-data/clock.ts";
import type { SecureKeyStorage } from "../local-sync/device-key.ts";
import {
	MOBILE_BYO_PROVIDERS,
	PROVIDER_CREDENTIAL_VERSION,
	type ProviderConnectionSummary,
	providerCredentialEntry,
	readStoredProviderCredential,
	summaryOf,
} from "./record.ts";

/**
 * Provider connection store. This is the only place API keys live (Keychain/Keystore).
 *
 * The file splits access into two ports, the same split as the web counterpart:
 *
 * ```text
 * ProviderConnectionStore      Read by screens: summaries, connect, disconnect. No secret leaves.
 * ProviderCredentialAccess     Read by the runtime, only at execution time. Never handed to screens.
 * ```
 *
 * A single merged interface would give settings components a function that reads the secret. That
 * function could be called from somewhere in the render tree, and the plaintext key would then end
 * up in React state or closures and travel with error reports and profile snapshots. With the
 * split, that code cannot be written at all.
 *
 * What this file does not do:
 *
 * - It does not verify keys. Checking a key means sending a request to the provider, which
 *   belongs to the transport layer (`lib/generation/*`). The assembly point sets the order:
 *   `connect` runs only after verification succeeds, so a key rejected with 401 never shows as
 *   connected.
 * - It does not touch preferences. Disconnecting does not clear global or room overrides that
 *   point at the provider. The user can reconnect later, and those rooms must work again without
 *   any action.
 * - It does not know SQLite. Summaries are not copied into the database for convenience: that
 *   copy would be a plaintext record of which provider keys exist on this device, and the two
 *   stores could diverge (one entry deleted, the other kept).
 */

/**
 * The port screens see. No secret leaves through it.
 *
 * It has no method that reads a secret, so a component holding this type cannot read a key. Do not
 * add `readSecret()`, `getApiKey()` or `exportCredential()`.
 */
export interface ProviderConnectionStore {
	/** All connections for this device and member. Empty array if none. */
	list(): Promise<ProviderConnectionSummary[]>;
	get(provider: ByoProvider): Promise<ProviderConnectionSummary | null>;
	has(provider: ByoProvider): Promise<boolean>;
	/**
	 * Connects, or replaces the key. Both are the same operation because the result is the same: one
	 * valid key stored for this provider.
	 *
	 * Replacement must overwrite. Removing the old entry first and then writing the new one would
	 * leave the connection gone if the write fails in between.
	 */
	connect(provider: ByoProvider, secret: string): Promise<void>;
	/** Deletes the credential. Preferences are left alone. */
	disconnect(provider: ByoProvider): Promise<void>;
}

/**
 * The port the runtime sees. It opens the secret **only at execution time**.
 *
 * The value is passed to a callback, not returned. If it were returned as `Promise<string>`,
 * callers would hold it in variables that spread into retry closures, module caches and state
 * objects. With a callback, the secret's lifetime is visibly limited to one request.
 *
 * Reading from storage on every call is a rule too. Another screen may have replaced the key or
 * disconnected, and a module-level cache would never see that change.
 */
export interface ProviderCredentialAccess {
	/**
	 * Runs one operation with this provider's credential.
	 *
	 * If there is no connection or the entry cannot be read, the callback is **not called** and the
	 * result is `null`. It does not throw, because the caller sits right before generation and must be
	 * able to show the normal "not connected" guidance. **There is no fallback to another provider.**
	 */
	withCredential<T>(
		provider: ByoProvider,
		use: (secret: string) => Promise<T>,
	): Promise<T | null>;
}

/**
 * Builds the screen-facing store.
 *
 * The storage implementation is an argument so it can be verified (same reason as `device-key.ts`).
 * `expo-secure-store` is a native module and does not open in Node, and mocking it would let tests
 * pass without anyone checking that the entry name, format and read convention work for real.
 */
export function createProviderConnectionStore(
	storage: SecureKeyStorage,
	viewerId: string,
): ProviderConnectionStore {
	const read = async (provider: ByoProvider) =>
		readStoredProviderCredential(
			await storage.get(providerCredentialEntry(viewerId, provider)),
			provider,
		);

	return {
		list: async () => {
			const summaries: ProviderConnectionSummary[] = [];
			/**
			 * Reads only the names we know, without enumerating storage. Enumeration would expose other
			 * members' entries on the same device and other apps' entries, which is wider than the question
			 * we answer ("what has this member connected").
			 */
			for (const provider of MOBILE_BYO_PROVIDERS) {
				const row = await read(provider);
				if (row) summaries.push(summaryOf(row));
			}
			return summaries;
		},

		get: async (provider) => {
			const row = await read(provider);
			return row ? summaryOf(row) : null;
		},

		has: async (provider) => (await read(provider)) !== null,

		connect: async (provider, secret) => {
			/**
			 * Trims surrounding whitespace. Keys copied from a console often arrive with a trailing newline,
			 * and that one character shows up as a 401 from the provider, so the user thinks the key is
			 * wrong.
			 */
			const trimmed = secret.trim();
			if (!trimmed) throw new Error("Empty credentials aren't saved");

			await storage.set(
				providerCredentialEntry(viewerId, provider),
				JSON.stringify({
					version: PROVIDER_CREDENTIAL_VERSION,
					provider,
					connectionId: newLocalId(),
					updatedAt: nowIso(),
					secret: trimmed,
				}),
			);
		},

		/** Removing a missing connection succeeds (idempotent). Double taps really do happen. */
		disconnect: async (provider) => {
			await storage.remove(providerCredentialEntry(viewerId, provider));
		},
	};
}

/**
 * The runtime-only accessor for the same member.
 *
 * It is a separate factory on purpose, and that is the boundary. Only the assembly point calls this
 * (`local-data/stores.ts`), and its result flows only into generation runtime. Settings screens
 * receive only the `ProviderConnectionStore` above.
 */
export function createProviderCredentialAccess(
	storage: SecureKeyStorage,
	viewerId: string,
): ProviderCredentialAccess {
	return {
		withCredential: async (provider, use) => {
			/**
			 * Read at execution time. This line keeps screens and the runtime consistent: if the key was
			 * just replaced, this request goes out with the new one; if the connection was removed, this
			 * returns `null`.
			 */
			const row = readStoredProviderCredential(
				await storage.get(providerCredentialEntry(viewerId, provider)),
				provider,
			);
			if (!row) return null;

			/**
			 * We do not try to wipe the secret with `try/finally`. JavaScript strings are immutable and
			 * cannot be overwritten, so such code does nothing while looking like protection. What actually
			 * narrows is the reference's lifetime, and this function already narrows it by not returning the
			 * value.
			 */
			return await use(row.secret);
		},
	};
}
