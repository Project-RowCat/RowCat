import {
	RUNTIME_API_VERSION,
	RUNTIME_DECLARATIONS_SOURCE_DIGEST,
} from "@rowcat/runtime/declarations";
import {
	RUNTIME_SANDBOX_API_VERSION,
	RUNTIME_SANDBOX_BUILD_VERSION,
	RUNTIME_SANDBOX_BUILT_WITH,
	RUNTIME_SANDBOX_SOURCE_DIGEST,
} from "@rowcat/runtime/sandbox";
import {
	DISPATCHER_BUILTIN_ID,
	DURABLE_STATE_BUILTIN_ID,
	HOST_BRIDGE_BUILTIN,
	HOST_BRIDGE_BUILTIN_ID,
	HOST_CAPABILITY_BUILTIN_ID,
	HOST_PORT_BUILTIN_ID,
	HOST_PORT_INSTALLER_BUILTIN,
	HOST_PORT_INSTALLER_BUILTIN_ID,
	PERSISTENT_STATE_BUILTIN_ID,
	PUBLIC_BUILTIN_IDS,
	RUNTIME_ROOT_BUILTIN_ID,
	RUNTIME_SANDBOX_BUILTINS,
	type RuntimeBuiltinModule,
	STORY_STATE_BUILTIN_ID,
	SYMBOLS_BUILTIN_ID,
} from "./builtins/modules.ts";

/**
 * Boot order and compatibility checks: the two gates a session passes before it evaluates creator
 * code.
 *
 * Boot order: prelude (trusted functions and bridge globals), then
 * 1. symbols (`rowcat:internal/symbols`, identity owner)
 * 2. host-bridge (`rowcat:internal/host`, the only builtin that captures the bridge global)
 * 3. runtime (`rowcat:internal/*` and `rowcat:runtime*`, internal modules then public)
 * 4. host-port installer (`rowcat:internal/host-port-installer`, fills the runtime's port slot)
 * 5. extras (builtins the session adds, such as the PoC bridge and test dispatcher) then the
 *    bridge globals are deleted, then 6. creator (artifact modules, entry point first), and then
 *    the session is ready.
 *
 * The order matters in three places. The bridge builtin must be captured before runtime internals
 * import it. The port installer must run after both the runtime slot and the bridge exist. Creator
 * modules may evaluate only after the bridge globals are gone. `planRuntimeBootstrap` encodes this
 * order as a value, and `bootstrap.test.ts` pins it. The adapter imports the plan as-is and has no
 * order of its own.
 *
 * Compatibility is checked before any creator module evaluates. An artifact declaring apiVersion 1
 * on a runtime of another version would compile but run on a contract it was not built against.
 * That shows up as a SyntaxError or as silent misbehavior. Three values are compared: the language
 * contract version (apiVersion), the generator rule version (builtWith), and the source digest
 * (whether it matches the declared generated output). If any one differs, no VM is created.
 */

export interface RuntimeSandboxBuild {
	readonly apiVersion: number;
	readonly builtWith: number;
	readonly sourceDigest: string;
	readonly modules: readonly RuntimeBuiltinModule[];
}

/**
 * The generated build this host installs. Tests pass this shape instead of the real one to simulate
 * a mismatched build.
 */
export const CURRENT_RUNTIME_SANDBOX: RuntimeSandboxBuild = Object.freeze({
	apiVersion: RUNTIME_SANDBOX_API_VERSION,
	builtWith: RUNTIME_SANDBOX_BUILT_WITH,
	sourceDigest: RUNTIME_SANDBOX_SOURCE_DIGEST,
	modules: RUNTIME_SANDBOX_BUILTINS,
});

/** What the host requires at boot. These values define this code's version. */
export const RUNTIME_SANDBOX_EXPECTATION = Object.freeze({
	apiVersion: RUNTIME_API_VERSION,
	buildVersion: RUNTIME_SANDBOX_BUILD_VERSION,
	sourceDigest: RUNTIME_DECLARATIONS_SOURCE_DIGEST,
	/** Modules boot cannot proceed without: the public set, plus the identity and dispatcher slots. */
	requiredIds: [
		...PUBLIC_BUILTIN_IDS,
		SYMBOLS_BUILTIN_ID,
		DISPATCHER_BUILTIN_ID,
		HOST_PORT_BUILTIN_ID,
		HOST_CAPABILITY_BUILTIN_ID,
		RUNTIME_ROOT_BUILTIN_ID,
		STORY_STATE_BUILTIN_ID,
		/**
		 * Both lifetimes must be present. A host that reports compatibility but lacks one of them fails
		 * with a SyntaxError during creator module evaluation instead of at boot. That is the same reason
		 * RUNTIME_API_VERSION is bumped.
		 */
		PERSISTENT_STATE_BUILTIN_ID,
		DURABLE_STATE_BUILTIN_ID,
	] as readonly string[],
});

export type SandboxCompatibility = { ok: true } | { ok: false; reason: string };

