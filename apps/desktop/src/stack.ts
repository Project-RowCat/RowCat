import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { startConsoleServer } from "./console-server.ts";
import {
	busyPorts,
	type DesktopSettings,
	loadOrCreateSettings,
} from "./settings.ts";

/**
 * Runs the whole deployment on this computer: one Postgres and the three servers the container
 * images run (`docker-compose.yml`), started in the order compose's health checks impose.
 *
 * **Each server is the published build, unchanged.** The API is `apps/api/dist`, the web app is
 * `apps/web/.output`, the console is `apps/admin/dist` — the same artifacts the images carry, given
 * the same environment variables. A desktop-only code path inside the API would be a second product
 * that is tested nowhere, and its differences would surface only for the people least able to
 * report them.
 *
 * **All three sit on `localhost`, on different ports, and that is what makes sign-in work.** The
 * session cookie is `SameSite=Lax` (`apps/api/src/auth/index.ts`); the browser treats every port of
 * `localhost` as one site, so web and console send the API's cookie — the same shape `pnpm dev` runs.
 * A hostname such as `127.0.0.1.nip.io` or a PaaS subdomain would split them into different sites.
 *
 * It runs as a production deployment (`NODE_ENV=production`): the dev identity verifier, the dev
 * mail transport and the development secrets are all refused there, and a computer someone actually
 * uses is a deployment, not a development checkout.
 *
 * What this does not hold: Redis (the API falls back to an in-process limiter — one process, so it
 * is exact), mail, push, AI keys and background jobs. Each stays off and the console's readiness
 * page names it.
 */
export interface StackArtifacts {
	/** Holds `dist/index.mjs`, `drizzle/` and the API's `node_modules`. */
	apiDir: string;
	/** The web build's `server/index.mjs`. */
	webServerEntry: string;
	/** The console's `dist/`. */
	consoleDistDir: string;
	/** Runs the two Node servers. In Electron this is Electron itself with `ELECTRON_RUN_AS_NODE`. */
	node: { command: string; env?: Record<string, string> };
}

export interface RunningStack {
	settings: DesktopSettings;
	origins: { web: string; api: string; console: string };
	/** The first-run setup code while the deployment has no administrator; `null` once one exists. */
	setupCode(): string | null;
	stop(): Promise<void>;
}

export type StackLog = (source: string, line: string) => void;

export class PortsBusyError extends Error {
	constructor(readonly ports: number[]) {
		super(`ports in use: ${ports.join(", ")}`);
	}
}

const DATABASE_USER = "rowcat";
const DATABASE_NAME = "rowcat";

/** How long a server may take to answer before launch gives up. Migrations run inside this window. */
const READY_TIMEOUT_MS = 90_000;

