import type {
	AccountDetailsDto,
	AccountSessionDto,
	LoginMethodDto,
} from "@rowcat/contracts";
import { PASSWORD_LENGTH } from "@rowcat/contracts";
import { canDisconnectLoginMethod } from "@rowcat/domain";
import { auth } from "../../auth/index.ts";
import { badRequest, forbidden, unauthorized } from "../../lib/errors.ts";

/**
 * Account reads go through Better Auth, not drizzle. The user/account tables are the adapter's
 * implementation detail (camelCase columns, silent changes on upgrade), so a direct join would turn
 * such a change into a runtime malfunction. How providers are counted is also the library's rule; a
 * copy would diverge when linking rules change.
 *
 * Identity comes only from the request. Functions take headers and no userId or email: such an
 * argument would let one caller pass a client value and read someone else's account.
 */

/**
 * providerId to contract vocabulary, for the four configured providers (`auth/index.ts`). The key
 * order is also the display order (sorting below uses it).
 *
 * The table ignores deployment settings on purpose. It answers which rows are attached to this
 * account; switching a provider off does not remove an existing link, and filtering here would hide
 * a real login method and break last-method detection (an uncounted method lets the last remaining
 * one be unlinked).
 *
 * Every entry is an identity mapping (Kakao is also `kakao`), but the table stays: without it
 * `providerId` would reach the contract unvalidated and unknown values would leak into responses
 * (item 1 below).
 */
const LOGIN_METHOD_BY_PROVIDER_ID: Record<string, LoginMethodDto["provider"]> =
	{
		credential: "credential",
		google: "google",
		apple: "apple",
		kakao: "kakao",
	};

/** Server-decided display order, so the list does not reshuffle per request. */
const LOGIN_METHOD_ORDER = Object.values(LOGIN_METHOD_BY_PROVIDER_ID);

/**
 * Account rows to login methods.
 *
 * 1. Unknown providers are dropped. That is deployment drift, and a 500 for it would block the
 *    account screen (no email check, no sign-out). The list is read-only guidance, so a missing
 *    entry breaks nothing; the warning log keeps the need to widen the vocabulary visible.
 * 2. The same method collapses to one entry (linking history can produce two rows), keeping the
 *    earlier time since users want to know since when they have used it.
 * 3. Sorted, because DB order is not guaranteed.
 */
function toLoginMethods(
	accounts: { providerId: string; createdAt: Date }[],
): LoginMethodDto[] {
	const earliest = new Map<LoginMethodDto["provider"], Date>();
	for (const row of accounts) {
		const provider = LOGIN_METHOD_BY_PROVIDER_ID[row.providerId];
		if (!provider) {
			console.warn(
				`[account] dropped a sign-in method not in the contract from the response: providerId=${row.providerId}`,
			);
			continue;
		}
		const known = earliest.get(provider);
		if (!known || row.createdAt < known) earliest.set(provider, row.createdAt);
	}
	return LOGIN_METHOD_ORDER.flatMap((provider) => {
		const linkedAt = earliest.get(provider);
		return linkedAt ? [{ provider, linkedAt: linkedAt.toISOString() }] : [];
	});
}

/**
 * The caller's account details. No session is a 401, unlike `/me` (null for guests, where "not
 * signed in" is part of the normal public-gallery path); only signed-in people exist on this
 * screen.
 *
 * Member status (suspended, blocked) is not checked: this reads one's own info, and a restricted
 * account most needs to see its state and sign out.
 */
