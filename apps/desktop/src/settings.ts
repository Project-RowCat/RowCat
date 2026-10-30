import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

/**
 * What one installation decides once and keeps: its four ports and its two secrets.
 *
 * **The ports are fixed at first run, never re-picked.** The browser keys IndexedDB by origin, and the
 * web app's origin carries its port — so a launch that moved the web server to another free port
 * would open on an empty local database, and the member's conversations and drafts would sit under an
 * origin nothing opens again. When a stored port is taken, launch stops and says so instead.
 *
 * **The secrets are generated, never typed.** The session key and the database password are what a
 * production boot refuses when they are values this repository publishes (`deployment-secrets.ts` in
 * the API); a desktop install that shipped one fixed value would ship it to everyone.
 *
 * What this does not hold: anything optional (mail, AI keys, social sign-in). Those stay off and the
 * operations console names them; a settings file that grew those keys would become a second place to
 * configure the API, next to the one it already has.
 */
export interface DesktopSettings {
	version: 1;
	ports: { web: number; api: number; console: number; database: number };
	authSecret: string;
	databasePassword: string;
}

const SETTINGS_FILE = "settings.json";

/** Tried first so a fresh install usually lands on the same, recognisable numbers. */
const PREFERRED_PORTS = {
	web: 47300,
	api: 47301,
	console: 47302,
	database: 47303,
};

export async function loadOrCreateSettings(
	dataDir: string,
): Promise<DesktopSettings> {
	mkdirSync(dataDir, { recursive: true });
	const file = join(dataDir, SETTINGS_FILE);
	if (existsSync(file)) return parseSettings(readFileSync(file, "utf8"));

	const taken = new Set<number>();
	const pick = async (preferred: number) => {
		const port = await firstFreePort(preferred, taken);
		taken.add(port);
		return port;
	};
	const settings: DesktopSettings = {
		version: 1,
		ports: {
			web: await pick(PREFERRED_PORTS.web),
			api: await pick(PREFERRED_PORTS.api),
			console: await pick(PREFERRED_PORTS.console),
			database: await pick(PREFERRED_PORTS.database),
		},
		authSecret: randomBytes(32).toString("base64"),
		databasePassword: randomBytes(24).toString("hex"),
	};
	// 0o600: the file holds the session key and the database password.
	writeFileSync(file, `${JSON.stringify(settings, null, "\t")}\n`, {
		mode: 0o600,
	});
	return settings;
}

function parseSettings(text: string): DesktopSettings {
	const value = JSON.parse(text) as Partial<DesktopSettings>;
	const ports = value.ports;
	if (
		value.version !== 1 ||
		!ports ||
		![ports.web, ports.api, ports.console, ports.database].every(
			(port) => Number.isInteger(port) && port > 0 && port < 65536,
		) ||
		typeof value.authSecret !== "string" ||
		typeof value.databasePassword !== "string"
	)
		throw new Error(
			`${SETTINGS_FILE} is not readable — it was edited or is from another version`,
		);
	return value as DesktopSettings;
}

/** The ports a stored installation needs that something else holds right now. */
export async function busyPorts(settings: DesktopSettings): Promise<number[]> {
	const busy: number[] = [];
	for (const port of Object.values(settings.ports))
		if (!(await isFree(port))) busy.push(port);
	return busy;
}

async function firstFreePort(
	preferred: number,
	taken: Set<number>,
): Promise<number> {
	for (let port = preferred; port < preferred + 200; port++)
		if (!taken.has(port) && (await isFree(port))) return port;
	throw new Error(`no free port near ${preferred}`);
}

function isFree(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer();
		server.once("error", () => resolve(false));
		server.listen({ port, host: "127.0.0.1" }, () =>
			server.close(() => resolve(true)),
		);
	});
}
