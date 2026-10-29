/**
 * Release policy: where a version can go and where it can go from.
 *
 * This file has no side effects (no files, network or `process.exit`); it only answers from the
 * values it is given, so the decision can be checked by value (`release-policy.test.mjs`). If the
 * policy were scattered into Bash conditions in workflow YAML, the only place to run it would be
 * the moment of publishing, whose failure cannot be undone.
 *
 * Two consumers go through the same functions: `guard-publish.mjs` (`prepublishOnly`, the last gate
 * before the registry) and `release-plan.mjs` (GitHub Actions, running the same decision ahead of
 * time). Written separately in both, one would loosen, and the loosened one would be the one that
 * actually publishes.
 *
 * It is plain JavaScript because `prepublishOnly` runs before any build in this repository: the
 * gate must stand even if tsx is not installed or tsdown is broken, since a gate that opens for
 * lack of tooling is the very state it prevents. So all three scripts (policy, gate, plan) are
 * `.mjs` that node reads as-is.
 */

/** The name published to npm; the only package this workspace publishes. */
export const PACKAGE_NAME = "@rowcat/mcp";

/**
 * Prefix of the tag that starts a publish: `mcp-v0.1.0`, not `v0.1.0`. This repository has several
 * apps and several version axes (date versions for releases, mobile SemVer); an unprefixed `v*`
 * cannot say which of them it releases, and the price of that ambiguity is another app's release
 * tag starting an npm publish.
 */
export const RELEASE_TAG_PREFIX = "mcp-v";

/**
 * The only workflow file a publish can come from. npm trusted publishing trusts repository plus
 * this path, so this value is both our check and must equal npm's configuration; a publish step
 * accidentally attached to another workflow is caught here.
 */
export const RELEASE_WORKFLOW = ".github/workflows/mcp-publish.yml";

/** `0.1.0-alpha.1`: the shape the first external versions must take. */
const PRERELEASE = /^\d+\.\d+\.\d+-(?:alpha|beta|rc)\.\d+$/;
/** `0.1.0`: a shape this repository has no policy for yet; see `distTagFor` below. */
const STABLE = /^\d+\.\d+\.\d+$/;

/** The tag name that publishes this version; a tag/`package.json` mismatch does not publish. */
export const releaseTagFor = (version) => `${RELEASE_TAG_PREFIX}${version}`;

/**
 * The repository a publish is allowed from; it comes from here, not from the manifest.
 *
 * It used to come from `manifest.repository.url` to avoid a copy. What broke that is a field that
 * can be cleared: while this code lived in a private repository the public fields stayed empty (npm
 * would have linked to a 404), and clearing them silently made the manifest-derived value `null`, so
 * checks ② and ③ below (repository and workflow comparison) were skipped by their `!== null` guard
 * and a fork's workflow passed the gate. Publishing authority therefore stays a constant even now
 * that the repository is public and the manifest names it too; `identityProblems` checks the two
 * agree instead of deriving one from the other.
 */
export const RELEASE_REPOSITORY = "project-rowcat/rowcat";

/**
 * Whether a public-metadata value names exactly this repository. A substring check would let
 * `project-rowcat/rowcat-fork` pass, so the name has to end at a path, fragment, `.git` or the end.
 */
const namesReleaseRepository = (value) =>
	new RegExp(
		`github\\.com/${RELEASE_REPOSITORY.replace("/", "\\/")}(\\.git)?([/#]|$)`,
		"i",
	).test(value);


/**
 * The dist-tag for this version; stable versions have no answer yet.
 *
 * `0.1.0-alpha.1` gets `next` (not yet validated outside, and `pnpm add @rowcat/mcp` does not pick
 * it); `0.1.0` is refused because publishing to `latest` is a decision this repository has not
 * made. `stable → latest` looks natural, but npm versions are immutable and `latest` is what an
 * option-less install picks up, and this code cannot know the canary was validated outside the
 * repository. So there is no automatic promotion; the day that decision is made, this function
 * gains a branch and that commit also fixes `publishConfig.tag` (`version.test.ts` pins the pair by
 * value).
 */
export function distTagFor(version) {
	if (PRERELEASE.test(version)) return { ok: true, distTag: "next" };
	if (STABLE.test(version))
		return {
			ok: false,
			problem:
				`Version ${version} is stable: this repository has no stable release policy yet.\n` +
				"  Moving to `latest` is a separate decision after the canary is verified outside the repository,\n" +
				"  and when that decision is made, distTagFor in release-policy.mjs gains a branch.",
		};
	return {
		ok: false,
		problem: `Version ${version} is not of the shape MAJOR.MINOR.PATCH[-(alpha|beta|rc).N].`,
	};
}