export async function readAccountDetails(
	headers: Headers,
): Promise<AccountDetailsDto> {
	/**
	 * Both calls use the same headers. Reading the session first and passing its userId would make
	 * "whose account" an argument to be policed by convention; passing headers makes that mistake
	 * inexpressible.
	 *
	 * The session is settled first, not in parallel: the list call also throws without a session, so
	 * running both would need that failure swallowed (else guests get 500 instead of 401), and the
	 * swallow would also eat real failures for signed-in requests, drawing "an account with no login
	 * methods" as fact.
	 */
	const session = await auth.api.getSession({ headers });
	if (!session?.user) throw unauthorized();
	const accounts = await auth.api.listUserAccounts({ headers });

	const methods = toLoginMethods(accounts);
	return {
		email: session.user.email,
		emailVerified: session.user.emailVerified,
		/**
		 * A credential method means a password exists. The hash is neither read nor verified; the screen
		 * needs the capability only.
		 *
		 * Deliberately reads the raw rows, not the filtered `methods`: the capability check must stay
		 * accurate even if vocabulary drift dropped a method from the list.
		 */
		hasPassword: accounts.some((row) => row.providerId === "credential"),
		/** Copied from the plugin's `user` field. It turns true only after the first authenticator code, so "started setup" and "on" never mix. */
		twoFactorEnabled: session.user.twoFactorEnabled === true,
		methods,
		createdAt: session.user.createdAt.toISOString(),
	};
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Account security: Better Auth's operations go through Better Auth.
 *
 * The reason reads do not use drizzle is stronger for writes. Hand-made password hashes or deleted
 * account/session rows would have to imitate every rule the library attaches (hash parameters, cookie
 * refresh, fresh-session requirement), and the one missed is an account-takeover path.
 *
 * So every function below forwards the session headers to `auth.api`. We add only three things:
 *
 * 1. product rule: the last login method cannot be unlinked (pure check in @rowcat/domain)
 * 2. projection: session tokens become opaque references (tokens never cross the line)
 * 3. error vocabulary: library codes to stable RowCat codes
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The part of Better Auth's thrown `APIError` we read. The library type is not imported; structural
 * typing fits the real value and survives the library moving the class.
 */
interface AuthApiFailure {
	body?: { code?: unknown };
}

/** The library error's code, or undefined. The message text is never read. */
function authErrorCode(error: unknown): string | undefined {
	const code = (error as AuthApiFailure | null)?.body?.code;
	return typeof code === "string" ? code : undefined;
}

/**
 * Library error to RowCat error, reading the code and never the message. Library messages are
 * English and change silently on upgrade, and some describe internal state ("Session is not fresh")
 * without telling the user what to do.
 *
 * Unknown codes are rethrown as-is: generalizing here would draw a retry sentence for new failure
 * kinds and they would never get a name.
 */
function translateAuthError(error: unknown): never {
	switch (authErrorCode(error)) {
		/**
		 * The session is valid but the login is old (`freshAge`, 24h by default). Despite the name this
		 * is not expiry; the user must sign in again, not wait, so the code says so (account deletion
		 * made the same call).
		 */
		case "SESSION_NOT_FRESH":
		case "SESSION_EXPIRED":
			throw forbidden(
				"For security, a recent sign-in is required. Please sign in again and try.",
				"recent_login_required",
			);
		case "UNAUTHORIZED":
			throw unauthorized();
		case "PASSWORD_TOO_SHORT":
			throw badRequest(
				`Passwords must be at least ${PASSWORD_LENGTH.min} characters.`,
				"password_too_short",
			);
		case "PASSWORD_TOO_LONG":
			throw badRequest(
				`Passwords must be at most ${PASSWORD_LENGTH.max} characters.`,
				"password_too_long",
			);
		/**
		 * A set-password request on an account that already has one: the screen is stale (another device
		 * set it). Point to the change form rather than silently converting, which would need the current
		 * password this request does not carry.
		 */
		case "PASSWORD_ALREADY_SET":
			throw badRequest(
				"This account already has a password. Refresh the screen and use Change password instead.",
				"password_already_set",
			);
		case "FAILED_TO_UNLINK_LAST_ACCOUNT":
			throw badRequest(
				"You can't disconnect your last sign-in method.",
				"last_login_method",
			);
		case "ACCOUNT_NOT_FOUND":
			throw badRequest(
				"That sign-in method isn't connected.",
				"login_method_not_linked",
			);
		default:
			throw error;
	}
}

/** Wraps one `auth.api` call in our error vocabulary. */
async function callAuth<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		translateAuthError(error);
	}
}

