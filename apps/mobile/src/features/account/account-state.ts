import type { SessionPhase } from "../../lib/session-state.ts";

/**
 * Pure rule deciding what the account screen draws. Same role and reason as
 * `notifications-state.ts`: stacked `if`s in a component cannot be order-checked without rendering,
 * and wrong order is silent.
 *
 * - Drawing the guest prompt while `booting` makes a signed-in user think the session vanished.
 * - Folding `unavailable` into guest invites someone who never signed out to sign in.
 * - Placing paused after loading shows offline users a placeholder that never ends.
 * - Drawing a failure as an empty value yields "email: -"; failure is unknown, not an empty
 *   account.
 *
 * The screen waits on identity only (`session.phase`), not SQLite: account is server-owned private
 * state, and `useMobileAppPhase` (session + SQLite) would kill even a nickname change on a device
 * whose store will not open. Changing account settings never changes `Viewer.id`, so the local
 * database lifetime is unrelated.
 */

export type AccountScreenState =
	/** Identity unknown yet: neutral wait, never flash the guest prompt. */
	| { kind: "booting" }
	| { kind: "guest" }
	/** The session cannot be confirmed: not a guest, so no sign-in button. */
	| { kind: "unavailable" }
	/** Member confirmed; restricted accounts land here too. */
	| { kind: "ready" };

export function resolveAccountScreenState(
	phase: SessionPhase,
): AccountScreenState {
	if (phase === "booting") return { kind: "booting" };
	if (phase === "guest") return { kind: "guest" };
	// Do not fold `unavailable` into guest: the stored session is intact and we merely could not ask.
	// Offering sign-in there tells a signed-in person they were signed out.
	if (phase === "unavailable") return { kind: "unavailable" };
	return { kind: "ready" };
}

/** Only the axes read from the `/me/account` query, so it can be tested without the library. */
export interface AccountDetailsQueryView {
	/** Retries stopped because the query judged there is no network (`fetchStatus: "paused"`). */
	isPaused: boolean;
	isError: boolean;
	isPending: boolean;
	hasData: boolean;
}

export type AccountDetailsPanelState =
	| "offline"
	| "error"
	| "loading"
	| "ready";

export interface AccountDetailsPanelView {
	state: AccountDetailsPanelState;
	/**
	 * A value is drawn but the last refresh failed or paused: keep the value and add only a staleness
	 * note and `Try again`. A stale value is never drawn as current.
	 */
	retryable: boolean;
}

/**
 * Query state -> what to draw, in order: held value, paused, failed, loading.
 *
 * A failure here ends inside this section: profile and content display read other authorities
 * (viewer, public profile) and must keep working when `/me/account` is down. The list queries
 * (passkeys, sessions) have their own decision in `security-state.ts`, which adds a `recent_login`
 * branch.
 */
export function accountDetailsPanelView(
	q: AccountDetailsQueryView,
): AccountDetailsPanelView {
	if (q.hasData) return { state: "ready", retryable: q.isError || q.isPaused };
	// Paused before failed: a paused query is still `isPending`, so after it loading never ends.
	if (q.isPaused) return { state: "offline", retryable: true };
	if (q.isError) return { state: "error", retryable: true };
	return { state: "loading", retryable: false };
}
