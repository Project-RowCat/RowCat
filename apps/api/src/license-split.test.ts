import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * **This repository's license is split in two, and the boundary is the direction of dependency.**
 *
 * ```text
 * Apache-2.0      the creator runtime language, toolchain and wire contracts — the eight APACHE below
 * AGPL-3.0-only   everything else (the five apps, the other packages, the root)
 * ```
 *
 * The split exists so those eight can be used outside this service. That promise becomes false
 * the moment one of the eight takes an AGPL package **as a runtime dependency**: whoever installs it
 * receives AGPL code too, while its `license` field still says Apache. That mismatch breaks neither
 * compilation nor any other test, so it is locked by value (`docs/oss/PLAN.md` §라이선스).
 *
 * - **The material for the decision is `package.json`.** Import statements are not scanned: pnpm
 *   blocks imports of undeclared packages, so the declaration is the ceiling, and the declaration is
 *   also what an installer receives.
 * - **`devDependencies` are ignored.** Tests and tooling are not shipped code and do not follow the
 *   installer.
 * - **A new package defaults to AGPL.** Adding one to the Apache side means changing the list below,
 *   that package's `LICENSE` and `NOTICE`, and the root `NOTICE` together, and that commit is itself
 *   up for review.
 *
 * **It lives in `apps/api` because of the cache.** This check reads every `package.json` in the
 * repository, but Turborepo hashes only each package's own folder (`turbo.json`). Placed in another
 * package, its `test` would **pretend to pass on a cache hit** even after another package's
 * `package.json` changed. `@rowcat/api#test` is the only uncached test task, so it always really
 * runs; `config/operator-domain.test.ts`, which also scans the whole repository, is in this package
 * for the same reason. It does not skip without a database (it only reads files).
 */

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const APACHE = "Apache-2.0";
const AGPL = "AGPL-3.0-only";

/** The packages shipped as Apache-2.0 — **exactly these eight**. Adding one follows the procedure in the header above. */
const APACHE_PACKAGES: readonly string[] = [
	"packages/runtime",
	"packages/runtime-compiler",
	"packages/runtime-host",
	"packages/runtime-renderer-web",
	"packages/runtime-renderer-native",
	"packages/runtime-persistence",
	"packages/runtime-ai-docs",
	"packages/contracts",
];

/** The dependency fields that follow an installer — the absence of `devDependencies` is the point. */
const SHIPPED_DEPENDENCY_FIELDS = [
	"dependencies",
	"peerDependencies",
	"optionalDependencies",
] as const;

interface Manifest {
	name: string;
	license?: string;
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
}

interface Workspace {
	/** The path from the repository root. The root itself is `"."`. */
	dir: string;
	manifest: Manifest;
}

const read = (path: string): string =>
	readFileSync(join(REPO_ROOT, path), "utf8");

/**
 * `pnpm-workspace.yaml` decides the workspace list. Rather than re-interpreting that file's patterns,
 * this **checks the current two patterns by value** and then scans those two folders: if a pattern
 * were added and this check did not know it, a package there would pass green with no license.
 */
const WORKSPACE_GLOBS = ["apps/*", "packages/*"] as const;

function workspaceGlobs(): string[] {
	const yaml = read("pnpm-workspace.yaml");
	const block = /^packages:\s*\n((?:[ \t]+-[^\n]*\n?)+)/m.exec(yaml)?.[1] ?? "";
	return [...block.matchAll(/-\s*["']?([^"'\n]+?)["']?\s*$/gm)].map(
		(match) => match[1] ?? "",
	);
}

function workspaces(): Workspace[] {
	const found: Workspace[] = [
		{ dir: ".", manifest: JSON.parse(read("package.json")) as Manifest },
	];
	for (const glob of WORKSPACE_GLOBS) {
		const parent = glob.slice(0, -"/*".length);
		for (const entry of readdirSync(join(REPO_ROOT, parent), {
			withFileTypes: true,
		})) {
			if (!entry.isDirectory()) continue;
			const dir = `${parent}/${entry.name}`;
			if (!existsSync(join(REPO_ROOT, dir, "package.json"))) continue;
			found.push({
				dir,
				manifest: JSON.parse(read(`${dir}/package.json`)) as Manifest,
			});
		}
	}
	return found;
}

const all = workspaces();
const byName = new Map(all.map((ws) => [ws.manifest.name, ws]));
const apache = all.filter((ws) => APACHE_PACKAGES.includes(ws.dir));

describe("license slots", () => {
	test("the workspace patterns are just the two folders this check walks", () => {
		expect(workspaceGlobs()).toEqual([...WORKSPACE_GLOBS]);
	});

	test("all eight on the Apache list actually exist", () => {
		expect(apache.map((ws) => ws.dir).sort()).toEqual(
			[...APACHE_PACKAGES].sort(),
		);
	});

	test.each(
		all.map((ws) => [ws.dir, ws] as const),
	)("%s's license is the value for its slot", (_dir, ws) => {
		const expected = APACHE_PACKAGES.includes(ws.dir) ? APACHE : AGPL;
		expect(
			ws.manifest.license,
			`the license in ${ws.dir}/package.json must be ${expected}`,
		).toBe(expected);
	});
});

describe("license texts", () => {
	test("the root LICENSE is the AGPL-3.0 text", () => {
		const text = read("LICENSE");
		expect(text).toMatch(/^\s*GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3/);
		expect(text).toContain("END OF TERMS AND CONDITIONS");
	});

	test.each(
		APACHE_PACKAGES,
	)("%s has the Apache 2.0 text and a NOTICE", (dir) => {
		const text = read(`${dir}/LICENSE`);
		expect(text).toMatch(/^\s*Apache License\s+Version 2\.0, January 2004/);
		expect(text).toContain("END OF TERMS AND CONDITIONS");
		expect(read(`${dir}/NOTICE`)).toContain("Copyright (c) 2026 astra-void");
	});

	/** The root NOTICE is the document explaining the split — if its list drifts, the human-readable side becomes false. */
	test("the root NOTICE lists all eight", () => {
		const notice = read("NOTICE");
		expect(notice).toContain("Copyright (c) 2026 astra-void");
		for (const dir of APACHE_PACKAGES) expect(notice).toContain(dir);
	});
});

describe("dependency direction — Apache packages do not take AGPL packages", () => {
	test.each(apache.map((ws) => [ws.dir, ws] as const))("%s", (_dir, ws) => {
		const offenders: string[] = [];
		for (const field of SHIPPED_DEPENDENCY_FIELDS) {
			for (const name of Object.keys(ws.manifest[field] ?? {})) {
				const target = byName.get(name);
				if (target === undefined) continue;
				if (target.manifest.license === APACHE) continue;
				offenders.push(`${field}: ${name} (${target.manifest.license})`);
			}
		}
		expect(
			offenders,
			`${ws.dir} takes a non-Apache-2.0 workspace package as a shipped dependency`,
		).toEqual([]);
	});

	/**
	 * Whether the check does real work: if it recognized no workspace dependency at all, the check
	 * above would always be green. The runtime chain really does depend on itself, so those names must show up.
	 */
	test("actually inspects workspace dependencies", () => {
		const host = byName.get("@rowcat/runtime-host");
		expect(Object.keys(host?.manifest.dependencies ?? {})).toContain(
			"@rowcat/runtime",
		);
	});
});
