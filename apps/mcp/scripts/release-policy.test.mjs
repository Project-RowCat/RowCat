import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
	PACKAGE_NAME,
	RELEASE_WORKFLOW,
	checkPublishAuthorization,
	distTagFor,
	identityProblems,
	releaseTagFor,
	RELEASE_REPOSITORY,
} from "./release-policy.mjs";

/**
 * Checks the release policy by value. As Bash conditions in workflow YAML it could only be run at
 * publish time, whose failure cannot be undone (npm versions are immutable), so the policy is a
 * pure function checked here. The cases that must be refused are the point: a passing path is
 * confirmed by any successful publish, while a path that must be blocked looks like nothing
 * happened if it is not.
 */

const MANIFEST = {
	name: PACKAGE_NAME,
	version: "0.1.0-alpha.1",
	publishConfig: { access: "public", tag: "next" },
	repository: {
		type: "git",
		url: `git+https://github.com/${RELEASE_REPOSITORY}.git`,
		directory: "apps/mcp",
	},
};

/** The environment a tag release job actually sees. */
const RELEASE_ENV = {
	GITHUB_ACTIONS: "true",
	GITHUB_REPOSITORY: "Project-RowCat/RowCat",
	GITHUB_WORKFLOW_REF: `Project-RowCat/RowCat/${RELEASE_WORKFLOW}@refs/tags/mcp-v0.1.0-alpha.1`,
	GITHUB_REF_TYPE: "tag",
	GITHUB_REF_NAME: "mcp-v0.1.0-alpha.1",
};

describe("where a version goes", () => {
	test.each([
		["0.1.0-alpha.1", "next"],
		["0.1.0-beta.2", "next"],
		["1.0.0-rc.1", "next"],
	])("%s → %s", (version, expected) => {
		expect(distTagFor(version)).toEqual({ ok: true, distTag: expected });
	});

	/**
	 * Stable versions are refused; that absence is the decision. `latest` is what an option-less
	 * install picks up, and this code cannot know the canary was validated outside the repository.
	 */
	test("stable versions have no dist-tag", () => {
		const stable = distTagFor("0.1.0");
		expect(stable.ok).toBe(false);
		expect(stable.problem).toContain("stable");
	});

	test.each(["", "v0.1.0", "0.1", "0.1.0-alpha", "0.1.0-dev.1", "latest"])(
		"%s off the shape is refused",
		(version) => {
			expect(distTagFor(version).ok).toBe(false);
		},
	);
});

describe("tags and versions", () => {
	test("the tag name comes from the version", () => {
		expect(releaseTagFor("0.1.0-alpha.1")).toBe("mcp-v0.1.0-alpha.1");
	});

	/**
	 * Without the prefix another release tag in this repository would start an npm publish; with
	 * several apps and version axes, `v*` cannot say what it releases.
	 */
	test("the prefix names the app", () => {
		expect(releaseTagFor("1.0.0")).not.toBe("v1.0.0");
		expect(releaseTagFor("1.0.0").startsWith("mcp-v")).toBe(true);
	});
});

/**
 * The repository identity comes from a constant, not the manifest, and the manifest has to agree with
 * it. While the code lived in a private repository the rule was the reverse (that address must not
 * appear, because npm would link to a 404). Now the repository is public, and npm's provenance check
 * compares `repository.url` with the repository the workflow ran in, so a missing or different value
 * fails at the registry after every other gate passed.
 */
describe("public metadata names the release repository", () => {
	test("this repository's manifest passes", () => {
		const manifest = JSON.parse(
			readFileSync(
				join(dirname(fileURLToPath(import.meta.url)), "../package.json"),
				"utf8",
			),
		);
		expect(identityProblems(manifest)).toEqual([]);
	});

	test("no repository is refused", () => {
		const { repository: _, ...bare } = MANIFEST;
		expect(identityProblems(bare).join("\n")).toContain(RELEASE_REPOSITORY);
	});

	test.each([
		"https://github.com/someone/fork",
		`https://github.com/${RELEASE_REPOSITORY}-fork`,
	])("a different repository is refused: %s", (url) => {
		expect(
			identityProblems({ ...MANIFEST, repository: { type: "git", url } }),
		).not.toEqual([]);
	});

	test("bugs and homepage may be absent, and present they name this repository", () => {
		expect(
			identityProblems({
				...MANIFEST,
				bugs: { url: `https://github.com/${RELEASE_REPOSITORY}/issues` },
				homepage: `https://github.com/${RELEASE_REPOSITORY}/tree/main/apps/mcp#readme`,
			}),
		).toEqual([]);
	});

	/**
	 * The hosted service's site and support mailbox are gone; a link to either is a dead end on the npm
	 * page.
	 */
	test.each(["bugs", "homepage"])("%s elsewhere is refused", (field) => {
		expect(
			identityProblems({ ...MANIFEST, [field]: "https://example.com" }),
		).not.toEqual([]);
	});
});

