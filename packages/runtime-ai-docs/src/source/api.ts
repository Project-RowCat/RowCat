import {
	RUNTIME_API_VERSION,
	RUNTIME_PACKAGE_SOURCES,
	type RuntimeSourceFile,
} from "@rowcat/runtime/declarations";
import ts from "typescript-compiler-api";
import type { RuntimeAiSymbolKind } from "../corpus.ts";

/**
 * Extracts the public API from source, instead of comparing against a hand-written list.
 *
 * - Source is `RUNTIME_PACKAGE_SOURCES` because those are the files the compiler's virtual file
 *   system and Monaco's language service actually read. Names extracted from them are, by
 *   definition, names that compile. Walking the module object misses type-only exports (types do
 *   not exist at runtime), and a hand-written list silently goes stale.
 * - `runtime-api-inventory.ts` in apps/web hand-writes the classification (which page explains
 *   which name). This extractor does not read it; the `symbols` frontmatter of the docs answers
 *   ownership. The two mechanisms guard the same fact from opposite directions, which is why this
 *   package does not import the app.
 * - Names with no owner are not emitted into the reference. They stay in `undocumented`, which a
 *   test keeps empty. Generation does not stop, for the same reason as above.
 * - Signatures stop before the implementation: functions at the body, `const` at the type
 *   annotation. Included implementations would be read as API and agents would call internal
 *   helpers. This failure occurs in practice.
 * - Only this file knows TypeScript. `./index.ts` does not re-export this module; apps/web's doc
 *   generator imports only `./index.ts`, and TypeScript must not reach it. That app's boundary test
 *   enforces this.
 */

export interface RuntimeApiSymbolSource {
	readonly name: string;
	readonly kind: RuntimeAiSymbolKind;
	readonly signature: string;
	readonly summary: string;
	/**
	 * The file where this name is actually declared (e.g. `component.ts`), so diagnostics can say
	 * where to fix it.
	 */
	readonly file: string;
}

const INDEX = "index.ts";
const SUMMARY_MAX = 240;
const SIGNATURE_MAX = 4000;

const sourceMap = (): ReadonlyMap<string, RuntimeSourceFile> =>
	new Map(RUNTIME_PACKAGE_SOURCES.map((file) => [file.path, file]));

/**
 * Maps `./internal/errors` to `internal/errors.ts`. Generated copies drop `.ts` from relative
 * imports, because of a conflict between `allowImportingTsExtensions` and emit, so the extension is
 * added back here. Resolution order matches the compiler's.
 */
