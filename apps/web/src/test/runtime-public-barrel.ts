import ts from "typescript-compiler-api";

/**
 * Checks syntactically that the root of @rowcat/runtime (packages/runtime/src/index.ts) is a barrel
 * of named re-exports only, and collects their names.
 *
 * The public API inventory (features/docs/runtime-api-inventory.test.ts) counts this file's exports
 * and compares them with the docs. The old counter read only `export { … } from` clauses, so
 * declarations exported directly (`export interface`, `export type`, `export const`) went
 * uncounted. Type-only declarations are absent from the runtime module object too, so both checks
 * passed silently and public API could ship without docs.
 *
 * The fix narrows the file's shape rather than widening the counter. If the root holds only
 * re-exports, its export list comes completely from one syntax node (NamedExports), and any other
 * form is rejected by name. Unknown syntax is never skipped silently.
 */

export interface PublicBarrelExport {
	name: string;
	kind: "value" | "type";
}

export class PublicBarrelViolation extends Error {
	override readonly name = "PublicBarrelViolation";
}

const namesOf = (statement: ts.Statement): string[] => {
	if (ts.isVariableStatement(statement))
		return statement.declarationList.declarations.map((declaration) =>
			declaration.name.getText(),
		);
	if (ts.isExportAssignment(statement)) return ["default"];
	if (ts.isImportDeclaration(statement))
		return [statement.moduleSpecifier.getText()];
	if (
		ts.isInterfaceDeclaration(statement) ||
		ts.isTypeAliasDeclaration(statement) ||
		ts.isFunctionDeclaration(statement) ||
		ts.isClassDeclaration(statement) ||
		ts.isEnumDeclaration(statement) ||
		ts.isModuleDeclaration(statement)
	)
		return [statement.name?.getText() ?? "(unnamed)"];
	return [statement.getText().split("\n")[0]?.trim() ?? "(statement)"];
};

/**
 * The name of a syntax kind. ts.SyntaxKind[kind] returns the alias when values overlap
 * (VariableStatement equals FirstStatement), so error messages choose their names here.
 */
const kindOf = (statement: ts.Statement): string =>
	ts.isVariableStatement(statement)
		? "VariableStatement"
		: ts.SyntaxKind[statement.kind];

const violation = (fileLabel: string, what: string): PublicBarrelViolation =>
	new PublicBarrelViolation(
		`${fileLabel} must remain a named-export barrel (named re-exports only). ` +
			`${what} — keep the declaration in its own module and re-export it with \`export { name } from "./…"\`. ` +
			"Without a barrel the public API inventory (runtime-api-inventory.test.ts) cannot count the name, and a type-only declaration is absent from the runtime module object too, so it ships undocumented.",
	);

/**
 * Collects the barrel's re-exports. On the first non-barrel statement it throws at once: returning
 * the names collected so far would let callers treat the list as complete.
 */
export function collectPublicBarrelExports(
	sourceText: string,
	fileLabel: string,
): PublicBarrelExport[] {
	const source = ts.createSourceFile(
		fileLabel,
		sourceText,
		ts.ScriptTarget.ES2022,
		true,
	);
	const found: PublicBarrelExport[] = [];
	for (const statement of source.statements) {
		if (!ts.isExportDeclaration(statement))
			throw violation(
				fileLabel,
				`a directly exported declaration or a non-barrel statement: ${namesOf(statement).join(", ")} (${kindOf(statement)})`,
			);
		const clause = statement.exportClause;
		if (clause === undefined)
			throw violation(
				fileLabel,
				`an unnamed re-export: ${statement.getText()} (export * — the inventory cannot count it)`,
			);
		if (ts.isNamespaceExport(clause))
			throw violation(
				fileLabel,
				`a namespace re-export: ${statement.getText()} (export * as — the inventory cannot count the names inside)`,
			);
		if (statement.moduleSpecifier === undefined)
			throw violation(
				fileLabel,
				`an export without from: ${statement.getText()} (exports a local declaration)`,
			);
		for (const element of clause.elements)
			found.push({
				name: element.name.text,
				kind: statement.isTypeOnly || element.isTypeOnly ? "type" : "value",
			});
	}
	return found;
}
