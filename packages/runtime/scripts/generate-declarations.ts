import { readFileSync, writeFileSync } from "node:fs";
import {
	collectRuntimeSources,
	DECLARATIONS_FILE,
	renderDeclarations,
} from "./lib/declaration-sources.ts";

/**
 * `pnpm runtime:declarations`: converts the runtime source into a generated file that tooling
 * reads. `--check` writes nothing and only compares (for CI). Rules and rationale are in the header
 * of lib/declaration-sources.ts.
 */

const check = process.argv.includes("--check");
const expected = renderDeclarations(collectRuntimeSources());
const current = (() => {
	try {
		return readFileSync(DECLARATIONS_FILE, "utf8");
	} catch {
		return null;
	}
})();

if (current === expected) {
	process.stdout.write("runtime declarations: up to date\n");
	process.exit(0);
}

if (check) {
	process.stderr.write(
		"runtime declarations differ from the source; run pnpm runtime:declarations\n",
	);
	process.exit(1);
}

writeFileSync(DECLARATIONS_FILE, expected);
process.stdout.write("runtime declarations: regenerated\n");
