import { describe, expect, it } from "vitest";
import { readDraftIdParam } from "./draft-id.ts";

describe("draft id parameter", () => {
	it("reads a string as is", () => {
		expect(readDraftIdParam("draft-1")).toBe("draft-1");
	});

	it("takes the first value when it arrives as an array", () => {
		expect(readDraftIdParam(["draft-1", "draft-2"])).toBe("draft-1");
	});

	/** Empty values are not ids: "not found" must be said only after actually looking. */
	it.each([undefined, "", "   ", []])("an empty value (%p) is null", (raw) => {
		expect(readDraftIdParam(raw as string | string[] | undefined)).toBeNull();
	});

	it("trims leading and trailing spaces", () => {
		expect(readDraftIdParam(" draft-1 ")).toBe("draft-1");
	});
});
