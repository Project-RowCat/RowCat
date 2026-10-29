import { describe, expect, it } from "vitest";
import { parseCreatorStack } from "./errors.ts";
import { createCallIdAllocator } from "./ids.ts";
import { canTransition, transition } from "./lifecycle.ts";

describe("state machine", () => {
	it("a failed session can only go to disposed", () => {
		expect(canTransition("failed", "ready")).toBe(false);
		expect(canTransition("failed", "running")).toBe(false);
		expect(canTransition("failed", "disposing")).toBe(true);
	});

	it("a disposed session goes nowhere", () => {
		for (const to of [
			"creating",
			"ready",
			"running",
			"disposing",
			"failed",
		] as const)
			expect(canTransition("disposed", to)).toBe(false);
	});

	it("an invalid transition throws", () => {
		expect(() => transition("disposed", "ready")).toThrow(
			/invalid runtime session transition/,
		);
		expect(transition("ready", "running")).toBe("running");
	});
});

describe("call ids", () => {
	it("increase monotonically and count issuance", () => {
		const ids = createCallIdAllocator();
		expect([ids.next(), ids.next(), ids.next()]).toEqual([1, 2, 3]);
		expect(ids.issued()).toBe(3);
	});
});

describe("creator stacks", () => {
	it("reads module ids and positions, dropping modules the host planted", () => {
		const frames = parseCreatorStack(
			"    at boom (src/main.tsx:4:35)\n    at run (src/util.ts:10:2)\n    at <anonymous> (<rowcat:graph>:1:1)\n",
		);
		expect(frames).toEqual([
			{ functionName: "boom", moduleId: "src/main.tsx", line: 4, column: 35 },
			{ functionName: "run", moduleId: "src/util.ts", line: 10, column: 2 },
		]);
	});
});
