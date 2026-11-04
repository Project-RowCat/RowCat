import { expoClient } from "@better-auth/expo/client";
import { APP_SCHEME } from "@rowcat/domain";
import { apiBaseUrl } from "@rowcat/sdk";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import type { ActiveInstance } from "./instances/active-instance.ts";
import {
	authSessionEntryNames,
	authStoragePrefixFor,
	chunkCountOf,
} from "./instances/auth-storage.ts";
import { activeInstance } from "./instances/device-registry.ts";

/**
 * Auth client: performs sign-in and sign-out. It plays the same role as `apps/web/src/lib/auth.ts`
 * and follows the same rule: screens do not read state from here. Product identity (member id,
 * nickname, member status, adult gate) comes from `/v2/me`. Authorization and the **local SQLite
 * scope** are keyed by the member id. Better Auth's `user.id` identifies the login account, so
 * choosing the database file by it would make switching login method swap the file holding the
 * user's conversations and drafts. This file exposes only what it does; who the viewer is comes
 * from `viewerQueryOptions` in `@rowcat/query` (see the `session-state.ts` header).
 *
 * OAuth URLs, state, PKCE, cookie parsing and session refresh are not hand-written, for the same
 * reason as on the web: hand-written code is certain to get something wrong, and the wrong part is
 * an account takeover path.
 *
 * **No auth backend runs inside the app.** Serving a second Better Auth from Expo Router API routes
 * (`app/api/auth/*`) would create two session-signing keys and two trusted-origin lists, and the
 * looser one would become the real policy. The authority is the single `/v2/auth/*` in `apps/api`.
 */

/**
 * Auth mount point of an instance: its `/v2` base plus `/auth`. The origin comes from the active instance
 * (`instances/active-instance.ts`) and the prefix rule stays the SDK's — re-reading
 * `process.env.EXPO_PUBLIC_API_ORIGIN` here would let the API move to another server while auth stayed on
 * the old one.
 */
export const authBaseUrlFor = (origin: string): string =>
	`${apiBaseUrl(origin)}/auth`;

/**
 * Name prefix for auth storage. It never overlaps the sync key. Both live in the OS secret store
 * but hold different things:
 *
 * ```text
 * rowcat.auth[.<hash>]_*   session cookie · session cache   (owned by Better Auth, per instance)
 * rowcat.sync.dek.<hash>   the DEK this device remembers   (owned by local-sync/device-key.ts)
 * ```
 *
 * They are not merged into one secret-storage service because their lifetimes and owners differ.
 * Sign-out clears the first and leaves the second alone: signing out closes access, it does not
 * revoke trust. Overlapping prefixes would make that distinction unrepresentable. Each instance has its
 * own auth prefix (`instances/auth-storage.ts`); the home instance keeps `rowcat.auth`.
 */

/**
 * Storage for auth secrets: Keychain / Keystore. The wrapper exists for one reason, the access
 * policy. The default (`WHEN_UNLOCKED`) is restored onto other devices through encrypted backups,
 * and a session cookie moved that way would be a login on a device we never issued it to.
 * `THIS_DEVICE_ONLY` blocks that move and also keeps the value unreadable while the device is
 * locked. The sync DEK uses the same policy for the same reason (see `local-sync/secure-store.ts`).
 *
 * `requireAuthentication` stays off: enabling it would show a biometric prompt every time the app
 * returns to the foreground, and checking a session is not something the user asked for.
 *
 * All four methods are filled in because Better Auth's storage adapter also calls the synchronous
 * variants. Leave one out and that path silently uses the default policy with no options.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
	keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const authSecureStore = {
	getItem: (key: string) => SecureStore.getItem(key, OPTIONS),
	getItemAsync: (key: string) => SecureStore.getItemAsync(key, OPTIONS),
	setItem: (key: string, value: string) =>
		SecureStore.setItem(key, value, OPTIONS),
	setItemAsync: (key: string, value: string) =>
		SecureStore.setItemAsync(key, value, OPTIONS),
};

const createInstanceAuthClient = (active: ActiveInstance) =>
	createAuthClient({
		baseURL: authBaseUrlFor(active.origin),
		plugins: [
			expoClient({
				/**
				 * Deep-link scheme, taken from the domain's single source. Omitting it would make the plugin
				 * read `app.json`, and the code would no longer show where the value comes from. The server's
				 * `trustedOrigins` derives from the same constant (`apps/api/src/auth/trusted-origins.ts`), so
				 * stating it here keeps the link between the two visible.
				 */
				scheme: APP_SCHEME,
				storagePrefix: authStoragePrefixFor(active.instance),
				storage: authSecureStore,
			}),
			/**
			 * Two-factor authentication: only the two challenge-answering paths (`verify-totp`,
			 * `verify-backup-code`) are used. The challenge cookie is stored and sent with the other auth
			 * cookies by the Expo plugin above. Enabling and disabling are not available in this app; that
			 * management lives on the web account screen.
			 */
			twoFactorClient(),
		],
	});

