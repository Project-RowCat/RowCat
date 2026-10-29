import { describe, expect, it } from "vitest";
import { apiBaseUrl, DEVELOPMENT_API_ORIGIN } from "./base-url.ts";
import { createRowCatClient } from "./client.ts";
import * as sdk from "./index.ts";

/**
 * **This package has no default origin.**
 *
 * For a while one operator's address was the default, and a fork that forgot to pass an origin
 * quietly attached to that server. Two things are guarded here: omitting it throws, and no such
 * constant reappears on the public surface.
 */
describe("apiBaseUrl", () => {
	it("appends the contract's path prefix to the origin", () => {
		expect(apiBaseUrl("https://api.example.com")).toBe(
			"https://api.example.com/v2",
		);
		expect(apiBaseUrl(DEVELOPMENT_API_ORIGIN)).toBe("http://localhost:3001/v2");
	});

	it("throws without an origin; there is no silent default", () => {
		expect(() => apiBaseUrl("")).toThrow(/no default origin/);
		expect(() => apiBaseUrl("   ")).toThrow(/no default origin/);
		expect(() => apiBaseUrl(undefined as unknown as string)).toThrow(
			/no default origin/,
		);
	});

	it("the client refuses an empty base too", () => {
		expect(() => createRowCatClient({ baseUrl: "" })).toThrow(
			/no default origin/,
		);
	});

	it("no operator origin constant on the public surface", () => {
		expect(Object.keys(sdk)).not.toContain("PRODUCTION_API_ORIGIN");
		expect(Object.keys(sdk)).not.toContain("API_BASE_URL");
	});
});
