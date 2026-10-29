import { expoClient } from "@better-auth/expo/client";
import { APP_SCHEME } from "@rowcat/domain";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { API_BASE_URL } from "./env.ts";

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
 * Auth mount point. The origin is not chosen again here: `API_BASE_URL` is already `${origin}/v2`,
 * assembled in one place (`env.ts`). Re-reading `process.env.EXPO_PUBLIC_API_ORIGIN` here would let
 * the API move to another dev server while auth stayed on the old one.
 */
export const AUTH_BASE_URL = `${API_BASE_URL}/auth`;

/**
 * Name prefix for auth storage. It never overlaps the sync key. Both live in the OS secret store
 * but hold different things:
 *
 * ```text
 * rowcat.auth_*            session cookie · session cache   (owned by Better Auth)
 * rowcat.sync.dek.<hash>   the DEK this device remembers   (owned by local-sync/device-key.ts)
 * ```
 *
 * They are not merged into one secret-storage service because their lifetimes and owners differ.
 * Sign-out clears the first and leaves the second alone: signing out closes access, it does not
 * revoke trust. Overlapping prefixes would make that distinction unrepresentable.
 */
const AUTH_STORAGE_PREFIX = "rowcat.auth";

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

export const authClient = createAuthClient({
	baseURL: AUTH_BASE_URL,
	plugins: [
		expoClient({
			/**
			 * Deep-link scheme, taken from the domain's single source. Omitting it would make the plugin
			 * read `app.json`, and the code would no longer show where the value comes from. The server's
			 * `trustedOrigins` derives from the same constant (`apps/api/src/auth/trusted-origins.ts`), so
			 * stating it here keeps the link between the two visible.
			 */
			scheme: APP_SCHEME,
			storagePrefix: AUTH_STORAGE_PREFIX,
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

/**
 * The current session cookie, which is **asynchronous**. In Better Auth 1.7, `getCookie()` returns
 * a Promise (it reads SecureStore). Copying an older example that uses it synchronously sends
 * `[object Promise]` in the header. The server reads that as no cookie and answers as a guest,
 * which looks like being logged out rather than like an error.
 *
 * An empty value comes back when there is no cookie. Folding it to `null` gives the transport layer
 * one shape for "absent" (`auth-fetch.ts`).
 */
export const readAuthCookie = async (): Promise<string | null> =>
	(await authClient.getCookie()) || null;
