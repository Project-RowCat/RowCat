import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Converts the source of @rowcat/runtime into a string that tooling can read. The consumers are the
 * runtime compiler's virtual file system and Monaco's language service. Neither can read
 * node_modules.
 * - Why not a hand-written .d.ts: Phase 1 had one, and nothing signaled when it diverged from the
 *   implementation. Adding a primitive still compiled and passed tests, and the mismatch surfaced
 *   only when a creator used an autocompleted name the compiler did not know.
 * - So the real source is copied, and no second declaration source exists to diverge. This is the
 *   generator, committed output, and regenerate-and-compare pattern the repository already uses for
 *   design tokens, legal documents and update notices.
 * - One transform: relative imports lose their .ts extension. The repo convention needs
 *   allowImportingTsExtensions, which requires noEmit, and the runtime compiler must emit. The
 *   original stays unchanged. The copy resolves without the extension, and creator code writing
 *   ./foo.ts gets an ordinary type error.
 */

const HERE = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(HERE, "..", "src");
export const DECLARATIONS_FILE = join(SRC, "declarations", "generated.ts");

/**
 * Hidden from the tooling: the tooling's own assets (declarations and sandbox output) and the
 * tests. sandbox/ is excluded too. That folder is VM JavaScript built from this source. Copying it
 * would put a second copy of the whole runtime inside the creator program, and that file would
 * contain itself.
 */
const isExcluded = (path: string): boolean =>
	path.startsWith(`declarations${sep}`) ||
	path.startsWith("declarations/") ||
	path.startsWith(`sandbox${sep}`) ||
	path.startsWith("sandbox/") ||
	path.includes(".test.");

function* walk(root: string): Generator<string> {
	for (const name of readdirSync(root).sort()) {
		const path = join(root, name);
		if (statSync(path).isDirectory()) {
			yield* walk(path);
			continue;
		}
		if (name.endsWith(".ts")) yield path;
	}
}

/**
 * from './x.ts' becomes from './x'. Applies only to relative paths. This package has no absolute
 * imports, but if one appeared it should be left alone. Dropping an extension is a file resolution
 * matter, not a package name matter.
 */
const stripRelativeExtension = (source: string): string =>
	source.replace(
		/(from\s+")(\.{1,2}\/[^"]+?)\.ts(")/g,
		(_match, before: string, path: string, after: string) =>
			`${before}${path}${after}`,
	);

export interface RuntimeSourceFile {
	path: string;
	content: string;
}

/**
 * Identity of a source bundle: the key that compares by value whether two generated outputs came
 * from the same source.
 *
 * The declaration output (read by tooling) and the sandbox output (run by the VM) must come from
 * one source. If only one is regenerated, a commit can pass types and tests while the autocomplete
 * and the VM's real exports have diverged. So both generators call the same function over the same
 * file list, and the host compares the two digests at boot (@rowcat/runtime-host).
 *
 * Only paths and contents go in. No absolute paths, timestamps or machine names. The same source
 * yields the same value wherever it is computed.
 */
export function digestRuntimeSources(
	files: readonly RuntimeSourceFile[],
): string {
	const hash = createHash("sha256");
	for (const file of files) {
		hash.update(file.path);
		hash.update("\0");
		hash.update(file.content);
		hash.update("\0");
	}
	return hash.digest("hex").slice(0, 32);
}

/** Files to copy, sorted by path, so the output does not depend on file system ordering. */
export function collectRuntimeSources(): RuntimeSourceFile[] {
	const files: RuntimeSourceFile[] = [];
	for (const absolute of walk(SRC)) {
		const path = relative(SRC, absolute).split(sep).join("/");
		if (isExcluded(path)) continue;
		files.push({
			path,
			content: stripRelativeExtension(readFileSync(absolute, "utf8")),
		});
	}
	return files.sort((left, right) => (left.path < right.path ? -1 : 1));
}

const HEADER = `/**
 * **This is a generated file. Do not edit it by hand.**
 *
 * The source is \`packages/runtime/src/**\` and the command that makes it is \`pnpm runtime:declarations\`.
 * If this file goes stale, the API the tooling describes and the API this package really exports diverge, and
 * that mismatch is silent: \`declarations.test.ts\` checks freshness by value.
 */

export interface RuntimeSourceFile {
	/** The path inside this package (\`index.ts\` · \`internal/dispatcher.ts\`). */
	readonly path: string;
	readonly content: string;
}

/**
 * The digest of the source bundle this declaration derives from (\`digestRuntimeSources\`). The sandbox output
 * must hold the same value, and the host compares the two at boot.
 */
export const RUNTIME_DECLARATIONS_SOURCE_DIGEST = `;

const SOURCES_HEADER = `
export const RUNTIME_PACKAGE_SOURCES: readonly RuntimeSourceFile[] = [
`;

export function renderDeclarations(files: readonly RuntimeSourceFile[]): string {
	const entries = files
		.map(
			(file) =>
				`\t{\n\t\tpath: ${JSON.stringify(file.path)},\n\t\tcontent: ${JSON.stringify(file.content)},\n\t},\n`,
		)
		.join("");
	return `${HEADER}${JSON.stringify(digestRuntimeSources(files))};\n${SOURCES_HEADER}${entries}];\n`;
}
