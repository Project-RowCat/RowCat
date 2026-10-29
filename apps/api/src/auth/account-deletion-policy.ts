import { APIError, getSessionFromCtx } from "better-auth/api";

/**
 * An account with a password confirms deletion with it. Our rule standing in front of the library's
 * `/delete-user`, whose own check is narrower than this repository said it was:
 *
 * ```text
 * the library        a password is checked only when one is sent; with none, any session under 24h passes
 * this repository    a password account must send it; a social-only account has none, so recent login decides
 * ```
 *
 * The gap is one stolen fresh cookie: without this rule it deletes an account whose owner set a
 * password precisely so that holding a session would not be enough. Both apps already send the
 * password whenever the account has one (`use-account-deletion.ts`, `account-deletion-auth.ts`), so
 * only a request that skipped the screen meets this refusal.
 *
 * The refusal uses the library's own `INVALID_PASSWORD`, the code both apps already map to "the
 * password is wrong" — for a request that sent none, that sentence is close enough and needs no new
 * vocabulary on either screen.
 */
export async function enforceAccountDeletionPolicy(
	// biome-ignore lint/suspicious/noExplicitAny: passes Better Auth's middleware context type through as-is.
	ctx: { path?: string; body?: unknown } & any,
): Promise<void> {
	if (ctx.path !== "/delete-user") return;
	if (passwordSent(ctx.body)) return;
	const session = await getSessionFromCtx(ctx);
	/** Without a session the library answers 401; do not preempt its vocabulary. */
	if (!session?.user) return;
	const account = await ctx.context.internalAdapter.findCredentialAccount(
		session.user.id,
	);
	if (account?.password)
		throw APIError.from("BAD_REQUEST", {
			message: "Enter your password to delete this account",
			code: "INVALID_PASSWORD",
		});
}

const passwordSent = (body: unknown): boolean => {
	const password = (body as { password?: unknown } | null)?.password;
	return typeof password === "string" && password.length > 0;
};
