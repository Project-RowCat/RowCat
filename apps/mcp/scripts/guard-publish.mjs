/**
 * The gate that keeps a publish from happening by accident; the only place `prepublishOnly` goes
 * through.
 *
 * Publishing must not be one command here (build, pack, verify and publish are separate), yet `pnpm
 * publish` is one line anywhere and, once it succeeds, cannot be undone: npm versions are
 * immutable, so a wrongly published 0.1.0 stays 0.1.0 forever.
 *
 * This gate used to require only `ROWCAT_MCP_PUBLISH=yes`, a declaration of intent that a local
 * shell passed with one line. It now asks observable facts instead: where it runs, which
 * repository, which workflow, which tag. The decision lives in `release-policy.mjs`; this file only
 * turns the answer into an exit code. A local `pnpm publish` is refused; the release job for a
 * `mcp-v<version>` tag passes.
 *
 * Environment variables can be filled in, so this is not a cryptographic boundary (real registry
 * authority is npm's OIDC); it blocks the path developers pass through carelessly.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPublishAuthorization } from "./release-policy.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const verdict = checkPublishAuthorization(process.env, manifest);

/**
 * The build output must already exist. That `prepack` builds anyway is not a reason to drop this:
 * the question is whether the tree was built and verified. A publish that skipped `pack:verify`
 * first breaks in the installed copy, on the user's machine.
 */
const built = existsSync(join(root, "dist", "index.mjs"));

if (!verdict.ok || !built) {
	const lines = [...verdict.problems];
	if (!built)
		lines.push(
			"dist/index.mjs is missing: it hasn't passed the build and pack verification.\n" +
				`  pnpm --filter ${manifest.name} build && pnpm --filter ${manifest.name} pack:verify`,
		);
	process.stderr.write(`${lines.join("\n\n")}\n`);
	process.exit(1);
}

process.stderr.write(
	`${manifest.name}@${manifest.version} → dist-tag ${verdict.distTag}\n`,
);
