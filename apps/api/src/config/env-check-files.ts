import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	checkEnvironmentSurfaces,
	type EnvCheckResult,
	type EnvCheckSources,
} from "./env-check.ts";

/**
 * Thin layer that feeds repository files to the checker. The check itself (`env-check.ts`) takes
 * strings only, so tests can run every drift kind on synthetic fixtures; disk reads live here and
 * this file knows the four paths and makes no judgement.
 */

const REPO_ROOT = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
	"..",
);

export const ENV_CHECK_FILES = {
	rootExample: ".env.example",
	apiExample: "apps/api/.env.example",
	webExample: "apps/web/.env.example",
	compose: "docker-compose.yml",
} as const;

export function readEnvCheckSources(root = REPO_ROOT): EnvCheckSources {
	const read = (relative: string): string =>
		readFileSync(join(root, relative), "utf8");
	return {
		rootExample: read(ENV_CHECK_FILES.rootExample),
		apiExample: read(ENV_CHECK_FILES.apiExample),
		webExample: read(ENV_CHECK_FILES.webExample),
		compose: read(ENV_CHECK_FILES.compose),
	};
}

export const checkRepositoryEnvironment = (root?: string): EnvCheckResult =>
	checkEnvironmentSurfaces(readEnvCheckSources(root));