/**
 * Only one package in this workspace can be published. `pnpm -r publish` sweeps the whole
 * workspace, so relying on which directory the publish runs from would eventually publish
 * `@rowcat/sync` to npm, which cannot be undone; the name is therefore pinned as a value.
 */
export function identityProblems(manifest) {
	const problems = [];
	if (manifest?.name !== PACKAGE_NAME)
		problems.push(
			`The publish target is not ${PACKAGE_NAME}: the manifest's name is ${manifest?.name ?? "(none)"}.`,
		);
	if (manifest?.private === true)
		problems.push("The manifest is private: a package that cannot be published.");
	if (manifest?.publishConfig?.access !== "public")
		problems.push(
			"publishConfig.access is not public: scoped packages default to restricted.",
		);
	/**
	 * The npm page's links name this repository and nowhere else. `repository` is required: npm attaches
	 * provenance to a trusted publish and validates `repository.url` against the repository the
	 * workflow ran in, so an empty or different value fails only at the registry, after every other
	 * gate passed. `bugs` and `homepage` may be absent; present, they name this repository too (they
	 * once held the hosted service's site and support mail, which are gone). Right before publishing is
	 * the last place for this check because npm versions are immutable.
	 */
	const repository =
		typeof manifest?.repository === "string"
			? manifest.repository
			: (manifest?.repository?.url ?? "");
	if (!namesReleaseRepository(repository))
		problems.push(
			`repository does not name ${RELEASE_REPOSITORY} (now ${repository || "(none)"}): npm's provenance check compares it with the publishing repository.`,
		);
	for (const field of ["bugs", "homepage"]) {
		const value = manifest?.[field];
		if (value === undefined) continue;
		const url = typeof value === "string" ? value : (value?.url ?? "");
		if (!namesReleaseRepository(url))
			problems.push(
				`${field} points somewhere other than ${RELEASE_REPOSITORY} (now ${JSON.stringify(value)}): in a public package that cell is a link installers click.`,
			);
	}
	return problems;
}

/**
 * Whether this operation is allowed to publish.
 *
 * ① inside GitHub Actions (blocks the path through a human's shell); ② this repository (a fork's
 * workflow cannot publish this name); ③ this workflow file (blocks publish steps attached to other
 * workflows); ④ started from a tag equal to the version (pushing to main does not publish); ⑤ a
 * version whose dist-tag resolves (`distTagFor` above); ⑥ the right package (`identityProblems`
 * above).
 *
 * This is not a cryptographic boundary: ①-④ are all environment variables a determined person can
 * fill in locally. Real registry authority is still npm's OIDC; this blocks the path developers
 * pass through carelessly, which exists and cannot be undone once taken.
 */
export function checkPublishAuthorization(env, manifest) {
	const problems = [];
	const version = manifest?.version ?? "";

	if (env.GITHUB_ACTIONS !== "true") {
		problems.push(
			"Refused: @rowcat/mcp is published only from GitHub Actions.\n" +
				`  Locally this is as far as it goes: pnpm --filter ${PACKAGE_NAME} build && pnpm --filter ${PACKAGE_NAME} pack:verify\n` +
				`  To publish, push the ${releaseTagFor(version || "<version>")} tag to run ${RELEASE_WORKFLOW}.`,
		);
	} else {
		if (env.GITHUB_REPOSITORY !== RELEASE_REPOSITORY)
			problems.push(
				`The repository differs: this package is published only from ${RELEASE_REPOSITORY} (now ${env.GITHUB_REPOSITORY ?? "(none)"}).`,
			);
		const workflow = env.GITHUB_WORKFLOW_REF ?? "";
		if (!workflow.startsWith(`${RELEASE_REPOSITORY}/${RELEASE_WORKFLOW}@`))
			problems.push(
				`Publishing goes out only from ${RELEASE_WORKFLOW} (now ${workflow || "(none)"}).`,
			);
		if (env.GITHUB_REF_TYPE !== "tag")
			problems.push(
				`Publishing starts from a tag: pushing a branch does not publish (ref_type=${env.GITHUB_REF_TYPE ?? "(none)"}).`,
			);
		else if (env.GITHUB_REF_NAME !== releaseTagFor(version))
			problems.push(
				`The tag and the version disagree: tag ${env.GITHUB_REF_NAME ?? "(none)"} · package.json ${version || "(none)"}\n` +
					`  If the version you mean to publish is right, the tag is ${releaseTagFor(version)}. CI does not rewrite the version.`,
			);
	}

	const tag = distTagFor(version);
	if (!tag.ok) problems.push(tag.problem);
	problems.push(...identityProblems(manifest));

	return tag.ok
		? { ok: problems.length === 0, problems, distTag: tag.distTag }
		: { ok: false, problems };
}
