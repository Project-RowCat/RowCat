import {
	isOwnProfile,
	type PublicProfile,
	profileDisplayName,
	profileInitial,
	UNNAMED_PROFILE_LABEL,
} from "@rowcat/domain";
import { describe, expect, it } from "vitest";

/**
 * Checks how a profile identifies who it refers to and how it is labeled, without rendering.
 *
 * The rules live in pure functions in @rowcat/domain, shared with the future Expo app. These tests
 * verify three things: a title exists even when the name is empty, ownership is decided by id
 * alone, and an initial is never split in the middle of a Unicode character.
 *
 * The tests live in apps/web because @rowcat/domain has no test runner yet. Locking the rule where
 * it is consumed is cheaper than adding a runner. Web tests are pure-logic tests that run without
 * React (vitest.config.ts).
 *
 * Markup is not asserted. Class and tag assertions break on every design change without catching
 * the rules that matter here.
 */

const profile = (patch: Partial<PublicProfile> = {}): PublicProfile => ({
	id: "member-1",
	displayName: "NightCat",
	avatarUrl: null,
	bio: null,
	followers: 0,
	...patch,
});

describe("display name", () => {
	it("uses the name as is when present", () => {
		expect(profileDisplayName(profile())).toBe("NightCat");
	});

	it.each([
		["an empty string", ""],
		["only spaces", "   "],
		["only line breaks", "\n\t"],
	])("%s is replaced by the state label", (_label, displayName) => {
		/**
		 * If the name is cleared entirely, the page has no h1, and neither readers nor assistive
		 * technology can tell whose profile this is. A whitespace-only name is treated as absent too: it
		 * would leave a heading filled with invisible characters, which reads as broken and is worse than
		 * having none.
		 */
		expect(profileDisplayName(profile({ displayName }))).toBe(
			UNNAMED_PROFILE_LABEL,
		);
	});

	it("the replacement does not read like a person's name", () => {
		// Recorded decision: the placeholder is `Unnamed creator`. Words like `Unknown` or `Deleted member` are avoided,
		// because they read as if a name had been invented. What must be conveyed is the state, not a
		// name.
		expect(UNNAMED_PROFILE_LABEL).toBe("Unnamed creator");
	});
});

describe("ownership", () => {
	it("the same member id is your own profile", () => {
		expect(isOwnProfile(profile({ id: "m1" }), "m1")).toBe(true);
	});

	it("a different id is not", () => {
		expect(isOwnProfile(profile({ id: "m1" }), "m2")).toBe(false);
	});

	it("a guest has no own profile", () => {
		expect(isOwnProfile(profile(), null)).toBe(false);
	});

	it("a different person is not you **even with the same name**", () => {
		/**
		 * Comparing by display name is blocked because that is the reason this function exists. Display
		 * names are not unique, so judging ownership by name would show an `Edit profile` link on someone else's
		 * profile whenever two people share a name. Clicking it does not let the viewer edit that
		 * profile, since editing lives under `/me/*` and the target comes only from the cookie. The
		 * screen is still defective, because it looks editable.
		 */
		const alice = profile({ id: "alice", displayName: "Cat" });
		expect(isOwnProfile(alice, "bob")).toBe(false);
	});
});

describe("avatar placeholder initial", () => {
	it("uppercases the first letter", () => {
		expect(profileInitial(profile({ displayName: "rowcat" }))).toBe("R");
	});

	it("a Hangul name gives one syllable as is", () => {
		// A Hangul name ("night cat"): one syllable block is one character.
		expect(
			profileInitial(
				profile({ displayName: "\uBC24\uC758\uACE0\uC591\uC774" }),
			),
		).toBe("\uBC24");
	});

	it("does not split a character in an emoji name", () => {
		/**
		 * Slicing with `name[0]` splits surrogate pairs and leaves a lone surrogate half (U+D83D) on
		 * screen. `Array.from` slices by code point, so a complete emoji comes out.
		 */
		const initial = profileInitial(profile({ displayName: "🐈‍⬛ Black cat" }));
		expect(initial).toBe("🐈");
		expect(initial).not.toContain("�");
	});

	it("ignores surrounding whitespace", () => {
		expect(profileInitial(profile({ displayName: "   rowcat" }))).toBe("R");
	});

	it("nothing to take gives an empty string — no invented question mark", () => {
		// Returns an empty string for a whitespace-only name. The caller draws the icon. Producing `?`
		// here would make that symbol look like part of the name.
		expect(profileInitial(profile({ displayName: "  " }))).toBe("");
	});
});
