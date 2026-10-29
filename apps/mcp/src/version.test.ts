import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * The package version must agree between `package.json` (what npm publishes) and `index.ts`
 * `VERSION` (what `--version` and MCP clients read). Reading `package.json` from the bundle would
 * be automatic, but bundlers rewrite that path and a mistake breaks only the installed copy; the
 * value stays literal and this check keeps the pair in step.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const manifest = JSON.parse(
	readFileSync(join(HERE, "..", "package.json"), "utf8"),
) as {
	name: string;
	version: string;
	private?: boolean;
	license?: string;
	bin?: Record<string, string>;
	files?: string[];
	engines?: { node?: string };
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	publishConfig?: { access?: string; tag?: string };
	repository?: unknown;
	bugs?: unknown;
	homepage?: unknown;
};

const source = readFileSync(join(HERE, "index.ts"), "utf8");

describe("version", () => {
	test("index.ts's VERSION equals package.json", () => {
		const declared = /const VERSION = "([^"]+)";/.exec(source)?.[1];
		expect(declared).toBe(manifest.version);
	});

	/** Once a version is `latest`, `pnpm add @rowcat/mcp` picks up an unverified release, and npm versions are immutable. */
	test("it is a prerelease with dist-tag next", () => {
		expect(manifest.version).toMatch(/-(alpha|beta|rc)\.\d+$/);
		expect(manifest.publishConfig?.tag).toBe("next");
	});
});

describe("a publishable shape", () => {
	test("not private, and goes out with a public scope", () => {
		expect(manifest.private).toBeUndefined();
		expect(manifest.publishConfig?.access).toBe("public");
	});

	/** `bin` once pointed at `src/`; an installed machine has neither TypeScript nor workspace symlinks, so it died on line one. */
	test("bin points at the build output", () => {
		expect(manifest.bin?.["rowcat-mcp"]).toBe("./dist/index.mjs");
	});

	/** Listing `LICENSE` removes an assumption: a tarball missing it ships a `SEE LICENSE IN LICENSE` pointing nowhere, and npm versions are immutable. */
	test("the tarball holds only dist, README and LICENSE", () => {
		expect(manifest.files).toEqual(["dist", "README.md", "LICENSE"]);
	});

	test("states the Node version", () => {
		expect(manifest.engines?.node).toMatch(/^>=/);
	});
});

describe("the two groups of dependencies", () => {
	/** `@rowcat/*` is not published; left in `dependencies`, `npm install` fetches names the registry lacks and fails. They fold into the bundle, so they are dev dependencies. */
	test("@rowcat/* is not in dependencies", () => {
		const runtime = Object.keys(manifest.dependencies ?? {});
		expect(runtime.filter((name) => name.startsWith("@rowcat/"))).toEqual([]);
	});

	test("@rowcat/* is in devDependencies with workspace specifiers", () => {
		for (const [name, range] of Object.entries(manifest.devDependencies ?? {}))
			if (name.startsWith("@rowcat/")) expect(range).toBe("workspace:*");
	});

	/**
	 * Two dependencies are read as files and cannot fold into the bundle. `createRequire` resolves
	 * them from the installed `node_modules`, so a transitive dependency is not enough; missing,
	 * install succeeds and only the preview breaks.
	 */
	test("packages providing WASM and lib.d.ts are direct dependencies", () => {
		const runtime = manifest.dependencies ?? {};
		expect(runtime["@jitl/quickjs-ng-wasmfile-release-sync"]).toBeDefined();
		expect(runtime["typescript-compiler-api"]).toBeDefined();
	});
});

