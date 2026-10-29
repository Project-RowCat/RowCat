import type { Viewer } from "@rowcat/domain";
import type { MobileLocalScopeStatus } from "./local-data/activation.ts";

/**
 * What the app **belongs to right now**, and when the screen may draw that fact.
 *
 * This file must not know React. Every rule below is the kind that compiles even when broken and
 * fails quietly on the device (drawing the login screen for someone who never logged out, or one
 * frame of someone else's data). They have to be checkable without rendering. The React wiring
 * lives in `identity.tsx` and does not restate these rules. It is the same split as `activation.ts`
 * ↔ `scope.tsx`.
 *
 * ## The two questions are different
 *
 * ```text
 * Better Auth   "is there an authentication session"   → does a cookie exist
 * GET /v2/me    "which RowCat member does this belong to" → Viewer.id
 * ```
 *
 * Do not draw the screen from the first answer. The authentication account id (`session.user.id`)
 * is the identifier of a login **method**, while product ownership (stories, favorites, the local
 * SQLite file) hangs entirely off the member id. Mixing them would make changing the login method
 * change the user's data. So no authentication-session user object can enter this module's inputs.
 * The only input is whether a cookie was present, and identity always comes from `/me`.
 */

/**
 * The state of the `/me` query, copied from TanStack Query with only the axes we look at.
 *
 * Not taking `UseQueryResult` directly is for two reasons. One is purity: this module does not
 * depend on React. The other is intent: copying only three axes states what the screen judges by.
 */
export interface ViewerQuerySnapshot {
	status: "pending" | "success" | "error";
	/**
	 * The member once the value is settled. `null` is a confirmed answer: **guest**. `undefined` means
	 * no answer yet. Collapsing the two would make a loading state look signed out.
	 */
	data: Viewer | null | undefined;
	/**
	 * Retries have **stopped** because the network was judged absent (`fetchStatus === "paused"`).
	 *
	 * This axis is needed because the `status` in that state is still `pending`. Without it, an
	 * offline user sees a loading state that never ends.
	 */
	paused: boolean;
}

export interface SessionInputs {
	/**
	 * Whether the native auth storage has been read once.
	 *
	 * While this is `false`, nothing is drawn. Reading a cookie that has not arrived yet as a guest,
	 * and drawing the login screen for a frame, looks to an already signed-in user like a notice that
	 * their session disappeared.
	 */
	hydrated: boolean;
	/**
	 * Whether a session cookie **was present** in that read.
	 *
	 * This is not an identity basis. The only place this value is used is to tell "cannot be verified"
	 * apart from "nothing to verify". With no cookie, the server must answer guest, so even offline we
	 * know that answer.
	 */
	storedSession: boolean;
	/** Whether a sign-in or sign-out procedure is running. */
	transition: boolean;
	viewer: ViewerQuerySnapshot;
}

/**
 * ```text
 * booting        not yet known: a neutral waiting screen
 * guest          no session (the server said so, or there was never a cookie)
 * authenticated  a member is confirmed
 * unavailable    the session **cannot be verified**; this is not a sign-out
 * ```
 *
 * The fourth state is the most important distinction in this slice. If a stored session exists and
 * `/me` fails because of the network, folding that into guest makes the app behave as if signed
 * out. The things done in that state (clearing the cookie, releasing the local scope, showing the
 * login screen) are things the user never asked for. The server **answering** null and the server
 * not being asked are different facts.
 */
export type SessionPhase =
	| "booting"
	| "guest"
	| "authenticated"
	| "unavailable";

export interface SessionState {
	phase: SessionPhase;
	/** Has a value only in `authenticated`. Identity is never guessed in the other phases. */
	viewer: Viewer | null;
}

const BOOTING: SessionState = { phase: "booting", viewer: null };
const GUEST: SessionState = { phase: "guest", viewer: null };
const UNAVAILABLE: SessionState = { phase: "unavailable", viewer: null };

export function resolveSessionState(inputs: SessionInputs): SessionState {
	if (!inputs.hydrated) return BOOTING;

	/**
	 * During a transition the **previous identity is not drawn**. From the moment sign-out is pressed
	 * until the server settles, if Alice's nickname stays on screen, interactions in that gap are
	 * aimed at an account already left. In an account switch (Alice → Bob), that gap is the window
	 * where someone else's data would be visible.
	 */
	if (inputs.transition) return BOOTING;

	const { status, data, paused } = inputs.viewer;

	/**
	 * The query failed: retries are used up and it ended in an error. **This is not guest.**
	 *
	 * A background refresh failure never reaches here (if a value was already received, `status` stays
	 * `success`). So what arrives in this branch is only "never received an answer".
	 */
	if (status === "error") return UNAVAILABLE;

	if (status === "success")
		return data
			? { phase: "authenticated", viewer: data }
			: /** The server **answered**: no member exists for this cookie. That is guest. */
				GUEST;

	/**
	 * There is still no answer, but retries have stopped (offline). If no stored session exists, we
	 * already know the answer is guest. If one exists, **it cannot be verified**. Opening the member
	 * database by guessing from the stored session is outside V1's bounds. Doing so would require
	 * storing an authentication-account → member mapping on the device, which is a separate decision
	 * that needs expiry and security judgments.
	 */
	if (paused) return inputs.storedSession ? UNAVAILABLE : GUEST;

	return BOOTING;
}

/**
 * The value the screen actually branches on: the session overlaid with the **readiness of local
 * storage**.
 *
 * ```text
 * booting       neutral wait
 * guest         guest screen (public browsing is a legitimate product state)
 * unavailable   "the session cannot be verified" + retry
 * opening       a member is confirmed and SQLite is opening
 * ready         usable
 * local-error   a member is confirmed but the storage will not open
 * ```
 *
 * `opening` and `local-error` are separate for the whole point of this function. Drawing local
 * features just because the member is confirmed renders the conversation list while the storage
 * does not exist yet (or never will). That screen is **an empty list**, and the user reads their
 * conversations as gone. It does not silently continue.
 */
export type MobileAppPhase =
	| "booting"
	| "guest"
	| "unavailable"
	| "opening"
	| "ready"
	| "local-error";

export function resolveAppPhase(
	session: SessionState,
	localStatus: MobileLocalScopeStatus,
): MobileAppPhase {
	if (session.phase !== "authenticated") return session.phase;
	if (localStatus === "ready") return "ready";
	if (localStatus === "error") return "local-error";
	return "opening";
}

/** Whether authenticated product screens may be drawn: only when the member **and** the storage are both ready. */
export const isAuthenticatedAppReady = (phase: MobileAppPhase): boolean =>
	phase === "ready";
