import { z } from "zod";
import { LoginMethodProvider } from "./me.ts";

/**
 * Account security protocol: the shapes that `/v2/me/account/*` actually exchanges. This is kept
 * apart from `me.ts`. That file reads 'what this account is' (email, login methods, creation date);
 * this file changes 'how one gets into this account'. Merging them would mix a read-response
 * allowlist with write-request vocabulary. `SetPasswordDto` would also make `me.ts`'s statement
 * that it has no password false.
 *
 * Not exchanged here:
 * - Better Auth internals: user.id, account.id, session.token, provider account IDs, and provider
 *   access, refresh, and id tokens.
 * - `currentPassword`. Password change is not here. Better Auth already serves `POST
 *   /v2/auth/change-password` over HTTP, and the web calls it directly
 *   (`authClient.changePassword`), the same way account deletion calls `authClient.deleteUser()`
 *   directly. Wrapping it would create a second implementation of the current-password check and
 *   bring `currentPassword` into this contract.
 *
 * Password set is different. In Better Auth 1.7.0, `setPassword` is
 * `createAuthEndpoint.serverOnly`, so it has no HTTP surface and the browser has no endpoint to
 * call. This route forwards the session header to `auth.api.setPassword`. That is the supported
 * path; it does not hash the password or write the account table directly.
 */

/**
 * Password length policy, with one source for the whole repo. If signup, change, and set each
 * hard-coded these values, changing one would let the form accept passwords the server rejects. The
 * final authority is the Better Auth config (`emailAndPassword` in `apps/api/src/auth/index.ts`);
 * the web's inline hint and the schemas below all read this constant.
 *
 * It lives in `contracts` because it constrains request bodies, the same as `NICKNAME_LIMITS`.
 * Putting it in `domain` would require contracts to import from there, a dependency direction this
 * repo does not use.
 *
 * No composition rules (uppercase, symbols) are part of the policy. Such rules block long
 * passphrases and push people toward worse passwords.
 */
export const PASSWORD_LENGTH = { min: 8, max: 128 } as const;

/**
 * Sets a password. Valid only for accounts that have no credential yet. There is no
 * `currentPassword`: the target is an account that signed up with Google only and has no password,
 * so asking for one would make the user think they forgot something. On an account that already has
 * a password, the server rejects the request (`password_already_set`). The server, not a UI branch,
 * is the final authority.
 *
 * Nothing is trimmed, normalized, or lowercased. A password is an opaque string; if save and verify
 * applied different rules, the password just set would fail at login. Length is measured on the
 * same axis as Better Auth, so the form and the server cannot disagree.
 */
export const SetPasswordDto = z.object({
	newPassword: z.string().min(PASSWORD_LENGTH.min).max(PASSWORD_LENGTH.max),
});
export type SetPasswordDto = z.infer<typeof SetPasswordDto>;

/**
 * Disconnects a login method. It identifies the provider, not an account row ID. Better Auth's
 * `unlinkAccount` takes `account.id` (our database row ID). Returning that value to the screen
 * would spread an internal auth identifier into caches, dev tools, and error reports. There is at
 * most one row per provider per member, so the server finds it from the provider alone. There is no
 * target-member field: the target is always the requester's own account, identified from the
 * cookie.
 */
export const LoginMethodDisconnectDto = z.object({
	provider: LoginMethodProvider,
});
export type LoginMethodDisconnectDto = z.infer<typeof LoginMethodDisconnectDto>;

/**
 * One active session. It is a shadow of the session's existence, not an authentication credential.
 *
 * The key fact about this type: `id` is the session row's ID, not the session token. Better Auth's
 * `listSessions` returns full session objects that include `token`, and `revokeSession` takes that
 * token. Passing that shape to the screen would put other devices' session tokens into browser
 * memory, query caches, dev tools, and error reports, undoing the HttpOnly session cookie. So the
 * server maps each session to a row ID, and revocation takes that ID and resolves it to the token
 * on the server.
 *
 * Device name, browser, IP, and last-activity time are not included. The server stores only the raw
 * User-Agent and IP. Turning those into a label such as 'iPhone · Safari' is fragile string
 * parsing, and a wrong label would make users think a device is not theirs and revoke a healthy
 * session. Only exact timestamps are included; nothing is invented.
 */