describe("the same executable on every platform", () => {
	/**
	 * Windows cannot be exercised here, so the assumptions that could break are pinned by value: no
	 * hand-joined paths (a "/" points elsewhere on Windows), home only from `homedir()` (`$HOME` is
	 * absent there), and no shell (chmod/mkdir via a shell makes the package POSIX-only). The `bin`
	 * shebang needs nothing because npm makes `.cmd`/`.ps1` shims, which is why `bin` must point at
	 * one built `.mjs`.
	 */
	const files = readdirSync(HERE, { recursive: true, encoding: "utf8" })
		.filter((name) => name.endsWith(".ts") && !name.includes(".test."))
		.map((name) => ({ name, code: readFileSync(join(HERE, name), "utf8") }));

	test.each(files.map((file) => file.name))("%s", (name) => {
		const code = files.find((file) => file.name === name)?.code ?? "";
		expect(code, "joins paths as strings").not.toMatch(
			/["'`]\$\{[A-Za-z0-9_.]+\}\/[A-Za-z]/,
		);
		expect(code, "reads $HOME").not.toMatch(/process\.env\.HOME\b/);
		expect(code, "calls a shell").not.toMatch(/child_process/);
	});

	test("config comes from the home directory, not cwd or the install path", () => {
		const config = readFileSync(join(HERE, "config.ts"), "utf8");
		expect(config).toContain("homedir()");
		expect(config).not.toMatch(/process\.cwd\(\)/);
		expect(config).not.toMatch(/import\.meta\.(url|dirname)/);
	});
});

/**
 * License. The package is the repository's `apps/mcp`, and the repository is AGPL-3.0-only
 * (`NOTICE`, `apps/api/src/license-split.test.ts` locks the split for every workspace package).
 *
 * 1. The manifest states the SPDX identifier, not a pointer into the tarball: tools and the npm
 *    page read the identifier, and `SEE LICENSE IN LICENSE` makes them guess.
 * 2. The shipped `LICENSE` is byte-for-byte the root one. A second copy that drifts (or the old
 *    proprietary text surviving in this folder) would make the npm tarball say something the
 *    repository does not.
 * 3. The README summary must not contradict it — this package was proprietary for a while, and
 *    "not open source" sentences are the easiest thing to leave behind.
 */
describe("the public release's license", () => {
	test("carries the SPDX identifier AGPL-3.0-only", () => {
		expect(manifest.license).toBe("AGPL-3.0-only");
	});

	const license = readFileSync(join(HERE, "..", "LICENSE"), "utf8");

	test("the bundled LICENSE equals the original at the repository root", () => {
		const root = readFileSync(join(HERE, "..", "..", "..", "LICENSE"), "utf8");
		expect(license).toBe(root);
		expect(license).toMatch(
			/^\s*GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3/,
		);
	});

	test("no proprietary license sentences remain", () => {
		expect(license).not.toMatch(/all rights reserved/i);
		expect(license).not.toMatch(/proprietary/i);
	});

	const readme = readFileSync(join(HERE, "..", "README.md"), "utf8");

	/** The README stays Korean, so these matchers read Korean text. */
	test("the README states the license and points at the LICENSE file", () => {
		expect(readme).toMatch(/## 라이선스/);
		expect(readme).toContain("LICENSE");
		expect(readme).toContain("AGPL-3.0-only");
		expect(readme, "a summary posing as the original").toMatch(
			/요약이 원문을 대신하지/,
		);
	});

	test("the README does not say proprietary or that the repository is private", () => {
		expect(readme).not.toMatch(/독점 소프트웨어/);
		expect(readme).not.toMatch(/저장소는 공개(?:가 아닙니다|되어 있지 않)/);
	});

	/** The files this tool edits are the creator's work; without this paragraph the license would seem to cover them. It is easy to delete, so it is pinned. */
	test("does not claim ownership of what users make", () => {
		expect(readme).toMatch(/소유권을 주장하지 않습니다/);
	});
});

/**
 * The npm page's three links lead to the public repository. They used to stay empty, because the code
 * lived in a private repository and the hosted service's site and support mail were going away; now
 * the repository is public, and `repository.url` is also what npm's provenance check compares with
 * the publishing repository (`identityProblems` in `scripts/release-policy.mjs` holds the rule, this
 * pins the values).
 */
describe("public links lead to the public repository", () => {
	const REPO = "https://github.com/Project-RowCat/RowCat";

	test("repository names it, with this package's directory", () => {
		expect(manifest.repository).toEqual({
			type: "git",
			url: "git+https://github.com/Project-RowCat/RowCat.git",
			directory: "apps/mcp",
		});
	});

	test("bugs and homepage point into it", () => {
		expect(manifest.bugs).toEqual({ url: `${REPO}/issues` });
		expect(manifest.homepage).toBe(`${REPO}/tree/main/apps/mcp#readme`);
	});
});

/**
 * The README ships in the tarball and is read on npm by people without this repository;
 * `DEVELOPMENT.md` does not ship. Merging them is natural but quietly costs: `pnpm --filter`
 * commands, workflow names and the procedure for retracting a bad release would sit on the public
 * registry page, where readers can do none of it. A re-merge looks like an ordinary edit, so it is
 * pinned by value.
 */
describe("the README is a public surface", () => {
	const readme = readFileSync(join(HERE, "..", "README.md"), "utf8");

	test.each([
		[/(?:^|[\s(`])docs\/[a-z]/m, "docs paths of the private repository"],
		[/\.github\//, "workflow file names"],
		[/pnpm --filter/, "commands that run only in the workspace"],
		[/git tag/, "the release procedure"],
		[/unpublish/i, "the version withdrawal procedure"],
	] as const)("contains no %s", (pattern, what) => {
		expect(
			readme,
			`the README has ${what}: that belongs in DEVELOPMENT.md`,
		).not.toMatch(pattern);
	});

	/** The opposite direction too: with only the bans above, emptying the README would pass green. */
	test.each([
		["install", "npm install -g @rowcat/mcp"],
		["first connection", "rowcat-mcp setup"],
		["the command clients call", "rowcat-mcp serve"],
		["when stuck", "rowcat-mcp doctor"],
		["license", "## 라이선스"],
	] as const)("%s can be done without the repository", (_what, needle) => {
		expect(readme).toContain(needle);
	});

	/** The destination of the moved content must exist and must not ship. */
	test("contributor docs are separate and not in the tarball", () => {
		expect(existsSync(join(HERE, "..", "DEVELOPMENT.md"))).toBe(true);
		expect(manifest.files).not.toContain("DEVELOPMENT.md");
	});
});
