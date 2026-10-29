import type { PublicProfile } from "@rowcat/domain";
import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import type { MobileLocalScopeStatus } from "../../lib/local-data/activation.ts";
import type { SessionPhase } from "../../lib/session-state.ts";
import {
	type ProfileQuerySnapshot,
	resolveProfileState,
} from "./profile-state.ts";

/**
 * Status resolution for the public profile, checked without rendering.
 *
 * The most important group is the last one: every combination of identity and local-storage state
 * must give the same answer. That independence exists only as "no condition was written", so this
 * test fails first if someone starts reading that axis.
 */

const PROFILE: PublicProfile = {
	id: "creator-1",
	displayName: "NightCat",
	avatarUrl: null,
	bio: null,
	followers: 12,
};

const snapshot = (
	patch: Partial<ProfileQuerySnapshot> = {},
): ProfileQuerySnapshot => ({
	status: "pending",
	paused: false,
	error: null,
	data: undefined,
	...patch,
});

const CONTEXT = { session: "guest", localScope: "idle" } as const;

const apiError = (status: number, requestId?: string) =>
	new RowCatApiError({
		status,
		code: "boom",
		message: "…",
		requestId,
	});

describe("resolveProfileState", () => {
	it("loading while the first lookup runs", () => {
		expect(
			resolveProfileState({ context: CONTEXT, profile: snapshot() }),
		).toEqual({
			kind: "loading",
		});
	});

	it("stopped for lack of network isn't loading", () => {
		/**
		 * The `status` in that state is still `pending`. Without this check, an offline user would see an
		 * endless placeholder.
		 */
		expect(
			resolveProfileState({
				context: CONTEXT,
				profile: snapshot({ paused: true }),
			}),
		).toEqual({ kind: "offline" });
	});

	it("404 is `missing` with no reason", () => {
		/**
		 * The server deliberately gives a missing member and a deleted member the same response. If the
		 * screen re-derived the reason, that boundary would break, so this state has no slot for one.
		 */
		const state = resolveProfileState({
			context: CONTEXT,
			profile: snapshot({ status: "error", error: apiError(404) }),
		});
		expect(state).toEqual({ kind: "missing" });
		expect(Object.keys(state)).toEqual(["kind"]);
	});

	it("other failures carry only the request id", () => {
		expect(
			resolveProfileState({
				context: CONTEXT,
				profile: snapshot({ status: "error", error: apiError(500, "req-9") }),
			}),
		).toEqual({ kind: "failed", requestId: "req-9" });
	});

	it("without an API error there's no request id", () => {
		expect(
			resolveProfileState({
				context: CONTEXT,
				profile: snapshot({ status: "error", error: new Error("offline") }),
			}),
		).toEqual({ kind: "failed", requestId: null });
	});

	it("with a held profile a failed background refresh doesn't erase it", () => {
		/**
		 * If the name and face disappeared on one network blip, the user would read the person as having
		 * left.
		 */
		expect(
			resolveProfileState({
				context: CONTEXT,
				profile: snapshot({
					status: "error",
					error: apiError(500),
					data: PROFILE,
				}),
			}),
		).toEqual({ kind: "profile", profile: PROFILE });
	});

	it("carries the successful profile as is", () => {
		expect(
			resolveProfileState({
				context: CONTEXT,
				profile: snapshot({ status: "success", data: PROFILE }),
			}),
		).toEqual({ kind: "profile", profile: PROFILE });
	});
});

describe("identity and device storage don't enter the decision", () => {
	/**
	 * **The most important group in this file.**
	 *
	 * The public profile must render for guests, before `/me` answers, and on devices where SQLite has
	 * not opened. That independence exists only as "no condition was written", and one added line
	 * breaks it silently. The symptom never appears on a logged-in developer's screen.
	 */
	const PHASES: SessionPhase[] = [
		"booting",
		"guest",
		"authenticated",
		"unavailable",
	];
	const SCOPES: MobileLocalScopeStatus[] = [
		"idle",
		"opening",
		"ready",
		"error",
	];

	const cases = [
		["loading", snapshot(), { kind: "loading" }],
		["offline", snapshot({ paused: true }), { kind: "offline" }],
		[
			"none",
			snapshot({ status: "error", error: apiError(404) }),
			{ kind: "missing" },
		],
		[
			"Profile",
			snapshot({ status: "success", data: PROFILE }),
			{ kind: "profile", profile: PROFILE },
		],
	] as const;

	for (const [name, profile, expected] of cases)
		for (const session of PHASES)
			for (const localScope of SCOPES)
				it(`${name}: ${session} × ${localScope}`, () => {
					expect(
						resolveProfileState({ context: { session, localScope }, profile }),
					).toEqual(expected);
				});
});
