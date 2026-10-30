import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";

/**
 * `pnpm dev:setup` — takes a fresh clone to a running local stack's prerequisites in one command:
 *
 *   1. the two env files (`.env` for compose, `apps/api/.env` for the API on the host)
 *   2. one BETTER_AUTH_SECRET, generated once and written into **both** — they must agree, and
 *      pasting it twice by hand is the step people got wrong
 *   3. a generated POSTGRES_PASSWORD in `.env` — compose requires it and publishes no default, so
 *      a local stack never runs on a password the public repository knows
 *   4. a gitignored compose override that publishes Postgres on 127.0.0.1 only — on 5432, or the
 *      next free port when a Postgres already runs on this machine. apps/api/.env's DATABASE_URL
 *      follows the password and the port, but only while it is still the example's value
 *   5. Postgres up and healthy, the schema migrated, the development account seeded
 *
 * It is safe to run again. Nothing that exists is overwritten: an env file you edited stays, a
 * secret already set stays, an override you wrote stays. Two different secrets are reported, not
 * reconciled — which one is right is not this script's to guess.
 *
 *   --no-docker   use your own Postgres (whatever apps/api/.env's DATABASE_URL points at)
 *   --no-seed     skip the development account
 *
 * It is a development tool. It writes no production value and refuses nothing a deployment needs;
 * a deployment follows docs/ops/CONFIGURATION.md.
 */

const root = resolve(import.meta.dirname, "..");
const args = new Set(process.argv.slice(2));
const useDocker = !args.has("--no-docker");
const seed = !args.has("--no-seed");

const ROOT_ENV = resolve(root, ".env");
const API_ENV = resolve(root, "apps/api/.env");
const OVERRIDE = resolve(root, "docker-compose.override.yml");

const EXAMPLE_DATABASE_URL = "postgres://rowcat:rowcat@localhost:5432/rowcat";
const OVERRIDE_PORT = /"127\.0\.0\.1:(\d+):5432"/;

function step(text: string) {
	console.log(`\n▸ ${text}`);
}

function note(text: string) {
	console.log(`  ${text}`);
}

function fail(lines: string[]): never {
	console.error(`\n✗ ${lines.join("\n  ")}`);
	process.exit(1);
}

function run(command: string, commandArgs: string[], hint: string[]) {
	const result = spawnSync(command, commandArgs, {
		cwd: root,
		stdio: "inherit",
	});
	if (result.error || result.status !== 0)
		fail([`${command} ${commandArgs.join(" ")} failed.`, ...hint]);
}

function ensureEnvFile(target: string, example: string) {
	if (existsSync(target)) {
		note(`${relative(target)} exists — kept as it is`);
		return;
	}
	copyFileSync(example, target);
	note(`${relative(target)} created from ${relative(example)}`);
}

function relative(path: string) {
	return path.slice(root.length + 1);
}

const lineOf = (key: string) => new RegExp(`^${key}=(.*)$`, "m");

function readValue(path: string, key: string): string {
	return readFileSync(path, "utf8").match(lineOf(key))?.[1]?.trim() ?? "";
}

function writeValue(path: string, key: string, value: string) {
	const text = readFileSync(path, "utf8");
	const line = lineOf(key);
	writeFileSync(
		path,
		line.test(text)
			? text.replace(line, () => `${key}=${value}`)
			: `${text.trimEnd()}\n${key}=${value}\n`,
	);
}

/**
 * Points apps/api/.env at the compose database, but only while DATABASE_URL is still the example's
 * value — an edited one is someone's own database, and rewriting it would be a guess.
 */
function followComposeDatabase(port: number) {
	const current = readValue(API_ENV, "DATABASE_URL");
	const user = readValue(ROOT_ENV, "POSTGRES_USER") || "rowcat";
	const database = readValue(ROOT_ENV, "POSTGRES_DB") || "rowcat";
	const password = encodeURIComponent(readValue(ROOT_ENV, "POSTGRES_PASSWORD"));
	const target = `postgres://${encodeURIComponent(user)}:${password}@localhost:${port}/${encodeURIComponent(database)}`;
	if (current === target) return;
	if (current !== EXAMPLE_DATABASE_URL) {
		note(
			`apps/api/.env DATABASE_URL was edited — left as it is; the compose database is on port ${port} with .env's POSTGRES_* values`,
		);
		return;
	}
	writeValue(API_ENV, "DATABASE_URL", target);
	note(
		`apps/api/.env DATABASE_URL now points at the compose database (port ${port}, .env's password)`,
	);
}

