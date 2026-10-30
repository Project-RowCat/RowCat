/**
 * Runs the desktop stack from this checkout's build outputs, without Electron — the quickest way to
 * see whether the bundled Postgres and the three servers come up together.
 *
 *   pnpm --filter @rowcat/desktop stack [data dir]
 *
 * Build first (`pnpm turbo run build --filter=@rowcat/api --filter=web --filter=admin`). The data
 * directory defaults to `.desktop-data/` here, so it never touches an installed app's data.
 */
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startStack } from "../src/stack.ts";

const repo = resolve(fileURLToPath(import.meta.url), "../../../..");
const dataDir = resolve(process.argv[2] ?? join(repo, "apps/desktop/.desktop-data"));

const stack = await startStack({
	dataDir,
	artifacts: {
		apiDir: join(repo, "apps/api"),
		webServerEntry: join(repo, "apps/web/.output/server/index.mjs"),
		consoleDistDir: join(repo, "apps/admin/dist"),
		node: { command: process.execPath },
	},
	log: (source, line) => console.log(`[${source}] ${line}`),
});

console.log(`\n  RowCat     ${stack.origins.web}`);
console.log(`  Console    ${stack.origins.console}`);
const code = stack.setupCode();
if (code) console.log(`  Setup code ${code}  (open ${stack.origins.console}/setup)`);
console.log(`  Data       ${dataDir}\n`);

for (const signal of ["SIGINT", "SIGTERM"] as const)
	process.once(signal, () => void stack.stop().then(() => process.exit(0)));
