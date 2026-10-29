import { canInteract } from "@rowcat/domain";
import type { SessionState } from "./session-state.ts";

/**
 * Whether the viewer may send an authenticated write right now. Favourites and comments share this.
 *
 * They share it because the axis the client sees is the same for both. The server differs
 * (favourites check `social.write`, comments check `comment.write`), but that capability list is
 * not sent in `/v2/me`; it lives in `/v2/me/moderation`. What the client can know is whether the
 * member is confirmed and whether that member is sanctioned, and the answer is the same for both
 * operations. Two copies would eventually be fixed on one side only.
 *
 * This is guidance, not authorization. The server always decides, and loosening this function opens
 * no door. Its job is only to keep the user from pressing a request that would certainly be
 * rejected.
 *
 * ## Four states; the fourth is the point of this file
 *
 * ```text
 * allowed      member confirmed and not sanctioned — send the request
 * sign-in      guest (the server answered that) — send to sign-in
 * restricted   member, but suspended or blocked — state the fact and block
 * unverified   identity cannot be confirmed (booting, or /me unreachable)
 * ```
 *
 * Folding `unverified` into `sign-in` would show a login screen to someone whose session is alive,
 * which reads as "you were signed out" — something the user never asked for. Folding it into
 * `allowed` would send an authenticated write from someone whose membership is unknown, and the
 * guest's request then fails with a 401 the user cannot explain. So in that state nothing is sent
 * and nothing navigates: the screen waits or rechecks the session.
 *
 * Local storage (SQLite) state does not come in here. The operations in this slice all change
 * server state, so whether the device file is open is unrelated.
 */
export type ViewerAction = "allowed" | "sign-in" | "restricted" | "unverified";

export function viewerAction(session: SessionState): ViewerAction {
	if (session.phase === "guest") return "sign-in";
	if (session.phase !== "authenticated") return "unverified";
	return canInteract(session.viewer) ? "allowed" : "restricted";
}
