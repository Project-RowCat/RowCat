import { LOCAL_SIGN_IN_AUTH_PATH } from "@rowcat/contracts";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { readLocalOwner } from "../services/setup/index.ts";

/**
 * `POST /v2/auth/local-sign-in` — a session for the deployment's local owner, with no password.
 *
 * A Better Auth endpoint rather than our own route because the session is the library's: creating it
 * through `internalAdapter` and setting it with `setSessionCookie` is the path the library's own
 * password-less sign-ins take (its anonymous plugin does exactly this), so the cookie's name, signature
 * and attributes cannot drift from what `getSession` reads.
 *
 * **Who may call it is not decided here.** This handler sees a `Request`, not a socket, so it cannot
 * tell whether the caller is on this computer; `app.ts` refuses the path before the library runs
 * unless `lib/local-request.ts` says so. What this decides is the other half: whether there is a
 * local owner at all. Without one, 404 — the same answer the edge gives, so the two refusals do not
 * tell a caller which one it hit.
 *
 * It does not create the owner (that is the setup claim, once) and it takes no body: the account it
 * signs into is fixed by the setup row, never named by the request.
 */
export const localSignInPlugin = () =>
	({
		id: "rowcat-local-sign-in",
		endpoints: {
			localSignIn: createAuthEndpoint(
				LOCAL_SIGN_IN_AUTH_PATH,
				{ method: "POST" },
				async (ctx) => {
					const owner = await readLocalOwner();
					if (!owner) throw new APIError("NOT_FOUND");
					const user = await ctx.context.internalAdapter.findUserById(
						owner.userId,
					);
					if (!user) throw new APIError("NOT_FOUND");
					const session = await ctx.context.internalAdapter.createSession(
						user.id,
					);
					if (!session) throw new APIError("INTERNAL_SERVER_ERROR");
					await setSessionCookie(ctx, { session, user });
					return ctx.json({ ok: true });
				},
			),
		},
	}) satisfies BetterAuthPlugin;