describe("the basis of publish permission is a constant", () => {
	/**
	 * Checks ② and ③ used to be skipped when the manifest had no readable repository; as a constant
	 * they always run, leaving no window for a fork's workflow to pass.
	 */
	test("forks are refused even without a repository in the manifest", () => {
		const verdict = checkPublishAuthorization(
			{
				...RELEASE_ENV,
				GITHUB_REPOSITORY: "someone/fork",
				GITHUB_WORKFLOW_REF: `someone/fork/${RELEASE_WORKFLOW}@refs/tags/mcp-v0.1.0-alpha.1`,
			},
			MANIFEST,
		);
		expect(verdict.ok).toBe(false);
		expect(verdict.problems.join("\n")).toContain(RELEASE_REPOSITORY);
	});
});

describe("publish permission", () => {
	test("the tag release job passes", () => {
		const verdict = checkPublishAuthorization(RELEASE_ENV, MANIFEST);
		expect(verdict.problems).toEqual([]);
		expect(verdict.ok).toBe(true);
		expect(verdict.distTag).toBe("next");
	});

	/** The first reason this file exists: a local shell does not pass. */
	test("a local shell is refused", () => {
		const verdict = checkPublishAuthorization({}, MANIFEST);
		expect(verdict.ok).toBe(false);
		expect(verdict.problems.join("\n")).toContain("GitHub Actions");
	});

	/** The old gate that a single declaration passed is gone. */
	test("an environment variable declaring intent does not open it", () => {
		expect(
			checkPublishAuthorization({ ROWCAT_MCP_PUBLISH: "yes" }, MANIFEST).ok,
		).toBe(false);
	});

	test.each([
		[
			"the version ahead of the tag",
			{ ...RELEASE_ENV, GITHUB_REF_NAME: "mcp-v0.1.0-alpha.2" },
			MANIFEST,
			"disagree",
		],
		[
			"pushed as a branch",
			{
				...RELEASE_ENV,
				GITHUB_REF_TYPE: "branch",
				GITHUB_REF_NAME: "main",
				GITHUB_WORKFLOW_REF: `Project-RowCat/RowCat/${RELEASE_WORKFLOW}@refs/heads/main`,
			},
			MANIFEST,
			"starts from a tag",
		],
		[
			"running in a fork",
			{ ...RELEASE_ENV, GITHUB_REPOSITORY: "someone/RowCat" },
			MANIFEST,
			"repository differs",
		],
		[
			"attached to another workflow",
			{
				...RELEASE_ENV,
				GITHUB_WORKFLOW_REF:
					"Project-RowCat/RowCat/.github/workflows/ci.yml@refs/tags/mcp-v0.1.0-alpha.1",
			},
			MANIFEST,
			RELEASE_WORKFLOW,
		],
		[
			"pointing at another package",
			RELEASE_ENV,
			{ ...MANIFEST, name: "@rowcat/sync" },
			"is not @rowcat/mcp",
		],
		[
			"private",
			RELEASE_ENV,
			{ ...MANIFEST, private: true },
			"private",
		],
		[
			"scope not opened",
			RELEASE_ENV,
			{ ...MANIFEST, publishConfig: { access: "restricted" } },
			"public",
		],
	])("%s is refused", (_label, env, manifest, expected) => {
		const verdict = checkPublishAuthorization(env, manifest);
		expect(verdict.ok).toBe(false);
		expect(verdict.problems.join("\n")).toContain(expected);
	});

	/**
	 * No other workspace package can go out this way. `pnpm -r publish` exists, so relying on the
	 * directory alone would eventually publish `@rowcat/sync` to npm.
	 */
	test.each([
		"@rowcat/sync",
		"@rowcat/runtime-host",
		"@rowcat/runtime-mcp",
		"@rowcat/authoring",
		"rowcat",
	])("%s is not published by this policy", (name) => {
		expect(identityProblems({ ...MANIFEST, name }).length).toBeGreaterThan(0);
	});
});

