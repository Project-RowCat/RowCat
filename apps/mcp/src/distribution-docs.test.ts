import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * The two names of the distribution: what you install and what you run are different values.
 *
 * ```text
 * package slot  @rowcat/mcp   the name npm/pnpm look up in the registry
 * command slot  rowcat-mcp    the executable the install puts on PATH
 * ```
 *
 * Mixed up, docs end up instructing `npx rowcat-mcp` or `npm install -g rowcat-mcp`, which fetches
 * a package that does not exist, and in review that looks like an ordinary line because the two
 * words really are similar. So it is checked by value.
 *
 * The source is `package.json`: restating the names here would let the copy go stale, and the check
 * would then guard a wrong name.
 *
 * The reverse is equally wrong: mechanically rewriting `rowcat-mcp serve` to `@rowcat/mcp serve`
 * produces a line that does not run. So the check looks at the package manager's argument slot
 * rather than searching for strings (`specifiersOf` below).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, "..");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");

const manifest = JSON.parse(
	readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"),
) as { name: string; bin?: Record<string, string> };

/** Single source of both values. */
const PACKAGE = manifest.name;
const BINARY = Object.keys(manifest.bin ?? {})[0] ?? "";

/**
 * Docs that instruct people with these two names. Generated artifacts (`corpus.ts`,
 * `llms-full.txt`, `runtime-docs-content.ts`) are not here: if the source is right so are they, and
 * `pnpm check`'s `*:check` already guards that pairing.
 */
const DOCS = [
	"apps/mcp/README.md",
	"apps/mcp/DEVELOPMENT.md",
	"AGENTS.md",
	...readdirSync(join(REPO_ROOT, "docs"), {
		recursive: true,
		encoding: "utf8",
	})
		.filter((name) => name.endsWith(".md"))
		.map((name) => `docs/${name.replace(/\\/g, "/")}`),
].filter((path) => existsSync(join(REPO_ROOT, path)));

/** Shape npm accepts as a package name: scope is optional, a version may follow. */
const PACKAGE_SPECIFIER =
	/^(?:@[a-z0-9~][a-z0-9._~-]*\/)?[a-z0-9~][a-z0-9._~-]*(?:@[^\s@]+)?$/;

const MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const RUNNERS = new Set(["npx", "bunx"]);
const INSTALLS = new Set(["install", "add", "i"]);

/**
 * Picks out only the tokens that reach a package manager as a package.
 *
 * `rowcat-mcp serve` (run) and `npx rowcat-mcp` (package) contain the same word; the only
 * difference is which slot the word stands in.
 *
 * ```text
 * npx · bunx            first word after flags is the package
 * pnpm|yarn|bun dlx     same
 * npm|pnpm|… install    every non-flag word up to `--` is a package
 * anything else (claude mcp add · pnpm exec · pnpm --filter)  is not a package slot
 * ```
 *
 * `exec` is left out on purpose: `pnpm exec rowcat-mcp` calls the installed executable, and
 * catching it would flag legitimate lines.
 */
