import { GUARDIAN_ERROR_CODE, MEMBERSHIP_ERROR_CODE } from "@rowcat/contracts";
import type { Viewer } from "@rowcat/domain";
import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import {
	ageDeclarationError,
	guardianConsentError,
	guardianRequestError,
	membershipGateFor,
	minorRestrictionMessage,
} from "./membership-gate-state.ts";

/**
 * Test file header for membership-gate-state. It is a pure-logic test, with no React rendering,
 * matching the app's test style. It catches who sees what, not the screen's shape. Both failure
 * modes are silent:
 * - Gate judgment: too broad sends a guest to the age screen instead of the public gallery; too
 *   narrow lets an under-14 member use the app without guardian consent.
 * - Failure copy: pointing at a dead end sends the user looking for a procedure that does not
 *   exist.
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

const apiError = (code: string, status = 400): RowCatApiError =>
	new RowCatApiError({ status, code, message: "a server sentence" });

describe("membershipGateFor", () => {
	it("guests pass", () => {
		expect(membershipGateFor(null)).toBeNull();
	});

	it("reads the server's value as is", () => {
		for (const gate of [
			null,
			"age_required",
			"guardian_consent_required",
		] as const)
			expect(membershipGateFor(viewer({ membershipGate: gate }))).toBe(gate);
	});

	/**
	 * The priority is not reassembled by the screen. Reading ageStatus here would
	 * create a copy that sees outdated rules while a deployment is rolling out. If the server returns
	 * null, the gate passes, whatever the other axes say.
	 */
	it("other axes do not overturn the decision", () => {
		expect(
			membershipGateFor(
				viewer({
					membershipGate: null,
					ageStatus: "unknown",
				}),
			),
		).toBeNull();
	});
});

describe("age declaration failures", () => {
	it("no error, no sentence", () => {
		expect(ageDeclarationError(null)).toBeNull();
		expect(ageDeclarationError(undefined)).toBeNull();
	});

	it("a wrong value says it can be fixed", () => {
		expect(ageDeclarationError(apiError("invalid_input"))).toContain(
			"date of birth",
		);
	});

	/** The server's message is never shown. Failures must be told apart by code, not by sentence. */
	it("the server message does not leak to the screen", () => {
		for (const code of ["invalid_input", "login_required", "internal_error"])
			expect(ageDeclarationError(apiError(code))).not.toContain(
				"a server sentence",
			);
	});

	it("an unknown code falls back to the generic message", () => {
		expect(ageDeclarationError(apiError("brand_new_code"))).toBeTruthy();
	});
});

describe("guardian request failures", () => {
	/**
	 * The fact that no verifier exists is not folded into 'try again'. Folding it would make the child
	 * press until it works, turning our unready state into the user's problem.
	 */
	it("no verifier does not say to try again", () => {
		const message = guardianRequestError(
			apiError(GUARDIAN_ERROR_CODE.verifierUnavailable, 503),
		);
		expect(message).toBeTruthy();
		expect(message).not.toMatch(/try again/i);
	});

	it("not a child says to refresh", () => {
		expect(
			guardianRequestError(apiError(GUARDIAN_ERROR_CODE.notRequired, 409)),
		).toContain("refresh");
	});
});

describe("guardian page failures — a different next step means a different sentence", () => {
	/**
	 * This is the most important block in the file. If everything were folded into 'an error
	 * occurred', a guardian holding an expired link would suspect their device and authentication
	 * method, while what they need is one button press on the child's screen.
	 */
	it("expired or missing says to ask for a new link", () => {
		for (const code of [
			GUARDIAN_ERROR_CODE.notFound,
			GUARDIAN_ERROR_CODE.expired,
		])
			expect(guardianConsentError(apiError(code, 410))).toContain("new link");
	});

	it("an already handled request does not ask for a new link", () => {
		const message = guardianConsentError(
			apiError(GUARDIAN_ERROR_CODE.alreadyResolved, 409),
		);
		expect(message).toContain("already handled");
		expect(message).not.toContain("new link");
	});

	it("not an adult says so", () => {
		expect(
			guardianConsentError(apiError(GUARDIAN_ERROR_CODE.verifierNotAdult, 403)),
		).toContain("adult");
	});

	/**
	 * Network failures are kept apart from the other messages. Those explain our state. A network
	 * failure is a connection problem, and the guardian's next step differs.
	 */
	it("a network failure says it is a connection problem", () => {
		expect(guardianConsentError(new Error("fetch failed"))).toContain(
			"connect",
		);
	});

	it("all six codes have different sentences", () => {
		const messages = [
			GUARDIAN_ERROR_CODE.notFound,
			GUARDIAN_ERROR_CODE.expired,
			GUARDIAN_ERROR_CODE.alreadyResolved,
			GUARDIAN_ERROR_CODE.verificationRequired,
			GUARDIAN_ERROR_CODE.verificationFailed,
			GUARDIAN_ERROR_CODE.verifierNotAdult,
		].map((code) => guardianConsentError(apiError(code)));
		expect(new Set(messages).size).toBe(messages.length);
	});
});

describe("child restriction messages", () => {
	it("the two capabilities have their own sentences", () => {
		const messages = [
			MEMBERSHIP_ERROR_CODE.minorByoRestricted,
			MEMBERSHIP_ERROR_CODE.minorAdultRestricted,
		].map((code) => minorRestrictionMessage(apiError(code, 403)));
		expect(messages.every(Boolean)).toBe(true);
		expect(new Set(messages).size).toBe(2);
	});

	/**
	 * When BYO is blocked, the message says what still works: the chat itself is not blocked, and
	 * managed models remain available.
	 */
	it("the BYO restriction also says managed models work", () => {
		expect(
			minorRestrictionMessage(
				apiError(MEMBERSHIP_ERROR_CODE.minorByoRestricted, 403),
			),
		).toContain("RowCat-provided models");
	});

	it("errors other than child restrictions have no sentence", () => {
		expect(
			minorRestrictionMessage(apiError("account_restricted", 403)),
		).toBeNull();
		expect(minorRestrictionMessage(null)).toBeNull();
	});
});
