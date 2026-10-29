import type { Viewer } from "@rowcat/domain";
import { describe, expect, it } from "vitest";
import type { SessionState } from "./session-state.ts";
import { viewerAction } from "./viewer-action.ts";

/**
 * Whether an authenticated write is allowed: the decision that favourites and comments share.
 *
 * Testing this function rather than the screens is the point. If the heart and the compose box each
 * inspect the session, one day only one of them will fold `unavailable` into guest, and that screen
 * will show a login button to someone whose session is alive. To the user that reads as "you were
 * signed out".
 */

const APPROVED: Viewer = {
	id: "member-alice",
	nickname: "Alice",
	status: "approved",
	role: "user",
	verified: false,
	adult: false,
	showAdult: false,
	ageStatus: "standard",
	membershipGate: null,
	adultRecheckRequired: false,
};

const session = (state: SessionState): SessionState => state;

describe("four cells", () => {
	it("confirmed members send the request", () => {
		expect(
			viewerAction(session({ phase: "authenticated", viewer: APPROVED })),
		).toBe("allowed");
	});

	it("guests go to sign-in", () => {
		// A guest the server actually answered. This is different from a guest we could not ask about.
		expect(viewerAction(session({ phase: "guest", viewer: null }))).toBe(
			"sign-in",
		);
	});

	it.each([
		["suspend", "suspended" as const],
		["Block", "banned" as const],
	])("%s accounts are blocked and the fact is stated", (_label, status) => {
		expect(
			viewerAction(
				session({ phase: "authenticated", viewer: { ...APPROVED, status } }),
			),
		).toBe("restricted");
	});

	/**
	 * These two lines are the point of this file.
	 *
	 * Folding an unconfirmed session into guest shows a login screen. Folding it into a member sends
	 * an authenticated write from an unconfirmed session, which fails with a 401. Neither is the
	 * truth.
	 */
	it.each([
		["booting", "booting" as const],
		["the session can't be checked", "unavailable" as const],
	])("does nothing on %s", (_label, phase) => {
		expect(viewerAction(session({ phase, viewer: null }))).toBe("unverified");
	});

	it("uncheckable states fold into neither guest nor member", () => {
		const unverified = viewerAction(
			session({ phase: "unavailable", viewer: null }),
		);
		expect(unverified).not.toBe("sign-in");
		expect(unverified).not.toBe("allowed");
	});
});
