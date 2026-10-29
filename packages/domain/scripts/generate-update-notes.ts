import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import {
	BOOTSTRAP_REGISTRY,
	GENERATED_FILE,
} from "./lib/generated-registry.ts";

/**
 * Turns authored release notes into the generated runtime registry: `pnpm updates:generate`.
 *
 * - With `--check`, the script compares without writing (`pnpm updates:check`). Generated output
 *   can go stale silently: if the authored file is edited and this command is forgotten, types and
 *   tests still pass while only deployed apps show old notices. CI is also not allowed to fix the
 *   working tree. The check renders in memory and compares against the file.
 * - The rule module (`src/update-note.ts`) imports the generated file. A static import would stop
 *   this script from starting when the file is missing, and a repo whose file was deleted could
 *   never recreate it. So the import is dynamic: an empty registry is written first, and the rule
 *   is imported afterwards. The check mode skips that step. A missing file counts as stale, and a
 *   check that starts rewriting the tree is no longer a check.
 * - It does not generate at app start. The output is committed source and does not depend on
 *   build order or runtime.
 * - It does not patch partially. The whole registry is rewritten, so removed releases also
 *   disappear.
 * - It does not edit the authored files. It only reads them.
 */

const check = process.argv.includes("--check");
const where = relative(process.cwd(), GENERATED_FILE);

if (check && !existsSync(GENERATED_FILE)) {
	process.stderr.write(`${where} is missing; run pnpm updates:generate\n`);
	process.exit(1);
}

if (!existsSync(GENERATED_FILE)) {
	mkdirSync(dirname(GENERATED_FILE), { recursive: true });
	writeFileSync(GENERATED_FILE, BOOTSTRAP_REGISTRY);
}

const { renderUpdateNoteRegistry } = await import(
	"./lib/render-update-note-registry.ts"
);
const { loadUpdateNoteRecords } = await import("./lib/update-note-sources.ts");

const records = await loadUpdateNoteRecords();
const expected = renderUpdateNoteRegistry(records);

if (check) {
	if (readFileSync(GENERATED_FILE, "utf8") === expected) {
		process.stdout.write(`${where}: up to date (${records.length} releases)\n`);
		process.exit(0);
	}
	process.stderr.write(
		`${where} differs from the authored releases; run pnpm updates:generate\n`,
	);
	process.exit(1);
}

writeFileSync(GENERATED_FILE, expected);
process.stdout.write(`${where}: ${records.length} releases\n`);
