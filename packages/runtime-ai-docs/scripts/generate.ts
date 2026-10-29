import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeAiCorpus } from "../src/corpus.ts";
import { buildRuntimeAiCorpus } from "../src/source/build.ts";

/**
 * Flattens the corpus into one committed module. The MCP server runs outside the repository (an
 * executable installed on the author's machine), so docs/public/runtime is not available at
 * runtime. Docs are read here and the result is kept as a value. The web doc generator already made
 * the same decision.
 *
 * Side effect: when this file goes stale, the diff shows it. A commit that edits docs without
 * regenerating is blocked in CI by `--check`.
 *
 * Deterministic: no reads of time, randomness, or environment variables. Same input, same bytes.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const OUT = join(HERE, "..", "src", "generated", "corpus.ts");

const BANNER = `// Generated from docs/public/runtime/**/*.md and @rowcat/runtime's own source.
// Do not edit directly.
//
// Edit the source, then regenerate with \`pnpm --filter @rowcat/runtime-ai-docs gen\`. If this file
// drifts from the source, corpus-source.test.ts breaks.

import type { RuntimeAiCorpus } from "../corpus.ts";

`;

export const renderCorpusModule = (corpus: RuntimeAiCorpus): string =>
	`${BANNER}export const RUNTIME_AI_CORPUS: RuntimeAiCorpus = ${JSON.stringify(
		corpus,
		null,
		"\t",
	)};\n`;

function main(): void {
	const check = process.argv.includes("--check");
	const corpus = buildRuntimeAiCorpus();
	if (corpus.undocumented.length > 0)
		/**
		 * Records the names without stopping. A slice that lands before its docs must not block
		 * generation of the whole `llms.txt`. The requirement that the list be empty is enforced by a
		 * test.
		 */
		process.stderr.write(
			`warning: public API without docs: ${corpus.undocumented.join(", ")} (add it to a reference page's symbols)\n`,
		);
	const expected = renderCorpusModule(corpus);
	let current: string | null = null;
	try {
		current = readFileSync(OUT, "utf8");
	} catch {
		current = null;
	}
	if (current === expected) {
		process.stdout.write(
			`runtime ai docs: up to date (${corpus.docs.length} pages, ${corpus.symbols.length} symbols)\n`,
		);
		return;
	}
	if (check) {
		process.stderr.write(
			`${relative(REPO_ROOT, OUT)} differs from the source; run pnpm --filter @rowcat/runtime-ai-docs gen\n`,
		);
		process.exit(1);
	}
	mkdirSync(dirname(OUT), { recursive: true });
	writeFileSync(OUT, expected);
	process.stdout.write(
		`runtime ai docs: regenerated (${corpus.docs.length} pages, ${corpus.symbols.length} symbols)\n`,
	);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
