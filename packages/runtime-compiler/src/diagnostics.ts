import ts from "typescript-compiler-api";
import type {
	RuntimeDiagnostic,
	RuntimeDiagnosticCode,
	RuntimeDiagnosticSeverity,
	RuntimeDiagnosticSource,
} from "./contracts.ts";
import { toProjectPath } from "./paths.ts";

/**
 * The single place that builds diagnostics.
 *
 * TypeScript's diagnostic objects are not passed to the screen as-is. They hold the whole
 * SourceFile in `file`, may use a string or a linked list for messageText, and report positions as
 * byte offsets. If the screen had to understand them, the screen would depend on the compiler.
 * Keeping them in React state would also keep a whole program alive in memory.
 */

export interface RuntimePosition {
	path?: string;
	line?: number;
	column?: number;
	length?: number;
}

export function runtimeDiagnostic(
	code: RuntimeDiagnosticCode,
	source: RuntimeDiagnosticSource,
	message: string,
	position: RuntimePosition = {},
	severity: RuntimeDiagnosticSeverity = "error",
): RuntimeDiagnostic {
	return { code, severity, message, source, ...position };
}

export function positionOf(
	file: ts.SourceFile,
	start: number,
	length: number,
	path: string,
): RuntimePosition {
	const { line, character } = file.getLineAndCharacterOfPosition(start);
	return { path, line: line + 1, column: character + 1, length };
}

/**
 * Folds one TypeScript diagnostic into our shape. A diagnostic from a file outside the project
 * returns null. Such a diagnostic is not the creator's to fix (it comes from runtime package
 * sources or compiler-injected files), so it is a compiler-side defect. Drawing it in Problems
 * would send the creator to look for the cause in their own code. The caller counts the nulls and
 * raises them as an infrastructure failure.
 */
export function fromTypeScript(
	diagnostic: ts.Diagnostic,
): RuntimeDiagnostic | null {
	const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
	const severity: RuntimeDiagnosticSeverity =
		diagnostic.category === ts.DiagnosticCategory.Error ? "error" : "warning";

	if (!diagnostic.file)
		return {
			code: `ts${diagnostic.code}`,
			severity,
			message,
			source: "typescript",
			tsCode: diagnostic.code,
		};

	const path = toProjectPath(diagnostic.file.fileName);
	if (path === null) return null;

	const position = positionOf(
		diagnostic.file,
		diagnostic.start ?? 0,
		diagnostic.length ?? 0,
		path,
	);
	return {
		code: `ts${diagnostic.code}`,
		severity,
		message,
		source: "typescript",
		tsCode: diagnostic.code,
		...position,
	};
}

/**
 * Sorting must be deterministic. TypeScript's diagnostic order follows the program's file order,
 * which comes from the input array. Without sorting, reordering the files alone would change the
 * Problems list for the same project, and tests would miss it because both lists contain the same
 * set of diagnostics.
 */
export function sortRuntimeDiagnostics(
	diagnostics: readonly RuntimeDiagnostic[],
): RuntimeDiagnostic[] {
	return [...diagnostics].sort((left, right) => {
		const path = (left.path ?? "").localeCompare(right.path ?? "", "en");
		if (path !== 0) return path;
		if ((left.line ?? 0) !== (right.line ?? 0))
			return (left.line ?? 0) - (right.line ?? 0);
		if ((left.column ?? 0) !== (right.column ?? 0))
			return (left.column ?? 0) - (right.column ?? 0);
		return left.code.localeCompare(right.code, "en");
	});
}

/** Decides emit eligibility: a single error blocks emission. */
export const hasBlockingError = (
	diagnostics: readonly RuntimeDiagnostic[],
): boolean => diagnostics.some((diagnostic) => diagnostic.severity === "error");
