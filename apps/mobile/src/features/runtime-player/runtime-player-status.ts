import { RUNTIME_HOST_ERROR_CODE } from "@rowcat/runtime-host/errors";
import type { NativeRuntimeFailure } from "../../lib/runtime-native/protocol.ts";

/**
 * Decides between the two faces of a playback failure. This is the same split the web makes in its
 * worker.
 *
 * ```text
 * version mismatch      this device's app is outdated   the answer is an app update
 * other start failure   our side's incident or a limit   the answer is restart
 * ```
 *
 * While this split was missing, the native screen drew the **same sentence** (`Please restart`) for
 * both failures. Restarting from a version-mismatch screen rebuilds the same artifact in the same
 * app and gets the same failure, so that advice keeps the user in a retry that never ends. The web
 * names that state on its own (`incompatible`), and here it gives the same answer.
 *
 * ## The bridge vocabulary did not grow
 *
 * Nothing is added to the harness as `stage: "artifact"`. That value would be a protocol change and
 * would move the generated harness and WASM assets with it, but the fact needed already crosses:
 * `code` in `NativeRuntimeErrorInfo` carries the host's error code unchanged. So this decision is
 * one pure function on the Hermes side.
 *
 * Codes are not copied into strings. `@rowcat/runtime-host/errors` is a leaf module with no
 * imports, so it does not pull the engine into this app's bundle. A copy would silently make this
 * decision false on the day the host renames a code.
 */
export const runtimeArtifactIncompatible = (
	failure: NativeRuntimeFailure | null | undefined,
): boolean =>
	failure !== null &&
	failure !== undefined &&
	/**
	 * Only `start` is checked. Those two codes are thrown **before a VM is even created** (artifact
	 * validation and the sandbox version comparison fail first), and the web's equivalent decision
	 * lives at that same single spot. The same code arriving with a failure during running is a
	 * different fact, so it is not folded here.
	 */
	failure.stage === "start" &&
	(failure.error.code === RUNTIME_HOST_ERROR_CODE.artifactInvalid ||
		failure.error.code === RUNTIME_HOST_ERROR_CODE.sandboxIncompatible);
