import { APP_SCHEME } from "@rowcat/domain";
import { describe, expect, test } from "vitest";
import { corsOrigins } from "../env.ts";
import { auth } from "./index.ts";
import {
	APPLE_AUTH_ORIGIN,
	NATIVE_AUTH_ORIGIN,
	withAppleAuthOrigin,
	withNativeAuthOrigin,
} from "./trusted-origins.ts";

/**
 * Pins that the auth trust list and the browser CORS list stay separate. The obvious fix for a
 * native sign-in 403 is adding `rowcat://` to `WEB_ORIGIN`, which works while silently letting the
 * CORS allowlist accept a custom scheme; nothing else would catch that.
 */

describe("withNativeAuthOrigin", () => {
	test("puts one native scheme after the browser origins", () => {
		expect(withNativeAuthOrigin(["https://example.com"])).toEqual([
			"https://example.com",
			"rowcat://",
		]);
	});

	test("the scheme comes from the domain's single source", () => {
		expect(NATIVE_AUTH_ORIGIN).toBe(`${APP_SCHEME}://`);
	});

	test("does not add it twice when it is already there", () => {
		expect(withNativeAuthOrigin(["rowcat://"])).toEqual(["rowcat://"]);
	});

	test("does not modify the input", () => {
		const web = ["https://a.test"];
		withNativeAuthOrigin(web);
		expect(web).toEqual(["https://a.test"]);
	});

	/**
	 * A broad `exp://` wildcard would make any Expo Go session a redirect target. Better Auth's Expo
	 * plugin adds `exp://` itself only when `NODE_ENV === "development"`.
	 */
	test("we never write an exp:// wildcard", () => {
		for (const origin of withNativeAuthOrigin(["https://a.test"]))
			expect(origin).not.toMatch(/^exp:\/\//);
	});
});

describe("withAppleAuthOrigin", () => {
	/**
	 * Apple's callback is a cross-site POST (`response_mode=form_post`). Behind a CDN that sets a
	 * `SameSite=None` cookie, the origin check runs on it and rejects Apple after sign-in completes.
	 */
	test("a deployment with it on gets the Apple origin", () => {
		expect(withAppleAuthOrigin(["https://example.com"], true)).toEqual([
			"https://example.com",
			APPLE_AUTH_ORIGIN,
		]);
	});

	/**
	 * The point of this group: the list also validates redirect destinations, so adding a value is
	 * trust we should not carry when Apple is off.
	 */
	test("a deployment with it off adds nothing", () => {
		expect(withAppleAuthOrigin(["https://example.com"], false)).toEqual([
			"https://example.com",
		]);
	});

	test("does not add it twice when it is already there", () => {
		expect(withAppleAuthOrigin([APPLE_AUTH_ORIGIN], true)).toEqual([
			APPLE_AUTH_ORIGIN,
		]);
	});

	test("does not modify the input", () => {
		const web = ["https://a.test"];
		withAppleAuthOrigin(web, true);
		expect(web).toEqual(["https://a.test"]);
	});

	/** A single origin, not a wildcard; subdomains are not trusted. */
	test("it is exactly one origin", () => {
		expect(APPLE_AUTH_ORIGIN).toBe("https://appleid.apple.com");
	});
});

describe("auth config", () => {
	test("trusts the native scheme", () => {
		expect(auth.options.trustedOrigins).toContain(NATIVE_AUTH_ORIGIN);
	});

	test("the Expo server plugin is attached", () => {
		/**
		 * Without it, native requests arrive with no `Origin` (nothing copies `expo-origin`) and the
		 * OAuth callback cannot carry cookies back to the app: sign-in appears to work, then the session
		 * is gone.
		 */
		expect(auth.options.plugins?.map((plugin) => plugin.id)).toContain("expo");
	});

	test("the config has no broad exp:// wildcard", () => {
		const configured = auth.options.trustedOrigins;
		expect(Array.isArray(configured)).toBe(true);
		for (const origin of configured as string[])
			expect(origin).not.toMatch(/^exp:\/\//);
	});
});

describe("browser CORS", () => {
	/**
	 * The P0 of this file: browsers never send a custom scheme as `Origin`, so one here admits nothing
	 * and only removes `parseOriginList`'s typo rejection.
	 */
	test("the native scheme is not on the allowlist", () => {
		expect(corsOrigins).not.toContain(NATIVE_AUTH_ORIGIN);
		for (const origin of corsOrigins) expect(origin).toMatch(/^https?:\/\//);
	});

	/**
	 * Apple's origin does not belong here either: it answers "may we accept an auth callback from
	 * here", not "may a browser call our API". Mixed, appleid.apple.com joins our CORS allowlist.
	 */
	test("the Apple origin is not on the allowlist", () => {
		expect(corsOrigins).not.toContain(APPLE_AUTH_ORIGIN);
	});
});
