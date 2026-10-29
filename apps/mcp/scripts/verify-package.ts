import { execFileSync, spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Builds the tarball, installs it into an empty directory and runs it, to prove the package works
 * outside the repository.
 *
 * Checking inside the workspace gives a false green: `node_modules` resolves upward there, so
 * undeclared dependencies and unbundled `@rowcat/*` packages are all found. The temp directory is
 * therefore the OS's, not `RowCat/tmp/` (which also resolves through the parent `node_modules`).
 *
 * - pack list: no src, tests, config or secrets in the tarball
 * - license: the declared LICENSE file is actually in the tarball
 * - source leak: the sourcemap does not embed the private repo's TypeScript originals. The bundle
 *   folds `@rowcat/*` in, so default sourcemaps put `packages/*` sources in `sourcesContent`
 *   (measured: 135 of 145 files) and `files` ships all of `dist`. One build setting
 *   (`sourcemapExcludeSources`) prevents it, but deleting it raises no error, so the result is
 *   checked here. npm versions are immutable, so a leak cannot be taken back.
 * - install: npm resolves every dependency from the tarball alone
 * - `--help`: the installed executable starts
 * - doctor: the compiler and QuickJS stand in the installed copy. This is the reason the file
 *   exists: the `.wasm` and `lib.*.d.ts` assets must be found in the installed `node_modules`, not
 *   at a repository path.
 * - remaining imports: every bare import left in the bundle is a declared dependency
 * - path leak: no absolute repository path in the output
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = dirname(HERE);

const say = (line: string): void => {
	process.stderr.write(`${line}\n`);
};

const run = (
	command: string,
	args: readonly string[],
	cwd: string,
): string => {
	try {
		return execFileSync(command, [...args], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			// The installed executable must not inherit the parent shell's workspace config. Colour is off
			// because output is string-matched and some tools colour even without a TTY (CI).
			env: {
				...process.env,
				npm_config_workspaces: "false",
				NO_COLOR: "1",
				FORCE_COLOR: "0",
			},
		});
	} catch (error) {
		const shell = error as { stdout?: string; stderr?: string };
		throw new Error(
			`${command} ${args.join(" ")} failed\n${shell.stdout ?? ""}${shell.stderr ?? ""}`,
		);
	}
};

/**
 * Runs a command, accepting success or failure, and reads stderr too. That is why this is
 * `spawnSync`: the executable's human-facing output goes to stderr (stdout is JSON-RPC), so a
 * stdout-only check would see a successful command's output as empty.
 */
const attempt = (
	command: string,
	args: readonly string[],
	cwd: string,
	env: Readonly<Record<string, string>> = {},
): { readonly code: number; readonly out: string } => {
	const result = spawnSync(command, [...args], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: {
			...process.env,
			npm_config_workspaces: "false",
			NO_COLOR: "1",
			FORCE_COLOR: "0",
			...env,
		},
	});
	return {
		code: result.status ?? 1,
		out: `${result.stdout ?? ""}${result.stderr ?? ""}`,
	};
};

const failures: string[] = [];
const check = (ok: boolean, label: string, detail?: string): void => {
	say(`${ok ? "  ✓" : "  ✗"} ${label}${detail === undefined ? "" : ` — ${detail}`}`);
	if (!ok) failures.push(label);
};

/** What must not be in the tarball: source, tests, config, secrets. */
const FORBIDDEN: readonly RegExp[] = [
	/^package\/src\//,
	/\.test\.(ts|js|mjs)$/,
	/^package\/scripts\//,
	/^package\/tsconfig\.json$/,
	/^package\/tsdown\.config\.ts$/,
	/^package\/\.env/,
	/^package\/node_modules\//,
	/\.tsbuildinfo$/,
];

