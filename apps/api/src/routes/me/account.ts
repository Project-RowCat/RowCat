import type {
	AccountDetailsDto,
	AccountPasskeysDto,
	AccountSessionsDto,
} from "@rowcat/contracts";
import {
	LoginMethodDisconnectDto,
	PasskeyDeleteDto,
	PasskeyRenameDto,
	SessionRevokeDto,
	SetPasswordDto,
} from "@rowcat/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { invalidInput } from "../../lib/errors.ts";
import { requireViewer } from "../../lib/gates.ts";
import { getViewer } from "../../middleware/viewer.ts";
import {
	disconnectLoginMethod,
	listAccountSessions,
	readAccountDetails,
	revokeAccountSession,
	revokeOtherAccountSessions,
	setAccountPassword,
} from "../../services/account/index.ts";
import {
	deleteAccountPasskey,
	listAccountPasskeys,
	renameAccountPasskey,
} from "../../services/account/passkeys.ts";

/**
 * `/v2/me/account/*`.
 *
 * Not wrapped here: change-password, sign-out, delete-user and link-social stay on Better Auth's
 * own `/v2/auth/*` endpoints. Wrapping them would add a second implementation of identity
 * verification and would bring passwords into `@rowcat/contracts` and `@rowcat/sdk`.
 *
 * Wrapped here, each for a specific reason:
 *
 * ```text
 * set password    Better Auth's setPassword is serverOnly - no HTTP surface
 * unlink method   unlinkAccount takes an account row id, which must not reach the browser
 * list sessions   listSessions returns session tokens
 * revoke session  revokeSession takes that token
 * list passkeys   the response is the raw credential row (publicKey, credentialID)
 * delete passkey  the only place the server can observe success (security notice)
 * rename passkey  shares the same envelope as the two above
 * ```
 *
 * Passkey registration is not here: the WebAuthn ceremony runs between the browser and the plugin's
 * endpoints (the challenge cookie is bound to that round trip). The registration notice is sent by
 * the auth layer's response hook (`auth/index.ts`).
 *
 * Every gate is `requireViewer`, not `requireActiveViewer`: these operations lock the member's own
 * account rather than write outward, and a suspended or blocked member needs them most.
 *
 * Better Auth adds its own door on top: listing sessions and unlinking require a fresh session (24h
 * by default), and setting a password or revoking a session requires an authoritative session that
 * bypasses the cookie cache. We do not turn that off because the same `freshAge` guards identity
 * verification for account deletion.
 *
 * No path, query, body or header names a target. Session revocation takes one opaque session
 * reference, resolved back to a token only within the current session's own list
 * (`services/account/index.ts`).
 */
