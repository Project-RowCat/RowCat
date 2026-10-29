import { GUARDIAN_ERROR_CODE } from "@rowcat/contracts";
import type { MembershipGate, Viewer } from "@rowcat/domain";
import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import {
	ageDeclarationError,
	appGateFor,
	guardianRequestError,
} from "./membership-gate-state.ts";

/**
 * Entry gate decisions: **open exactly the one door the server chose.**
 *
 * This test guards one rule: the app does not reassemble the priority. The contradictory-values
 * block below is the substance of that rule: the age status never raises or lowers a gate the
 * server did not choose.
 */

const viewerWith = (patch: Partial<Viewer>): Viewer => ({
	id: "m1",
	nickname: "Test",
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

describe("appGateFor", () => {
	/** Guests, booting and `unavailable` all arrive as `null` (`lib/session-state.ts`). */
	it("no viewer means no gate", () => {
		expect(appGateFor(null)).toBeNull();
	});

	it("a member with no gate passes", () => {
		expect(appGateFor(viewerWith({ membershipGate: null }))).toBeNull();
	});

	it.each([
		["age_required", "age"],
		["guardian_consent_required", "guardian"],
	] as const)("the server's %s is the %s screen", (gate, panel) => {
		expect(appGateFor(viewerWith({ membershipGate: gate }))).toBe(panel);
	});

	/**
	 * The point is to walk the whole server vocabulary. A new value breaks the `Record` table at
	 * compile time, and this test checks that the value actually has a screen.
	 */
	it("every value in the server vocabulary has a screen", () => {
		const gates: NonNullable<MembershipGate>[] = [
			"age_required",
			"guardian_consent_required",
		];
		for (const gate of gates)
			expect(appGateFor(viewerWith({ membershipGate: gate }))).not.toBeNull();
	});
});

describe("contradictory values — the authority is always membershipGate", () => {
	/**
	 * The age status does not lower a gate the server raised. An `unknown` member the server holds at
	 * the age check stays there even if a stale field said otherwise.
	 */
	it("the server's gate beats the age state", () => {
		expect(
			appGateFor(
				viewerWith({
					ageStatus: "standard",
					membershipGate: "guardian_consent_required",
				}),
			),
		).toBe("guardian");
	});

	/**
	 * If the server says there is no gate, the viewer passes even with `unknown` age. That combination
	 * really occurs on a deployment with the rollout switch off, and the server is the authority then.
	 */
	it("even with unknown age, no gate means passing", () => {
		expect(
			appGateFor(viewerWith({ ageStatus: "unknown", membershipGate: null })),
		).toBeNull();
	});

	/** The reverse holds too: a gate is never built from the age status alone. */
	it("a child with no gate passes", () => {
		expect(
			appGateFor(viewerWith({ ageStatus: "child", membershipGate: null })),
		).toBeNull();
	});
});

const apiError = (code: string) =>
	new RowCatApiError({ status: 400, code, message: "server sentence" });

describe("failure copy", () => {
	it("no failure means no sentence", () => {
		expect(ageDeclarationError(null)).toBeNull();
		expect(guardianRequestError(undefined)).toBeNull();
	});

	/** The server sentence is not drawn as is: the screen must branch on the next step. */
	it("doesn't use the server's sentence as is", () => {
		expect(ageDeclarationError(apiError("invalid_input"))).not.toContain(
			"server sentence",
		);
		expect(guardianRequestError(apiError("weird_code"))).not.toContain(
			"server sentence",
		);
	});

	it("age: a failure fixed by correcting the value says so", () => {
		expect(ageDeclarationError(apiError("invalid_input"))).toContain(
			"date of birth",
		);
	});

	/**
	 * **Does not say "try again" for something that cannot succeed.** On a deployment without the
	 * verification path, a child who reads that advice presses until it works.
	 */
	it("guardian: a deployment that isn't ready doesn't recommend retrying", () => {
		const message = guardianRequestError(
			apiError(GUARDIAN_ERROR_CODE.verifierUnavailable),
		);
		expect(message).toBeTruthy();
		expect(message).not.toContain("Try again");
	});

	/** A network failure (no code) is not mixed with an explanation of our own state. */
	it("a connection failure has its own sentence", () => {
		const offline = new Error("network");
		expect(ageDeclarationError(offline)).toContain("check your connection");
		expect(guardianRequestError(offline)).toContain("check your connection");
	});

	it("an unknown code falls to generic copy", () => {
		expect(ageDeclarationError(apiError("nope"))).toBeTruthy();
		expect(guardianRequestError(apiError("nope"))).toBeTruthy();
	});
});
