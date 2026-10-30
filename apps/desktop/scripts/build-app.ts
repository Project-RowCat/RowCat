/**
 * Assembles and packages the desktop app.
 *
 *   pnpm --filter @rowcat/desktop stage     .stage/ only — what `pnpm --filter @rowcat/desktop dev` runs
 *   pnpm --filter @rowcat/desktop package   .stage/ then the installer in out/ (this OS only)
 *
 * The three servers go in as the same build outputs the container images carry — `apps/api/dist`
 * with its production dependencies, `apps/web/.output`, `apps/admin/dist` — so the installer runs
 * the code CI tested, not a desktop variant of it. Build them first:
 *
 *   pnpm turbo run build --filter=@rowcat/api --filter=web --filter=admin
 *
 * Dependencies are copied with `pnpm deploy` and a hoisted layout: an installer cannot carry pnpm's
 * symlinked store, and a flat `node_modules` is what Electron and Node resolve from without help.
 * Only this OS's optional binaries come along (sharp, the Postgres build), which is why an installer
 * is built on the OS it is for.
 *
 * Unsigned: macOS shows "unidentified developer" and Windows SmartScreen warns until the build is
 * signed and notarized — that needs the operator's own certificates (`apps/desktop/README.md`).
 */
import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_BUNDLE_ID, APP_NAME } from "@rowcat/domain";
import { build, type Configuration } from "electron-builder";

const desktop = resolve(fileURLToPath(import.meta.url), "../..");
const repo = resolve(desktop, "../..");
const mode = process.argv[2];
if (mode !== "stage" && mode !== "package") {
	console.error("usage: build-app.ts <stage|package>");
	process.exit(2);
}

/**
 * Packaging assembles in its own folder: `.stage/` is what a running `pnpm dev` app executes from,
 * and wiping it under that app breaks whatever the API loads lazily (the compile worker) mid-session.
 */
const stage = join(desktop, mode === "stage" ? ".stage" : "out/.stage");
const resources = join(stage, "resources");

const required = {
	"apps/api/dist/index.mjs": "pnpm --filter @rowcat/api build",
	"apps/web/.output/server/index.mjs": "pnpm --filter web build",
	"apps/admin/dist/index.html": "pnpm --filter admin build",
};
for (const [file, command] of Object.entries(required))
	if (!existsSync(join(repo, file))) {
		console.error(`missing ${file} — run: ${command}`);
		process.exit(1);
	}

const run = (command: string, args: string[], cwd = repo) =>
	execFileSync(command, args, { cwd, stdio: "inherit" });

rmSync(stage, { recursive: true, force: true });

/**
 * The API: production dependencies, the bundle, and the migrations the bundle applies at boot — and
 * nothing else. **An allowlist, not a cleanup**: `pnpm deploy` copies the package folder as it is on
 * disk, gitignored files included, and that folder holds the developer's `apps/api/.env` — one
 * installer built from it shipped those secrets. Deleting known leftovers would miss the next one.
 */
const api = join(resources, "api");
const apiDeploy = join(stage, "api-deploy");
run("pnpm", ["--filter", "@rowcat/api", "deploy", "--prod", "--legacy", "--config.node-linker=hoisted", apiDeploy]);
cpSync(join(apiDeploy, "node_modules"), join(api, "node_modules"), {
	recursive: true,
	verbatimSymlinks: true,
});
cpSync(join(apiDeploy, "package.json"), join(api, "package.json"));
rmSync(apiDeploy, { recursive: true, force: true });
cpSync(join(repo, "apps/api/dist"), join(api, "dist"), { recursive: true });
cpSync(join(repo, "apps/api/drizzle"), join(api, "drizzle"), { recursive: true });

// The web app's server build is self-contained (nitro bundles its dependencies).
cpSync(join(repo, "apps/web/.output"), join(resources, "web"), { recursive: true });
cpSync(join(repo, "apps/admin/dist"), join(resources, "console"), { recursive: true });

// The main process and the one runtime dependency it leaves external.
run("pnpm", ["exec", "tsdown"], desktop);
// The same allowlist as the API: this folder can hold a developer's `.desktop-data` database.
const app = join(stage, "app");
const appDeploy = join(stage, "app-deploy");
run("pnpm", ["--filter", "@rowcat/desktop", "deploy", "--prod", "--legacy", "--config.node-linker=hoisted", appDeploy]);
cpSync(join(appDeploy, "node_modules"), join(app, "node_modules"), {
	recursive: true,
	verbatimSymlinks: true,
});
cpSync(join(appDeploy, "package.json"), join(app, "package.json"));
rmSync(appDeploy, { recursive: true, force: true });
cpSync(join(desktop, "dist"), join(app, "dist"), { recursive: true });
relinkPostgresLibraries(join(app, "node_modules", "@embedded-postgres"));

/**
 * `pnpm deploy` copies symlinks as files, and the Postgres build names each library three ways
 * (`libicudata.77.1.dylib` · `.77.dylib` · `.dylib`) — 64 MB of ICU data alone went in three times.
 * The package lists those links itself (`native/pg-symlinks.json`, what its postinstall reads), so
 * they are put back as links; the installer formats keep symlinks.
 */
function relinkPostgresLibraries(scope: string): void {
	if (!existsSync(scope)) return;
	for (const name of readdirSync(scope)) {
		const root = join(scope, name);
		const listFile = join(root, "native", "pg-symlinks.json");
		if (!existsSync(listFile)) continue;
		const links = JSON.parse(readFileSync(listFile, "utf8")) as {
			source: string;
			target: string;
		}[];
		for (const { source, target } of links) {
			const linkPath = join(root, target);
			rmSync(linkPath, { force: true });
			symlinkSync(relative(dirname(linkPath), join(root, source)), linkPath);
		}
	}
}

if (mode === "stage") {
	console.log(`staged ${stage}`);
	process.exit(0);
}

const config: Configuration = {
	appId: `${APP_BUNDLE_ID}.desktop`,
	productName: APP_NAME,
	directories: { app, output: join(desktop, "out") },
	/**
	 * No asar: the Postgres binaries are executables the OS has to start from a real path, and
	 * `asarUnpack` moves them while the package still computes its path inside the archive.
	 */
	asar: false,
	/**
	 * The three servers are copied in after packing rather than declared as `extraResources`:
	 * electron-builder drops `node_modules` from extra resources whatever `filter` says, and an API
	 * without its dependencies dies at its first import — the installer still builds green.
	 */
	afterPack: async (context) => {
		const target =
			context.electronPlatformName === "darwin"
				? join(context.appOutDir, `${APP_NAME}.app`, "Contents", "Resources")
				: join(context.appOutDir, "resources");
		for (const name of ["api", "web", "console"])
			cpSync(join(resources, name), join(target, name), {
				recursive: true,
				verbatimSymlinks: true,
			});
	},
	mac: { target: ["dmg"], category: "public.app-category.entertainment", identity: null },
	win: { target: ["nsis"] },
	nsis: { oneClick: true, perMachine: false },
	linux: { target: ["AppImage"] },
	publish: null,
};
await build({ config });