function resolveModule(
	from: string,
	specifier: string,
	files: ReadonlyMap<string, RuntimeSourceFile>,
): string | null {
	if (!specifier.startsWith(".")) return null;
	const base = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
	const parts = [...base.split("/").filter((part) => part.length > 0)];
	for (const part of specifier.split("/")) {
		if (part === "." || part === "") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	const joined = parts.join("/");
	for (const candidate of [
		joined,
		`${joined}.ts`,
		`${joined}.tsx`,
		`${joined}/index.ts`,
	])
		if (files.has(candidate)) return candidate;
	return null;
}

const parse = (file: RuntimeSourceFile): ts.SourceFile =>
	ts.createSourceFile(
		file.path,
		file.content,
		ts.ScriptTarget.ES2022,
		/* setParentNodes */ true,
		file.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);

/** The single JSDoc block directly above a declaration. Does not use TypeScript's internal API. */
function jsDocOf(node: ts.Node, text: string): string {
	const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
	const doc = [...ranges]
		.reverse()
		.find((range) => text.slice(range.pos, range.pos + 3) === "/**");
	if (doc === undefined) return "";
	return text
		.slice(doc.pos + 3, doc.end - 2)
		.split("\n")
		.map((line) => line.replace(/^\s*\*?\s?/, ""))
		.join("\n")
		.trim();
}

/**
 * Keeps only the first sentence. JSDoc in this repo explains design reasoning at length, by rule.
 * The reference needs a one-line answer to 'what is this'; the docs pages hold the rest.
 */
function summarize(doc: string): string {
	/**
	 * JSDoc blocks that open with a code fence or a heading are common and are not summaries. Skip
	 * ahead to the first prose paragraph.
	 */
	const paragraphs = doc.split(/\n\s*\n/);
	const paragraph =
		paragraphs.find(
			(block) =>
				block.trim().length > 0 &&
				!block.trimStart().startsWith("```") &&
				!block.trimStart().startsWith("#") &&
				!block.trimStart().startsWith("|"),
		) ?? "";
	const flat = paragraph.replace(/\s+/g, " ").replace(/\*\*/g, "").trim();
	if (flat.length === 0) return "";
	const stop = flat.search(/[.。](\s|$)/);
	const sentence = stop === -1 ? flat : flat.slice(0, stop + 1);
	return sentence.length > SUMMARY_MAX
		? `${sentence.slice(0, SUMMARY_MAX - 1)}…`
		: sentence;
}

/** Strips the leading `export`: the stored string is a declaration, not part of the module. */
const withoutExport = (text: string): string => text.replace(/^export\s+/, "");

const clamp = (signature: string): string =>
	signature.length > SIGNATURE_MAX
		? `${signature.slice(0, SIGNATURE_MAX)}\n/* … truncated. See the docs for the full declaration */`
		: signature;

const isHookName = (name: string): boolean =>
	/^use[A-Z]/.test(name) || name === "use";

/**
 * A constant annotated with `RuntimeHostComponent<…>` is placed inside TSX, which is what makes it
 * a component kind.
 */
const isComponentType = (node: ts.TypeNode | undefined): boolean =>
	node !== undefined &&
	ts.isTypeReferenceNode(node) &&
	ts.isIdentifier(node.typeName) &&
	node.typeName.text === "RuntimeHostComponent";

interface Found {
	readonly kind: RuntimeAiSymbolKind;
	readonly signature: string;
	readonly summary: string;
	readonly file: string;
}

function declarationIn(
	source: ts.SourceFile,
	file: RuntimeSourceFile,
	name: string,
): Found | null {
	const text = file.content;
	for (const statement of source.statements) {
		if (ts.isInterfaceDeclaration(statement) && statement.name.text === name)
			return {
				kind: "interface",
				signature: clamp(withoutExport(statement.getText(source))),
				summary: summarize(jsDocOf(statement, text)),
				file: file.path,
			};
		if (ts.isTypeAliasDeclaration(statement) && statement.name.text === name)
			return {
				kind: "type",
				signature: clamp(withoutExport(statement.getText(source))),
				summary: summarize(jsDocOf(statement, text)),
				file: file.path,
			};
		if (
			ts.isClassDeclaration(statement) &&
			statement.name !== undefined &&
			statement.name.text === name
		)
			return {
				kind: "class",
				signature: clamp(signatureOfClass(statement, source)),
				summary: summarize(jsDocOf(statement, text)),
				file: file.path,
			};
		if (
			ts.isFunctionDeclaration(statement) &&
			statement.name !== undefined &&
			statement.name.text === name
		) {
			const whole = statement.getText(source);
			const body = statement.body;
			const signature =
				body === undefined
					? whole
					: whole
							.slice(0, body.getStart(source) - statement.getStart(source))
							.trimEnd();
			return {
				kind: isHookName(name) ? "hook" : "function",
				signature: clamp(`${signature.replace(/^export\s+/, "")};`),
				summary: summarize(jsDocOf(statement, text)),
				file: file.path,
			};
		}
		if (!ts.isVariableStatement(statement)) continue;
		for (const declaration of statement.declarationList.declarations) {
			if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name)
				continue;
			const keyword =
				statement.declarationList.flags & ts.NodeFlags.Const ? "const" : "let";
			const typed =
				declaration.type === undefined
					? declaration.getText(source)
					: `${name}: ${declaration.type.getText(source)}`;
			return {
				kind: isComponentType(declaration.type)
					? "component"
					: isHookName(name)
						? "hook"
						: "constant",
				signature: clamp(`declare ${keyword} ${typed};`),
				summary: summarize(jsDocOf(statement, text)),
				file: file.path,
			};
		}
	}
	return null;
}

/** Classes are not included with their full body, only their member signatures. */
function signatureOfClass(
	node: ts.ClassDeclaration,
	source: ts.SourceFile,
): string {
	const head = `declare class ${node.name?.text ?? ""}${
		node.heritageClauses === undefined
			? ""
			: ` ${node.heritageClauses.map((clause) => clause.getText(source)).join(" ")}`
	}`;
	const members = node.members
		.filter(
			(member) => !ts.isMethodDeclaration(member) || member.body === undefined,
		)
		.map((member) => {
			if (ts.isPropertyDeclaration(member) || ts.isMethodDeclaration(member))
				return `\t${member.getText(source).split("\n")[0] ?? ""}`;
			if (ts.isConstructorDeclaration(member)) {
				const whole = member.getText(source);
				const body = member.body;
				return `\t${(body === undefined ? whole : whole.slice(0, body.getStart(source) - member.getStart(source))).trim()};`;
			}
			return null;
		})
		.filter((line): line is string => line !== null);
	return `${head} {\n${members.join("\n")}\n}`;
}

