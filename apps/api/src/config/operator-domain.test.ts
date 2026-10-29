import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * **This repository knows no operator's domain.**
 *
 * The code's default is `localhost`, and production origins come from deployment config. Examples
 * use RFC 2606's `example.com` family. For a while, the domain of the service that ran this code
 * sat in defaults, examples and constants all over, and each of those values was a path that **quietly
 * attaches to someone else's production server** the moment a fork forgot one setting (the SDK's
 * default origin, mobile build profiles, image build args, the console's CSP).
 *
 * That absence exists only as **a string that is not there**, so a static scan guards it. It sits
 * beside the config layer's drift check (`env:check`) because the two are the same kind of check:
 * they ask which file holds a deployment's facts.
 *
 * The scan covers every file the repository tracks (`git ls-files`, including new unignored files).
 * The ignore list already filters build output, `node_modules` and `.env`.
 */

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/**
 * The string to find, assembled **so that the value never appears verbatim in this file**. Written
 * out, the check would catch itself, and once that line went on the allowlist anything in this file would pass.
 */
const OPERATOR_DOMAIN = new RegExp(
	`${["project", "rowcat"].join("-")}\\.com`,
	"i",
);

/**
 * Places where that domain may remain: **only documents recording history, and files waiting on a
 * different decision.** Written as path prefixes with a reason per line; a commit growing this list is itself up for review.
 *
 * Empty now. The last entry was `docs/oss/`, whose working plan named the domain while the release was
 * being prepared; the record that replaced it (`docs/oss/PLAN.md`) has no reason to.
 */
const ALLOWED: readonly { prefix: string; reason: string }[] = [];

const allowed = (path: string): boolean =>
	ALLOWED.some(({ prefix }) =>
		prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix,
	);

function trackedFiles(): string[] {
	return execFileSync(
		"git",
		["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
		{ cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	)
		.split("\0")
		.filter((path) => path.length > 0);
}

/** Skips unreadable files (deleted but still in the index) and binaries. */
function textOf(path: string): string | null {
	let bytes: Buffer;
	try {
		bytes = readFileSync(join(REPO_ROOT, path));
	} catch {
		return null;
	}
	if (bytes.includes(0)) return null;
	return bytes.toString("utf8");
}

describe("operator domain", () => {
	test("is in no file outside the allowlist", () => {
		const offenders: string[] = [];
		for (const path of trackedFiles()) {
			if (allowed(path)) continue;
			const text = textOf(path);
			if (text === null) continue;
			const lines = text.split("\n");
			lines.forEach((line, index) => {
				if (OPERATOR_DOMAIN.test(line)) offenders.push(`${path}:${index + 1}`);
			});
		}
		expect(offenders).toEqual([]);
	});

	test("the check actually catches that value", () => {
		/** With a wrong pattern the check above is always green — so verify with a mixed-case value. */
		expect(
			OPERATOR_DOMAIN.test(
				`https://api.${["Project", "RowCat"].join("-")}.com`,
			),
		).toBe(true);
		expect(OPERATOR_DOMAIN.test("https://api.example.com")).toBe(false);
	});
});
