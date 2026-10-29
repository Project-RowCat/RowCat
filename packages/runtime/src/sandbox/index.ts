import {
	RUNTIME_SANDBOX_API_VERSION,
	RUNTIME_SANDBOX_BUILT_WITH,
	RUNTIME_SANDBOX_MODULES,
	RUNTIME_SANDBOX_SOURCE_DIGEST,
	type RuntimeSandboxModule,
} from "./generated.ts";

/**
 * Assets installed by the VM. These are not creator vocabulary. The root package
 * (`@rowcat/runtime`) does not re-export this module, the same as the declared assets. The consumer
 * is `@rowcat/runtime-host`, which installs these modules inside an isolated VM as
 * `rowcat:runtime`, `rowcat:runtime/jsx-runtime`, and `rowcat:internal/*`. There are three
 * compatibility identities:
 * - RUNTIME_SANDBOX_API_VERSION: version of the language contract these modules implement,
 *   compared with the artifact's apiVersion.
 * - RUNTIME_SANDBOX_BUILD_VERSION: version of the build rules. Shows whether the output was
 *   produced by the current rules.
 * - RUNTIME_SANDBOX_SOURCE_DIGEST: digest of the original source. Shows whether the output comes
 *   from the same source as the declared generated output. The npm version (0.0.0) is not used. It
 *   is a placeholder no one reads. The host compares all three before evaluating creator modules.
 */

export {
	RUNTIME_SANDBOX_API_VERSION,
	RUNTIME_SANDBOX_BUILT_WITH,
	RUNTIME_SANDBOX_MODULES,
	RUNTIME_SANDBOX_SOURCE_DIGEST,
	type RuntimeSandboxModule,
};

/**
 * Version of the build rules this code requires. It must equal the artifact's
 * RUNTIME_SANDBOX_BUILT_WITH. If they differ, the rules changed without the generator being run.
 * sandbox.test.ts and the host's boot check both catch that state.
 */
export const RUNTIME_SANDBOX_BUILD_VERSION = 1;

/** Module ids creator code may import. This list must match the compiler's runtimeBuiltinId. */
export const RUNTIME_SANDBOX_PUBLIC_IDS: readonly string[] =
	RUNTIME_SANDBOX_MODULES.filter((module) => !module.internal).map(
		(module) => module.id,
	);

/**
 * Owner of the symbols. It is the only module through which other built-ins obtain identity.
 * Artifacts cannot point to it.
 */
export const RUNTIME_SANDBOX_SYMBOLS_ID = "rowcat:internal/symbols";

/** Module that holds the dispatcher slot. The host binds the slot by this name. */
export const RUNTIME_SANDBOX_DISPATCHER_ID = "rowcat:internal/dispatcher";
