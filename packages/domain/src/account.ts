/**
 * Account product model: how the person signs in (login methods, email). It is kept apart from
 * Viewer (viewer.ts), which answers who the person is (`member.id`, used for authorization and
 * local data ownership). Merging them would attach the email to `/me`, which runs on every root SSR
 * load, header render and auth guard, so every route's HTML would carry the email. A value read by
 * one screen should be fetched by one query.
 *
 * The Better Auth session is not here either. It answers which device is in use, a third axis apart
 * from the future Sync device identity. Mixing all three would make 'sign out' mean different
 * deletions on different screens.
 */

/**
 * Login methods configured in this deployment only: credential, Google, Apple and Kakao. The
 * provider's own account identifier is not modeled: the screen only needs to answer 'what did I
 * sign in with'.
 */
export type LoginMethodProvider = "credential" | "google" | "apple" | "kakao";

export interface LoginMethod {
	provider: LoginMethodProvider;
	/** When this method was linked to the account (ISO 8601). */
	linkedAt: string;
}

/**
 * Private account metadata, read only by the account screen. `hasPassword` is a boolean on purpose:
 * the screen needs whether a credential exists, not the password. Hashes, verification results and
 * last-change times never come through here.
 */
export interface AccountDetails {
	email: string;
	emailVerified: boolean;
	hasPassword: boolean;
	/** Whether authenticator-app 2FA is on. If it is, password sign-in also asks for a code. */
	twoFactorEnabled: boolean;
	/**
	 * Stable order (credential, Google, Apple, Kakao). If the order changed between requests, the list
	 * would reshuffle.
	 */
	methods: LoginMethod[];
	/**
	 * When the authentication account was created (ISO 8601). Not the creator profile's join date and
	 * not the member row's creation time: the member row is created lazily on the first request, so
	 * the two can differ.
	 */
	createdAt: string;
}

/**
 * `id` is an opaque reference that revocation requests point at, not the session token. Using the
 * auth library's session object as the product model would carry its token into screen state and
 * caches (see `contracts/account-security.ts`). Device name, browser, IP and last-activity time are
 * deliberately absent: an invented device name could make a user think a healthy session belongs to
 * someone else, and they might then revoke their own session.
 */
export interface AccountSession {
	id: string;
	/** Whether this is the session viewing the screen now. The server decides. */
	current: boolean;
	createdAt: string;
	expiresAt: string;
}

/**
 * The answer to whether disconnecting is allowed, with a reason. It is not a boolean because the
 * screen must say different things: `cannot disconnect the last method`
 * clears once the user links another method, while `not linked` means the screen is
 * stale and a refresh is the fix.
 */
export type LoginMethodDisconnectCheck =
	| { allowed: true; remaining: LoginMethod[] }
	| { allowed: false; reason: "not_linked" | "last_method" };

/**
 * Whether this method can be disconnected while a sign-in method would remain. A pure rule. It is a
 * function because writing `methods.length > 1` in several places loses the reason, duplicates the
 * condition across the dialog, disabled button and server check, and miscounts. The count must be
 * of usable methods, not account rows: Better Auth can store a credential row without a password,
 * and counting it would allow disconnecting the last usable method. This function counts only what
 * the list holds. The server projection (`toLoginMethods` in
 * `apps/api/src/services/account/index.ts`) must keep only usable methods. It drops providers
 * outside the contract vocabulary, so this check errs stricter than Better Auth's `accounts.length
 * === 1`. That mistake blocks an action rather than locking the account. Neither the disabled
 * button nor this function is the authority. The server's disconnect path enforces the same rule,
 * with Better Auth's own guard behind it.
 */
export function canDisconnectLoginMethod(input: {
	methods: readonly LoginMethod[];
	target: LoginMethodProvider;
}): LoginMethodDisconnectCheck {
	const linked = input.methods.some(
		(method) => method.provider === input.target,
	);
	if (!linked) return { allowed: false, reason: "not_linked" };

	const remaining = input.methods.filter(
		(method) => method.provider !== input.target,
	);
	/**
	 * Blocks when nothing would remain. This is the slice's invariant: a successful security operation
	 * never leaves the account with zero login methods.
	 */
	if (remaining.length === 0) return { allowed: false, reason: "last_method" };
	return { allowed: true, remaining };
}

/*
 * Passkeys are a list of credentials per account, so `LoginMethodProvider` has no passkey value on
 * purpose. That vocabulary names one provider record per member, while a person registers passkeys
 * on several devices. Collapsing them would make `linkedAt` meaningless on a row and leave delete
 * with no clear target. No key material is modeled: public keys, credential ids, counters and
 * transports are protocol details the screen cannot use, as with tokens in the session model.
 */

export interface AccountPasskey {
	/** Opaque reference that rename and delete target. Not the credential id. */
	id: string;
	/**
	 * User-given label, possibly absent; then the screen shows only `Passkey`. Device names are
	 * not invented: an authenticator model id (AAGUID) could yield labels like 'iCloud Keychain', but
	 * privacy-preserving platforms zero that value and the list is not authoritative. Deleting on a
	 * wrong label cannot be undone.
	 */
	name: string | null;
	createdAt: string;
}

/**
 * Resend cooldown for auth emails, in seconds. It only prevents an accidental second click. Abuse
 * protection is the server's rate limiter; a disabled button is not a defense. 60 seconds is long
 * enough to wait for mail to arrive. Both apps must read the same value, since a different duration
 * would make the same action behave differently per device.
 */
export const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Pure function that returns the seconds remaining, where 0 means the email can be sent. The
 * current time is a parameter so the rule can be checked without rendering. A never-sent state
 * (`null`) returns 0. The cooldown is not persisted on the device: it is display state that resets
 * when the screen reopens, which is correct, because the only fact the client can trust is 'sent
 * just now in this run'.
 */
export function resendCooldownRemaining(
	lastSentAt: number | null,
	now: number,
): number {
	if (lastSentAt === null) return 0;
	const elapsed = Math.floor((now - lastSentAt) / 1000);
	/**
	 * A non-finite or negative elapsed time (clock moved back, or a future timestamp) counts as a full
	 * cooldown, rather than showing a negative countdown.
	 */
	if (!Number.isFinite(elapsed) || elapsed < 0) return RESEND_COOLDOWN_SECONDS;
	return Math.max(0, RESEND_COOLDOWN_SECONDS - elapsed);
}