const specifiersOf = (line: string): string[] => {
	const tokens = line
		.replace(/#.*$/, "")
		/**
		 * Backticks count as delimiters. Docs write commands as inline code, and Korean attaches a
		 * particle right after the closing backtick (for example a Korean particle after `rowcat-mcp`). Trimming only the edges would read
		 * that token as `rowcat-mcp` plus the particle and let inline violations pass silently.
		 */
		.replace(/`/g, " ")
		.split(/\s+/)
		.map((token) => token.replace(/^["'([]+/, "").replace(/["'),.\]]+$/, ""))
		.filter((token) => token.length > 0);
	const found: string[] = [];

	for (let i = 0; i < tokens.length; i += 1) {
		const token = tokens[i] ?? "";
		const next = tokens[i + 1] ?? "";

		const runner =
			RUNNERS.has(token) || (MANAGERS.has(token) && next === "dlx")
				? i + (MANAGERS.has(token) ? 2 : 1)
				: -1;
		if (runner >= 0) {
			for (let j = runner; j < tokens.length; j += 1) {
				const candidate = tokens[j] ?? "";
				if (candidate.startsWith("-")) continue;
				found.push(candidate);
				break;
			}
			continue;
		}

		if (!MANAGERS.has(token) || !INSTALLS.has(next)) continue;
		for (let j = i + 2; j < tokens.length; j += 1) {
			const candidate = tokens[j] ?? "";
			if (candidate === "--") break;
			if (candidate.startsWith("-")) continue;
			/**
			 * `install` takes several arguments, so scan to the end of the line. But prose shares a line
			 * with the command (`install with npm install -g @rowcat/mcp@next, then run rowcat-mcp`);
			 * without stopping at a non-package word, the tail of the sentence is read as packages and a
			 * correct line is flagged. A check that flags correct lines gets deleted.
			 */
			if (!PACKAGE_SPECIFIER.test(candidate)) break;
			found.push(candidate);
		}
	}

	return found;
};

/** Strips the version from `pkg@1.2.3` / `pkg@next` (a scope's `@` is the first character, so it is not hit). */
const bareName = (specifier: string): string =>
	specifier.replace(/(?<=.)@[^@/]*$/, "");

const read = (path: string): string =>
	readFileSync(join(REPO_ROOT, path), "utf8");

describe("both names come from package.json alone", () => {
	test("package name and command name", () => {
		expect(PACKAGE).toBe("@rowcat/mcp");
		expect(BINARY).toBe("rowcat-mcp");
		expect(BINARY).not.toBe(PACKAGE);
	});

	/**
	 * Using the command name as the package name is the misunderstanding this slice blocks, and if it
	 * entered the manifest rather than the docs there would be nothing left to check.
	 */
	test("the command name does not act as the package name", () => {
		expect(PACKAGE.startsWith("@")).toBe(true);
		expect(manifest.bin?.[BINARY]).toMatch(/^\.\/dist\//);
	});
});

describe("docs do not pass the command name off as the package", () => {
	test.each(DOCS)("%s", (path) => {
		const offenders: string[] = [];
		for (const line of read(path).split("\n")) {
			for (const specifier of specifiersOf(line)) {
				if (bareName(specifier) !== BINARY) continue;
				offenders.push(line.trim());
			}
		}
		expect(
			offenders,
			`${path}: the package slot takes ${PACKAGE}; ${BINARY} is the command after install`,
		).toEqual([]);
	});

	/**
	 * Checks that this check does not overreach. A check that flags legitimate lines gets deleted
	 * wholesale, taking what it was meant to block with it.
	 */
	test("lines calling the installed copy are not caught", () => {
		for (const line of [
			`${BINARY} serve`,
			`${BINARY} doctor`,
			`claude mcp add rowcat-runtime -- ${BINARY} serve`,
			`ROWCAT_API_BASE_URL=x pnpm exec tsx script.ts "$(which ${BINARY})"`,
			`npm install -g ${PACKAGE}@next`,
			`pnpm add -g ${PACKAGE}@next`,
			`npx ${PACKAGE}@next setup`,
			`pnpm dlx ${PACKAGE}@next serve`,
			`pnpm --filter ${PACKAGE} start setup`,
			`npm install -g ${PACKAGE}@next  # after that it is the single word ${BINARY}`,
			`Install with \`npm install -g ${PACKAGE}@next\`; the command is \`${BINARY} serve\`.`,
		])
			expect(specifiersOf(line).map(bareName), line).not.toContain(BINARY);
	});

	test("catches a command name standing in the package slot", () => {
		for (const line of [
			`npx ${BINARY} setup`,
			`npx -y ${BINARY} serve`,
			`pnpm dlx ${BINARY} setup`,
			`npm install -g ${BINARY}`,
			`npm i ${BINARY}@next`,
			`pnpm add -g ${BINARY}`,
			`bunx ${BINARY} serve`,
			`yarn add ${BINARY}`,
			`Install is one line: \`npx ${BINARY} setup\`.`,
			`Get it with \`npm install -g ${BINARY}\`.`,
		])
			expect(specifiersOf(line).map(bareName), line).toContain(BINARY);
	});
});

describe("the two names are written apart at least once", () => {
	/**
	 * The two docs where people start installing. Without the distinction written down, readers infer
	 * it from examples, and that inference is half right and lands on `npm install -g rowcat-mcp`.
	 */
	test.each([
		"apps/mcp/README.md",
		"docs/public/runtime/guides/ai-tools.md",
	])("%s", (path) => {
		const source = read(path);
		expect(source).toContain(PACKAGE);
		expect(source).toContain(BINARY);
		expect(
			source,
			`${path}: there is no place setting the package name and the command name side by side`,
		).toMatch(/npm 패키지 이름[\s\S]{0,200}설치 뒤의 명령/);
	});
});
