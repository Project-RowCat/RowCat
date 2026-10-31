import { RUNTIME_VIRTUAL_ROOT } from "./contracts.ts";

/**
 * Canonical shape of paths and the project-root boundary.
 *
 * Why the authoring package's rules are not called: @rowcat/authoring already has
 * normalizeRuntimePath and checkRuntimePath, and the repo guards against the same rule living in
 * two places. The copy here exists for two reasons.
 * 1. The dependency direction is reversed. If the compiler imported the authoring package,
 *    contracts, domain and zod would come with it, and this package would stop being a pure tool. A
 *    future server running the same validation at publish time would inherit that weight.
 * 2. The questions differ. Authoring asks whether a file may exist in the project (count,
 *    length, duplicates, characters). This module asks where a string points inside the project.
 *    Only normalization and rejection of .. overlap.
 *
 * The copy is kept, and its equivalence is enforced by a test: the same structure as compareRev,
 * which lives in three copies. The test sits at the assembly point (apps/web) where both packages
 * can be imported together. A comment cannot stop one side from being edited alone. The drift would
 * show up not as a compile error but as a file that opens in the editor yet cannot be found by the
 * compiler.
 */

/**
 * Folds the different ways of writing the same path into one. .. is deliberately not resolved here:
 * resolving it immediately would turn src/../../secret silently into secret, erasing the intent to
 * point outside the root, and the next check would see a harmless-looking path. Leaving it in place
 * lets the boundary check below see it.
 */
export function normalizeProjectPath(input: string): string {
	const slashed = input.trim().replace(/\\/g, "/");
	return slashed
		.split("/")
		.filter((segment) => segment.length > 0 && segment !== ".")
		.join("/");
}

/**
 * Code-unit comparison, not localeCompare. Locale comparison depends on each engine's ICU data
 * (Node full-icu and small-icu, Hermes and JSC all differ), so the same file list would sort
 * differently on different devices and break the promise that the same manuscript gives the same
 * hash. It is also not injective: two paths that differ only in characters ignored by collation
 * compare as 0, and the sort then depends on stability (the order the repository supplied). Code-
 * unit comparison is the same everywhere. The studio's runtime-compile-signature.ts makes the same
 * choice for the same reason.
 */
export const compareCodeUnits = (left: string, right: string): number =>
	left < right ? -1 : left > right ? 1 : 0;

/**
 * Whether the path is a canonical project path that may be accepted as an artifact module id.
 *
 * isRuntimeSourcePath checks only the extension, and it let through ids such as <rowcat:pwn.ts. The
 * host loader reads the <rowcat: prefix as a marker of its own driver module and then opened all
 * internal modules. What is locked here is the shape. The path must already be canonical
 * (normalization changes nothing), must not leave the root, and each segment must come from the
 * character set the authoring repo accepts (SEGMENT_PATTERN in @rowcat/authoring). That set has no
 * <, >, : or /, so host driver and built-in id shapes are excluded here.
 */
export function isCanonicalRuntimeModuleId(id: string): boolean {
	if (!isRuntimeSourcePath(id)) return false;
	if (normalizeProjectPath(id) !== id) return false;
	if (escapesProjectRoot(id)) return false;
	return id.split("/").every((segment) => MODULE_SEGMENT.test(segment));
}

/**
 * Segment character set, matching what the authoring repo accepts. .. is inside this set too, so
 * escapesProjectRoot checks it separately.
 */
const MODULE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Judges the shape only, not the file list. */
export function escapesProjectRoot(path: string): boolean {
	if (path.startsWith("/")) return true;
	let depth = 0;
	for (const segment of path.split("/")) {
		if (segment === "..") {
			depth -= 1;
			if (depth < 0) return true;
			continue;
		}
		depth += 1;
	}
	return false;
}

/**
 * Resolves .. to produce a canonical path, and only after the boundary check has passed. The order
 * is the rule: resolving first would erase the intent to leave the root.
 */
export function resolveProjectPath(
	fromDirectory: string,
	specifier: string,
): string {
	const segments = [
		...fromDirectory.split("/").filter(Boolean),
		...specifier.split("/").filter(Boolean),
	];
	const stack: string[] = [];
	for (const segment of segments) {
		if (segment === ".") continue;
		if (segment === "..") {
			stack.pop();
			continue;
		}
		stack.push(segment);
	}
	return stack.join("/");
}

export function directoryOf(path: string): string {
	const index = path.lastIndexOf("/");
	return index === -1 ? "" : path.slice(0, index);
}

export const toVirtualPath = (path: string): string =>
	`${RUNTIME_VIRTUAL_ROOT}/${path}`;

/**
 * Top-level folders of the virtual file system that belong to the compiler: node_modules/ holds the
 * runtime package and the TypeScript libraries, .rowcat/ holds the entry check. They are listed once
 * because two questions read them: which virtual files are not the creator's (toProjectPath), and
 * which project paths a creator may not use (isReservedProjectPath).
 *
 * The authoring rule refuses the same first segments (checkRuntimePath in @rowcat/authoring), and
 * runtime-path-parity.test.ts holds the two copies equal. Only the first segment is reserved,
 * because only there do the two trees overlap: src/node_modules/x.ts is an ordinary creator file
 * that compiles and emits like any other.
 */
export const RESERVED_PROJECT_ROOTS = ["node_modules", ".rowcat"] as const;

/**
 * Whether a canonical project path sits under a compiler-owned folder.
 *
 * Accepting one used to be silently wrong in two ways. A creator node_modules/x.ts was read as the
 * compiler's own file, so its type error surfaced as 'the compiler environment is invalid' with no
 * path. A creator .rowcat/entry-check.ts was replaced in the virtual file system by the injected
 * entry check, so the policy pass and the remote-asset scan read the creator's text while emit
 * produced ours. Refusing the path up front makes both unrepresentable.
 */
export function isReservedProjectPath(path: string): boolean {
	const first = path.split("/", 1)[0] ?? "";
	return (RESERVED_PROJECT_ROOTS as readonly string[]).includes(first);
}

export function toProjectPath(virtualPath: string): string | null {
	const prefix = `${RUNTIME_VIRTUAL_ROOT}/`;
	if (!virtualPath.startsWith(prefix)) return null;
	const rest = virtualPath.slice(prefix.length);
	/** Files under the reserved folders belong to the compiler, so they map to no project path. */
	if (isReservedProjectPath(rest)) return null;
	return rest;
}

/** The extension list is the only basis for deciding whether a path is runtime source. */
export const RUNTIME_SOURCE_EXTENSIONS = [".ts", ".tsx"] as const;

export const isRuntimeSourcePath = (path: string): boolean =>
	RUNTIME_SOURCE_EXTENSIONS.some(
		(extension) => path.endsWith(extension) && path.length > extension.length,
	);