type AuthClient = ReturnType<typeof createInstanceAuthClient>;

/**
 * One client per instance, kept for the life of the process. Each holds its own session cache and reads
 * only its own SecureStore prefix, so a client built for one server can never send another server's cookie.
 * The active instance changes only by remounting the tree (`active-instance-root.tsx`), and a client for an
 * instance the device switched away from simply stops being asked.
 */
const clients = new Map<string, AuthClient>();

export function authClientFor(active: ActiveInstance): AuthClient {
	let client = clients.get(active.origin);
	if (!client) {
		client = createInstanceAuthClient(active);
		clients.set(active.origin, client);
	}
	return client;
}

/**
 * **The active instance's auth client**, under the name every call site already used. A forwarding
 * object rather than a function so `authClient.signIn.email(...)` reads exactly as before — and so the
 * static scans that look for those calls by name still see them. Each property read resolves the
 * active instance at that moment; there are no React hooks on this client to hold a stale one.
 */
export const authClient: AuthClient = new Proxy({} as AuthClient, {
	get: (_target, property) =>
		Reflect.get(authClientFor(activeInstance()), property),
});

/**
 * The current session cookie, which is **asynchronous**. In Better Auth 1.7, `getCookie()` returns
 * a Promise (it reads SecureStore). Copying an older example that uses it synchronously sends
 * `[object Promise]` in the header. The server reads that as no cookie and answers as a guest,
 * which looks like being logged out rather than like an error.
 *
 * An empty value comes back when there is no cookie. Folding it to `null` gives the transport layer
 * one shape for "absent" (`auth-fetch.ts`).
 */
export const readAuthCookieFor = async (
	active: ActiveInstance,
): Promise<string | null> => (await authClientFor(active).getCookie()) || null;

/** The active instance's cookie. Transports bound to one origin use `readAuthCookieFor` instead. */
export const readAuthCookie = (): Promise<string | null> =>
	readAuthCookieFor(activeInstance());

/**
 * Forgets an instance's session on this device — for removing the instance, not for signing out of the
 * active one (that path is `signOutSession`). The server is told first when it can be reached, so the
 * session ends there too; offline, the device forgets it anyway, because removal must not depend on the
 * server it removes. Then every entry the client wrote under that instance's prefix is deleted, chunks
 * included, and the cached client is dropped.
 */
export async function forgetInstanceSession(
	active: ActiveInstance,
): Promise<void> {
	/** At most five seconds: a server that never answers must not hold its own removal. */
	await Promise.race([
		authClientFor(active)
			.signOut()
			.catch(() => {}),
		new Promise((resolve) => setTimeout(resolve, 5_000)),
	]);
	const prefix = authStoragePrefixFor(active.instance);
	for (const name of authSessionEntryNames(prefix)) {
		const stored = await SecureStore.getItemAsync(name, OPTIONS).catch(
			() => null,
		);
		for (let i = 0; i < chunkCountOf(stored); i++)
			await SecureStore.deleteItemAsync(`${name}.${i}`, OPTIONS).catch(
				() => {},
			);
		await SecureStore.deleteItemAsync(name, OPTIONS).catch(() => {});
	}
	clients.delete(active.origin);
}