/**
 * Set a password on an account with no credential method.
 *
 * It exists because Better Auth 1.7.0's `setPassword` is `createAuthEndpoint.serverOnly`, with no
 * HTTP surface; our route forwards the session headers, which is the path the library intends, not
 * a workaround that builds a hash or writes the account row.
 *
 * The password is not tidied: the contract only measures length (no `.trim()`), and a rule that
 * differs between storing and verifying would break signing in with the new password. Nothing is
 * logged; this function's argument is plaintext. The existing-password check is left to the library
 * (`PASSWORD_ALREADY_SET`) because a check before the write leaves a window for another device to
 * set one; the decision belongs where the write is.
 */
export async function setAccountPassword(
	headers: Headers,
	newPassword: string,
): Promise<AccountDetailsDto> {
	try {
		await callAuth(() =>
			auth.api.setPassword({ headers, body: { newPassword } }),
		);
	} catch (error) {
		/**
		 * A concurrent second request lands here. The library reads whether a credential row exists and
		 * creates it otherwise; a request creating it in that window makes the later commit hit the
		 * unique index (`account_issuer_idx`). That failure has no library vocabulary, passes
		 * `translateAuthError` and becomes a 500.
		 *
		 * State is safe (one row, the winner's password lives), but the answer is wrong: 500 says the
		 * server broke while the truth is "a password is already set", which already has a name here.
		 *
		 * The driver error code (`23505`) is not read; it is an adapter/DB detail and the branch would
		 * die silently if storage changed. Instead the current state is re-read: failed and a credential
		 * exists means someone set it first. Otherwise the failure is unknown and rethrown (folding it
		 * into a known reason would deny it a name).
		 */
		const accounts = await auth.api
			.listUserAccounts({ headers })
			.catch(() => null);
		if (accounts?.some((row) => row.providerId === "credential"))
			throw badRequest(
				"This account already has a password. Refresh the screen and use Change password instead.",
				"password_already_set",
			);
		throw error;
	}
	// Returns the account as it is after the change so the screen does not guess `hasPassword`.
	return readAccountDetails(headers);
}

/**
 * Unlink a login method, where the rule that an account cannot be locked out stands.
 *
 * The check is ours because Better Auth's guard counts `accounts.length === 1`, account rows, while
 * our projection drops providers outside the contract vocabulary. The two can disagree, and then
 * the library passes and we block, which errs in the safe, narrower direction.
 *
 * The same pure function the screen uses decides (`canDisconnectLoginMethod`); a separately written
 * server condition would make the confirm dialog's "what remains" differ from what the server
 * counted, surfacing after the user pressed confirm.
 *
 * The target row id never leaves this function: the client sends a provider name, mapped to a row
 * id only within this session's own account list, so a request carrying someone else's row id is
 * inexpressible.
 */
