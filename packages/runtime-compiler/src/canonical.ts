import {
	RUNTIME_ARTIFACT_FORMAT_VERSION,
	RUNTIME_COMPILER_VERSION,
	type RuntimeArtifact,
	type RuntimeCompileInput,
} from "./contracts.ts";
import { compareCodeUnits, normalizeProjectPath } from "./paths.ts";

/**
 * Canonical form, so the same project always produces the same bytes.
 *
 * Every place where determinism can break is gathered here, and each one changes the result:
 * - Input array order. Storage does not guarantee the order it returns (Dexie, SQLite, and sync
 *   each differ).
 * - Path separators. Values that came from Windows contain backslashes.
 * - Line endings. The same source may be saved as CRLF or LF.
 * - Object key order. JSON.stringify follows insertion order.
 *
 * The last is the quietest: a refactor that adds a field and changes key order changes every hash
 * without any error, invalidating every cached artifact.
 *
 * Line endings are folded in the hash input, not in the stored source. The author's saved bytes
 * stay unchanged, the same rule the render path follows (chat markdown already does this).
 */

/**
 * Folds line endings. The hash input and the source TypeScript reads must follow the same rule.
 *
 * For a time only the hash went through this function. So a CRLF source and an LF copy of the same
 * source produced the same `sourceHash`, while template literals still emitted the CR LF pair. The
 * artifact then broke the promise that the same source yields the same bytes (see compile.ts).
 */
export const normalizeNewlines = (content: string): string =>
	content.replace(/\r\n?/g, "\n");

/**
 * Serialization with keys fixed in declaration order.
 *
 * Not `JSON.stringify(value, Object.keys(value).sort())`: that also sorts nested object keys
 * alphabetically, producing an unreadable result, and the replacer array behaves differently for
 * objects inside arrays. Only the shapes this code produces matter, so a hand-written serializer is
 * more exact.
 */
export function canonicalArtifactJson(artifact: RuntimeArtifact): string {
	return JSON.stringify(
		{
			formatVersion: artifact.formatVersion,
			apiVersion: artifact.apiVersion,
			compilerVersion: artifact.compilerVersion,
			entry: artifact.entry,
			sourceHash: artifact.sourceHash,
			/**
			 * An artifact with no remote-asset list and one with an empty list produce the SAME bytes. Their
			 * meaning is the same (no remote address was authorized; see contracts.ts). Keeping them apart
			 * would give artifacts from before this version and the same source compiled now different
			 * canonical forms. That difference means nothing and would only invalidate caches.
			 */
			remoteAssets: [...(artifact.remoteAssets ?? [])],
			modules: artifact.modules.map((module) => ({
				id: module.id,
				code: module.code,
				...(module.map === undefined ? {} : { map: module.map }),
				dependencies: module.dependencies.map((dependency) => ({
					specifier: dependency.specifier,
					kind: dependency.kind,
					resolved: dependency.resolved,
				})),
			})),
		},
		null,
		"\t",
	);
}

/**
 * The hash input contains source and compiler meaning only.
 *
 * What must not enter is the contract: no draft id, file record id, updatedAt, HLC revision, dirty
 * flag, device identifier, or storage metadata. So the same source arriving on another device
 * through sync hashes the same. A later artifact cache depends on that fact.
 */
export function canonicalSourceBytes(input: RuntimeCompileInput): string {
	const files = input.files
		.map((file) => ({
			path: normalizeProjectPath(file.path),
			content: normalizeNewlines(file.content),
		}))
		.sort((left, right) => compareCodeUnits(left.path, right.path));

	return JSON.stringify(
		{
			formatVersion: RUNTIME_ARTIFACT_FORMAT_VERSION,
			compilerVersion: RUNTIME_COMPILER_VERSION,
			apiVersion: input.apiVersion,
			entry: normalizeProjectPath(input.entry),
			files,
		},
		null,
		"\t",
	);
}
