import { describe, expect, test } from "vitest";
import { resolveWebAuthnConfig, rpIdCoversHost } from "./webauthn-config.ts";

/**
 * WebAuthn config: this decision is the security boundary.
 *
 * A mistake here is not a server error. If the rpID does not cover an origin, the browser refuses
 * registration, nothing is logged on the server, and the user sees it as a device problem. So that
 * combination is cut at boot and the rule is checked by value.
 */

const WEB = "https://example.com";

describe("does the rpID cover the origin", () => {
	test("the same host covers", () => {
		expect(rpIdCoversHost("example.com", "example.com")).toBe(true);
	});

	test("a parent domain covers its subdomains", () => {
		expect(rpIdCoversHost("example.com", "app.example.com")).toBe(true);
	});

	/**
	 * Comparing suffixes as plain strings is the hole: `"evil-example.com".endsWith("example.com")` is
	 * true. Without the dot boundary an attacker-registered domain could use our rpID, meaning
	 * passkeys made there would also work on our site.
	 */
	test("a suffix without a dot boundary does not cover", () => {
		expect(rpIdCoversHost("example.com", "evil-example.com")).toBe(false);
		expect(rpIdCoversHost("example.com", "notexample.com")).toBe(false);
	});

	test("a subdomain does not cover its parent", () => {
		expect(rpIdCoversHost("app.example.com", "example.com")).toBe(false);
	});
});

describe("config resolution", () => {
	test("empty uses the canonical web origin's host", () => {
		const result = resolveWebAuthnConfig({
			rpId: "",
			rpName: "",
			origins: [WEB],
			webOrigin: WEB,
		});
		expect(result).toMatchObject({
			ok: true,
			config: { rpId: "example.com", rpName: "RowCat" },
		});
	});

	/**
	 * The API domain must not become the default: the plugin's default is the `baseURL` host, which in
	 * our deployment is the API domain, while the ceremony happens on the web origin. Choosing that
	 * value explicitly is this function's reason to exist, so derivation from the web origin is pinned
	 * by value.
	 */
	test("a parent domain covers several subdomains", () => {
		const result = resolveWebAuthnConfig({
			rpId: "example.com",
			rpName: "",
			origins: [WEB, "https://beta.example.com"],
			webOrigin: WEB,
		});
		expect(result.ok).toBe(true);
	});

	test("blocks boot when an origin isn't covered", () => {
		const result = resolveWebAuthnConfig({
			rpId: "www.example.com",
			rpName: "",
			origins: [WEB, "https://admin.example.com"],
			webOrigin: WEB,
		});
		expect(result.ok).toBe(false);
	});

	test("blocks boot when there are no origins at all", () => {
		expect(
			resolveWebAuthnConfig({
				rpId: "",
				rpName: "",
				origins: [],
				webOrigin: WEB,
			}).ok,
		).toBe(false);
	});

	/** Local development still works: the host is the same even with different ports. */
	test("the localhost development combination passes", () => {
		const result = resolveWebAuthnConfig({
			rpId: "",
			rpName: "",
			origins: ["http://localhost:3000", "http://localhost:3002"],
			webOrigin: "http://localhost:3000",
		});
		expect(result).toMatchObject({ ok: true, config: { rpId: "localhost" } });
	});
});
