import { forbidden, unauthorized } from "../lib/errors.ts";
import { auth } from "./index.ts";

/**
 * The row id of the auth session behind this request.
 *
 * `viewer.ts` answers *who*; this answers *which session*. Only push registration binds to a
 * session (`db/tables/push.ts` header), so the value is not put on `Viewer` — there it would pass
 * through every route and eventually become a basis for authorization, which must stay the resolved
 * member.
 *
 * Returns `session.id` (the primary key), never `session.token`: the token is itself account access
 * and does not leave the server (the account screen's session list made the same call).
 */
export async function resolveSessionId(
	headers: Headers,
): Promise<string | null> {
	const session = await auth.api.getSession({ headers });
	return session?.session?.id ?? null;
}

/**
 * Same value as Better Auth's `freshAge` (24 hours). The library enforces it only on its own
 * endpoints (session revoke, method unlink, account deletion); if ours used a different value, some
 * operations would demand a re-login and others not, with no way to explain the difference.
 */
const SESSION_FRESH_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Step-up before irreversible operations: rejects a valid session created more than a day ago,
 * which narrows what a long-lived stolen cookie can do. Uses the account screen's code
 * (`recent_login_required`) — the remedy is to sign in again, not to wait.
 */
export async function requireFreshSession(
	headers: Headers,
	now: Date = new Date(),
): Promise<string> {
	const session = await auth.api.getSession({ headers });
	const current = session?.session;
	if (!current) throw unauthorized();
	const createdAt = new Date(current.createdAt).getTime();
	if (
		!Number.isFinite(createdAt) ||
		now.getTime() - createdAt > SESSION_FRESH_AGE_MS
	)
		throw forbidden(
			"For security, a recent sign-in is required. Please sign in again and try.",
			"recent_login_required",
		);
	return current.id;
}
