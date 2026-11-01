import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The config CLI as a process — its argument handling runs at module top level and ends in
 * `process.exit`, so it is checked the way an operator runs it. Only the stdin path is pinned here:
 * it is what lets a running container's environment be checked without dumping it to a file
 * (docs/ops/CLEAN-INSTALL.md), and a regression there sends people back to `env > /tmp/…`.
 */

const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));

function doctor(stdin: string, ...args: string[]) {
	return spawnSync(
		process.execPath,
		["--import", "tsx", cli, "doctor", "--file", "-", ...args],
		{
			input: stdin,
			encoding: "utf8",
			// The process environment is layered under the file; an empty one keeps the host's out.
			env: { PATH: process.env.PATH ?? "" },
		},
	);
}

describe("env:doctor --file -", () => {
	const secret = "a-session-key-that-is-long-enough-for-production";
	const password = "never-echo-this-password";
	const input = [
		"NODE_ENV=production",
		`BETTER_AUTH_SECRET=${secret}`,
		`DATABASE_URL=postgres://rowcat_app:${password}@db:5432/rowcat`,
		"",
	].join("\n");

	it("reads the values from stdin and says so", () => {
		const result = doctor(input, "--json");
		const report = JSON.parse(result.stdout) as {
			source: string;
			mode: string;
			valid: boolean;
		};
		expect(report.source).toBe("process environment + stdin (3 keys)");
		expect(report.mode).toBe("production");
		expect(report.valid).toBe(true);
	});

	it("prints none of the values it read", () => {
		for (const args of [["--json"], []]) {
			const result = doctor(input, ...args);
			const output = result.stdout + result.stderr;
			expect(output).not.toContain(secret);
			expect(output).not.toContain(password);
		}
	});
});