/** Free means this process could bind it on loopback, which is what the override publishes. */
function portFree(port: number): Promise<boolean> {
	return new Promise((done) => {
		const server = createServer();
		server.once("error", () => done(false));
		server.listen(port, "127.0.0.1", () => server.close(() => done(true)));
	});
}

async function firstFreePort(from: number): Promise<number> {
	for (let port = from; port < from + 20; port++)
		if (await portFree(port)) return port;
	fail([`No free port between ${from} and ${from + 19} for Postgres.`]);
}

step("Env files");
ensureEnvFile(ROOT_ENV, resolve(root, ".env.example"));
ensureEnvFile(API_ENV, resolve(root, "apps/api/.env.example"));

step("BETTER_AUTH_SECRET");
{
	const inRoot = readValue(ROOT_ENV, "BETTER_AUTH_SECRET");
	const inApi = readValue(API_ENV, "BETTER_AUTH_SECRET");
	if (inRoot && inApi && inRoot !== inApi) {
		note("⚠ .env and apps/api/.env hold different secrets — left as they are.");
		note(
			"  Sessions signed by the API on the host will not verify in the compose API, and the reverse.",
		);
	} else if (inRoot && inApi) {
		note("already set in both files");
	} else {
		const secret = inRoot || inApi || randomBytes(32).toString("base64");
		if (!inRoot) writeValue(ROOT_ENV, "BETTER_AUTH_SECRET", secret);
		if (!inApi) writeValue(API_ENV, "BETTER_AUTH_SECRET", secret);
		note(
			inRoot || inApi
				? "copied the existing secret into the file that had none"
				: "generated one and wrote it into both files",
		);
	}
}

step("POSTGRES_PASSWORD");
if (readValue(ROOT_ENV, "POSTGRES_PASSWORD")) {
	note("already set in .env — kept as it is");
} else {
	// Hex: it goes into DATABASE_URL unescaped in compose, where base64's `/` and `+` would break it.
	writeValue(ROOT_ENV, "POSTGRES_PASSWORD", randomBytes(24).toString("hex"));
	note("generated one and wrote it into .env");
}

if (useDocker) {
	step("Postgres (docker compose)");
	let port = 5432;
	if (existsSync(OVERRIDE)) {
		port = Number(
			readFileSync(OVERRIDE, "utf8").match(OVERRIDE_PORT)?.[1] ?? 5432,
		);
		note(
			"docker-compose.override.yml exists — kept as it is (it must publish db on the port DATABASE_URL uses)",
		);
	} else {
		port = await firstFreePort(5432);
		writeFileSync(
			OVERRIDE,
			[
				"# Written by `pnpm dev:setup`. Local only (gitignored): publishes Postgres to this machine so",
				"# the API on the host can reach it, bound to loopback so it never reaches the network.",
				"services:",
				"  db:",
				"    ports:",
				`      - "127.0.0.1:${port}:5432"`,
				"",
			].join("\n"),
		);
		note(`docker-compose.override.yml written (db on 127.0.0.1:${port})`);
		if (port !== 5432)
			note("5432 is taken (a Postgres already runs on this machine?)");
	}
	followComposeDatabase(port);
	run(
		"docker",
		["compose", "up", "-d", "--wait", "db"],
		[
			"Is Docker running?",
			"If the port in docker-compose.override.yml is taken, change it there and in",
			"DATABASE_URL in apps/api/.env.",
			"A db volume created before keeps its old password: set POSTGRES_PASSWORD in .env to it,",
			"or drop the local volume (docker compose down -v — deletes local data).",
			"To use your own Postgres instead: pnpm dev:setup --no-docker",
		],
	);
} else {
	step("Postgres");
	note("--no-docker: using DATABASE_URL from apps/api/.env");
}

step("Schema");
run(
	"pnpm",
	["--filter", "@rowcat/api", "db:migrate"],
	[
		"Check that Postgres is reachable at apps/api/.env's DATABASE_URL.",
		"Password refused? A db volume created before keeps the password it was created with.",
	],
);

if (seed) {
	step("Development account");
	run("pnpm", ["--filter", "@rowcat/api", "db:seed:dev-user"], []);
}

console.log(`
✓ Ready. Start web, API and the operations console:

    pnpm dev:all

  web      http://localhost:3000${seed ? "   (sign in: dev@rowcat.test / rowcat-dev)" : ""}
  API      http://localhost:3001
  console  http://localhost:3002/setup   (the setup code is in the API's output: [setup] …)

  AI generation needs a key: OPENROUTER_API_KEY in apps/api/.env, or each member's own key in AI settings.
  What else this configuration turns on: pnpm env:doctor --file apps/api/.env
`);
