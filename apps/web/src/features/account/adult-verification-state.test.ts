import { ADULT_VERIFICATION_ERROR_CODE } from "@rowcat/contracts";
import { adultVisibilityState, type Viewer } from "@rowcat/domain";
import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import type { IdentityHandoffOutcome } from "#/lib/identity/handoff.ts";
import {
	adultVerificationErrorMessage,
	adultVerificationOffer,
	identityHandoffMessage,
} from "./adult-verification-state.ts";

/**
 * Screen decisions for adult eligibility: **whom to offer what**, and the failure sentences.
 *
 * Both failure modes are silent:
 *
 * ```text
 * offer    recommending identity verification to a child sends them through a procedure that
 *          does not exist; re-offering it to someone already eligible reads as unfinished
 * failure  telling someone who closed the window that it "failed" makes them doubt their device
 * ```
 */

const viewer = (patch: Partial<Viewer> = {}): Viewer => ({
	id: "m1",
	nickname: "Tester",
	status: "approved",
	role: "user",
	verified: false,
	adult: false,
	showAdult: false,
	ageStatus: "standard",
	membershipGate: null,
	adultRecheckRequired: false,
	...patch,
});

const offerFor = (patch: Partial<Viewer> = {}) =>
	adultVerificationOffer(adultVisibilityState(viewer(patch)));

const apiError = (code: string, status = 400): RowCatApiError =>
	new RowCatApiError({ status, code, message: "server copy" });

describe("adultVerificationOffer", () => {
	it("offers identity verification to an unverified member", () => {
		expect(offerFor()).toBe("verify");
	});

	/**
	 * **Nothing is offered to a child.** A child account with all three adult axes on is representable
	 * (legacy data, bad seeds, operator error), and the result must still be the same: the server
	 * gates on the same decision (`requireNonChild`).
	 */
	it("offers nothing to a child", () => {
		expect(offerFor({ ageStatus: "child" })).toBe("none");
		expect(
			offerFor({
				ageStatus: "child",
				verified: true,
				adult: true,
				showAdult: true,
			}),
		).toBe("none");
	});

	/**
	 * Verified but under 19: **re-verification is the only path.** The server stores no birth date, so
	 * nothing opens automatically when the person turns 19.
	 */
	it("offers re-verification to a verified minor", () => {
		expect(offerFor({ verified: true, adult: false })).toBe("reverify");
	});

	/**
	 * Annual re-verification: **adults are asked to verify again.** Folding this into `reverify`
	 * (under 19) would tell an adult "after you turn 19" (wrong), or show a large button to a minor.
	 */
	it("offers renewal to an adult whose last check is over a year old", () => {
		expect(
			offerFor({
				verified: true,
				adult: true,
				showAdult: true,
				adultRecheckRequired: true,
			}),
		).toBe("renew");
		expect(
			offerFor({ verified: true, adult: true, adultRecheckRequired: true }),
		).toBe("renew");
	});

	/** A child still gets nothing offered, whatever the flags say. */
	it("does not offer renewal to a child either", () => {
		expect(
			offerFor({
				ageStatus: "child",
				verified: true,
				adult: true,
				adultRecheckRequired: true,
			}),
		).toBe("none");
	});

	it("offers nothing to a member who already qualifies", () => {
		expect(offerFor({ verified: true, adult: true })).toBe("none");
		expect(offerFor({ verified: true, adult: true, showAdult: true })).toBe(
			"none",
		);
	});

	/**
	 * **An unverified age is not a child.** Folding it in would strip the path to verification from
	 * every member who existed before the age gate, on a sanction based on a fact we never verified.
	 */
	it("offers identity verification to a member of unknown age too", () => {
		expect(offerFor({ ageStatus: "unknown" })).toBe("verify");
	});
});

