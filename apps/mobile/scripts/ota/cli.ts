import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	MOBILE_UPDATE_KEY_ID_PATTERN,
	MobileUpdateChannel,
	MobileUpdatePlatform,
} from "@rowcat/contracts";
import { passthroughApiCli } from "./api-cli.ts";
import { publish, rollback } from "./publish.ts";
import {
	type RegisteredRelease,
	StageTracker,
	writeResultFile,
} from "./result.ts";
import {
	configuredRuntimeVersion,
	currentFingerprint,
	judgeRuntime,
	readRuntimeLock,
	recordRuntime,
} from "./runtime.ts";

/**
 * `pnpm mobile:update ...`: the self-hosted OTA publish tool.
 *
 * It belongs wherever the publish environment lives (signing key, storage credentials, the target
 * deployment's DB). The operations console's `New OTA release` and `Roll back` are requests to run this
 * command in CI (`mobile-ota.yml`, not shipped in the public repository; an example for deployments
 * to adapt is in `docs/ota/example-workflows.md`). The console and API hold no private key and CI
 * has no second publisher. During an incident without console or CI, a person runs this command
 * directly (`docs/ota/ARCHITECTURE.md`). The canonical procedure is `docs/ota/OPERATIONS.md`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = resolve(HERE, "../..");
const REPO_ROOT = resolve(MOBILE_ROOT, "../..");

const USAGE = `RowCat mobile OTA

  publish <preview|testflight|production> [--platform ios|android]
          [--rollout N | --draft] [--api-origin <origin>]
          [--note YYYY-MM-DD | --no-note] [--reason "…"]
          [--skip-checks] [--allow-dirty] [--no-register]
          [--result-file <path>]
      production registers as a draft unless a percentage is given (it goes to nobody).
      --result-file writes the result CI reads (registered ids · the failed step).

  rollout <id[,id…]> <percent> [--reason "…"]    raises the percentage (it never shrinks)
  pause <id[,id…]> --reason "…"                  new installs stop receiving it (no signing key needed)
  resume <id[,id…]> [--reason "…"]
  rollback <id> --reason "…" [--to-embedded] [--result-file <path>]
                                                  rolls back, and re-signs the place to return to
  register <bundle.json> [--rollout N | --draft]  re-registers one signed bundle from a failed publish
  list | show <id> | gc-report                   calls the API operations CLI as is

  runtime:check                                   is the native fingerprint = this generation's record
  runtime:record                                  records the fingerprint for the current generation for the first time
  keys:generate <channel> --key-out <a folder outside the repository> [--generation N]
`;

class UsageError extends Error {}

interface Args {
	positional: string[];
	flags: Map<string, string>;
}

const BOOLEAN = new Set([
	"draft",
	"allow-duplicate-content",
	"no-note",
	"skip-checks",
	"allow-dirty",
	"no-register",
	"to-embedded",
]);

function parse(argv: string[]): Args {
	const positional: string[] = [];
	const flags = new Map<string, string>();
	for (let index = 0; index < argv.length; index++) {
		const token = argv[index] as string;
		if (!token.startsWith("--")) {
			positional.push(token);
			continue;
		}
		const name = token.slice(2);
		if (BOOLEAN.has(name)) {
			flags.set(name, "true");
			continue;
		}
		const value = argv[index + 1];
		if (value === undefined || value.startsWith("--"))
			throw new UsageError(`--${name} has no value`);
		flags.set(name, value);
		index++;
	}
	return { positional, flags };
}

const has = (args: Args, name: string) => args.flags.get(name) === "true";

async function runtimeCommand(record: boolean): Promise<number> {
	const runtimeVersion = await configuredRuntimeVersion();
	const fingerprint = await currentFingerprint(MOBILE_ROOT);
	if (record) {
		const outcome = recordRuntime(
			MOBILE_ROOT,
			runtimeVersion,
			fingerprint,
			new Date(),
		);
		console.log(
			outcome === "recorded"
				? `recorded ${runtimeVersion} → ${fingerprint} — commit native-runtime.lock.json`
				: `${runtimeVersion} is already recorded with the same fingerprint`,
		);
		return 0;
	}
	const judged = judgeRuntime(
		readRuntimeLock(MOBILE_ROOT),
		runtimeVersion,
		fingerprint,
	);
	if (!judged.ok) {
		console.error(judged.problem);
		return 1;
	}
	console.log(`${runtimeVersion} · fingerprint ${fingerprint} — matches the record`);
	return 0;
}

/**
 * Generates a signing key; the private key is written only outside the repository.
 *
 * Uses expo-updates' own generator (`expo-updates codesigning:generate`). The certificate is moved
 * to `certs/<keyId>.pem` and committed; the private key stays in the `--key-out` folder, which is
 * refused if inside the repository (`.gitignore` is a further layer we do not rely on).
 */
