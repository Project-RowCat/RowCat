import { canonicalRemoteAssetList } from "@rowcat/runtime/asset";
import {
	RUNTIME_API_MIN_COMPATIBLE_VERSION,
	RUNTIME_API_VERSION,
	runtimeApiCompatibility,
} from "@rowcat/runtime/declarations";
import {
	RUNTIME_ARTIFACT_FORMAT_VERSION,
	RUNTIME_COMPILER_VERSION,
	type RuntimeArtifact,
	type RuntimeArtifactDependency,
	type RuntimeArtifactModule,
} from "@rowcat/runtime-compiler/contracts";
import { isCanonicalRuntimeModuleId } from "@rowcat/runtime-compiler/paths";
import { RUNTIME_REMOTE_ASSET_MANIFEST_LIMITS } from "@rowcat/runtime-compiler/remote-assets";
import { RUNTIME_HOST_ERROR_CODE, RuntimeHostError } from "./errors.ts";
import { isRecord } from "./is-record.ts";

/**
 * Reads an artifact without trusting it. Having the type RuntimeArtifact does not mean the value
 * came from the compiler. Values can come from a server, cache, local storage, network or another
 * process, none of which is inside the execution boundary. This function checks everything that can
 * be answered before execution:
 * - formatVersion and compilerVersion: is this a version we can read? Both must match exactly.
 * - apiVersion: is it inside the compatibility window (runtimeApiCompatibility)?
 * - entry: does it point at an actual module?
 * - module ids: are they runtime source paths, and are they unique?
 * - dependencies: local ones inside the artifact, builtin ones within the installed list.
 * - remoteAssets: shape, canonical form, and the count and length limits.
 *
 * An artifact without remoteAssets authorizes no remote addresses. Treating the absence as
 * allow-all would make the list protect nothing, since deleting the field would open everything.
 * Older artifacts lose nothing, because that format never contained remote addresses.
 *
 * The bodies of emitted code are not parsed here. If an import inside them disagrees with the
 * table, the loader rejects it at run time (the normalizer in session.ts), and that rejection is
 * also deterministic. The check is not duplicated; there are two points at which it can be
 * answered.
 */

export type ArtifactValidation =
	| { ok: true; artifact: RuntimeArtifact }
	| { ok: false; error: RuntimeHostError };

const invalid = (message: string): ArtifactValidation => ({
	ok: false,
	error: new RuntimeHostError(RUNTIME_HOST_ERROR_CODE.artifactInvalid, message),
});

function validateDependency(
	value: unknown,
	moduleIds: ReadonlySet<string>,
	builtinIds: ReadonlySet<string>,
	owner: string,
): string | null {
	if (!isRecord(value)) return `${owner}: dependency is not an object`;
	const { specifier, kind, resolved } =
		value as Partial<RuntimeArtifactDependency>;
	if (typeof specifier !== "string" || specifier.length === 0)
		return `${owner}: dependency specifier is invalid`;
	if (typeof resolved !== "string" || resolved.length === 0)
		return `${owner}: dependency "${specifier}" has no resolution`;
	if (kind === "local") {
		if (!moduleIds.has(resolved))
			return `${owner}: dependency "${specifier}" resolves to unknown module ${resolved}`;
		return null;
	}
	if (kind === "builtin") {
		if (!builtinIds.has(resolved))
			return `${owner}: dependency "${specifier}" resolves to unknown built-in ${resolved}`;
		return null;
	}
	return `${owner}: dependency "${specifier}" has unknown kind`;
}