describe("this package's manifest", () => {
	const manifest = JSON.parse(
		readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
	);

	test("has a shape this policy can publish", () => {
		expect(identityProblems(manifest)).toEqual([]);
	});

	/**
	 * `publishConfig.tag` and the policy must say the same value. The manifest `tag` is kept as a
	 * second line of defence for a publish without `--tag`, but it is a fixed string while the policy
	 * is computed from the version, so the two can diverge the day a stable policy exists; the symptom
	 * would be a stable version landing on `next`, not an error. Pinning the pair makes a commit that
	 * adds a branch to `distTagFor` fix the manifest too.
	 */
	test("publishConfig.tag equals the dist-tag the policy computes", () => {
		const tag = distTagFor(manifest.version);
		expect(tag.ok).toBe(true);
		expect(manifest.publishConfig.tag).toBe(tag.distTag);
	});

	test("prepublishOnly passes through this gate", () => {
		expect(manifest.scripts.prepublishOnly).toBe(
			"node scripts/guard-publish.mjs",
		);
	});

	/**
	 * Publishing uses `pnpm publish`; an `npm publish` in a package script would upload a tarball with
	 * workspace specifiers unsubstituted.
	 */
	test("package scripts do not publish on their own", () => {
		for (const [name, body] of Object.entries(manifest.scripts))
			expect(`${name}: ${body}`).not.toMatch(/\b(npm|pnpm|yarn)\s+publish\b/);
	});
});

/**
 * Guards the publish path itself by value. The rest of this file checks pure functions, but what
 * actually reaches the registry is a few workflow lines. YAML is hard to unit test, so the policy
 * moved to scripts; here we only check that those scripts are in place and that nothing that must
 * be absent is present. Guarding absence is the point: adding `pull_request` or `--recursive` looks
 * like an ordinary line in a diff, and the result cannot be undone.
 */
describe("publish workflow", () => {
	const path = join(
		dirname(fileURLToPath(import.meta.url)),
		"..",
		"..",
		"..",
		RELEASE_WORKFLOW,
	);
	const raw = readFileSync(path, "utf8");
	/** The header explains `npm publish`, so checks look only at lines with comments stripped. */
	const body = raw
		.split("\n")
		.filter((line) => !/^\s*#/.test(line))
		.join("\n");

	test("publishing uses pnpm publish", () => {
		expect(body).toMatch(/pnpm publish --tag/);
		expect(body, "npm publish is used as a registry operation").not.toMatch(
			/^\s*(?:run:\s*)?npm publish\b/m,
		);
	});

	test("there is no shape publishing the whole workspace", () => {
		expect(body).not.toMatch(/pnpm\s+(?:-r|--recursive)\s+publish/);
		expect(body).not.toMatch(/publish\s+(?:-r|--recursive)/);
		expect(body).toMatch(/working-directory: apps\/mcp/);
	});

	/** Publishing goes out only on the tag event; if an input decided it, setting it wrong would be a publish. */
	test("the publish step runs only on tag pushes", () => {
		const publish = body.slice(body.indexOf("- name: Publish"));
		expect(publish).toMatch(/if: github\.event_name == 'push'/);
	});

	test.each([
		["pull_request", /^\s*pull_request:/m],
		["pull_request_target", /pull_request_target/],
		["branch push", /^\s*branches:/m],
		["schedule", /^\s*schedule:/m],
		["contents: write", /contents:\s*write/],
		["NPM_TOKEN", /NPM_TOKEN|NODE_AUTH_TOKEN/],
		["ROWCAT_MCP_PUBLISH", /ROWCAT_MCP_PUBLISH/],
	])("%s is absent", (_label, pattern) => {
		expect(body).not.toMatch(pattern);
	});

	test.each([
		["OIDC for trusted publishing", /id-token: write/],
		["concurrency is queued", /group: rowcat-mcp-publish/],
		["not cancelled", /cancel-in-progress: false/],
		["a time limit", /timeout-minutes:/],
		["a frozen lockfile", /pnpm install --frozen-lockfile/],
		["the repository gate", /pnpm check/],
		["pack verification", /pack:verify/],
	])("%s is present", (_label, pattern) => {
		expect(body).toMatch(pattern);
	});

	/** Actions are pinned by SHA, the same rule as the repository's other workflows. */
	test("actions are pinned by SHA", () => {
		for (const [, spec] of body.matchAll(/uses: (\S+)/g))
			expect(spec, spec).toMatch(/@[0-9a-f]{40}$/);
	});
});
