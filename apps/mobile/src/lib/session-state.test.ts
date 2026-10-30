import type { Viewer } from "@rowcat/domain";
import { describe, expect, it } from "vitest";
import type { MobileLocalScopeStatus } from "./local-data/activation.ts";
import {
	isAuthenticatedAppReady,
	resolveAppPhase,
	resolveSessionState,
	type SessionInputs,
	type SessionPhase,
} from "./session-state.ts";

/**
 * Only the **decisions** of start, sign-in and sign-out are tested here. This file has no simulator
 * and no React, because every rule here is the kind that compiles even when broken and fails
 * quietly.
 */

const ALICE: Viewer = {
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
	localOwner: false,
};

const inputs = (patch: Partial<SessionInputs> = {}): SessionInputs => ({
	hydrated: true,
	storedSession: false,
	transition: false,
	viewer: { status: "pending", data: undefined, paused: false },
	...patch,
});

const phaseOf = (patch: Partial<SessionInputs>): SessionPhase =>
	resolveSessionState(inputs(patch)).phase;

describe("cold start", () => {
	it("draws nothing before reading storage", () => {
		/**
		 * Reading a cookie that has not arrived yet as a guest, and drawing the login screen for a frame,
		 * looks to an already signed-in user like a notice that their session disappeared.
		 */
		expect(phaseOf({ hydrated: false, storedSession: true })).toBe("booting");
		expect(phaseOf({ hydrated: false })).toBe("booting");
	});

	it("read but not yet answered means waiting", () => {
		expect(phaseOf({ storedSession: true })).toBe("booting");
	});

	it("authenticated when the server gives a member", () => {
		const state = resolveSessionState(
			inputs({
				storedSession: true,
				viewer: { status: "success", data: ALICE, paused: false },
			}),
		);
		expect(state.phase).toBe("authenticated");
		expect(state.viewer).toBe(ALICE);
	});

	it("a guest when the server **answers** null", () => {
		const state = resolveSessionState(
			inputs({
				storedSession: true,
				viewer: { status: "success", data: null, paused: false },
			}),
		);
		expect(state.phase).toBe("guest");
		expect(state.viewer).toBeNull();
	});
});

describe("a network failure isn't a sign-out", () => {
	/**
	 * **The P0 of this file.** If a stored session exists and `/me` fails, folding that into guest
	 * makes the app act as if signed out. What it then does (releasing the local scope, showing the
	 * login screen) is something the user never asked for.
	 */
	it("a lookup error is unavailable, not guest", () => {
		expect(
			phaseOf({
				storedSession: true,
				viewer: { status: "error", data: undefined, paused: false },
			}),
		).toBe("unavailable");
	});

	it("even without a session an error doesn't fold to guest", () => {
		/**
		 * The fact that no cookie exists is stated by hydration. But if the query **ended in error**,
		 * that is not the result of asking. Do not treat what was not confirmed as confirmed.
		 */
		expect(
			phaseOf({
				storedSession: false,
				viewer: { status: "error", data: undefined, paused: false },
			}),
		).toBe("unavailable");
	});

	it("with a member already received, a background refresh failure is still authenticated", () => {
		/**
		 * Even if a background refresh fails, `status` stays `success`, and we draw that value as it is.
		 * One failed refresh does not send the user back to the login screen.
		 */
		expect(
			phaseOf({
				storedSession: true,
				viewer: { status: "success", data: ALICE, paused: false },
			}),
		).toBe("authenticated");
	});
});

describe("offline — what can't be checked and what has nothing to check", () => {
	it("with a stored session it can't be checked", () => {
		expect(
			phaseOf({
				storedSession: true,
				viewer: { status: "pending", data: undefined, paused: true },
			}),
		).toBe("unavailable");
	});

	it("without a stored session it's a guest — we know that answer", () => {
		/**
		 * With no cookie, the server must answer guest, so even offline this answer is not a guess. But
		 * we still do **not open the member database by guessing** (V1's bound).
		 */
		expect(
			phaseOf({
				storedSession: false,
				viewer: { status: "pending", data: undefined, paused: true },
			}),
		).toBe("guest");
	});
});

describe("doesn't draw the previous identity while switching", () => {
	it("Alice doesn't remain while sign-out is running", () => {
		const state = resolveSessionState(
			inputs({
				transition: true,
				storedSession: true,
				viewer: { status: "success", data: ALICE, paused: false },
			}),
		);
		expect(state.phase).toBe("booting");
		expect(state.viewer).toBeNull();
	});

	it("doesn't fall back to the guest screen while sign-in is running", () => {
		expect(
			phaseOf({
				transition: true,
				viewer: { status: "success", data: null, paused: false },
			}),
		).toBe("booting");
	});
});

describe("authenticated ≠ usable", () => {
	const authenticated = { phase: "authenticated" as const, viewer: ALICE };

	const appPhase = (status: MobileLocalScopeStatus) =>
		resolveAppPhase(authenticated, status);

	/**
	 * **The order is the point of this block** (#92). Authentication succeeds → waiting for `/me` →
	 * storage opening → ready. None of the intermediate states is `ready`. Drawing the conversation
	 * list just because the member is confirmed shows an **empty** list, and the user reads their
	 * conversations as gone.
	 */
	it("even with the member settled it's not ready before storage opens", () => {
		expect(appPhase("idle")).toBe("opening");
		expect(appPhase("opening")).toBe("opening");
		expect(isAuthenticatedAppReady(appPhase("opening"))).toBe(false);
	});

	it("ready only when both are ready", () => {
		expect(appPhase("ready")).toBe("ready");
		expect(isAuthenticatedAppReady(appPhase("ready"))).toBe(true);
	});

	it("doesn't quietly continue when storage doesn't open", () => {
		expect(appPhase("error")).toBe("local-error");
		expect(isAuthenticatedAppReady(appPhase("error"))).toBe(false);
	});

	/**
	 * Walks the steps of one sign-in **in order**. If `ready` becomes true at any step, the screen
	 * transitions there, and what is visible is either an unopened store's empty list or (worse) the
	 * previous person's value.
	 */
	it("keeps the order auth success → waiting for /me → opening storage → ready", () => {
		const steps: Array<[string, SessionInputs, MobileLocalScopeStatus]> = [
			[
				"Better Auth gave 200 but /me isn't back yet",
				inputs({ storedSession: true, transition: true }),
				"idle",
			],
			[
				"/me gave a member but storage is opening",
				inputs({
					storedSession: true,
					viewer: { status: "success", data: ALICE, paused: false },
				}),
				"opening",
			],
		];

		for (const [label, input, localStatus] of steps) {
			const phase = resolveAppPhase(resolveSessionState(input), localStatus);
			expect(isAuthenticatedAppReady(phase), label).toBe(false);
		}

		const settled = resolveAppPhase(
			resolveSessionState(
				inputs({
					storedSession: true,
					viewer: { status: "success", data: ALICE, paused: false },
				}),
			),
			"ready",
		);
		expect(isAuthenticatedAppReady(settled)).toBe(true);
	});

	it("unauthenticated cells don't depend on storage state", () => {
		for (const status of [
			"idle",
			"opening",
			"ready",
			"error",
		] as MobileLocalScopeStatus[]) {
			expect(resolveAppPhase({ phase: "guest", viewer: null }, status)).toBe(
				"guest",
			);
			expect(
				resolveAppPhase({ phase: "unavailable", viewer: null }, status),
			).toBe("unavailable");
			expect(resolveAppPhase({ phase: "booting", viewer: null }, status)).toBe(
				"booting",
			);
		}
	});
});
