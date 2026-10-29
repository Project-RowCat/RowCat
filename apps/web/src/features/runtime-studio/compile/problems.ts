import type {
	RuntimeDiagnostic,
	RuntimeDiagnosticSource,
} from "@rowcat/runtime-compiler";
import { deferredTranslator } from "#/lib/i18n/current.ts";
import type { RuntimeMarker } from "../editor/code-editor.tsx";

const tr = deferredTranslator("runtimeStudio");

/**
 * The single list the Problems panel draws. Two sources feed it, but the panel answers one
 * question: what is wrong right now.
 * - Monaco's TypeScript service: syntax, types, module existence (source `typescript`).
 * - The runtime compiler: entry point, module resolution, forbidden syntax (sources `module` and
 *   `policy`). They are not shown as two lists, because the author would then have to check both to
 *   answer one question. When both report a missing module at the same spot, RowCat's message wins.
 *   TypeScript's text implies an npm install, which this product does not support. Identical editor
 *   markers at one spot collapse into one row. The key includes position, message, and severity.
 *   Folding applies to editor markers only: RowCat diagnostics at one spot with different codes are
 *   different problems, and both stay (`runtime_eval_forbidden` and `runtime_module_not_found` can
 *   share a line).
 */

export interface RuntimeProblem {
	/**
	 * List key. It includes both location and code, so two different problems on one line do not fold
	 * into one.
	 */
	key: string;
	path: string;
	line?: number;
	column?: number;
	message: string;
	severity: "error" | "warning";
	source: RuntimeDiagnosticSource;
	code: string;
}

export interface RuntimeProblemsInput {
	/**
	 * Diagnostics collected from the editor. Each carries a file id, so clicking one opens that file.
	 */
	markers: readonly RuntimeMarker[];
	diagnostics: readonly RuntimeDiagnostic[];
}

/** Whether RowCat owns the diagnostic. Where positions overlap, RowCat's diagnostic wins. */
const isRowCatOwned = (source: RuntimeDiagnosticSource): boolean =>
	source !== "typescript";

const positionKey = (
	path: string,
	line: number | undefined,
	column: number | undefined,
): string => `${path}:${line ?? 0}:${column ?? 0}`;

export function mergeRuntimeProblems({
	markers,
	diagnostics,
}: RuntimeProblemsInput): RuntimeProblem[] {
	const problems: RuntimeProblem[] = [];

	for (const diagnostic of diagnostics) {
		/**
		 * Diagnostics not tied to any file (such as a missing entry point) are still drawn. Hiding them
		 * for lacking a position would drop the most important one: a project with no entry point can
		 * fail to compile while having no per-file errors.
		 */
		problems.push({
			key: `${diagnostic.code}@${positionKey(diagnostic.path ?? "", diagnostic.line, diagnostic.column)}`,
			path: diagnostic.path ?? "",
			line: diagnostic.line,
			column: diagnostic.column,
			message: diagnostic.message,
			severity: diagnostic.severity,
			source: diagnostic.source,
			code: diagnostic.code,
		});
	}

	const owned = new Set(
		problems
			.filter((problem) => isRowCatOwned(problem.source))
			.map((problem) =>
				positionKey(problem.path, problem.line, problem.column),
			),
	);

	const seen = new Set<string>();

	for (const marker of markers) {
		/** Editor `info` markers are hints, not diagnostics; this list has no such severity. */
		if (marker.severity === "info") continue;
		const at = positionKey(marker.path, marker.line, marker.column);
		if (owned.has(at)) continue;
		/**
		 * Severity is part of the key because the fold axis and the display axis must match. An error and
		 * a warning with the same spot and message are separate rows. A shared key would drop one of them
		 * or give React a duplicate key.
		 */
		const key = `ts@${at}:${marker.severity}:${marker.message}`;
		if (seen.has(key)) continue;
		seen.add(key);
		problems.push({
			key,
			path: marker.path,
			line: marker.line,
			column: marker.column,
			message: marker.message,
			severity: marker.severity,
			source: "typescript",
			code: "typescript",
		});
	}

	return sortProblems(problems);
}

/**
 * Sorting must be deterministic. The two sources arrive in orders that depend on edit order and
 * worker response timing. Unsorted, the same problem set could render in a different order each
 * time, and the reader would lose their place.
 */
function sortProblems(problems: RuntimeProblem[]): RuntimeProblem[] {
	return problems.sort((left, right) => {
		/** Diagnostics without a file sort to the top, since they are usually the cause of the rest. */
		if ((left.path === "") !== (right.path === ""))
			return left.path === "" ? -1 : 1;
		const path = left.path.localeCompare(right.path, "en");
		if (path !== 0) return path;
		if ((left.line ?? 0) !== (right.line ?? 0))
			return (left.line ?? 0) - (right.line ?? 0);
		if ((left.column ?? 0) !== (right.column ?? 0))
			return (left.column ?? 0) - (right.column ?? 0);
		return left.code.localeCompare(right.code, "en");
	});
}

/**
 * Source label, drawn only for diagnostics that have no position. A file-bound diagnostic already
 * shows its origin in the path. A project-level one has no file to point at, and inventing a
 * coordinate such as 1:1 would read as a line in some file's first line. Being a Record, adding a
 * source breaks compilation here, so an unnamed source cannot render as a silent blank.
 */
export const RUNTIME_PROBLEM_SOURCE_LABEL: Record<
	RuntimeDiagnosticSource,
	string
> = {
	typescript: "TypeScript",
	get module() {
		return tr("problemSource.module");
	},
	get policy() {
		return tr("problemSource.policy");
	},
	get runtime() {
		return tr("problemSource.runtime");
	},
};

/**
 * The location text includes only what is known: line and column, line only, or file only. For
 * module resolution, which has no file, it is the project-level source label. Unknown positions are
 * not filled with 1:1, which would be indistinguishable from a real coordinate. Navigation on click
 * may still land at 1:1, the least wrong target, but that is a separate fact and is not stated in
 * the text.
 */
export function runtimeProblemLocation(problem: RuntimeProblem): string {
	if (problem.path === "") return RUNTIME_PROBLEM_SOURCE_LABEL[problem.source];
	if (problem.line === undefined) return problem.path;
	if (problem.column === undefined) return `${problem.path}:${problem.line}`;
	return `${problem.path}:${problem.line}:${problem.column}`;
}

/**
 * What the user is looking at. This is a display axis, not a list axis. There are three options,
 * because the list has only two severities (`info` never arrives). No per-source, per-code, or
 * per-file filters. Those narrow nothing about what is wrong right now and only imitate a tool's
 * shape.
 */
export const RUNTIME_PROBLEM_FILTERS = ["all", "errors", "warnings"] as const;
export type RuntimeProblemFilter = (typeof RUNTIME_PROBLEM_FILTERS)[number];

/**
 * Selects which rows to draw; the canonical list is untouched. Merging, de-duplication, and sorting
 * already happened upstream and are not redone here. Filtering after sorting would give each filter
 * a different order, and a reader would lose their place when switching back. For `all`, the input
 * array is returned as-is. A copy would create a new array on every render, and consumers would
 * treat the value as changed.
 */
export function filterRuntimeProblems(
	problems: readonly RuntimeProblem[],
	filter: RuntimeProblemFilter,
): readonly RuntimeProblem[] {
	if (filter === "all") return problems;
	const severity = filter === "errors" ? "error" : "warning";
	return problems.filter((problem) => problem.severity === severity);
}
