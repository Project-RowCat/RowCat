import { describe, expect, it } from "vitest";
import { containsPattern, escapeLikePattern, prefixPattern } from "./like.ts";

describe("LIKE escaping", () => {
	it("wraps the three pattern characters with a backslash", () => {
		expect(escapeLikePattern("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
	});
	it("a partial match puts wildcards only at both ends", () => {
		expect(containsPattern("%")).toBe("%\\%%");
	});
	it("a prefix match puts a wildcard only at the end", () => {
		expect(prefixPattern("admin._")).toBe("admin.\\_%");
	});
});