export async function disconnectLoginMethod(
	headers: Headers,
	provider: LoginMethodDto["provider"],
): Promise<AccountDetailsDto> {
	const session = await auth.api.getSession({ headers });
	if (!session?.user) throw unauthorized();
	const accounts = await callAuth(() => auth.api.listUserAccounts({ headers }));

	const check = canDisconnectLoginMethod({
		methods: toLoginMethods(accounts),
		target: provider,
	});
	if (!check.allowed)
		throw check.reason === "last_method"
			? badRequest(
					"You can't disconnect your last sign-in method.",
					"last_login_method",
				)
			: badRequest(
					"That sign-in method isn't connected.",
					"login_method_not_linked",
				);

	/**
	 * Several rows can share a provider (linking history). All are unlinked: removing one would leave
	 * the method gone on screen yet still usable to sign in, which the user's action did not intend.
	 */
	for (const row of accounts.filter((row) => row.providerId === provider))
		await callAuth(() =>
			auth.api.unlinkAccount({ headers, body: { accountId: row.id } }),
		);

	return readAccountDetails(headers);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Sessions: list and revoke.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The fields we read from the library's session object. `token` is absent on purpose: the real
 * object has it (the library's `revokeSession` takes it), and this type declares it unread.
 */
interface AuthSessionRow {
	id: string;
	createdAt: Date;
	expiresAt: Date;
}

/**
 * Auth session to contract vocabulary, the place the token stops. It does not pick fields out
 * (`const { token, ...rest } = row`): that blocks only fields known today and would leak any field
 * the library adds, the same reason the public profile projection is an allowlist.
 */
function toAccountSession(
	row: AuthSessionRow,
	currentSessionId: string | undefined,
): AccountSessionDto {
	return {
		id: row.id,
		current: row.id === currentSessionId,
		createdAt: new Date(row.createdAt).toISOString(),
		expiresAt: new Date(row.expiresAt).toISOString(),
	};
}

/**
 * Stable order: current session first, then newest login. DB order is not guaranteed, and a
 * reshuffling list moves the revoke button to another row, so the user revokes a different session
 * than intended. The id is the last axis because two sessions created in the same millisecond would
 * otherwise swap per render.
 */
function sortAccountSessions(
	sessions: AccountSessionDto[],
): AccountSessionDto[] {
	return sessions.sort((a, b) => {
		if (a.current !== b.current) return a.current ? -1 : 1;
		if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
		return a.id < b.id ? -1 : 1;
	});
}

/**
 * Live sessions. The library's `listSessions` requires a fresh session (`freshSessionMiddleware`);
 * for someone logged in a long time that is a 403, which is a fact ("sign in again to see this"),
 * not an error: `translateAuthError` maps it to `recent_login_required`. The requirement is not
 * turned off because the same `freshAge` guards identity verification for account deletion.
 */
export async function listAccountSessions(
	headers: Headers,
): Promise<AccountSessionDto[]> {
	const session = await auth.api.getSession({ headers });
	if (!session?.user) throw unauthorized();
	const rows = await callAuth(() => auth.api.listSessions({ headers }));
	return sortAccountSessions(
		rows.map((row) => toAccountSession(row, session.session?.id)),
	);
}

/**
 * Revoke one session; the opaque reference is traced back to a token only inside the server.
 *
 * The client sends a row id, resolved to a token only within this session's own list, so someone
 * else's session id is not found. Ownership is in the predicate rather than a separate check.
 *
 * Not finding it is deliberately not an error: already revoked, expired and someone else's all get
 * the same result (the current list). Distinguishing them would make the response an existence
 * detector and make a retry that lost its response look like failure.
 *
 * The current session is not revoked here. That is sign-out, which has its own path (cookie cleanup
 * and local cache reset); allowing it here lets a user kill their own screen from the "clean up
 * other devices" list with no explanation.
 */
export async function revokeAccountSession(
	headers: Headers,
	sessionId: string,
): Promise<AccountSessionDto[]> {
	const session = await auth.api.getSession({ headers });
	if (!session?.user) throw unauthorized();

	/**
	 * This lookup resolves the opaque reference to a token and passes the fresh-session gate. Both
	 * happen before the revoke, so a rejected request changes nothing (the same ordering revoke-all
	 * keeps).
	 */
	const rows = await callAuth(() => auth.api.listSessions({ headers }));
	const target = rows.find((row) => row.id === sessionId);

	if (target && target.id !== session.session?.id)
		await callAuth(() =>
			auth.api.revokeSession({ headers, body: { token: target.token } }),
		);
	else if (target)
		throw badRequest(
			"End the session you're using now by signing out.",
			"current_session_revoke",
		);

	return listAccountSessions(headers);
}

/**
 * Revoke everything but the current session. The library's `revokeOtherSessions` handles keeping
 * the current one alive, cookie refresh included; imitating it in SQL would eventually drop that
 * piece and sign the user out of their own session.
 */
export async function revokeOtherAccountSessions(
	headers: Headers,
): Promise<AccountSessionDto[]> {
	const session = await auth.api.getSession({ headers });
	if (!session?.user) throw unauthorized();

	/**
	 * Read before write; that order is the whole function. Listing requires a fresh session
	 * (`freshSessionMiddleware`) but revoking does not, a library asymmetry. Reversed, a
	 * long-logged-in user's request would revoke for real and return 403: the screen draws failure
	 * while other devices are already cut off, irreversibly.
	 *
	 * So the fresh gate is passed first, and a throw there changed nothing (fail-closed). The result
	 * is discarded; passing the gate is the point.
	 */
	await callAuth(() => auth.api.listSessions({ headers }));
	await callAuth(() => auth.api.revokeOtherSessions({ headers }));
	return listAccountSessions(headers);
}