/** Traces where `name` came from in this file, following both re-exports and local re-exports. */
function hopThrough(
	source: ts.SourceFile,
	path: string,
	name: string,
	files: ReadonlyMap<string, RuntimeSourceFile>,
): { file: string; name: string } | null {
	for (const statement of source.statements) {
		if (!ts.isExportDeclaration(statement)) continue;
		const clause = statement.exportClause;
		if (clause === undefined || !ts.isNamedExports(clause)) continue;
		const element = clause.elements.find((entry) => entry.name.text === name);
		if (element === undefined) continue;
		const local = element.propertyName?.text ?? name;
		const specifier = statement.moduleSpecifier;
		if (specifier !== undefined && ts.isStringLiteral(specifier)) {
			const target = resolveModule(path, specifier.text, files);
			return target === null ? null : { file: target, name: local };
		}
		/** A re-export with no module specifier: this file re-exports a name it imported. */
		for (const other of source.statements) {
			if (!ts.isImportDeclaration(other)) continue;
			const bindings = other.importClause?.namedBindings;
			if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
			const imported = bindings.elements.find(
				(entry) => entry.name.text === local,
			);
			if (imported === undefined) continue;
			if (!ts.isStringLiteral(other.moduleSpecifier)) continue;
			const target = resolveModule(path, other.moduleSpecifier.text, files);
			return target === null
				? null
				: { file: target, name: imported.propertyName?.text ?? local };
		}
		return null;
	}
	return null;
}

function findSymbol(
	path: string,
	name: string,
	files: ReadonlyMap<string, RuntimeSourceFile>,
	seen: ReadonlySet<string>,
): Found | null {
	const key = `${path}#${name}`;
	if (seen.has(key)) return null;
	const file = files.get(path);
	if (file === undefined) return null;
	const source = parse(file);
	const direct = declarationIn(source, file, name);
	if (direct !== null) return direct;
	const hop = hopThrough(source, path, name, files);
	if (hop === null) return null;
	return findSymbol(hop.file, hop.name, files, new Set([...seen, key]));
}

/** Every name `index.ts` exports. This is the language's vocabulary. */
function publicNames(files: ReadonlyMap<string, RuntimeSourceFile>): string[] {
	const index = files.get(INDEX);
	if (index === undefined)
		throw new Error(`RUNTIME_PACKAGE_SOURCES has no ${INDEX}`);
	const source = parse(index);
	const names: string[] = [];
	for (const statement of source.statements) {
		if (!ts.isExportDeclaration(statement)) continue;
		const clause = statement.exportClause;
		if (clause === undefined)
			throw new Error(
				`${INDEX}: \`export * from\` cannot count the vocabulary; write the names`,
			);
		if (!ts.isNamedExports(clause)) continue;
		for (const element of clause.elements) names.push(element.name.text);
	}
	return names;
}

export interface RuntimeApiExtract {
	readonly apiVersion: number;
	readonly symbols: readonly RuntimeApiSymbolSource[];
}

/**
 * Extracts every public name with its signature. If any name cannot be traced, this throws. A name
 * silently left out becomes an API that does not exist for the agent, and that absence shows up
 * nowhere on screen.
 *
 * Sorted alphabetically, not in the order `index.ts` lists them. A total order keeps regeneration
 * from shifting the output; the meaning of order is carried separately by `kind`.
 */
export function extractRuntimeApi(): RuntimeApiExtract {
	const files = sourceMap();
	const symbols = publicNames(files)
		.map((name) => {
			const found = findSymbol(INDEX, name, files, new Set());
			if (found === null)
				throw new Error(
					`could not find the declaration of ${name} exported by @rowcat/runtime; the extractor doesn't know that shape`,
				);
			return {
				name,
				kind: found.kind,
				signature: found.signature,
				summary: found.summary,
				file: found.file,
			};
		})
		.sort((left, right) => (left.name < right.name ? -1 : 1));
	return { apiVersion: RUNTIME_API_VERSION, symbols };
}
