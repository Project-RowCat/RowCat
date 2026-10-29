import { describe, expect, it } from "vitest";
import {
	accountDeletionGuideUrl,
	accountWebUrl,
	guardianConsentUrl,
	passwordResetWebUrl,
	publicWebUrl,
} from "./public-web.ts";

/**
 * Locks one rule by value: never guess the canonical web address. A wrong answer here becomes a
 * dead link, which reads as "the app is broken". The addresses this module builds are all places a
 * user goes when stuck (account-deletion guidance, guardian consent, password reset, the web
 * account screen).
 */

describe("publicWebUrl", () => {
	it("without an origin no address is made", () => {
		expect(publicWebUrl(null, "/account-deletion")).toBeNull();
		expect(accountDeletionGuideUrl(null)).toBeNull();
		expect(accountWebUrl(null)).toBeNull();
		expect(guardianConsentUrl(null, "/guardian/abc")).toBeNull();
		expect(passwordResetWebUrl(null)).toBeNull();
	});

	it("folds the trailing slash", () => {
		expect(publicWebUrl("https://example.test///", "/account-deletion")).toBe(
			"https://example.test/account-deletion",
		);
	});

	/**
	 * Joining a relative path would overwrite the origin's last segment, so not building one is
	 * correct.
	 */
	it("doesn't make one unless the path is absolute", () => {
		expect(publicWebUrl("https://example.test", "account-deletion")).toBeNull();
	});
});

describe("fixed paths per place", () => {
	const origin = "https://example.com";

	/** Pairs with the web route (`apps/web/src/routes/reset-password.tsx`). */
	it("Reset password", () => {
		expect(passwordResetWebUrl(origin)).toBe(
			"https://example.com/reset-password",
		);
	});

	it("public deletion guide", () => {
		expect(accountDeletionGuideUrl(origin)).toBe(
			"https://example.com/account-deletion",
		);
	});

	it("account screen", () => {
		expect(accountWebUrl(origin)).toBe("https://example.com/account");
	});

	/** The server builds the path: the token is inside it, and this app cannot invent it. */
	it("guardian consent joins the path the server gave as is", () => {
		expect(guardianConsentUrl(origin, "/guardian/tok-123")).toBe(
			"https://example.com/guardian/tok-123",
		);
	});
});
