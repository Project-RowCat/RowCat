import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { APP_NAME } from "@rowcat/domain";
import { activeEntries, parseDotenvExample } from "./dotenv-example.ts";
import { renderEnvCheck } from "./env-check.ts";
import { checkRepositoryEnvironment } from "./env-check-files.ts";
import {
	buildDoctorReport,
	type DoctorMode,
	doctorExitCode,
} from "./env-doctor.ts";
import { renderDoctorJson, renderDoctorText } from "./env-doctor-render.ts";

/**
 * The two config tools. Both only read and start nothing.
 *
 * ```bash
 * pnpm env:check                              do the repository's config surfaces agree
 * pnpm env:doctor                             what works with this environment
 * pnpm env:doctor --mode production           resolve as a production deployment
 * pnpm env:doctor --file .env --json          pre-deploy preflight
 * ```
 *
 * A process, not a route: `GET /v2/admin/config/doctor` would be an address that exports config
 * state guarded by one session — the same reason manual job runs are a CLI (`jobs/cli.ts`). The
 * console's readiness list (`services/admin/deployment-readiness.ts`) is the narrow exception: the
 * same report with `summary` and `detail` dropped whole, so only states and variable names leave.
 *
 * Imports no boot code (`env.ts`, `db/client.ts`, `app.ts`, `jobs/*`); passing through it would run
 * migrations, start schedulers or `process.exit(1)` exactly when diagnosis is needed. Guarded by
 * `config/boundaries.test.ts`.
 */

function usage(): void {
	console.log(`${APP_NAME} config tool

  check                                    do the repository's config surfaces agree
                                           (needs no secrets and no external services — for CI)

  doctor [options]                         what works with this environment
    --mode production|development          defaults to the one NODE_ENV picks
    --file <path>                          layers that file's values over the process environment
                                           (--env-file is accepted too — if pnpm's single executable
                                           takes that name as a Node option first, use --file)
                                           \`-\` reads the values from stdin, so a running container's
                                           environment never has to be written to disk
    --json                                 machine-readable output
    --strict                               counts warnings and degraded states as failures too
`);
}

interface DoctorOptions {
	mode?: DoctorMode;
	envFile?: string;
	json: boolean;
	strict: boolean;
}

function parseDoctorArgs(argv: string[]): DoctorOptions | { error: string } {
	const options: DoctorOptions = { json: false, strict: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		// Separator pnpm inserts when forwarding arguments to a workspace script.
		if (arg === "--") continue;
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		if (arg === "--strict") {
			options.strict = true;
			continue;
		}
		if (arg === "--mode") {
			const value = argv[index + 1];
			if (value !== "production" && value !== "development")
				return { error: "--mode must be production or development" };
			options.mode = value;
			index += 1;
			continue;
		}
		/**
		 * Two names for one option. `--env-file` is also a Node runtime flag, and the standalone pnpm
		 * binary (`@pnpm/exe`, a Node single-executable) takes it from its own argv before the script
		 * ever runs — `pnpm env:doctor --env-file x` then dies with "x: not found", `--` included. The
		 * documented spelling is `--file` for that reason; `--env-file` stays for direct `tsx` runs.
		 */
		if (arg === "--file" || arg === "--env-file") {
			const value = argv[index + 1];
			if (!value) return { error: `${arg} has no path` };
			options.envFile = value;
			index += 1;
			continue;
		}
		return { error: `unknown argument: ${arg}` };
	}
	return options;
}

const STDIN = "-";

/**
 * Reads one env file, only when named explicitly — never searching parent directories, so operators
 * always know what is being checked. File values beat the process environment because the question
 * is "what happens if I deploy with this file"; the source line says so. Unreadable lines report
 * only line number and reason, never the content (it is usually a secret).
 *
 * `-` is stdin. Checking a running deployment means reading its container's environment
 * (`docker compose exec -T api env | pnpm --silent env:doctor --file - …`), and the alternative was a
 * dump of every secret it holds left in a temporary file — readable by whoever shares the machine's
 * temp directory, and outliving the command whenever the cleanup step is forgotten.
 */
function loadEnvFile(path: string): {
	values: Record<string, string>;
	label: string;
	problems: string[];
} {
	const parsed = parseDotenvExample(
		readFileSync(path === STDIN ? 0 : path, "utf8"),
	);
	const values: Record<string, string> = {};
	for (const entry of activeEntries(parsed)) values[entry.key] = entry.value;
	return {
		values,
		label: `process environment + ${path === STDIN ? "stdin" : path} (${Object.keys(values).length} keys)`,
		problems: parsed.invalid.map(
			(invalid) =>
				`${path === STDIN ? "stdin" : path}:${invalid.line} — ${invalid.reason}`,
		),
	};
}

function runCheck(): number {
	const result = checkRepositoryEnvironment();
	console.log(renderEnvCheck(result));
	return result.ok ? 0 : 1;
}

function runDoctor(argv: string[]): number {
	const parsed = parseDoctorArgs(argv);
	if ("error" in parsed) {
		console.error(parsed.error);
		return 1;
	}

	let env: Record<string, unknown> = { ...process.env };
	let source = "process environment";
	const problems: string[] = [];

	if (parsed.envFile) {
		/**
		 * Relative to where the operator typed the command, not to this package. `pnpm env:doctor` runs
		 * the script inside `apps/api`, so `--file .env` typed at the repository root used to read
		 * `apps/api/.env` — a different deployment's file, reported as green with no hint. pnpm records
		 * the invoking directory as `INIT_CWD`; a direct `tsx` run has none and uses its own cwd.
		 */
		const envFile =
			parsed.envFile === STDIN
				? STDIN
				: resolve(process.env.INIT_CWD || process.cwd(), parsed.envFile);
		let loaded: ReturnType<typeof loadEnvFile>;
		try {
			loaded = loadEnvFile(envFile);
		} catch {
			console.error(`can't read the environment file: ${envFile}`);
			return 1;
		}
		env = { ...env, ...loaded.values };
		source = loaded.label;
		problems.push(...loaded.problems);
	}

	const report = buildDoctorReport({ env, mode: parsed.mode, source });

	if (parsed.json) process.stdout.write(renderDoctorJson(report));
	else {
		console.log(renderDoctorText(report));
		for (const problem of problems) console.warn(`! ${problem}`);
	}

	return doctorExitCode(report, parsed.strict);
}

const [command, ...rest] = process.argv.slice(2);

if (!command || command === "help" || command === "--help") {
	usage();
	process.exit(0);
}

if (command === "check") process.exit(runCheck());
if (command === "doctor") process.exit(runDoctor(rest));

console.error(`unknown command: ${command}`);
usage();
process.exit(1);