export function validateRuntimeArtifact(
	input: unknown,
	options: { builtins: ReadonlySet<string> },
): ArtifactValidation {
	if (!isRecord(input)) return invalid("artifact is not an object");

	if (input.formatVersion !== RUNTIME_ARTIFACT_FORMAT_VERSION)
		return invalid(
			`unsupported artifact format ${String(input.formatVersion)} (expected ${RUNTIME_ARTIFACT_FORMAT_VERSION})`,
		);
	/**
	 * The API version is accepted as a window. The verdict is one function in @rowcat/runtime, and
	 * this code only calls it, because four consumers must return the same answer. Inside the window,
	 * an older version uses an identity adapter, so the artifact is returned unchanged in its own
	 * version. Overwriting apiVersion with the host's version below would make it impossible to say
	 * which version the session is actually running.
	 */
	const compatibility = runtimeApiCompatibility(input.apiVersion);
	if (compatibility === "malformed")
		return invalid(
			`runtime api version ${String(input.apiVersion)} is not a version`,
		);
	if (compatibility === "too-new")
		return invalid(
			`unsupported runtime api ${String(input.apiVersion)} (host runs ${RUNTIME_API_VERSION}; update the app)`,
		);
	if (compatibility === "too-old")
		return invalid(
			`unsupported runtime api ${String(input.apiVersion)} (host accepts ${RUNTIME_API_MIN_COMPATIBLE_VERSION}..${RUNTIME_API_VERSION}; republish the story)`,
		);
	const apiVersion = input.apiVersion as number;
	/**
	 * The compiler version must match exactly. The question this value answers is whether the artifact
	 * was built under the same rules as the current ones. If the version has risen, the answer is no.
	 * Accepting a range would force this code to re-derive which older versions can still run.
	 */
	if (input.compilerVersion !== RUNTIME_COMPILER_VERSION)
		return invalid(
			`unsupported compiler version ${String(input.compilerVersion)} (expected ${RUNTIME_COMPILER_VERSION})`,
		);
	if (typeof input.sourceHash !== "string")
		return invalid("artifact has no source hash");
	if (
		typeof input.entry !== "string" ||
		!isCanonicalRuntimeModuleId(input.entry)
	)
		return invalid("artifact entry is not a canonical runtime module id");
	if (!Array.isArray(input.modules) || input.modules.length === 0)
		return invalid("artifact has no modules");

	/**
	 * The authorization list: a missing field is the same as an empty one.
	 *
	 * Canonicalization (canonicalRemoteAssetList) doubles as validation. Non-address values,
	 * duplicates and ordering are folded in one pass, so the list's identity is the same on the
	 * producing and reading sides. But if any entries are dropped, the artifact is rejected. Silently
	 * filtering them would turn a corrupted artifact into a work that draws only some of its images,
	 * and that failure could be traced neither by the creator nor by the compiler.
	 */
	let remoteAssets: readonly string[] = [];
	if (input.remoteAssets !== undefined) {
		if (!Array.isArray(input.remoteAssets))
			return invalid("artifact remote asset manifest is not an array");
		if (
			input.remoteAssets.length > RUNTIME_REMOTE_ASSET_MANIFEST_LIMITS.maxCount
		)
			return invalid(
				`artifact declares too many remote assets (${input.remoteAssets.length} > ${RUNTIME_REMOTE_ASSET_MANIFEST_LIMITS.maxCount})`,
			);
		let total = 0;
		for (const entry of input.remoteAssets as unknown[]) {
			if (typeof entry !== "string")
				return invalid("artifact remote asset manifest holds a non-string");
			total += entry.length;
		}
		if (total > RUNTIME_REMOTE_ASSET_MANIFEST_LIMITS.maxTotalCharacters)
			return invalid(
				`artifact remote asset manifest is too large (${total} > ${RUNTIME_REMOTE_ASSET_MANIFEST_LIMITS.maxTotalCharacters} characters)`,
			);
		const canonical = canonicalRemoteAssetList(input.remoteAssets as unknown[]);
		if (canonical.length !== new Set(input.remoteAssets as string[]).size)
			return invalid("artifact remote asset manifest holds a non-remote value");
		remoteAssets = canonical;
	}

	const modules: RuntimeArtifactModule[] = [];
	const ids = new Set<string>();
	for (const raw of input.modules as unknown[]) {
		if (!isRecord(raw)) return invalid("module is not an object");
		const { id, code, dependencies, map } =
			raw as Partial<RuntimeArtifactModule>;
		/**
		 * Accepts only canonical project paths; an extension check is not enough. An extension check let
		 * through <rowcat:pwn.ts and ../escape.ts. The first made the loader read the <rowcat: prefix as
		 * its own host driver and open internal modules. Built-in names are rejected too: existence and
		 * permission are different questions, but if two modules share one id, the loader hides one of
		 * them.
		 */
		if (typeof id !== "string" || !isCanonicalRuntimeModuleId(id))
			return invalid(
				`module id ${String(id)} is not a canonical runtime module id`,
			);
		if (options.builtins.has(id))
			return invalid(`module id ${id} collides with a built-in`);
		if (ids.has(id)) return invalid(`module ${id} appears twice`);
		if (typeof code !== "string") return invalid(`module ${id} has no code`);
		if (!Array.isArray(dependencies))
			return invalid(`module ${id} has no dependency table`);
		if (map !== undefined && typeof map !== "string")
			return invalid(`module ${id} has an invalid source map`);
		ids.add(id);
		modules.push({
			id,
			code,
			dependencies: dependencies as RuntimeArtifactDependency[],
			...(map === undefined ? {} : { map }),
		});
	}

	if (!ids.has(input.entry))
		return invalid(`entry ${input.entry} is not one of the modules`);

	for (const module of modules)
		for (const dependency of module.dependencies) {
			const problem = validateDependency(
				dependency,
				ids,
				options.builtins,
				module.id,
			);
			if (problem !== null) return invalid(problem);
		}

	return {
		ok: true,
		artifact: {
			formatVersion: RUNTIME_ARTIFACT_FORMAT_VERSION,
			apiVersion,
			compilerVersion: RUNTIME_COMPILER_VERSION,
			entry: input.entry,
			modules,
			sourceHash: input.sourceHash,
			remoteAssets,
		},
	};
}
