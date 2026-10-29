import type { RuntimeDiagnostic } from "@rowcat/runtime-compiler";
import { describe, expect, it } from "vitest";
import type { RuntimeMarker } from "../editor/code-editor.tsx";
import {
	filterRuntimeProblems,
	mergeRuntimeProblems,
	RUNTIME_PROBLEM_FILTERS,
	type RuntimeProblem,
	runtimeProblemLocation,
} from "./problems.ts";

/**
 * Rules for folding the two Problems sources into one list. Order and duplicates are the whole
 * subject. Both problems show only on screen and look like a cluttered list, so reviews pass over
 * them. But one duplicated line can recommend a fix that this product does not offer.
 */

const marker = (over: Partial<RuntimeMarker> = {}): RuntimeMarker => ({
	fileId: "file-1",
	path: "src/main.tsx",
	line: 2,
	column: 20,
	message: "Cannot find module './missing'.",
	severity: "error",
	...over,
});

const diagnostic = (
	over: Partial<RuntimeDiagnostic> = {},
): RuntimeDiagnostic => ({
	code: "runtime_module_not_found",
	severity: "error",
	message: 'Cannot find "./missing".',
	source: "module",
	path: "src/main.tsx",
	line: 2,
	column: 20,
	...over,
});

describe("two sources become one list", () => {
	it("draws both", () => {
		const problems = mergeRuntimeProblems({
			markers: [marker({ line: 9, column: 1, message: "type error" })],
			diagnostics: [diagnostic()],
		});
		expect(problems.map((problem) => problem.source)).toEqual([
			"module",
			"typescript",
		]);
	});

	/**
	 * When both report the same spot, RowCat's message is kept. TypeScript's wording implies an npm
	 * install, which this product has no path for.
	 */
	it("at the same place RowCat's verdict wins", () => {
		const problems = mergeRuntimeProblems({
			markers: [marker()],
			diagnostics: [diagnostic()],
		});
		expect(problems).toHaveLength(1);
		expect(problems[0]?.source).toBe("module");
		expect(problems[0]?.message).toContain("Cannot find");
	});

	it("does not fold at different places", () => {
		const problems = mergeRuntimeProblems({
			markers: [marker({ line: 3 })],
			diagnostics: [diagnostic()],
		});
		expect(problems).toHaveLength(2);
	});

	/**
	 * Editor `info` markers are hints, not diagnostics. This list has no such severity, so they are
	 * dropped.
	 */
	it("info severity doesn't appear in the list", () => {
		const problems = mergeRuntimeProblems({
			markers: [marker({ severity: "info", line: 40 })],
			diagnostics: [],
		});
		expect(problems).toEqual([]);
	});
});

/**
 * TypeScript emits several identical markers at one spot. They add nothing to each other, and keys
 * are built from position and message, so React would receive duplicate keys.
 */
describe("one row even if the editor says the same thing several times", () => {
	const repeated = (count: number): RuntimeMarker[] =>
		Array.from({ length: count }, () =>
			marker({
				line: 16,
				column: 19,
				message:
					"Left side of comma operator is unused and has no side effects.",
			}),
		);

	it("markers with the same place, message and severity become one row", () => {
		const problems = mergeRuntimeProblems({
			markers: repeated(5),
			diagnostics: [],
		});
		expect(problems).toHaveLength(1);
		expect(problems[0]?.source).toBe("typescript");
	});

	it("keys don't collide", () => {
		const problems = mergeRuntimeProblems({
			markers: [
				...repeated(5),
				marker({ line: 16, column: 19, message: "different message" }),
				marker({ line: 16, column: 19, severity: "warning" }),
			],
			diagnostics: [],
		});
		expect(new Set(problems.map((one) => one.key)).size).toBe(problems.length);
	});

	/**
	 * Same spot with different messages is a different problem. Folding them would hide one thing to
	 * fix.
	 */
	it("does not fold different messages", () => {
		const problems = mergeRuntimeProblems({
			markers: [
				marker({ line: 16, column: 19, message: "comma operator" }),
				marker({ line: 16, column: 19, message: "Cannot find name" }),
			],
			diagnostics: [],
		});
		expect(problems).toHaveLength(2);
	});

	/**
	 * Severity is part of the fold key. The same message as an error and as a warning are separate
	 * rows.
	 */
	it("does not fold different severities", () => {
		const problems = mergeRuntimeProblems({
			markers: [
				marker({ line: 16, column: 19, message: "same message" }),
				marker({
					line: 16,
					column: 19,
					message: "same message",
					severity: "warning",
				}),
			],
			diagnostics: [],
		});
		expect(problems.map((one) => one.severity).sort()).toEqual([
			"error",
			"warning",
		]);
	});

	/**
	 * Folding applies to editor markers only. Two RowCat diagnostics at the same spot with different
	 * codes are different problems.
	 */
	it("RowCat diagnostics don't fold even at the same place", () => {
		const problems = mergeRuntimeProblems({
			markers: [],
			diagnostics: [
				diagnostic({ code: "runtime_eval_forbidden", message: "same message" }),
				diagnostic({
					code: "runtime_module_not_found",
					message: "same message",
				}),
			],
		});
		expect(problems).toHaveLength(2);
	});

	/** However many markers overlap, they all yield the spot to RowCat's diagnostic. */
	it("every overlapping marker yields to RowCat's verdict", () => {
		const problems = mergeRuntimeProblems({
			markers: [marker(), marker(), marker()],
			diagnostics: [diagnostic()],
		});
		expect(problems).toHaveLength(1);
		expect(problems[0]?.source).toBe("module");
	});
});

