/**
 * Launches the real desktop app (`dist/main.mjs` + `.stage/resources`, what `pnpm dev` opens) under
 * Playwright's Electron driver, with its app folder moved to a throwaway directory.
 *
 * Why a wrapper entry and not `electron .`: `main.ts` puts its data under
 * `<appData>/RowCat Dev` — the developer's own development install. The wrapper (`harness/main.mjs`)
 * moves `appData` before importing the unchanged main bundle, so a run never opens, migrates or
 * fills that folder, and every run starts from a first launch. Nothing in `src/` knows about it.
 *
 * The wrapper's folder is the app path, so `artifacts()` reads `<run>/.stage/resources`. That folder
 * links the staged API, web and console builds and holds this run's `afterstate/` — the real bridge,
 * none, or an impostor — which is how the fallback scenarios swap the engine without touching
 * `.stage/`.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, type ElectronApplication, type Page } from "@playwright/test";

export const DESKTOP = resolve(fileURLToPath(import.meta.url), "../..");
export const STAGE = join(DESKTOP, ".stage", "resources");
export const ELECTRON = createRequire(import.meta.url)("electron") as string;

export type BridgeKind =
	| { kind: "real"; path: string }
	| { kind: "wasm"; path: string }
	| { kind: "missing" }
	| { kind: "script"; source: string; executable?: boolean };

export interface Run {
	root: string;
	appData: string;
	userData: string;
	storeDir: string;
	bridgePath: string;
}

/** A run folder: wrapper entry, linked server builds, and the bridge this scenario wants. */
export function prepareRun(root: string, bridge: BridgeKind): Run {
	const app = join(root, "app");
	const resources = join(app, ".stage", "resources");
	mkdirSync(resources, { recursive: true });
	cpSync(join(DESKTOP, "e2e", "harness"), app, { recursive: true });
	for (const name of ["api", "web", "console"]) {
		const link = join(resources, name);
		if (!existsSync(link)) symlinkSync(join(STAGE, name), link, process.platform === "win32" ? "junction" : "dir");
	}
	setBridge({ root }, bridge);
	const appData = join(root, "appData");
	mkdirSync(appData, { recursive: true });
	const userData = join(appData, "RowCat Dev");
	return {
		root,
		appData,
		userData,
		storeDir: join(userData, "afterstate-wasm"),
		bridgePath: join(resources, "afterstate", "afterstate-bridge"),
	};
}

/** Replaces this run's engine executable (between launches). */
export function setBridge(run: Pick<Run, "root">, bridge: BridgeKind): void {
	const dir = join(run.root, "app", ".stage", "resources", "afterstate");
	const target = join(dir, "afterstate-bridge");
	rmSync(dir, { recursive: true, force: true });
	if (bridge.kind === "missing") return;
	if (bridge.kind === "wasm") { cpSync(bridge.path, dir, { recursive: true }); return; }
	mkdirSync(dir, { recursive: true });
	if (bridge.kind === "real") copyFileSync(bridge.path, target);
	else writeFileSync(target, bridge.source);
	chmodSync(target, bridge.kind === "script" && bridge.executable === false ? 0o644 : 0o755);
}

export async function launch(run: Run): Promise<{ app: ElectronApplication; page: Page }> {
	const app = await _electron.launch({
		executablePath: ELECTRON,
		args: [join(run.root, "app")],
		env: {
			...process.env,
			ROWCAT_E2E_APPDATA: run.appData,
			ROWCAT_E2E_MAIN: join(DESKTOP, "dist", "main.mjs"),
		} as Record<string, string>,
		timeout: 120_000,
	});
	const settings = () =>
		JSON.parse(readFileSync(join(run.userData, "deployment", "settings.json"), "utf8")) as {
			ports: { web: number; api: number };
		};
	// The first window is the launch page; the web app replaces it in the same window.
	const page = await app.firstWindow();
	const deadline = Date.now() + 180_000;
	while (Date.now() < deadline) {
		if (existsSync(join(run.userData, "deployment", "settings.json"))) {
			const web = `http://localhost:${settings().ports.web}`;
			if (page.url().startsWith(web)) break;
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	return { app, page };
}

export function origins(run: Run): { web: string; api: string } {
	const s = JSON.parse(
		readFileSync(join(run.userData, "deployment", "settings.json"), "utf8"),
	) as { ports: { web: number; api: number } };
	return { web: `http://localhost:${s.ports.web}`, api: `http://localhost:${s.ports.api}` };
}

/** Child processes of `pid` (one level), with their command lines. */
export function childrenOf(pid: number): { pid: number; command: string }[] {
	let out = "";
	try {
		out = execFileSync("ps", ["-A", "-o", "pid=,ppid=,command="], { encoding: "utf8" });
	} catch {
		return [];
	}
	return out
		.split("\n")
		.map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
		.filter((m): m is RegExpMatchArray => m !== null && Number(m[2]) === pid)
		.map((m) => ({ pid: Number(m[1]), command: m[3] ?? "" }));
}

/** Every process whose executable is this run's bridge path (orphans included). */
export function bridgeProcesses(run: Run): { pid: number; ppid: number }[] {
	const out = execFileSync("ps", ["-A", "-o", "pid=,ppid=,command="], { encoding: "utf8" });
	return out
		.split("\n")
		.map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
		.filter((m): m is RegExpMatchArray => m !== null && (m[3] ?? "").startsWith(run.bridgePath))
		.map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]) }));
}

/** `lsof -iTCP -sTCP:LISTEN`, as `command pid address` lines. */
export function listeners(): string[] {
	try {
		const out = execFileSync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], { encoding: "utf8" });
		return [
			...new Set(
				out
					.split("\n")
					.slice(1)
					.filter(Boolean)
					.map((l) => {
						const f = l.split(/\s+/);
						return `${f[0]} ${f[1]} ${f[8]}`;
					}),
			),
		].sort();
	} catch {
		return [];
	}
}

/** Every socket (any protocol) a process holds, from `lsof -a -p <pid> -i`. Empty = none. */
export function socketsOf(pid: number): string {
	try {
		return execFileSync("lsof", ["-nP", "-a", "-p", String(pid), "-i"], { encoding: "utf8" }).trim();
	} catch {
		// lsof exits 1 when it lists nothing.
		return "";
	}
}
