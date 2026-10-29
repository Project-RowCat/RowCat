import { authClient } from "./auth.ts";
import type { AuthErrorLike } from "./auth-error.ts";

/**
 * The only place that calls Better Auth directly for account deletion. It is a neighbour of
 * `account-security-auth.ts` and follows the same boundary rules.
 *
 * ## The entry is one endpoint of the auth layer
 *
 * `POST /v2/auth/delete-user`. The reason no RowCat route such as `/v2/me/delete` exists is stated
 * in the server config (`apps/api/src/auth/index.ts`): deletion removes the auth identity, and to
 * keep a password field out of our contracts (`@rowcat/contracts`, `@rowcat/sdk`) it reuses the
 * auth layer's identity check (password, recent login). The server's `beforeDelete` hook removes
 * product data, sync ciphertext and the auth account row in **one transaction**, so success of this
 * call confirms the account is gone from the server.
 *
 * ## The password does not leave this file
 *
 * It is taken as an argument and only sent in the request. It is not trimmed, and it is not stored
 * in the query cache, SQLite, SecureStore or a failure object; the failure shape we build has only
 * `code` and `status`.
 *
 * ## A failure with no response is an **empty object** — and that is special for this operation
 *
 * The Better Auth client resolves a failure that got a response as `{ error }`, and throws only
 * when transport itself failed. Folding the thrown case into an empty object follows the same
 * convention as the security boundary, but here it means something else: **the server may already
 * have deleted the account and only the response was lost.** So the caller must report that outcome
 * as "not confirmed" rather than "failed, press again"
 * (`features/account/delete-account-error.ts`), and must not start local cleanup. Cleanup starts
 * only on explicit success (`null`).
 */
export function requestAccountDeletion(
	password?: string,
): Promise<AuthErrorLike | null> {
	return authClient
		.deleteUser(password ? { password } : {})
		.then(
			(result: { error?: unknown } | null) =>
				(result?.error as AuthErrorLike | undefined) ?? null,
		)
		.catch((): AuthErrorLike => ({}));
}
