import { describe, expect, it } from "vitest";
import { bearerToken } from "./github-actions-oidc.ts";

describe("taking the token from the header", () => {
	it("strips the Bearer prefix", () => {
		expect(bearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
		/** Case-insensitive — that prefix belongs to the HTTP spec. */
		expect(bearerToken("bearer abc.def.ghi")).toBe("abc.def.ghi");
	});

	it.each([
		undefined,
		"",
		"abc.def.ghi",
		"Basic abc",
		"Bearer ",
	])("null when it isn't the right shape (%s)", (header) => {
		expect(bearerToken(header)).toBeNull();
	});
});