/** Any of these in the output means the repository or a secret leaked. */
const LEAKS: readonly [RegExp, string][] = [
	[/\/Users\/[^\s"']+\/RowCat/, "an absolute repository path"],
	[/workspace:\*/, "a workspace specifier"],
	[/_authToken/, "an npm token"],
	[/BEGIN [A-Z ]*PRIVATE KEY/, "a private key"],
	[/\bsk-[A-Za-z0-9]{16,}/, "provider credentials"],
];

async function main(): Promise<void> {
	say("");
	say("① Build");
	run("pnpm", ["exec", "tsdown"], PACKAGE);
	const bundle = readFileSync(join(PACKAGE, "dist", "index.mjs"), "utf8");
	check(bundle.startsWith("#!/usr/bin/env node"), "has a shebang");
	check(
		!bundle.includes("--experimental-strip-types"),
		"no source-execution assumptions remain",
	);

	// Only line-initial `import`s count. The bundle embeds the AI docs corpus as strings, including
	// creator examples like `import { Stack } from "@rowcat/runtime"`; scanning the whole file would
	// read those as `@rowcat/*` left external. rolldown hoists externals to static imports at the top.
	const imported = [...bundle.matchAll(/^(?:import|export)[^\n]*?from\s*["']([^"']+)["']/gm)]
		.map((match) => match[1] ?? "")
		.filter((specifier) => !specifier.startsWith("."));
	check(
		!imported.some((specifier) => specifier.startsWith("@rowcat/")),
		"@rowcat/* folded into the bundle",
		imported.filter((s) => s.startsWith("@rowcat/")).join(", ") || undefined,
	);
	check(
		!imported.some((specifier) => specifier.endsWith(".ts")),
		"imports no TS source",
	);

	// Every remaining bare import must be a declared dependency; a missing one installs fine and fails
	// only at run time, first on a user's machine.
	const manifest = JSON.parse(
		readFileSync(join(PACKAGE, "package.json"), "utf8"),
	) as { dependencies?: Record<string, string> };
	const declared = new Set(Object.keys(manifest.dependencies ?? {}));
	const bare = new Set<string>();
	for (const specifier of imported) {
		if (specifier.startsWith("node:")) continue;
		const parts = specifier.split("/");
		bare.add(
			specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : (parts[0] ?? ""),
		);
	}
	const undeclared = [...bare].filter((name) => !declared.has(name));
	check(
		undeclared.length === 0,
		"every bare import in the bundle is declared",
		undeclared.length === 0 ? undefined : undeclared.join(", "),
	);
	say(`     external: ${[...bare].sort().join(", ")}`);

	for (const [leak, why] of LEAKS)
		check(!leak.test(bundle), `the output has no ${why}`);

	// The sourcemap ships but its sources do not. Mappings must stay (they decode users' stack traces)
	// and `sourcesContent` must be empty. Both are checked: checking only one would pass a sourcemap
	// deleted outright.
	const map = JSON.parse(
		readFileSync(join(PACKAGE, "dist", "index.mjs.map"), "utf8"),
	) as { sources?: string[]; sourcesContent?: (string | null)[]; mappings?: string };
	const embedded = (map.sourcesContent ?? []).filter(
		(entry) => typeof entry === "string" && entry.length > 0,
	).length;
	check(
		embedded === 0,
		"source maps carry no originals",
		embedded === 0
			? `mappings only, for ${map.sources?.length ?? 0} files`
			: `originals of ${embedded} files are embedded`,
	);
	check(
		(map.mappings ?? "").length > 1000,
		"source map mappings remain",
		"stack traces resolve to files and lines",
	);

	say("");
	say("② Pack");
	// `prepack` runs here, so build logs are mixed into stdout and the JSON must be located. Finding
	// it with `indexOf("[")` only works locally: some tools (tsdown) colour output in CI without a
	// TTY, and ANSI escapes like `\x1b[34m` contain brackets. So take the last bracket at the start of
	// a line (build logs come first). The helpers above disable colour, but that is defence at the
	// cause; this parsing must hold with colour on. The shape also differs by npm version: 10 emits
	// one array, 11 an object keyed by package name. The publish workflow installs `npm@latest`, so
	// local and CI meet different npms. A single entry is the same in both shapes, so they are merged
	// there.
	const packOutput = run("npm", ["pack", "--json"], PACKAGE);
	const jsonStart = [...packOutput.matchAll(/^[[{]/gm)].map((m) => m.index).at(-1);
	if (jsonStart === undefined)
		throw new Error(`npm pack produced no JSON:\n${packOutput}`);
	type PackMeta = {
		filename: string;
		size: number;
		unpackedSize: number;
		files: { path: string }[];
	};
	const packed = JSON.parse(packOutput.slice(jsonStart)) as
		| PackMeta[]
		| Record<string, PackMeta>;
	const meta = (Array.isArray(packed) ? packed : Object.values(packed))[0];
	if (meta === undefined) throw new Error("npm pack produced nothing");
	const tarball = join(PACKAGE, meta.filename);
	say(
		`     ${meta.filename}  packed ${(meta.size / 1024).toFixed(0)}KB · unpacked ${(meta.unpackedSize / 1024 / 1024).toFixed(1)}MB · ${meta.files.length} files`,
	);
	const offending = meta.files
		.map((file) => `package/${file.path}`)
		.filter((path) => FORBIDDEN.some((rule) => rule.test(path)));
	check(
		offending.length === 0,
		"the tarball has no sources, tests or config",
		offending.length === 0 ? undefined : offending.slice(0, 5).join(", "),
	);
	check(
		meta.files.some((file) => file.path === "dist/index.mjs"),
		"the tarball has the executable",
	);

	// The license is the SPDX identifier (`version.test.ts` pins it; the npm page and license scanners
	// read it), and the full text must actually be in the tarball: AGPL-3.0 asks that the terms travel
	// with the software. npm usually adds LICENSE, but this check does not rely on that: it asks whether
	// the file is in this tarball now.
	const manifestLicense = JSON.parse(
		readFileSync(join(PACKAGE, "package.json"), "utf8"),
	) as {
		name: string;
		version: string;
		license?: string;
		repository?: unknown;
		bugs?: unknown;
		homepage?: unknown;
	};
	check(
		manifestLicense.license === "AGPL-3.0-only",
		"license is the SPDX identifier",
		manifestLicense.license ?? "(none)",
	);
	for (const required of ["LICENSE", "README.md"])
		check(
			meta.files.some((file) => file.path === required),
			`the tarball has ${required}`,
		);

	// Public metadata leads to the public repository: those npm page fields are links installers
	// click, and npm's provenance check compares `repository.url` with the publishing repository.
	// `identityProblems` in `release-policy.mjs` checks the same just before publish.
	const repository = manifestLicense.repository as { url?: string } | undefined;
	check(
		repository?.url === "git+https://github.com/project-rowcat/rowcat.git",
		"repository names the public repository",
		repository?.url ?? "(none)",
	);

	say("");
	say("③ Clean install (OS temp directory)");
	const sandbox = mkdtempSync(join(tmpdir(), "rowcat-mcp-verify-"));
	check(
		!sandbox.startsWith(dirname(dirname(PACKAGE)) + sep),
		"the temp directory is outside the workspace",
		sandbox,
	);
	try {
		writeFileSync(
			join(sandbox, "package.json"),
			`${JSON.stringify({ name: "rowcat-mcp-consumer", private: true, version: "0.0.0" }, null, 2)}\n`,
		);
		run("npm", ["install", "--no-audit", "--no-fund", tarball], sandbox);
		const cli = join(sandbox, "node_modules", ".bin", "rowcat-mcp");
		/**
		 * The installed CLI gets a home of its own. It keeps its device config in `~/.rowcat/mcp.json`,
		 * and on a developer's machine that file is real: a session cookie and an API address. Read
		 * through, the "no account" check below answers about that person's device rather than a fresh
		 * install, and the verification touches a live session for no reason.
		 */
		const cliHome = join(sandbox, "home");
		mkdirSync(cliHome);
		const fresh = { HOME: cliHome, USERPROFILE: cliHome };

		const help = attempt(cli, ["--help"], sandbox, fresh);
		check(help.code === 0, "rowcat-mcp --help", `exit ${help.code}`);
		check(help.out.includes("rowcat-mcp setup"), "--help mentions setup first");

		const version = attempt(cli, ["--version"], sandbox, fresh);
		check(
			version.out.trim() ===
				(JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as {
					version: string;
				}).version,
			"--version equals the package version",
			version.out.trim(),
		);

		// The check this file exists for: do the compiler (`lib.*.d.ts`) and QuickJS (WASM) stand in the
		// installed copy? With no configuration, `doctor` exits 1 at the API line; we read the runtime
		// line before it.
		const doctor = attempt(cli, ["doctor"], sandbox, fresh);
		check(
			doctor.out.includes("Runtime     ✓"),
			"compile and the QuickJS preview stand in the installed copy",
			doctor.out
				.split("\n")
				.find((line) => line.startsWith("Runtime"))
				?.trim(),
		);
		/**
		 * A fresh machine has no API address (there is no default origin), so `doctor` stops at the API
		 * line and names `setup` as the next step, before it ever reaches sign-in.
		 */
		check(
			/^API\s+✗.*rowcat-mcp setup/m.test(doctor.out),
			"on a machine without an account it says what to do next",
			doctor.out
				.split("\n")
				.find((line) => line.startsWith("API"))
				?.trim(),
		);
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
		rmSync(tarball, { force: true });
	}

	say("");
	say("④ The shape to be published");
	say(`     ${manifestLicense.name}@${manifestLicense.version}`);
	say(`     license   ${manifestLicense.license ?? "(none)"}`);
	say(`     homepage  ${String(manifestLicense.homepage ?? "(none)")}`);
	say(`     bugs      ${JSON.stringify(manifestLicense.bugs ?? null)}`);
	say(
		`     packed    ${(meta.size / 1024).toFixed(0)}KB · ${meta.files.length} files`,
	);

	say("");
	if (failures.length > 0) {
		say(`✗ ${failures.length} failed`);
		for (const failure of failures) say(`   ${failure}`);
		process.exit(1);
	}
	say("✓ The package runs outside the repository.");
}

await main();