export const AccountSessionDto = z.object({
	/** The value revocation requests refer to. Not the session token (see above). */
	id: z.string(),
	/** Whether this request came from this session. The server decides. */
	current: z.boolean(),
	createdAt: z.iso.datetime(),
	expiresAt: z.iso.datetime(),
});
export type AccountSessionDto = z.infer<typeof AccountSessionDto>;

/**
 * List and revoke share one envelope. Revoke responds with the updated list, not `{ status: true
 * }`. If the screen removed the row by hand, the list would become 'what we believe', and sessions
 * created on other devices at the same moment would never appear. Returning the server-confirmed
 * list keeps the screen from drifting out of sync.
 */
export const AccountSessionsDto = z.object({
	sessions: z.array(AccountSessionDto),
});
export type AccountSessionsDto = z.infer<typeof AccountSessionsDto>;

/**
 * No target-member field. Passing another member's session ID makes the server look only in the
 * requester's own session list. The lookup finds nothing, and the response is the current list, not
 * an error. Revocation is idempotent, and no response reveals whether an ID exists.
 */
export const SessionRevokeDto = z.object({ sessionId: z.string().min(1) });
export type SessionRevokeDto = z.infer<typeof SessionRevokeDto>;

/*
 * Passkeys are a list, not an account row.
 *
 * `LoginMethodProvider` deliberately does not include the value `passkey`. That vocabulary means
 * one provider record attached to the account, one per provider per member. An account can have
 * several passkeys, so merging them would make one list row stand for many credentials, and its
 * `linkedAt` could not be defined.
 *
 * Not exchanged here: publicKey and credentialID (cryptographic material the screen cannot use),
 * counter, deviceType, and backedUp (protocol state), transports (between authenticator and
 * browser), aaguid (the authenticator model identifier, see below), and the Better Auth user.id.
 *
 * aaguid is excluded because the plugin has a helper that derives labels such as 'iCloud Keychain'
 * or '1Password' from it. Privacy-focused platforms zero the value (Apple's default flow does), and
 * the list is not authoritative. A wrong label is worse than none: users would take their own
 * device for someone else's and delete a healthy credential.
 */

/**
 * Passkey label length policy. A passkey label is a display name, not a secret. No password-style
 * rules (composition, complexity). Only surrounding whitespace is trimmed. The upper bound is about
 * the screen, not storage: one long label would push the list wide and move its delete button off
 * screen.
 */
export const PASSKEY_NAME_LENGTH = { min: 1, max: 60 } as const;

/**
 * A passkey has three fields. `id` is an opaque reference that rename and delete point to. It is
 * not the credential ID; that value never crosses the wire. If it points at someone else's passkey,
 * the server returns 404. Ownership is checked by the library, not by this screen.
 */
export const AccountPasskeyDto = z.object({
	id: z.string(),
	/**
	 * The label the user gave. If absent, the screen shows `Passkey` and nothing more; no name is
	 * invented.
	 */
	name: z.string().nullable(),
	createdAt: z.iso.datetime(),
});
export type AccountPasskeyDto = z.infer<typeof AccountPasskeyDto>;

/**
 * Same reason as the session list: rename and delete return the server-confirmed list, so the
 * screen cannot drift from what is stored.
 */
export const AccountPasskeysDto = z.object({
	passkeys: z.array(AccountPasskeyDto),
});
export type AccountPasskeysDto = z.infer<typeof AccountPasskeysDto>;

/**
 * Trims whitespace and nothing more. Emoji and names with surrounding spaces are the user's own
 * choice. There is no target-member field; the passkey is always the requester's own.
 */
export const PasskeyRenameDto = z.object({
	id: z.string().min(1),
	name: z
		.string()
		.trim()
		.min(PASSKEY_NAME_LENGTH.min)
		.max(PASSKEY_NAME_LENGTH.max),
});
export type PasskeyRenameDto = z.infer<typeof PasskeyRenameDto>;

export const PasskeyDeleteDto = z.object({ id: z.string().min(1) });
export type PasskeyDeleteDto = z.infer<typeof PasskeyDeleteDto>;