function generateKeys(args: Args): number {
	const channel = MobileUpdateChannel.parse(args.positional[1]);
	const generation = Number(args.flags.get("generation") ?? "1");
	if (!Number.isInteger(generation) || generation < 1)
		throw new UsageError("--generation is an integer of 1 or more");
	const keyId = `rowcat-${channel}-${generation}`;
	if (!MOBILE_UPDATE_KEY_ID_PATTERN.test(keyId))
		throw new UsageError(`can't build a key id: ${keyId}`);
	const keyOut = args.flags.get("key-out");
	if (!keyOut) throw new UsageError("--key-out <a folder outside the repository> is required");
	const keyDir = resolve(keyOut);
	const inside = relative(REPO_ROOT, keyDir);
	if (!inside.startsWith("..") && !isAbsolute(inside))
		throw new UsageError("the private key is never written inside the repository — --key-out is outside the repository");
	const certificate = join(MOBILE_ROOT, "certs", `${keyId}.pem`);
	if (existsSync(certificate))
		throw new UsageError(
			`a certificate for ${keyId} already exists — keys aren't overwritten (rotation raises --generation)`,
		);
	const staging = join(MOBILE_ROOT, ".ota", `cert-${keyId}`);
	rmSync(staging, { recursive: true, force: true });
	mkdirSync(keyDir, { recursive: true });
	const result = spawnSync(
		"node",
		[
			join(MOBILE_ROOT, "node_modules/expo-updates/bin/cli.js"),
			"codesigning:generate",
			"--key-output-directory",
			keyDir,
			"--certificate-output-directory",
			staging,
			"--certificate-validity-duration-years",
			"10",
			"--certificate-common-name",
			`RowCat OTA ${keyId}`,
		],
		{ stdio: "inherit" },
	);
	if (result.status !== 0) return result.status ?? 1;
	mkdirSync(dirname(certificate), { recursive: true });
	renameSync(join(staging, "certificate.pem"), certificate);
	rmSync(staging, { recursive: true, force: true });
	renameSync(join(keyDir, "private-key.pem"), join(keyDir, `${keyId}.private-key.pem`));
	renameSync(join(keyDir, "public-key.pem"), join(keyDir, `${keyId}.public-key.pem`));
	console.log(`
certificate  ${relative(REPO_ROOT, certificate)}   ← commit it
private key  ${join(keyDir, `${keyId}.private-key.pem`)}   ← move it to the CI secret (ROWCAT_OTA_SIGNING_KEY) and keep this file safe

Binaries **built next** on this channel trust this certificate (app.config.ts's OTA_SIGNING_KEY_ID must be ${keyId}).`);
	return 0;
}

/**
 * Runs while writing the result file: registered releases on success, the stopped stage on failure,
 * never error text (`result.ts`). Failures are rethrown because the exit code is the CI step's
 * outcome.
 */
async function withResultFile(
	path: string | undefined,
	run: (stages: StageTracker) => Promise<RegisteredRelease[]>,
): Promise<number> {
	const stages = new StageTracker();
	try {
		const releases = await run(stages);
		if (path) writeResultFile(path, { ok: true, stage: null, releases });
		return 0;
	} catch (error) {
		if (path)
			writeResultFile(path, { ok: false, stage: stages.current, releases: [] });
		throw error;
	}
}

async function main(): Promise<number> {
	const args = parse(process.argv.slice(2));
	const command = args.positional[0];
	switch (command) {
		case undefined:
		case "help":
			console.log(USAGE);
			return 0;
		case "publish": {
			const channel = MobileUpdateChannel.parse(args.positional[1]);
			const platformFlag = args.flags.get("platform");
			const rolloutFlag = args.flags.get("rollout");
			if (rolloutFlag !== undefined && has(args, "draft"))
				throw new UsageError("--rollout and --draft can't be used together");
			const rollout = rolloutFlag === undefined ? null : Number(rolloutFlag);
			if (rollout !== null && !Number.isInteger(rollout))
				throw new UsageError("--rollout is an integer percent");
			if (args.flags.get("note") && has(args, "no-note"))
				throw new UsageError("--note and --no-note can't be used together");
			return withResultFile(args.flags.get("result-file"), (stages) =>
				publish({
				mobileRoot: MOBILE_ROOT,
				repoRoot: REPO_ROOT,
				channel,
				platforms: platformFlag
					? [MobileUpdatePlatform.parse(platformFlag)]
					: ["ios", "android"],
				rollout,
				draft: has(args, "draft"),
				apiOrigin: args.flags.get("api-origin"),
				note: args.flags.get("note"),
				noNote: has(args, "no-note"),
				skipChecks: has(args, "skip-checks"),
				allowDirty: has(args, "allow-dirty"),
				register: !has(args, "no-register"),
				reason: args.flags.get("reason") ?? "",
				now: new Date(),
				stages,
				}),
			);
		}
		case "rollback": {
			const id = args.positional[1];
			if (!id) throw new UsageError("a release id is required");
			return withResultFile(args.flags.get("result-file"), (stages) =>
				rollback({
					mobileRoot: MOBILE_ROOT,
					repoRoot: REPO_ROOT,
					id,
					reason: args.flags.get("reason") ?? "",
					toEmbedded: has(args, "to-embedded"),
					now: new Date(),
					stages,
				}),
			);
		}
		case "register": {
			// Re-registers one bundle from a failed publish. pnpm runs the command in the API package, so
			// the path is resolved absolute against where the person typed it (`INIT_CWD`).
			const file = args.positional[1];
			if (!file) throw new UsageError("a bundle file path is required");
			const forwarded = [
				"register",
				resolve(process.env.INIT_CWD ?? process.cwd(), file),
			];
			for (const [name, value] of args.flags)
				forwarded.push(`--${name}`, ...(value === "true" ? [] : [value]));
			return passthroughApiCli(forwarded);
		}
		case "rollout":
		case "pause":
		case "resume":
		case "list":
		case "show":
		case "gc-report": {
			const forwarded = [command, ...args.positional.slice(1)];
			for (const [name, value] of args.flags)
				forwarded.push(`--${name}`, ...(value === "true" ? [] : [value]));
			return passthroughApiCli(forwarded);
		}
		case "runtime:check":
			return runtimeCommand(false);
		case "runtime:record":
			return runtimeCommand(true);
		case "keys:generate":
			return generateKeys(args);
		default:
			throw new UsageError(`unknown command: ${command}`);
	}
}

main().then(
	(code) => {
		process.exitCode = code;
	},
	(error: unknown) => {
		if (error instanceof UsageError) {
			console.error(`${error.message}\n\n${USAGE}`);
			process.exitCode = 2;
			return;
		}
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	},
);
