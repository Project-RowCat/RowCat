import type { SessionPhase } from "../../lib/session-state.ts";

/**
 * Rules for **what the settings screen draws**, extracted as a pure function.
 *
 * Same place and same reason as the account screen (`account-state.ts`). Stacking `if`s inside a
 * component makes the order impossible to check without rendering, and getting the order wrong
 * fails silently:
 *
 * ```text
 * drawing the guest notice while booting   a signed-in person reads it as the session being gone
 * folding unavailable into guest           someone who never signed out is invited to sign in
 * ```
 *
 * ## This screen does not wait for SQLite
 *
 * Taking a single `SessionPhase` argument expresses that. Two of the three categories read local
 * storage (the default AI generation settings, the persona library), but that wait belongs to
 * **that section**, not to the screen. Gating on `useMobileAppPhase` (session + SQLite) would also
 * break changing brightness on a device whose storage never opens.
 *
 * The account theme is on the same axis. The value is owned by the server, so when its lookup fails
 * the display section and the local-data section must still work. That isolation is expressed by
 * each section holding its own state (`theme-customization-state.ts`).
 */

export type SettingsScreenState =
	/** Identity is not known yet: a neutral wait. The guest notice is not drawn even for one frame. */
	| { kind: "booting" }
	/**
	 * Guest (the server **answered** so). Everything settings touches belongs to the account or to
	 * that account's device data, so there is nothing to draw here. Brightness is kept, though: that
	 * value is the device's, and the header's brightness trigger stays available to guests.
	 */
	| { kind: "guest" }
	/** The session **cannot be verified**: not a guest, and no sign-in button is drawn. */
	| { kind: "unavailable" }
	/** The member is confirmed: category content is drawn here (restricted accounts too). */
	| { kind: "ready" };

export function resolveSettingsScreenState(
	phase: SessionPhase,
): SettingsScreenState {
	if (phase === "booting") return { kind: "booting" };
	if (phase === "guest") return { kind: "guest" };
	/**
	 * `unavailable` is not folded into guest. The stored session is still there; we just could not ask
	 * the server. Inviting sign-in here would tell a signed-in person they were signed out. Above all,
	 * the point of this branch is **not drawing the previous viewer's private settings** (we cannot
	 * draw a persona library for an account we cannot identify).
	 */
	if (phase === "unavailable") return { kind: "unavailable" };
	return { kind: "ready" };
}