export async function startStack(options: {
	dataDir: string;
	artifacts: StackArtifacts;
	log: StackLog;
}): Promise<RunningStack> {
	const { dataDir, artifacts, log } = options;
	const settings = await loadOrCreateSettings(dataDir);
	await stopLeftoverDatabase(join(dataDir, "postgres"), log);
	const busy = await busyPorts(settings);
	if (busy.length > 0) throw new PortsBusyError(busy);

	const origins = {
		web: `http://localhost:${settings.ports.web}`,
		api: `http://localhost:${settings.ports.api}`,
		console: `http://localhost:${settings.ports.console}`,
	};

	const stoppers: (() => Promise<void>)[] = [];
	const stop = async () => {
		// Reverse order: servers before the database they write to.
		for (const stopOne of stoppers.reverse()) await stopOne().catch(() => {});
	};

	try {
		const database = await startDatabase(dataDir, settings, log);
		stoppers.push(() => database.stop());

		let setupCode: string | null = null;
		const api = spawnNode(
			"api",
			artifacts,
			join(artifacts.apiDir, "dist", "index.mjs"),
			artifacts.apiDir,
			{
				NODE_ENV: "production",
				HOST: "127.0.0.1",
				PORT: String(settings.ports.api),
				DATABASE_URL: `postgres://${DATABASE_USER}:${settings.databasePassword}@127.0.0.1:${settings.ports.database}/${DATABASE_NAME}`,
				BETTER_AUTH_SECRET: settings.authSecret,
				API_ORIGIN: origins.api,
				WEB_ORIGIN: `${origins.web},${origins.console}`,
			},
			(line) => {
				log("api", line);
				const match =
					/\[setup\].*enter: ([0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4})/.exec(line);
				if (match) setupCode = match[1] ?? null;
			},
		);
		stoppers.push(() => stopChild(api));
		await waitForHttp(`${origins.api}/v2/health/ready`, api);

		const web = spawnNode(
			"web",
			artifacts,
			artifacts.webServerEntry,
			dataDir,
			{
				NODE_ENV: "production",
				HOST: "127.0.0.1",
				PORT: String(settings.ports.web),
				VITE_API_ORIGIN: origins.api,
				VITE_ADMIN_ORIGIN: origins.console,
			},
			(line) => log("web", line),
		);
		stoppers.push(() => stopChild(web));

		const consoleServer = await startConsoleServer({
			distDir: artifacts.consoleDistDir,
			apiOrigin: origins.api,
			port: settings.ports.console,
		});
		stoppers.push(() => closeServer(consoleServer));

		await waitForHttp(origins.web, web);

		return {
			settings,
			origins,
			setupCode: () => setupCode,
			stop,
		};
	} catch (error) {
		await stop();
		throw error;
	}
}

async function startDatabase(
	dataDir: string,
	settings: DesktopSettings,
	log: StackLog,
): Promise<EmbeddedPostgres> {
	const databaseDir = join(dataDir, "postgres");
	const fresh = !existsSync(join(databaseDir, "PG_VERSION"));
	const database = new EmbeddedPostgres({
		databaseDir,
		port: settings.ports.database,
		user: DATABASE_USER,
		password: settings.databasePassword,
		authMethod: "scram-sha-256",
		persistent: true,
		/**
		 * UTF-8 stated outright. initdb otherwise takes the encoding from the process locale, and a
		 * Finder launch has none — the cluster comes up `SQL_ASCII`, which stores bytes without
		 * checking them, so Korean text is accepted but compared and sorted as raw bytes. `--no-locale`
		 * keeps collation byte-order on every OS rather than whatever locales this computer happens
		 * to have installed (the order an index was built with must not change under it).
		 */
		initdbFlags: ["--encoding=UTF8", "--no-locale"],
		// Loopback only: nothing on the network should reach this computer's database.
		postgresFlags: ["-c", "listen_addresses=127.0.0.1"],
		onLog: (message) => log("postgres", String(message).trimEnd()),
		onError: (message) => log("postgres", String(message).trimEnd()),
	});
	if (fresh) await database.initialise();
	await database.start();
	if (fresh) await database.createDatabase(DATABASE_NAME);
	return database;
}

/**
 * Stops a Postgres an earlier run left behind. The app is killed for real sometimes — a force quit,
 * a crash, a shutdown that would not wait — and then nothing ran `stop()`: the server keeps the data
 * folder and its port, and every later launch would end at "port in use" with no way out for someone
 * who does not know what a process is. `pg_ctl` reads the folder's own `postmaster.pid`, so it only
 * ever signals the server that owns this data; a stale file with no server behind it is a no-op.
 */
async function stopLeftoverDatabase(
	databaseDir: string,
	log: StackLog,
): Promise<void> {
	if (!existsSync(join(databaseDir, "postmaster.pid"))) return;
	// Resolved outside the try: a missing binary is a packaging fault, not "nothing was running".
	const pgCtl = await pgCtlPath();
	try {
		execFileSync(
			pgCtl,
			["stop", "-D", databaseDir, "-m", "fast", "-w", "-t", "30"],
			{ stdio: "ignore" },
		);
		log("desktop", "stopped a database an earlier run left running");
	} catch {
		// Not running: the pid file is stale and Postgres clears it itself on start.
	}
}

