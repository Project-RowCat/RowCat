import { describe, expect, test, vi } from "vitest";
import {
	createCorsOriginMatcher,
	isLoopbackOrigin,
	parseOriginList,
} from "./origins.ts";

/**
 * Only guards that CORS does not fail silently. Real CORS behaviour cannot be verified with
 * in-process requests (`app.request`): without browser enforcement a missing header still succeeds,
 * so the checks sit on configuration parsing.
 */
describe("parseOriginList", () => {
	test("normalizes to the same shape as the Origin header", () => {
		// Trailing slash, path and uppercase host are all shapes a browser never sends.
		expect(
			parseOriginList("https://example.com/, https://EXAMPLE.com/app"),
		).toEqual({ origins: ["https://example.com"], invalid: [] });
	});

	test("the port disappears only when it is the default", () => {
		expect(
			parseOriginList("http://localhost:3000,https://a.test:443").origins,
		).toEqual(["http://localhost:3000", "https://a.test"]);
	});

	test("returns values that can't be read as origins separately", () => {
		// A host without a scheme is the commonest typo; ignoring it silently just empties the whitelist.
		expect(parseOriginList("example.com, ftp://a.test").invalid).toEqual([
			"example.com",
			"ftp://a.test",
		]);
	});

	test("an empty value is an empty list", () => {
		expect(parseOriginList(" , ")).toEqual({ origins: [], invalid: [] });
	});
});

describe("isLoopbackOrigin", () => {
	test("separates production domains from local", () => {
		expect(isLoopbackOrigin("http://localhost:3000")).toBe(true);
		expect(isLoopbackOrigin("http://127.0.0.1:3000")).toBe(true);
		expect(isLoopbackOrigin("https://example.com")).toBe(false);
	});
});

describe("createCorsOriginMatcher", () => {
	const allowed = ["https://example.com"];

	test("returns only allowlisted origins as they are", () => {
		const match = createCorsOriginMatcher(allowed);
		expect(match("https://example.com")).toBe("https://example.com");
		expect(match("https://evil.test")).toBeNull();
	});

	test("rejections are logged, but the same origin is not logged repeatedly", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const match = createCorsOriginMatcher(allowed);

		match("https://not-allowed.example");
		match("https://not-allowed.example");

		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0]?.[0]).toContain("https://not-allowed.example");
		warn.mockRestore();
	});

	test("a request with no Origin is neither rejected nor logged", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(createCorsOriginMatcher(allowed)("")).toBeNull();
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});
});