export const meAccount = new Hono<AppEnv>()
	/**
	 * Email, login methods and creation date. Kept off `/me` because that is the hottest read (root
	 * SSR, header, auth guards) and its values would reach every route's HTML. The service receives
	 * only headers, so no request can name which account to read.
	 */
	.get("/", async (c) => {
		requireViewer(await getViewer(c));
		const body: AccountDetailsDto = await readAccountDetails(c.req.raw.headers);
		return c.json(body);
	})

	/**
	 * Sets a password, valid only for an account with no credential method yet. Change goes through
	 * `/v2/auth/change-password` because it verifies the current password; this account has none, so
	 * the library exposes setPassword server-only. The server rejects an account that already has one.
	 *
	 * The request body is never logged: this route has no diagnostic logging on purpose
	 * (`lib/no-secret-logging.test.ts` scans this file).
	 */
	.post("/password", async (c) => {
		requireViewer(await getViewer(c));
		const parsed = SetPasswordDto.safeParse(
			await c.req.json().catch(() => null),
		);
		/**
		 * Fixed message instead of the failure detail. Today `invalidInput` is safe because zod carries
		 * no value on length violations, but a future `.refine()` could mix input into the generated
		 * sentence.
		 */
		if (!parsed.success)
			throw invalidInput({
				issues: [
					{
						path: ["newPassword"],
						message: `Passwords must be 8 to 128 characters.`,
					},
				],
			});
		const body: AccountDetailsDto = await setAccountPassword(
			c.req.raw.headers,
			parsed.data.newPassword,
		);
		// Account state is in the response; keep it out of caches.
		c.header("Cache-Control", "private, no-store");
		return c.json(body);
	})

	/**
	 * Unlinks a login method. The request carries a provider name only; the account row id Better Auth
	 * needs is looked up in the current session's account list, so a request pointing at someone
	 * else's row is inexpressible.
	 *
	 * The last method is never unlinked: `canDisconnectLoginMethod` (the same pure function the screen
	 * uses) decides, this route is the final authority, and the library's own guard sits behind it.
	 */
	.post("/login-methods/disconnect", async (c) => {
		requireViewer(await getViewer(c));
		const parsed = LoginMethodDisconnectDto.safeParse(
			await c.req.json().catch(() => null),
		);
		if (!parsed.success) throw invalidInput(parsed.error);
		const body: AccountDetailsDto = await disconnectLoginMethod(
			c.req.raw.headers,
			parsed.data.provider,
		);
		c.header("Cache-Control", "private, no-store");
		return c.json(body);
	})

	/**
	 * Active sessions. No session token in the response (`AccountSessionDto` is an allowlist): only an
	 * opaque reference for revocation and two timestamps; no invented device name, browser or IP.
	 */
	.get("/sessions", async (c) => {
		requireViewer(await getViewer(c));
		const body: AccountSessionsDto = {
			sessions: await listAccountSessions(c.req.raw.headers),
		};
		/** Private list revealing other devices; `no-store` keeps it out of back-button snapshots and proxy caches. */
		c.header("Cache-Control", "private, no-store");
		return c.json(body);
	})

	/**
	 * Revokes one session, idempotently. An already-revoked, expired or foreign session all get the
	 * same result, the current list; distinguishing them would turn the response into an existence
	 * probe. Only the session in use is refused: that is sign-out, which has its own path.
	 */
	.post("/sessions/revoke", async (c) => {
		requireViewer(await getViewer(c));
		const parsed = SessionRevokeDto.safeParse(
			await c.req.json().catch(() => null),
		);
		if (!parsed.success) throw invalidInput(parsed.error);
		const body: AccountSessionsDto = {
			sessions: await revokeAccountSession(
				c.req.raw.headers,
				parsed.data.sessionId,
			),
		};
		c.header("Cache-Control", "private, no-store");
		return c.json(body);
	})

	/**
	 * Revokes every session except the current one. No body: letting the client choose which to keep
	 * would become a parameter that spares someone else's session or kills its own.
	 */
	.post("/sessions/revoke-others", async (c) => {
		requireViewer(await getViewer(c));
		const body: AccountSessionsDto = {
			sessions: await revokeOtherAccountSessions(c.req.raw.headers),
		};
		c.header("Cache-Control", "private, no-store");
		return c.json(body);
	})

	/**
	 * Registered passkeys, as a sanitized projection (`AccountPasskeyDto` is an allowlist): no public
	 * key, credential id, counter, transports or AAGUID, which a direct call to the plugin's list
	 * endpoint would land in the query cache, devtools and error reporters.
	 */
	.get("/passkeys", async (c) => {
		requireViewer(await getViewer(c));
		const body: AccountPasskeysDto = {
			passkeys: await listAccountPasskeys(c.req.raw.headers),
		};
		/** Private list of sign-in devices; `no-store`. */
		c.header("Cache-Control", "private, no-store");
		return c.json(body);
	})

	/**
	 * Renames a passkey (display label only). Ownership is not re-checked here: the library puts
	 * `requireResourceOwnership` behind its session middleware, and a second implementation of the
	 * same rule means the looser one eventually becomes the real policy.
	 */
	.post("/passkeys/rename", async (c) => {
		requireViewer(await getViewer(c));
		const parsed = PasskeyRenameDto.safeParse(
			await c.req.json().catch(() => null),
		);
		if (!parsed.success) throw invalidInput(parsed.error);
		const body: AccountPasskeysDto = {
			passkeys: await renameAccountPasskey(
				c.req.raw.headers,
				parsed.data.id,
				parsed.data.name,
			),
		};
		c.header("Cache-Control", "private, no-store");
		return c.json(body);
	})

	/**
	 * Deletes a passkey, irreversibly, so the service sends a security notice after success. A missing
	 * id and someone else's id are the same 404, decided by the library, so the response is not an
	 * existence probe.
	 */
	.post("/passkeys/delete", async (c) => {
		requireViewer(await getViewer(c));
		const parsed = PasskeyDeleteDto.safeParse(
			await c.req.json().catch(() => null),
		);
		if (!parsed.success) throw invalidInput(parsed.error);
		const body: AccountPasskeysDto = {
			passkeys: await deleteAccountPasskey(c.req.raw.headers, parsed.data.id),
		};
		c.header("Cache-Control", "private, no-store");
		return c.json(body);
	});
