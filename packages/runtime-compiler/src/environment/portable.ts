import type { RuntimeCompileFile } from "../contracts.ts";
import type { RuntimeCompilerEnvironment } from "../typescript-host.ts";
import { sha256Hex } from "./sha256.ts";

/**
 * Environment that runs anywhere, given only the library files.
 *
 * It differs from node.ts only in where the library is read from. Node reads the installed
 * TypeScript lib/ directory. A browser worker passes in strings that the bundle shipped as assets.
 * How the bundle loads them (Vite's ?raw) belongs to the app, so this package does not know. Both
 * environments pass the same function (sha256Hex in sha256.ts) for digests, so the same manuscript
 * gets the same sourceHash wherever it is compiled.
 */

/** Must return the same value as nodeDigest in the Node environment. */
export const portableDigest = (canonical: string): string =>
	sha256Hex(canonical).slice(0, 32);

export function portableRuntimeEnvironment(
	defaultLibs: readonly RuntimeCompileFile[],
): RuntimeCompilerEnvironment {
	return { defaultLibs, digest: portableDigest };
}
