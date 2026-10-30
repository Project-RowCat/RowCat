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
 *   3. a gitignored compose override that publishes Postgres on 127.0.0.1 only — on 5432, or the
 *      next free port when a Postgres already runs on this machine (then DATABASE_URL follows it,
 *      but only while it is still the example's value)
 *   4. Postgres up and healthy, the schema migrated, the development account seeded
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

const SECRET_LINE = /^BETTER_AUTH_SECRET=(.*)$/m;
const DATABASE_URL_LINE = /^DATABASE_URL=(.*)$/m;
const EXAMPLE_DATABASE_URL = "postgres://rowcat:rowcat@localhost:5432/rowcat";

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

function readSecret(path: string): string {
	return readFileSync(path, "utf8").match(SECRET_LINE)?.[1]?.trim() ?? "";
}

function writeSecret(path: string, secret: string) {
	const text = readFileSync(path, "utf8");
	writeFileSync(
		path,
		SECRET_LINE.test(text)
			? text.replace(SECRET_LINE, `BETTER_AUTH_SECRET=${secret}`)
			: `${text.trimEnd()}\nBETTER_AUTH_SECRET=${secret}\n`,
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
	const inRoot = readSecret(ROOT_ENV);
	const inApi = readSecret(API_ENV);
	if (inRoot && inApi && inRoot !== inApi) {
		note("⚠ .env and apps/api/.env hold different secrets — left as they are.");
		note(
			"  Sessions signed by the API on the host will not verify in the compose API, and the reverse.",
		);
	} else if (inRoot && inApi) {
		note("already set in both files");
	} else {
		const secret = inRoot || inApi || randomBytes(32).toString("base64");
		if (!inRoot) writeSecret(ROOT_ENV, secret);
		if (!inApi) writeSecret(API_ENV, secret);
		note(
			inRoot || inApi
				? "copied the existing secret into the file that had none"
				: "generated one and wrote it into both files",
		);
	}
}

if (useDocker) {
	step("Postgres (docker compose)");
	if (existsSync(OVERRIDE)) {
		note(
			"docker-compose.override.yml exists — kept as it is (it must publish db on the port DATABASE_URL uses)",
		);
	} else {
		const port = await firstFreePort(5432);
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
		if (port !== 5432) {
			note("5432 is taken (a Postgres already runs on this machine?)");
			const text = readFileSync(API_ENV, "utf8");
			if (text.match(DATABASE_URL_LINE)?.[1]?.trim() === EXAMPLE_DATABASE_URL) {
				writeFileSync(
					API_ENV,
					text.replace(
						DATABASE_URL_LINE,
						`DATABASE_URL=${EXAMPLE_DATABASE_URL.replace(":5432/", `:${port}/`)}`,
					),
				);
				note(`apps/api/.env DATABASE_URL now points at port ${port}`);
			} else {
				note(
					`apps/api/.env DATABASE_URL was edited — left as it is; point it at port ${port} to use this database`,
				);
			}
		}
	}
	run(
		"docker",
		["compose", "up", "-d", "--wait", "db"],
		[
			"Is Docker running?",
			"If the port in docker-compose.override.yml is taken, change it there and in",
			"DATABASE_URL in apps/api/.env.",
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
	["Check that Postgres is reachable at apps/api/.env's DATABASE_URL."],
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
