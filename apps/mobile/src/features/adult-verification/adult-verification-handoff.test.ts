import type { IdentityVerificationHandoff } from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import {
	planNativeVerification,
	providerReportedSuccess,
} from "./adult-verification-handoff.ts";

/**
 * Handoff mapping: the server-created value goes out unchanged. This guards the slice's whole
 * channel binding; if `identityVerificationId` were client-made or altered, the server could not
 * find its stored attempt, and the symptom is silent (the provider window opens and verification
 * completes normally).
 */

const portone: IdentityVerificationHandoff = {
	kind: "portone-v2",
	storeId: "store-a",
	channelKey: "channel-a",
	identityVerificationId: "server-attempt-123",
	redirectUrl: "https://web.example/account",
};

describe("PortOne request mapping", () => {
	it("carries the three the server gave as is", () => {
		const plan = planNativeVerification(portone);
		expect(plan).toEqual({
			kind: "portone",
			request: {
				storeId: "store-a",
				channelKey: "channel-a",
				identityVerificationId: "server-attempt-123",
			},
		});
	});

	// The client never makes the verification id. Beyond equality, this pins that the value came from
	// the server response: a random id would differ every run and could not match.
	it("doesn't invent the verification identifier", () => {
		const first = planNativeVerification(portone);
		const second = planNativeVerification(portone);
		expect(first).toEqual(second);
		if (first.kind !== "portone") throw new Error("must be a PortOne plan");
		expect(first.request.identityVerificationId).toBe("server-attempt-123");
	});

	// The browser's return address must not leak into the native layer. The native SDK overrides it
	// with its own callback (`portone://blank`), so passing it is pointless; but spreading `{
	// ...handoff }` would silently carry every field added to the contract, one of which may someday
	// be browser-only.
	it("neither redirectUrl nor kind rides on the request", () => {
		const plan = planNativeVerification(portone);
		if (plan.kind !== "portone") throw new Error("must be a PortOne plan");
		expect(Object.keys(plan.request).sort()).toEqual([
			"channelKey",
			"identityVerificationId",
			"storeId",
		]);
	});
});

describe("redirect mode", () => {
	// A real branch in the contract (the dev verifier picks it). It only opens the server-made address
	// and never reads the returned address; the type has no slot for it.
	it("opens the address the server made as is", () => {
		expect(
			planNativeVerification({
				kind: "redirect",
				redirectUrl: "https://web.example/account?verification=done",
			}),
		).toEqual({
			kind: "browser",
			url: "https://web.example/account?verification=done",
		});
	});
});

describe("doesn't proceed with an unknown mode", () => {
	// The client is fail-closed too. If a deployment picks a new provider, not proceeding beats
	// guessing a window; it does not throw because a crashing screen reads as "the app is broken".
	it("a kind outside the vocabulary is unsupported", () => {
		const unknown = {
			kind: "some-future-provider",
		} as unknown as IdentityVerificationHandoff;
		expect(planNativeVerification(unknown)).toEqual({ kind: "unsupported" });
	});
});

describe("verification authority response decision", () => {
	// Success is the absence of the structured field; it is not decided from human-readable text.
	it("no code means success", () => {
		expect(providerReportedSuccess({})).toBe(true);
		expect(
			providerReportedSuccess({
				transactionType: "IDENTITY_VERIFICATION",
				identityVerificationId: "server-attempt-123",
			} as Record<string, unknown>),
		).toBe(true);
	});

	it("a code means failure", () => {
		expect(providerReportedSuccess({ code: "FAILURE_TYPE_PG" })).toBe(false);
	});

	// The callback turns `portone://` query params into an object as is; a value can arrive as an
	// empty string, and folding that into "failure" would draw a successful verification as failed.
	it("an empty string isn't a code", () => {
		expect(providerReportedSuccess({ code: "" })).toBe(true);
	});

	// No response at all is not reported as success.
	it("no response isn't success", () => {
		expect(providerReportedSuccess(null)).toBe(false);
		expect(providerReportedSuccess(undefined)).toBe(false);
	});
});
