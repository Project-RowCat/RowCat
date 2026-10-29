import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Config tooling must not start the application. `env:doctor` exists to explain a broken
 * configuration; passing through boot code would run migrations, start schedulers or
 * `process.exit(1)` before it can draw anything — exactly when diagnosis is needed.
 *
 * That guarantee is an absent import, so a static scan guards it. It is an allowlist because a
 * denylist would silently pass a new folder under `services/`.
 */

const CONFIG_DIR = fileURLToPath(new URL(".", import.meta.url));

/**
 * App modules the config layer may import. All are pure decisions (no files, sockets or processes);
 * a commit that grows this list deserves review.
 */
const ALLOWED_APP_IMPORTS = new Set([
	"../lib/mail-config.ts",
	"../lib/origins.ts",
	"../lib/webauthn-config.ts",
	"../lib/apple-signin-config.ts",
	/** Push transport resolution only — pure: it does not call Expo or know destinations. */
	"../lib/push-config.ts",
	/** CI wiring resolution for mobile OTA publishing only — pure: no GitHub calls, no token use. */
	"../lib/mobile-update-ci-config.ts",
]);

/**
 * Scans with comments removed: headers here name what they do not call ("does not read
 * `process.env`"), and counting those as calls would push people to delete the documentation.
 */
const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function sourceFiles(): { path: string; text: string }[] {
	return readdirSync(CONFIG_DIR)
		.filter((name) => name.endsWith(".ts"))
		.map((name) => ({
			path: name,
			text: stripComments(readFileSync(join(CONFIG_DIR, name), "utf8")),
		}));
}

/** The test files hold the forbidden-word lists, so they are exempt. */
const productionFiles = (): { path: string; text: string }[] =>
	sourceFiles().filter((file) => !file.path.endsWith(".test.ts"));

const importsOf = (text: string): string[] =>
	[...text.matchAll(/(?:from|import)\s+"([^"]+)"/g)].map(
		(match) => match[1] as string,
	);

describe("import boundary of the config layer", () => {
	test("does not go through the boot facade (env.ts)", () => {
		for (const file of sourceFiles())
			for (const specifier of importsOf(file.text))
				expect(specifier, file.path).not.toMatch(/(^|\/)env\.ts$/);
	});

	test("the only in-app imports are pure decision modules", () => {
		for (const file of sourceFiles())
			for (const specifier of importsOf(file.text)) {
				if (!specifier.startsWith("..")) continue;
				expect(
					ALLOWED_APP_IMPORTS.has(specifier),
					`${file.path}: ${specifier}`,
				).toBe(true);
			}
	});

	/**
	 * Redundant with the allowlist, but naming what is blocked keeps the next person from routing
	 * around it.
	 */
	test("does not go through the database, app, jobs, routes or services", () => {
		for (const file of sourceFiles())
			for (const specifier of importsOf(file.text))
				expect(specifier, file.path).not.toMatch(
					/\.\.\/(db|jobs|routes|services|auth)\//,
				);
	});

	/** Diagnosis starts nothing: migrations, listening, schedulers and mail are off limits here. */
	test("does not call boot, send or scheduler functions", () => {
		const forbidden = [
			"runMigrations",
			"startBackgroundJobs",
			"sendTransactionalMail",
			"getRedis",
			"serve(",
		];
		for (const file of productionFiles())
			for (const name of forbidden)
				expect(file.text.includes(name), `${file.path}: ${name}`).toBe(false);
	});

	/**
	 * The rule layer (schema, resolution, inventory, check, doctor) knows no filesystem; keeping disk
	 * reads to two places lets the checker run on synthetic fixtures.
	 */
	test("only two places read the disk", () => {
		const readers = productionFiles()
			.filter((file) => file.text.includes("node:fs"))
			.map((file) => file.path)
			.sort();
		expect(readers).toEqual(["cli.ts", "env-check-files.ts"]);
	});

	/**
	 * A pure resolver reading `process.env` would inspect the shell it runs in, not the deployment it
	 * diagnoses. Only the CLI reads it.
	 */
	test("only the CLI reads process.env", () => {
		const readers = productionFiles()
			.filter((file) => file.text.includes("process.env"))
			.map((file) => file.path);
		expect(readers).toEqual(["cli.ts"]);
	});

	/** Read-only: this tool never edits a configuration file. */
	test("does not write files", () => {
		for (const file of productionFiles()) {
			expect(file.text, file.path).not.toMatch(
				/writeFile|appendFile|mkdir|rm\(|unlink/,
			);
		}
	});
});
