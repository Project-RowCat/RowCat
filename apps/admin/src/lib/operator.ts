import type { Viewer } from "@rowcat/domain";
import { canModerate } from "@rowcat/domain";

/**
 * Operator decision. This is the display layer; the server is the final authority: every lookup in
 * this app gets a 403 from `requireModeratorViewer` / `requireAdminViewer`, so deleting this file
 * would not expose anything.
 *
 * `canModerate` comes from `@rowcat/domain` so the screen uses the same predicate as the server
 * gate. Otherwise links show up that answer 403, or permitted operators cannot get in.
 */

/**
 * The four outcomes. `unknown` is not a guest.
 *
 * ```text
 * loading    /me has not answered yet           draw nothing
 * guest      the server said "no member"        send to sign-in
 * forbidden  a member without an operator role  403 screen, not sign-in
 * operator   may enter
 * ```
 *
 * `guest` and `forbidden` are separate because sending a role-less member to sign-in tells an
 * already-signed-in person to try again; what they need is a role grant. `loading` comes first:
 * folding it into guest flashes the sign-in screen on every refresh, and drawing a privileged
 * screen before it resolves would be worse.
 */
export type OperatorAccess = "loading" | "guest" | "forbidden" | "operator";

export interface ResolveOperatorAccessInput {
	pending: boolean;
	/** `null` is the server answering "not a member". */
	viewer: Viewer | null | undefined;
	/**
	 * The `/me` lookup failed (network, 5xx). Not folded into guest: failing to ask the server is a
	 * different fact from the server saying "no member", and folding it would make a signed-in
	 * operator look signed out during an API wobble, possibly mid-incident.
	 */
	failed: boolean;
}

export function resolveOperatorAccess({
	pending,
	viewer,
	failed,
}: ResolveOperatorAccessInput): OperatorAccess {
	/**
	 * A failure also maps to `loading`: the screen draws "cannot verify" with a retry, which opens no
	 * privileged screen and does not send the person to sign-in.
	 */
	if (pending || failed) return "loading";
	if (!viewer) return "guest";
	/** Same predicate as the server gate, which also rejects suspended operators. */
	return canModerate(viewer) ? "operator" : "forbidden";
}

/**
 * Whether to draw admin-only operations. A courtesy, not enforcement: the server rejects with
 * `requireAdminViewer`, so a wrong value leaks nothing; it only avoids a button that always answers
 * staff with 403. It goes through `canModerate` so a suspended admin is also false.
 */
export const canAdminister = (viewer: Viewer | null | undefined): boolean =>
	!!viewer && canModerate(viewer) && viewer.role === "admin";
