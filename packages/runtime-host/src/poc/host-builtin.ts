import type { RuntimeBuiltinModule } from "../builtins/modules.ts";

/**
 * PoC bridge. This is a test fixture, not a production built-in.
 *
 * `rowcat:internal/poc` is not part of the creator vocabulary. It is absent from the compiler's
 * allowlist, so TS source cannot import it. An artifact can reference it only when the session
 * explicitly installs it (the built-in list in validateRuntimeArtifact). In Phase 3 this module
 * lived in `builtins/` and the root exported it. Now it lives in `poc/`, and production boot works
 * without it. Suites and harnesses install it opt-in.
 *
 * The bridge itself comes from the narrow host built-in `rowcat:internal/host`, not from a global.
 */

export const POC_BUILTIN_ID = "rowcat:internal/poc";

export const POC_HOST_BUILTIN: RuntimeBuiltinModule = {
	id: POC_BUILTIN_ID,
	/**
	 * The only `rowcat:internal/*` module that creator code can import. That is allowed only because
	 * this fixture is installed in tests and harnesses alone.
	 *
	 * Production boot does not pass this module. Passing it makes planRuntimeBootstrap reject, since
	 * this id is the one exception it recognizes.
	 */
	internal: false,
	source: `import { internalHostCall } from "rowcat:internal/host";
export const hostCall = (capability, payload) => internalHostCall(capability, payload);
`,
};