export function checkSandboxCompatibility(
	build: RuntimeSandboxBuild,
	expectation: typeof RUNTIME_SANDBOX_EXPECTATION = RUNTIME_SANDBOX_EXPECTATION,
): SandboxCompatibility {
	if (build.apiVersion !== expectation.apiVersion)
		return {
			ok: false,
			reason: `sandbox runtime implements api ${build.apiVersion}, host expects ${expectation.apiVersion}`,
		};
	if (build.builtWith !== expectation.buildVersion)
		return {
			ok: false,
			reason: `sandbox runtime was generated with build rules ${build.builtWith}, host expects ${expectation.buildVersion} — run pnpm runtime:sandbox`,
		};
	if (build.sourceDigest !== expectation.sourceDigest)
		return {
			ok: false,
			reason:
				"sandbox runtime and declarations were generated from different sources — run pnpm runtime:declarations && pnpm runtime:sandbox",
		};
	const ids = new Set(build.modules.map((module) => module.id));
	for (const required of expectation.requiredIds)
		if (!ids.has(required))
			return { ok: false, reason: `sandbox runtime is missing ${required}` };
	for (const module of build.modules)
		if (
			!module.internal &&
			!(expectation.requiredIds as readonly string[]).includes(module.id)
		)
			return {
				ok: false,
				reason: `sandbox runtime exposes an unexpected public module ${module.id}`,
			};
	return { ok: true };
}

export const BOOTSTRAP_STAGES = [
	"symbols",
	"host-bridge",
	"runtime",
	"host-port",
	"extras",
] as const;

export type RuntimeBootstrapStage = (typeof BOOTSTRAP_STAGES)[number];

export interface RuntimeBootstrapPlan {
	/** The adapter imports in this order. */
	readonly stages: readonly {
		readonly stage: RuntimeBootstrapStage;
		readonly moduleIds: readonly string[];
	}[];
	/** All builtins placed in the loader table. Their order matches `stages`. */
	readonly builtins: readonly RuntimeBuiltinModule[];
	readonly builtinIds: ReadonlySet<string>;
	/** Builtins an artifact may reference: only non-internal builtins. */
	readonly importableIds: ReadonlySet<string>;
}

const byId = (
	left: RuntimeBuiltinModule,
	right: RuntimeBuiltinModule,
): number => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

/**
 * Builds the plan. This is pure. Within the generated modules, internal modules come first, then
 * public ones, and each group is sorted by id. ESM evaluates dependencies first, so this order is
 * not needed for correctness. Its value is that the adapter has no order of its own, and two runs
 * boot in the same order. A duplicate id is a host bug and throws.
 */
/** Namespace for internal modules. This prefix is never resolved from creator source. */
const INTERNAL_ID_PREFIX = "rowcat:internal/";
/**
 * The only exception. The value is written here because importing `poc/` would make production boot
 * carry the fixtures.
 */
const POC_IMPORTABLE_INTERNAL_ID = "rowcat:internal/poc";

export function planRuntimeBootstrap(
	build: RuntimeSandboxBuild,
	extras: readonly RuntimeBuiltinModule[] = [],
): RuntimeBootstrapPlan {
	const symbols = build.modules.filter((m) => m.id === SYMBOLS_BUILTIN_ID);
	const generated = build.modules.filter((m) => m.id !== SYMBOLS_BUILTIN_ID);
	const runtime = [
		...generated.filter((m) => m.internal).sort(byId),
		...generated.filter((m) => !m.internal).sort(byId),
	];
	const builtins: RuntimeBuiltinModule[] = [
		...symbols,
		HOST_BRIDGE_BUILTIN,
		...runtime,
		HOST_PORT_INSTALLER_BUILTIN,
		...extras,
	];
	const seen = new Set<string>();
	for (const module of builtins) {
		if (seen.has(module.id))
			throw new Error(`builtin ${module.id} is installed twice`);
		seen.add(module.id);
		/**
		 * The promise that `rowcat:internal/*` is not creator vocabulary is enforced here. The generator
		 * sets the flag for generated runtime modules, but the host writes the extras. A single missing
		 * flag there would turn an internal module into public vocabulary. The only exception is the PoC
		 * bridge; its rationale is in `poc/host-builtin.ts`.
		 */
		if (
			!module.internal &&
			module.id.startsWith(INTERNAL_ID_PREFIX) &&
			module.id !== POC_IMPORTABLE_INTERNAL_ID
		)
			throw new Error(
				`builtin ${module.id} is internal by name but installed as importable`,
			);
	}
	return {
		stages: [
			{ stage: "symbols", moduleIds: symbols.map((m) => m.id) },
			{ stage: "host-bridge", moduleIds: [HOST_BRIDGE_BUILTIN_ID] },
			{ stage: "runtime", moduleIds: runtime.map((m) => m.id) },
			{ stage: "host-port", moduleIds: [HOST_PORT_INSTALLER_BUILTIN_ID] },
			{ stage: "extras", moduleIds: extras.map((m) => m.id) },
		],
		builtins,
		builtinIds: seen,
		importableIds: new Set(
			builtins.filter((m) => m.internal !== true).map((m) => m.id),
		),
	};
}
