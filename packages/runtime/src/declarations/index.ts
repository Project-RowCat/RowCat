import {
	RUNTIME_DECLARATIONS_SOURCE_DIGEST,
	RUNTIME_PACKAGE_SOURCES,
	type RuntimeSourceFile,
} from "./generated.ts";

/**
 * Assets the tooling reads. These are not the author's vocabulary.
 *
 * - The root package (`@rowcat/runtime`) must not re-export this module. Re-exporting would put
 *   `RUNTIME_PACKAGE_SOURCES` into the author's autocomplete, a name the language does not have.
 * - Two consumers must see the same files: `@rowcat/runtime-compiler` (places them in a virtual
 *   file system and builds the program) and Monaco in apps/web (attaches them to its language
 *   service). If they diverge, the editor offers names the compiler rejects. Phase 1 had
 *   hand-written declarations with nothing preventing drift; there is now one source.
 * - The files live in node_modules, not behind `paths` aliases. Aliases would give Monaco and the
 *   compiler separate tables that can disagree. Plain node_modules placement resolves through
 *   TypeScript's default lookup in both, so no table exists.
 */

export {
	RUNTIME_DECLARATIONS_SOURCE_DIGEST,
	RUNTIME_PACKAGE_SOURCES,
	type RuntimeSourceFile,
};

/**
 * The version of the runtime language contract. It is a monotonically increasing integer, not
 * SemVer, because code compares it rather than people reading it. Artifacts carry it so a future VM
 * can tell whether it can read them. It goes up only when the public vocabulary grows or shrinks.
 *
 * History: 1 to 2 TextInput, TextArea, useGeneration. 2 to 3 persistent state (Phase 6B). 3 to 4
 * Audio. 4 to 5 scroll and text-entry controllers, and the `commands` port channel. 5 to 6
 * transition. 6 to 7 five style axes (minWidth, maxWidth, minHeight, maxHeight, shrink).
 *
 * From 3 to 4 onward a bump had a price. The host required an exact match, so each bump stopped
 * published artifacts from opening until their creators republished (the server has no authoring
 * source to recompile from). A compatibility window now exists (RUNTIME_API_MIN_COMPATIBLE_VERSION,
 * runtimeApiCompatibility). Purely additive bumps do not close old artifacts; only window-narrowing
 * bumps pay that price. The 4 to 5 bump was not exempt, since it also added a port channel old
 * hosts do not know. 5 to 6 added no port, but without a bump a v6 artifact would evaluate on a v5
 * host and the first commit's set-prop transition would fail the whole batch, so a boot-time
 * rejection is better.
 *
 * Bumping even for additions makes the check bidirectional. A v2 artifact imports useGeneration,
 * which a v1 runtime lacks. Without a bump, that host would call the artifact compatible, and the
 * failure would be a SyntaxError during author module evaluation instead of a rejection before the
 * VM exists (checkSandboxCompatibility in runtime-host).
 *
 * Whether the price is paid is a product decision that code cannot make: either run a
 * backward-compatible sandbox for old versions, or notify creators to republish. Do not deploy a
 * commit like this without it.
 */
export const RUNTIME_API_VERSION = 7;

/**
 * The oldest artifact version this host can run: the lower edge of the compatibility window. Every
 * bump from 4 onward was additive. Names old artifacts use still exist, their patches are in the
 * new renderer's table, and port channels were added, never removed (an artifact that does not know
 * `commands` simply never calls it). So artifacts from 5 up run on the current sandbox unchanged.
 * The adapter is the identity, and any version needing a non-identity adapter cannot enter the
 * window. The edge is 5 because it is the first version with the full port set (controller commands
 * and durable state channels). Older artifacts were built for hosts without those ports and might
 * run, but none were published at that version, and the window does not include unverified cases.
 * Narrowing the window closes works that are already published. A non-additive bump (names removed
 * or meanings changed) must raise this value together with RUNTIME_API_VERSION, and that commit
 * comes with the republish procedure (docs/creator-runtime/public-beta.md section 2).
 */
export const RUNTIME_API_MIN_COMPATIBLE_VERSION = 5;

