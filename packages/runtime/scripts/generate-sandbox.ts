import { readFileSync, writeFileSync } from "node:fs";
import { RUNTIME_API_VERSION } from "../src/declarations/index.ts";
import {
	collectRuntimeSources,
	renderSandbox,
	SANDBOX_FILE,
} from "./lib/sandbox-build.ts";

/**
 * `pnpm runtime:sandbox`: converts the runtime source into a generated module that the VM runs.
 * `--check` writes nothing and only compares (for CI). Rules and rationale are in the header of
 * lib/sandbox-build.ts.
 */

const check = process.argv.includes("--check");
const expected = renderSandbox(collectRuntimeSources(), RUNTIME_API_VERSION);
const current = (() => {
	try {
		return readFileSync(SANDBOX_FILE, "utf8");
	} catch {
		return null;
	}
})();

if (current === expected) {
	process.stdout.write("runtime sandbox: up to date\n");
	process.exit(0);
}

if (check) {
	process.stderr.write(
		"runtime sandbox differs from the source; run pnpm runtime:sandbox\n",
	);
	process.exit(1);
}

writeFileSync(SANDBOX_FILE, expected);
process.stdout.write("runtime sandbox: regenerated\n");