describe("adultVerificationErrorMessage", () => {
	/**
	 * A deployment with no verification method: **the user cannot fix this.** Suggesting "try again"
	 * makes the person repeat something that cannot work.
	 */
	it("does not suggest retrying when there is no verifier", () => {
		const message = adultVerificationErrorMessage(
			apiError(ADULT_VERIFICATION_ERROR_CODE.unavailable, 503),
		);
		expect(message).toContain("isn't available");
		expect(message).not.toContain("try again");
	});

	/**
	 * Closing the window and the provider refusing must be **different sentences**. Folding them
	 * together would report a failure to someone who stopped on their own.
	 */
	it("says not-completed and failed in different sentences", () => {
		const notCompleted = adultVerificationErrorMessage(
			apiError(ADULT_VERIFICATION_ERROR_CODE.notCompleted),
		);
		const failed = adultVerificationErrorMessage(
			apiError(ADULT_VERIFICATION_ERROR_CODE.providerFailed),
		);
		expect(notCompleted).not.toBe(failed);
		expect(notCompleted).toContain("didn't complete");
		expect(failed).toContain("failed");
	});

	it("expiry and conflict say to start again", () => {
		for (const code of [
			ADULT_VERIFICATION_ERROR_CODE.expired,
			ADULT_VERIFICATION_ERROR_CODE.conflict,
			ADULT_VERIFICATION_ERROR_CODE.notFound,
		])
			expect(adultVerificationErrorMessage(apiError(code, 410))).toContain(
				"start again",
			);
	});

	/**
	 * **Never tell a child that completing adult verification will do.** The sentence is false, and
	 * anyone following it searches for a procedure that does not exist.
	 */
	it("the child restriction does not suggest the procedure", () => {
		const message = adultVerificationErrorMessage(
			apiError("minor_adult_restricted", 403),
		);
		expect(message).toContain("under 14");
		expect(message).not.toContain("identity verification");
	});

	/** A network exception is not server copy: a caught exception may carry internal details. */
	it("a non-API error points at the connection", () => {
		expect(adultVerificationErrorMessage(new Error("boom"))).toContain(
			"connection",
		);
	});

	/** Even an unknown code gets a generic sentence rather than a dead end. */
	it("an unknown code gets the generic sentence", () => {
		expect(adultVerificationErrorMessage(apiError("something_new"))).toContain(
			"try again",
		);
	});

	/**
	 * **Never draw the provider's raw message.** Its values differ per channel, and to a user they
	 * read only as a "PG response code".
	 */
	it("does not draw server copy verbatim", () => {
		for (const code of Object.values(ADULT_VERIFICATION_ERROR_CODE))
			expect(adultVerificationErrorMessage(apiError(code))).not.toContain(
				"server copy",
			);
	});
});

describe("identityHandoffMessage", () => {
	/**
	 * **Cancelling is not a failure.** The person closed the window themselves; showing an error would
	 * make them doubt their device. `navigating` is the same: the page is leaving, so anything drawn
	 * disappears.
	 */
	it("cancelling and navigating have no sentence", () => {
		const silent: IdentityHandoffOutcome[] = [
			{ status: "cancelled" },
			{ status: "navigating" },
			{ status: "completed" },
		];
		for (const outcome of silent)
			expect(identityHandoffMessage(outcome)).toBeNull();
	});

	it("a verifier rejection says to try again", () => {
		expect(
			identityHandoffMessage({ status: "failed", message: null }),
		).toContain("try again");
	});

	/**
	 * The deployment chose an identity provider this screen does not know. **Do not guess and open
	 * some window.** The client is fail-closed too, and the user is told it is not available now.
	 */
	it("an unknown handoff says it can't proceed", () => {
		expect(identityHandoffMessage({ status: "unsupported" })).toContain(
			"can't proceed",
		);
	});

	/** The provider's raw message is not put on screen. */
	it("does not draw the verifier's original message", () => {
		expect(
			identityHandoffMessage({ status: "failed", message: "PG_ERR_0042" }),
		).not.toContain("PG_ERR_0042");
	});
});
