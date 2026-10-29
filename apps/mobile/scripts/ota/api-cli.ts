import { spawnSync } from "node:child_process";

/**
 * Bridge that hands registration and state transitions to the API's operations CLI.
 *
 * The bundle validation rules (signature, body/field agreement, asset addresses) and the transition
 * table live only in `apps/api/src/services/mobile-updates/`; re-implementing them here would let
 * the two decisions diverge, so this tool calls that process instead. It sees the release
 * environment's `DATABASE_URL` and `API_ORIGIN` but never the signing key (`childEnv`).
 */

const childEnv = (): NodeJS.ProcessEnv => {
	const env: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(process.env))
		if (!key.startsWith("ROWCAT_OTA_SIGNING_KEY")) env[key] = value;
	return env as NodeJS.ProcessEnv;
};

export interface ApiCliResult {
	status: number;
	stdout: string;
	stderr: string;
}

export function runApiCli(args: readonly string[]): ApiCliResult {
	const result = spawnSync(
		"pnpm",
		["--silent", "--filter", "@rowcat/api", "mobile-updates", ...args],
		{ encoding: "utf8", env: childEnv(), maxBuffer: 64 * 1024 * 1024 },
	);
	return {
		status: result.status ?? 1,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

/** Calls with `--json` and parses the result; on failure throws that process's own output. */
export function apiCliJson<T>(args: readonly string[]): T {
	const result = runApiCli([...args, "--json"]);
	if (result.status !== 0)
		throw new Error(
			`mobile-updates ${args[0]} failed:\n${result.stderr.trim() || result.stdout.trim()}`,
		);
	const start = result.stdout.search(/[[{]/);
	if (start < 0)
		throw new Error(`couldn't read the output of mobile-updates ${args[0]}`);
	return JSON.parse(result.stdout.slice(start)) as T;
}

/** Streams the human-readable output through (list, history, rollout changes). */
export function passthroughApiCli(args: readonly string[]): number {
	const result = spawnSync(
		"pnpm",
		["--silent", "--filter", "@rowcat/api", "mobile-updates", ...args],
		{ stdio: "inherit", env: childEnv() },
	);
	return result.status ?? 1;
}
