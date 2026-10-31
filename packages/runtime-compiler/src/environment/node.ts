import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { RuntimeCompileFile } from "../contracts.ts";
import type { RuntimeCompilerEnvironment } from "../typescript-host.ts";

/**
 * Wires the compiler on Node. This is the only file that knows about Node.
 *
 * The core does not call node:fs or node:crypto. If those imports entered the core, the package
 * would not load in a browser, and when the studio later wants full compilation in a trusted
 * worker, the package would first have to be split. So the core requires only two values
 * (defaultLibs and digest), and this environment decides where they come from.
 */

const require = createRequire(import.meta.url);

/**
 * The library files this environment may hold, by name. It is the same set the studio preview
 * worker bundles (apps/web runtime-preview-libs.ts globs lib.es5, lib.es2015..2022* and
 * lib.decorators*), written as one pattern so the two lists can be compared by eye.
 *
 * The set is narrowed by family rather than by walking the reference chain. lib.es2022.d.ts
 * references es2021 and so on down to es5, and knowing that chain exactly belongs to TypeScript and
 * changes between versions; a family pattern survives a TypeScript upgrade that adds a file.
 *
 * Narrowing is not cosmetic. `lib: [es2022]` only chooses the default; a `/// <reference lib>` in
 * creator source is resolved against whatever files sit in the lib folder. While every lib.*.d.ts
 * was here, one comment line put lib.dom.d.ts into the publication compile and fetch, document and
 * WebSocket type-checked, while the studio preview (which never had them) refused the same source.
 * The policy pass now refuses the directive itself (policy.ts); this set is what stands behind it.
 */
const RUNTIME_LIB_FILE =
	/^lib\.(?:es5|es20(?:15|16|17|18|19|20|21|22)[^/]*|decorators[^/]*)\.d\.ts$/;

/**
 * Reads lib.*.d.ts from the installed TypeScript instead of committing a copy, because a copy goes
 * stale. A commit that upgrades TypeScript must also update those files; otherwise the libraries
 * the checker uses and the compiler that emits diverge.
 */
export function nodeRuntimeLibs(): RuntimeCompileFile[] {
	const libDirectory = dirname(
		require.resolve("typescript-compiler-api/package.json"),
	);
	const lib = join(libDirectory, "lib");
	return readdirSync(lib)
		.filter((name) => RUNTIME_LIB_FILE.test(name))
		.sort()
		.map((name) => ({
			path: name,
			content: readFileSync(join(lib, name), "utf8"),
		}));
}

/**
 * SHA-256 truncated to 32 hex characters. This is a cache key, not a basis for permission
 * decisions. The short value is also easy to read in logs and on screen; the version column of the
 * studio's cover table makes the same tradeoff.
 */
export const nodeDigest = (canonical: string): string =>
	createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 32);

let cached: RuntimeCompilerEnvironment | null = null;

/**
 * The environment for this process, read once. The library is dozens of files, so re-scanning disk
 * on every compile would cost more than the compile itself. The test suite calls this function
 * dozens of times.
 */
export function nodeRuntimeEnvironment(): RuntimeCompilerEnvironment {
	if (cached === null)
		cached = { defaultLibs: nodeRuntimeLibs(), digest: nodeDigest };
	return cached;
}
