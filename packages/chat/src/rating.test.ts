import { describe, expect, it } from "vitest";
import { resolvePlatformAllAges, runtimeGenerationContext } from "./rating.ts";

describe("resolvePlatformAllAges", () => {
	it("without entitlement, an adult-mode request drops to all-ages", () => {
		/**
		 * This single line is the server side of the adult gate. Whatever the client claims, eligibility
		 * is decided by the membership information read from the session.
		 */
		expect(
			resolvePlatformAllAges({ requestedMode: "adult", adultAllowed: false }),
		).toBe(true);
	});

	it("opens as adult only with entitlement and an adult-mode request", () => {
		expect(
			resolvePlatformAllAges({ requestedMode: "adult", adultAllowed: true }),
		).toBe(false);
	});

	it("an all-ages request stays all-ages even with entitlement", () => {
		// The work rating takes priority here too. When an adult member opens an all-ages work, the
		// request arrives as all-ages, and the server does not promote it to adult.
		expect(
			resolvePlatformAllAges({ requestedMode: "all-ages", adultAllowed: true }),
		).toBe(true);
	});
});

describe("runtimeGenerationContext", () => {
	it("declares the rating and nothing else", () => {
		expect(runtimeGenerationContext(true)).toEqual({
			requestedMode: "all-ages",
		});
		expect(runtimeGenerationContext(false)).toEqual({ requestedMode: "adult" });
	});
});
