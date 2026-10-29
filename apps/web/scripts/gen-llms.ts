import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
	RUNTIME_AI_CORPUS,
	renderLlmsFullTxt,
	renderLlmsTxt,
	renderRuntimeApiJson,
} from "@rowcat/runtime-ai-docs";

/**
 * Emits the static asset set that agents read: `/llms.txt` (a one-page bootstrap with rules, the
 * document index and every public name), `/llms-full.txt` (the full public docs) and
 * `/runtime-api.json` (a machine-readable API reference).
 *
 * These are copies of the docs, not screens, so they live in `public/` rather than behind a server
 * route. Vite serves that folder at the root in both dev and build, which is where the `llms.txt`
 * convention expects them.
 *
 * `PUBLIC_WEB_ORIGIN` sets absolute URLs when present, otherwise they are root-relative. An
 * absolute origin baked into code would become a deployment fact, and a staging build would point
 * its llms.txt at production.
 *
 * No sentence describing the product is written here. All of it comes from the markdown under
 * `docs/public/runtime` (agent-only guidance lives in `_agents.md`).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const PUBLIC_DIR = join(HERE, "..", "public");

const origin = (process.env.PUBLIC_WEB_ORIGIN ?? "").trim();

const OUTPUTS: readonly [string, string][] = [
	[join(PUBLIC_DIR, "llms.txt"), renderLlmsTxt(RUNTIME_AI_CORPUS, { origin })],
	[
		join(PUBLIC_DIR, "llms-full.txt"),
		renderLlmsFullTxt(RUNTIME_AI_CORPUS, { origin }),
	],
	[
		join(PUBLIC_DIR, "runtime-api.json"),
		renderRuntimeApiJson(RUNTIME_AI_CORPUS, { origin }),
	],
];

function main(): void {
	const check = process.argv.includes("--check");
	let stale = false;
	for (const [file, expected] of OUTPUTS) {
		let current: string | null = null;
		try {
			current = readFileSync(file, "utf8");
		} catch {
			current = null;
		}
		if (current === expected) continue;
		stale = true;
		if (check) {
			process.stderr.write(
				`${relative(ROOT, file)} differs from the corpus; run pnpm --filter web gen:llms\n`,
			);
			continue;
		}
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, expected);
	}
	if (check && stale) process.exit(1);
	process.stdout.write(
		`llms: ${stale ? "regenerated" : "up to date"} (${RUNTIME_AI_CORPUS.docs.length} pages, ${RUNTIME_AI_CORPUS.symbols.length} symbols)\n`,
	);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
