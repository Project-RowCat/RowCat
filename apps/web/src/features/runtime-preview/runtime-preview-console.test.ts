import { describe, expect, it } from "vitest";
import {
	appendConsoleEntry,
	emptyRuntimePreviewConsole,
	formatConsoleArgs,
	RUNTIME_CONSOLE_LIMIT,
} from "./runtime-preview-console.ts";

describe("console buffer", () => {
	it("past the cap the oldest are dropped and counted", () => {
		let console = emptyRuntimePreviewConsole();
		for (let i = 0; i < RUNTIME_CONSOLE_LIMIT + 7; i += 1)
			console = appendConsoleEntry(console, {
				kind: "log",
				text: `line ${i}`,
				code: null,
				component: null,
			});
		expect(console.entries).toHaveLength(RUNTIME_CONSOLE_LIMIT);
		expect(console.dropped).toBe(7);
		expect(console.entries[0]?.text).toBe("line 7");
		expect(console.entries.at(-1)?.text).toBe(
			`line ${RUNTIME_CONSOLE_LIMIT + 6}`,
		);
	});

	it("ids keep increasing after dropped lines", () => {
		let console = emptyRuntimePreviewConsole();
		for (let i = 0; i < 5; i += 1)
			console = appendConsoleEntry(
				console,
				{ kind: "log", text: "x", code: null, component: null },
				3,
			);
		expect(console.entries.map((entry) => entry.id)).toEqual([3, 4, 5]);
	});
});

describe("value formatting", () => {
	it("top-level strings without quotes, the rest like JSON", () => {
		expect(
			formatConsoleArgs(["count", 3, true, null, { a: "b", n: [1, 2] }]),
		).toBe('count 3 true null {a: "b", n: [1, 2]}');
	});

	it("depth, entries and length are capped", () => {
		const deep = { a: { b: { c: { d: { e: 1 } } } } };
		expect(formatConsoleArgs([deep])).toBe("{a: {b: {c: {d: {…}}}}}");
		const wide = Array.from({ length: 30 }, (_, i) => i);
		expect(formatConsoleArgs([wide])).toContain("… 10 more");
		const long = "x".repeat(5_000);
		expect(formatConsoleArgs([long]).length).toBeLessThanOrEqual(2_001);
		expect(formatConsoleArgs([{ s: long }])).toContain("…");
	});
});
