import { isRuntimeBuiltinSpecifier } from "@rowcat/runtime/declarations";
import {
	directoryOf,
	escapesProjectRoot,
	normalizeProjectPath,
	resolveProjectPath,
} from "./paths.ts";

/**
 * Decides what one import string written by the creator points to. It does not defer to
 * TypeScript's resolver, for three reasons:
 * 1. Policy must come before resolution. For import 'lodash', TypeScript says 'module not
 *    found', which reads as 'install it'. That message does not tell the creator that this product
 *    has no npm installs.
 * 2. The artifact must carry this table. A later loader should not resolve again, so the
 *    compile-time conclusion must be stored as a value. TypeScript's internal results are not our
 *    module ids.
 * 3. Outside the root is an error, not an unresolved name. ../../secret is not a missing file;
 *    it is something that must not be done. The two cases need different messages.
 */

/**
 * Built-in identifier as the loader sees it. The rowcat: prefix keeps it from looking like an npm
 * package name.
 */
export const runtimeBuiltinId = (specifier: string): string =>
	`rowcat:${specifier.replace(/^@rowcat\//, "")}`;

export type RuntimeResolution =
	| { kind: "builtin"; specifier: string; resolved: string }
	| { kind: "local"; specifier: string; resolved: string }
	| {
			kind: "error";
			specifier: string;
			reason: "forbidden" | "escape" | "not_found" | "invalid";
			/** Locations actually tried when looking for a missing file. The message text reports them. */
			attempts?: readonly string[];
	  };

/**
 * Order in which extensionless relative paths are tried. It is pinned here and a test enforces it,
 * because the order can change the result (a project containing both foo.ts and foo/index.ts). If
 * the winner differed between deployments, the same manuscript would become a different program on
 * different devices.
 */
const CANDIDATE_SUFFIXES = [".ts", ".tsx", "/index.ts", "/index.tsx"] as const;

export interface RuntimeResolverInput {
	/**
	 * All source paths in the project. This set is the only basis for deciding whether a file exists.
	 */
	files: ReadonlySet<string>;
}

/**
 * Resolves one specifier. Bare names end at a single allowlist. For example,
 * @rowcat/runtime/internal/dispatcher exists in the virtual file system but is rejected here.
 * Existence and permission are different questions, and this order makes that distinction
 * structural.
 */
export function resolveRuntimeModule(
	specifier: string,
	fromPath: string,
	input: RuntimeResolverInput,
): RuntimeResolution {
	if (specifier.length === 0)
		return { kind: "error", specifier, reason: "invalid" };

	const relative = specifier.startsWith("./") || specifier.startsWith("../");
	if (!relative) {
		if (isRuntimeBuiltinSpecifier(specifier))
			return {
				kind: "builtin",
				specifier,
				resolved: runtimeBuiltinId(specifier),
			};
		return { kind: "error", specifier, reason: "forbidden" };
	}

	const normalized = normalizeProjectPath(specifier);
	const fromDirectory = directoryOf(fromPath);
	/**
	 * The boundary check runs before resolving. It checks whether the path, joined against the root,
	 * escapes upward, so legitimate paths such as ../../shared in deeply nested files still pass.
	 */
	const joined = `${fromDirectory ? `${fromDirectory}/` : ""}${normalized}`;
	if (escapesProjectRoot(joined))
		return { kind: "error", specifier, reason: "escape" };

	const base = resolveProjectPath(fromDirectory, normalized);
	if (base.length === 0) return { kind: "error", specifier, reason: "escape" };

	const attempts: string[] = [];
	for (const suffix of CANDIDATE_SUFFIXES) {
		const candidate = `${base}${suffix}`;
		attempts.push(candidate);
		if (input.files.has(candidate))
			return { kind: "local", specifier, resolved: candidate };
	}

	return { kind: "error", specifier, reason: "not_found", attempts };
}

export const RUNTIME_RESOLUTION_ORDER: readonly string[] = CANDIDATE_SUFFIXES;