describe("order", () => {
	/**
	 * A diagnostic not tied to a file (such as a missing entry point) sorts to the top. It is usually
	 * the cause of the rest. Buried below, the author would fix per-file errors one by one and reach
	 * the real cause last.
	 */
	it("diagnostics without a file stand at the top", () => {
		const problems = mergeRuntimeProblems({
			markers: [],
			diagnostics: [
				diagnostic({ path: "src/a.tsx", line: 1 }),
				diagnostic({
					code: "runtime_entry_missing",
					path: undefined,
					line: undefined,
					column: undefined,
				}),
			],
		});
		expect(problems[0]?.code).toBe("runtime_entry_missing");
		expect(problems[0]?.path).toBe("");
	});

	it("deterministic by path, line and column", () => {
		const problems = mergeRuntimeProblems({
			markers: [],
			diagnostics: [
				diagnostic({ path: "src/b.tsx", line: 1, column: 1 }),
				diagnostic({ path: "src/a.tsx", line: 9, column: 1 }),
				diagnostic({ path: "src/a.tsx", line: 2, column: 5 }),
				diagnostic({ path: "src/a.tsx", line: 2, column: 1 }),
			],
		});
		expect(
			problems.map(
				(problem) => `${problem.path}:${problem.line}:${problem.column}`,
			),
		).toEqual([
			"src/a.tsx:2:1",
			"src/a.tsx:2:5",
			"src/a.tsx:9:1",
			"src/b.tsx:1:1",
		]);
	});

	it("the order sources arrive in doesn't change the result", () => {
		const markers = [marker({ line: 5, column: 2, message: "types" })];
		const diagnostics = [diagnostic({ line: 1 })];
		expect(mergeRuntimeProblems({ markers, diagnostics })).toEqual(
			mergeRuntimeProblems({
				markers: [...markers].reverse(),
				diagnostics: [...diagnostics].reverse(),
			}),
		);
	});

	it("keys don't fold two problems on the same line", () => {
		const problems = mergeRuntimeProblems({
			markers: [],
			diagnostics: [
				diagnostic({ code: "runtime_eval_forbidden", column: 1 }),
				diagnostic({ code: "runtime_module_not_found", column: 1 }),
			],
		});
		expect(new Set(problems.map((problem) => problem.key)).size).toBe(2);
	});
});

const problem = (over: Partial<RuntimeProblem> = {}): RuntimeProblem => ({
	key: "k",
	path: "src/main.tsx",
	line: 12,
	column: 4,
	message: "type error",
	severity: "error",
	source: "typescript",
	code: "ts2322",
	...over,
});

/**
 * Shows only the position that is known. Filling an unknown position with 1:1 would make it
 * indistinguishable from a real coordinate, and readers would look for the cause on the file's
 * first line. Navigating to 1:1 on click is a separate fact.
 */
describe("location display", () => {
	it("writes both line and column when known", () => {
		expect(runtimeProblemLocation(problem())).toBe("src/main.tsx:12:4");
	});

	it("writes only the line without a column", () => {
		expect(runtimeProblemLocation(problem({ column: undefined }))).toBe(
			"src/main.tsx:12",
		);
	});

	it("writes only the file without a line", () => {
		expect(
			runtimeProblemLocation(problem({ line: undefined, column: undefined })),
		).toBe("src/main.tsx");
	});

	/** A diagnostic with no file belongs to the whole project; there is no coordinate to point at. */
	it("writes the source without a file", () => {
		expect(
			runtimeProblemLocation(
				problem({
					path: "",
					line: undefined,
					column: undefined,
					source: "module",
				}),
			),
		).toBe("Module resolution");
	});

	it("does not write invented coordinates", () => {
		const unknown = runtimeProblemLocation(
			problem({
				path: "",
				line: undefined,
				column: undefined,
				source: "runtime",
			}),
		);
		expect(unknown).not.toContain("1:1");
		expect(unknown).not.toContain(":");
	});
});

/** The filter is a display axis. It changes neither the canonical list's order nor its contents. */
describe("severity filter", () => {
	const problems = [
		problem({ key: "e1", severity: "error" }),
		problem({ key: "w1", severity: "warning" }),
		problem({ key: "e2", severity: "error" }),
	];

	it("all returns the input as is", () => {
		expect(filterRuntimeProblems(problems, "all")).toBe(problems);
	});

	it("picks only errors", () => {
		expect(
			filterRuntimeProblems(problems, "errors").map((one) => one.key),
		).toEqual(["e1", "e2"]);
	});

	it("picks only warnings", () => {
		expect(
			filterRuntimeProblems(problems, "warnings").map((one) => one.key),
		).toEqual(["w1"]);
	});

	/**
	 * Filtering must not change order. Someone who switches back to the full list must not lose the
	 * row they just saw.
	 */
	it("the remaining rows keep their order", () => {
		const kept = filterRuntimeProblems(problems, "errors").map(
			(one) => one.key,
		);
		expect(kept).toEqual(
			problems.filter((one) => one.severity === "error").map((one) => one.key),
		);
	});

	it("leaves the original alone", () => {
		const before = [...problems];
		for (const filter of RUNTIME_PROBLEM_FILTERS)
			filterRuntimeProblems(problems, filter);
		expect(problems).toEqual(before);
	});

	/** When nothing matches, the result is an empty list, not the full list. */
	it("empty when no severity matches", () => {
		expect(
			filterRuntimeProblems([problem({ severity: "error" })], "warnings"),
		).toEqual([]);
		expect(filterRuntimeProblems([], "all")).toEqual([]);
	});
});
