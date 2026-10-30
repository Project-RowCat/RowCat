import type { Viewer } from "@rowcat/domain";
import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, test } from "vitest";
import {
	type ResolveSetupViewInput,
	resolveSetupView,
	setupClaimErrorMessage,
} from "./setup-view.ts";

const viewer = (patch: Partial<Viewer> = {}): Viewer =>
	({
		id: "m1",
		nickname: "first operator",
		status: "approved",
		role: "user",
		verified: false,
		adult: false,
		showAdult: false,
		ageStatus: "standard",
		membershipGate: null,
		...patch,
	}) as Viewer;

const input = (
	patch: Partial<ResolveSetupViewInput> = {},
): ResolveSetupViewInput => ({
	status: { open: true },
	statusFailed: false,
	viewer: null,
	viewerPending: false,
	viewerFailed: false,
	claim: "idle",
	...patch,
});

describe("resolveSetupView", () => {
	test("the page's own claim wins over the refetched status", () => {
		expect(
			resolveSetupView(input({ claim: "succeeded", status: { open: false } })),
		).toEqual({ step: "done" });
	});

	/**
	 * The bug this order fixes: the claim's success refetches the status, which reads closed before the
	 * mutation reports success. Without this the form unmounted and the page said "already complete".
	 */
	test("a claim in flight keeps the code step even once the status reads closed", () => {
		expect(
			resolveSetupView(
				input({ claim: "pending", status: { open: false }, viewer: viewer() }),
			),
		).toEqual({ step: "code", nickname: "first operator" });
	});

	test("a status that could not be read is not closed", () => {
		expect(
			resolveSetupView(input({ status: undefined, statusFailed: true })),
		).toEqual({ step: "unavailable" });
		expect(resolveSetupView(input({ status: undefined }))).toEqual({
			step: "loading",
		});
	});

	/** The order this module exists for: a set-up deployment never draws the sign-up form. */
	test("closed is decided before the viewer", () => {
		expect(
			resolveSetupView(input({ status: { open: false }, viewer: null })),
		).toEqual({ step: "closed", operator: false });
		expect(
			resolveSetupView(
				input({ status: { open: false }, viewer: viewer({ role: "admin" }) }),
			),
		).toEqual({ step: "closed", operator: true });
	});

	test("a failed viewer lookup does not become the sign-up form", () => {
		expect(
			resolveSetupView(input({ viewer: undefined, viewerFailed: true })),
		).toEqual({ step: "unavailable" });
		expect(
			resolveSetupView(input({ viewer: undefined, viewerPending: true })),
		).toEqual({ step: "loading" });
	});

	test("open: account when signed out, code when signed in", () => {
		expect(resolveSetupView(input())).toEqual({ step: "account" });
		expect(resolveSetupView(input({ viewer: viewer() }))).toEqual({
			step: "code",
			nickname: "first operator",
		});
	});
});

describe("setupClaimErrorMessage", () => {
	const apiError = (code: string, status: number) =>
		new RowCatApiError({ status, code, message: "server sentence" });

	test("names the refusal, never the server's sentence", () => {
		const message = setupClaimErrorMessage(apiError("setup_code_invalid", 403));
		expect(message).toContain("doesn't match");
		expect(message).not.toContain("server sentence");
	});

	test("an unreachable API is not a wrong code", () => {
		expect(setupClaimErrorMessage(new TypeError("Failed to fetch"))).toContain(
			"Couldn't reach the API",
		);
	});
});
