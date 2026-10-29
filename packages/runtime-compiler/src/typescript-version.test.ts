import { version } from "typescript-compiler-api";
import { describe, expect, it } from "vitest";
import { RUNTIME_COMPILER_VERSION } from "./contracts.ts";

/**
 * This test is why RUNTIME_COMPILER_VERSION is bumped by hand (see the header of contracts.ts). A
 * patch to typescript can change emit output without the constant rising on its own, so the
 * TypeScript version the compiler actually uses is pinned as a value here. A commit that upgrades
 * the dependency fails this test first, and that commit is where the decision is made: did emit
 * change, and should the compiler version rise? The two values are written side by side so that
 * whoever changes one sees the other.
 */
describe("the TypeScript version the compiler brings in", () => {
	it("typescript-compiler-api is 5.9.3 and the compiler version is 1", () => {
		expect(version).toBe("5.9.3");
		expect(RUNTIME_COMPILER_VERSION).toBe(1);
	});
});