/**
 * The bundled `pg_ctl`, from the same platform package `embedded-postgres` loads its binaries from
 * (its `exports` names only the entry, which exports the paths). Resolved from the library's own
 * location: under pnpm the platform package is the library's dependency, not this package's.
 */
async function pgCtlPath(): Promise<string> {
	const platform = process.platform === "win32" ? "windows" : process.platform;
	const entry = createRequire(import.meta.resolve("embedded-postgres")).resolve(
		`@embedded-postgres/${platform}-${process.arch}`,
	);
	const binaries = (await import(pathToFileURL(entry).href)) as {
		pg_ctl: string;
	};
	return binaries.pg_ctl;
}

/**
 * Loaded into each server before its entry: when the app process goes away without stopping it
 * (killed, crashed), the IPC channel to it closes, and the server stops itself the graceful way.
 * Without it the API and web server outlive the app, holding its ports, and the next launch cannot
 * start. `unref` keeps the channel from holding an otherwise finished process open. A `data:` URL so
 * the same line works for the packaged app and for `scripts/run-stack.ts`, with no file to ship.
 */
const EXIT_WITH_PARENT = `data:text/javascript,${encodeURIComponent(
	"process.channel?.unref();process.once('disconnect',()=>process.kill(process.pid,'SIGTERM'));",
)}`;

function spawnNode(
	name: string,
	artifacts: StackArtifacts,
	entry: string,
	cwd: string,
	env: Record<string, string>,
	onLine: (line: string) => void,
): ChildProcess {
	const child = spawn(
		artifacts.node.command,
		["--import", EXIT_WITH_PARENT, entry],
		{
			cwd,
			/**
			 * Only what a Node process needs from the parent, then this deployment's values. Inheriting
			 * the whole environment would let a `DATABASE_URL` or `OPENROUTER_API_KEY` in the user's shell
			 * quietly configure this install — and a Finder launch has a different environment from a
			 * terminal one, so the same app would behave differently depending on how it was opened.
			 */
			env: {
				...pick(process.env, [
					"PATH",
					"HOME",
					"USERPROFILE",
					"TMPDIR",
					"TEMP",
					"TMP",
					"SystemRoot",
					"LANG",
				]),
				...artifacts.node.env,
				...env,
			},
			stdio: ["ignore", "pipe", "pipe", "ipc"],
		},
	);
	for (const stream of [child.stdout, child.stderr]) {
		let buffered = "";
		stream?.setEncoding("utf8");
		stream?.on("data", (chunk: string) => {
			buffered += chunk;
			const lines = buffered.split("\n");
			buffered = lines.pop() ?? "";
			for (const line of lines) onLine(line);
		});
	}
	child.on("exit", (code, signal) =>
		onLine(`[desktop] ${name} exited (${signal ?? code})`),
	);
	return child;
}

function pick(
	source: NodeJS.ProcessEnv,
	keys: string[],
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const key of keys) {
		const value = source[key];
		if (value) out[key] = value;
	}
	return out;
}

/** Polls until the URL answers 2xx. A child that exits first ends the wait with its failure. */
async function waitForHttp(url: string, child: ChildProcess): Promise<void> {
	const deadline = Date.now() + READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (child.exitCode !== null || child.signalCode !== null)
			throw new Error(`${url} — the server exited before it answered`);
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
			if (response.ok) return;
		} catch {
			// Not listening yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
	throw new Error(`${url} did not answer within ${READY_TIMEOUT_MS / 1000}s`);
}

/** SIGTERM first — the API closes its pool and in-flight requests on it — then SIGKILL. */
function stopChild(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null)
		return Promise.resolve();
	return new Promise((resolve) => {
		const kill = setTimeout(() => child.kill("SIGKILL"), 10_000);
		child.once("exit", () => {
			clearTimeout(kill);
			resolve();
		});
		child.kill("SIGTERM");
	});
}

function closeServer(server: Server): Promise<void> {
	return new Promise((resolve) => server.close(() => resolve()));
}
