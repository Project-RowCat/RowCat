import { describe, expect, it } from "vitest";
import type { PublicProfile } from "./profile.ts";
import {
	profileContentBlocked,
	resolveProfileActions,
} from "./profile-actions.ts";
import type { PersonalizationState } from "./social.ts";

/**
 * Checks what appears at the top of a public profile without rendering. Web tests run without
 * React, so this asserts whether a button appears and in what state, not its markup.
 */

const PROFILE: PublicProfile = {
	id: "creator-1",
	displayName: "NightCat",
	avatarUrl: null,
	bio: null,
	followers: 3,
};

const state = (
	patch: Partial<PersonalizationState> = {},
): PersonalizationState => ({
	favorites: [],
	following: [],
	blocked: [],
	...patch,
});

describe("resolveProfileActions", () => {
	it("guests get follow only; no block", () => {
		expect(resolveProfileActions(PROFILE, null, undefined)).toEqual({
			kind: "guest",
		});
	});

	it("one's own profile has neither follow nor block", () => {
		expect(
			resolveProfileActions(PROFILE, "creator-1", state({ following: [] })),
		).toEqual({ kind: "own" });
	});

	it("ownership is decided by id only; the same name does not make it yours", () => {
		const sameName: PublicProfile = { ...PROFILE, id: "creator-2" };
		expect(resolveProfileActions(sameName, "creator-1", state()).kind).toBe(
			"member",
		);
	});

	it("reads the relation as is on another member's profile", () => {
		expect(
			resolveProfileActions(
				PROFILE,
				"me",
				state({ following: ["creator-1"], blocked: [] }),
			),
		).toEqual({ kind: "member", following: true, blocked: false });
	});

	it("block state comes from the relation too", () => {
		expect(
			resolveProfileActions(PROFILE, "me", state({ blocked: ["creator-1"] })),
		).toEqual({ kind: "member", following: false, blocked: true });
	});

	it("without personalization yet it draws no relation", () => {
		expect(resolveProfileActions(PROFILE, "me", undefined)).toEqual({
			kind: "member",
			following: false,
			blocked: false,
		});
	});
});

describe("profileContentBlocked", () => {
	it("true only on a blocked creator's profile", () => {
		expect(
			profileContentBlocked(
				resolveProfileActions(PROFILE, "me", state({ blocked: ["creator-1"] })),
			),
		).toBe(true);
	});

	it.each([
		["guest", null, undefined],
		["own profile", "creator-1", undefined],
		["a member not blocked", "me", undefined],
	] as const)("false for %s", (_label, viewerId, personalization) => {
		expect(
			profileContentBlocked(
				resolveProfileActions(PROFILE, viewerId, personalization),
			),
		).toBe(false);
	});
});
