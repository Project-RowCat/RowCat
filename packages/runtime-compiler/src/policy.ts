import ts from "typescript-compiler-api";
import {
	RUNTIME_DIAGNOSTIC_CODE,
	type RuntimeDiagnostic,
	type RuntimeDiagnosticCode,
} from "./contracts.ts";
import { positionOf, runtimeDiagnostic } from "./diagnostics.ts";

/**
 * Scans for syntax that RowCat forbids.
 *
 * Not a sandbox. This pass blocks only syntax written directly, and workarounds are easy, for
 * example globalThis['ev' + 'al'] or (0, Function)('return this')(). Never write anywhere that 'the
 * compiler blocks eval, so creator code is safe.' Execution isolation belongs to the future WASM
 * VM. This pass provides three things: fast feedback, deterministic language policy, and defense in
 * depth that shrinks the attack surface. Those are useful, but they are not a boundary.
 *
 * No data-flow proof. There is no scope analysis and no alias tracking, so code that shadows
 * Function with a local variable gets a false positive (const Function = 1; is blocked). Erring in
 * that direction is intentional. Erring the other way would let creators believe the code is
 * allowed and build on it, and the whole project would break when the VM arrives.
 */

const FORBIDDEN_IDENTIFIER: Record<string, RuntimeDiagnosticCode> = {
	eval: RUNTIME_DIAGNOSTIC_CODE.evalForbidden,
	Function: RUNTIME_DIAGNOSTIC_CODE.functionConstructorForbidden,
	WebAssembly: RUNTIME_DIAGNOSTIC_CODE.webAssemblyForbidden,
};

const MESSAGE: Record<RuntimeDiagnosticCode, string> = {
	[RUNTIME_DIAGNOSTIC_CODE.evalForbidden]:
		"eval can't be used. Runtime code must be fully known at compile time.",
	[RUNTIME_DIAGNOSTIC_CODE.functionConstructorForbidden]:
		"The Function constructor can't be used. There is no path that builds code from strings.",
	[RUNTIME_DIAGNOSTIC_CODE.webAssemblyForbidden]: "WebAssembly can't be used.",
	[RUNTIME_DIAGNOSTIC_CODE.dynamicImportForbidden]:
		"Dynamic import can't be used. Every module is linked statically.",
	[RUNTIME_DIAGNOSTIC_CODE.requireForbidden]:
		"require can't be used. Link modules with import statements.",
} as Record<RuntimeDiagnosticCode, string>;

/**
 * Whether the identifier is a reference rather than a declaration or property name. Without this
 * check, ordinary names such as obj.eval, { eval: 1 } or const eval = ... would block the whole
 * project. Making the check broader, for example with scope analysis, would turn it into half a
 * type checker.
 */
function isReference(node: ts.Identifier): boolean {
	const parent = node.parent as ts.Node | undefined;
	if (!parent) return true;
	switch (parent.kind) {
		case ts.SyntaxKind.PropertyAccessExpression:
			return (parent as ts.PropertyAccessExpression).name !== node;
		case ts.SyntaxKind.QualifiedName:
			return (parent as ts.QualifiedName).right !== node;
		case ts.SyntaxKind.PropertyAssignment:
			return (parent as ts.PropertyAssignment).name !== node;
		case ts.SyntaxKind.PropertySignature:
		case ts.SyntaxKind.MethodSignature:
		case ts.SyntaxKind.MethodDeclaration:
		case ts.SyntaxKind.PropertyDeclaration:
		case ts.SyntaxKind.EnumMember:
		case ts.SyntaxKind.ImportSpecifier:
		case ts.SyntaxKind.ExportSpecifier:
		case ts.SyntaxKind.BindingElement:
		case ts.SyntaxKind.Parameter:
		case ts.SyntaxKind.VariableDeclaration:
		case ts.SyntaxKind.FunctionDeclaration:
		case ts.SyntaxKind.ClassDeclaration:
		case ts.SyntaxKind.TypeParameter:
			return false;
		default:
			return true;
	}
}

export function scanRuntimePolicy(
	file: ts.SourceFile,
	path: string,
): RuntimeDiagnostic[] {
	const found: RuntimeDiagnostic[] = [];

	const report = (node: ts.Node, code: RuntimeDiagnosticCode): void => {
		found.push(
			runtimeDiagnostic(
				code,
				"policy",
				MESSAGE[code] ?? "This syntax can't be used in the runtime.",
				positionOf(file, node.getStart(file), node.getWidth(file), path),
			),
		);
	};

	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node)) {
			/**
			 * Dynamic import(...) is blocked even for local files. The slice's promise is that the module
			 * graph is fully known at compile time. That promise lets the loader instantiate only a
			 * pre-built graph, so arbitrary code cannot be loaded later.
			 */
			if (node.expression.kind === ts.SyntaxKind.ImportKeyword)
				report(node, RUNTIME_DIAGNOSTIC_CODE.dynamicImportForbidden);
			else if (
				ts.isIdentifier(node.expression) &&
				node.expression.text === "require"
			)
				report(node, RUNTIME_DIAGNOSTIC_CODE.requireForbidden);
		}

		if (ts.isIdentifier(node)) {
			const code = FORBIDDEN_IDENTIFIER[node.text];
			if (code !== undefined && isReference(node)) report(node, code);
		}

		ts.forEachChild(node, visit);
	};

	ts.forEachChild(file, visit);
	return found;
}