export const RUNTIME_API_COMPATIBLE_VERSIONS: readonly number[] = Array.from(
	{ length: RUNTIME_API_VERSION - RUNTIME_API_MIN_COMPATIBLE_VERSION + 1 },
	(_, i) => RUNTIME_API_MIN_COMPATIBLE_VERSION + i,
);

/**
 * Outcomes when an artifact's version is checked:
 * - current: the version is this one. Run.
 * - compatible: an older version inside the window, through the identity adapter. Run.
 * - too-old: below the window. Reject; republishing is the answer.
 * - too-new: newer than this host. Reject; an app update is the answer.
 * - malformed: not an integer. Reject. The judgment lives in this one function because four
 *   consumers call it: the web preview worker, the web playback worker, the native harness, and
 *   server publish validation. Each writing its own check would open the window in one place only,
 *   and the mismatch would show up as a work that runs in the studio but does not open once
 *   published. The host's artifact validation (validateRuntimeArtifact in runtime-host) calls it.
 */
export type RuntimeApiCompatibility =
	| "current"
	| "compatible"
	| "too-old"
	| "too-new"
	| "malformed";

export function runtimeApiCompatibility(
	artifactVersion: unknown,
	hostVersion: number = RUNTIME_API_VERSION,
): RuntimeApiCompatibility {
	if (
		typeof artifactVersion !== "number" ||
		!Number.isSafeInteger(artifactVersion) ||
		artifactVersion < 1
	)
		return "malformed";
	if (artifactVersion === hostVersion) return "current";
	if (artifactVersion > hostVersion) return "too-new";
	return artifactVersion >= RUNTIME_API_MIN_COMPATIBLE_VERSION
		? "compatible"
		: "too-old";
}

export const RUNTIME_PACKAGE_NAME = "@rowcat/runtime";

/**
 * Every bare name the author may import. This list is the allowlist; any bare name not listed is
 * rejected by the compiler. Internal modules such as `@rowcat/runtime/internal/dispatcher` are
 * deliberately absent. They really exist in the virtual file system, but the policy pass runs
 * before resolution and blocks the name.
 */
export const RUNTIME_BUILTIN_SPECIFIERS = [
	RUNTIME_PACKAGE_NAME,
	`${RUNTIME_PACKAGE_NAME}/jsx-runtime`,
	`${RUNTIME_PACKAGE_NAME}/jsx-dev-runtime`,
] as const;

export type RuntimeBuiltinSpecifier =
	(typeof RUNTIME_BUILTIN_SPECIFIERS)[number];

export const isRuntimeBuiltinSpecifier = (
	specifier: string,
): specifier is RuntimeBuiltinSpecifier =>
	(RUNTIME_BUILTIN_SPECIFIERS as readonly string[]).includes(specifier);

/**
 * The virtual package's package.json has no `exports` field. With one, subpaths would have to pass
 * through that table, and nothing verifies that Monaco's resolver and the compiler treat it the
 * same. Without it, both resolve straight to file paths (`@rowcat/runtime/jsx-runtime` maps to
 * `jsx-runtime.ts`). `types` points at `index.ts` because this package ships as source, as the rest
 * of the repo does; there are no `.d.ts` build outputs.
 */
const packageManifest = (): string =>
	`${JSON.stringify(
		{
			name: RUNTIME_PACKAGE_NAME,
			version: "0.0.0",
			type: "module",
			types: "./index.ts",
			main: "./index.ts",
		},
		null,
		"\t",
	)}\n`;

/**
 * Takes `root` as a parameter so this module does not encode the compiler's placement rules. The
 * compiler chooses the root (RUNTIME_VIRTUAL_ROOT); this function only states what lies beneath it.
 */
export function runtimePackageFiles(root: string): RuntimeSourceFile[] {
	const base = `${root}/node_modules/${RUNTIME_PACKAGE_NAME}`;
	return [
		{ path: `${base}/package.json`, content: packageManifest() },
		...RUNTIME_PACKAGE_SOURCES.map((file) => ({
			path: `${base}/${file.path}`,
			content: file.content,
		})),
	];
}
