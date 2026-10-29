/**
 * States what will go where before publishing, and stops there if it does not line up.
 *
 * It runs the same decision as `guard-publish.mjs` (`release-policy.mjs`) from a different spot:
 * this one runs before install and checks, so a mismatched tag/version dies before spending 20
 * minutes; `guard-publish.mjs` runs right before the registry and stands even without this one.
 * This is convenience and that is the boundary: with only this, editing the workflow removes the
 * gate; with only that, a mismatched tag is rejected after every gate has passed.
 *
 * The two entries differ by event, not input: `push(mcp-v*)` publishes (tag must equal version,
 * dist-tag must resolve); `workflow_dispatch` is a rehearsal and does not publish, so it does not
 * ask for the tag pairing. Splitting on an input like `dry-run: true` would make setting it to
 * false by mistake a publish; splitting on the event makes an unintended publish unrepresentable.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	checkPublishAuthorization,
	distTagFor,
	identityProblems,
	releaseTagFor,
	RELEASE_REPOSITORY,
} from "./release-policy.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const say = (line) => {
	process.stderr.write(`${line}\n`);
};

const publishing = process.env.GITHUB_EVENT_NAME === "push";
const tag = distTagFor(manifest.version);

/**
 * A rehearsal does not ask about tag, repository or workflow: those only mean something for a
 * publishing event, and requiring them would make it impossible to rehearse a release from a
 * branch. Identity and dist-tag are asked either way, being facts independent of the event.
 */
const problems = publishing
	? checkPublishAuthorization(process.env, manifest).problems
	: [...identityProblems(manifest), ...(tag.ok ? [] : [tag.problem])];

say("");
say(`  package   ${manifest.name}`);
say(`  version   ${manifest.version}`);
say(`  tag       ${releaseTagFor(manifest.version)}`);
say(`  dist-tag  ${tag.ok ? tag.distTag : "(not determined)"}`);
say(`  repo      ${RELEASE_REPOSITORY}`);
say(`  engines   node ${manifest.engines?.node ?? "(none)"}`);
say(`  bin       ${Object.values(manifest.bin ?? {}).join(", ") || "(none)"}`);
say("");
say(
	publishing
		? `  → this run publishes: pnpm publish --tag ${tag.ok ? tag.distTag : "?"}`
		: "  → this run does not publish (rehearsal). Publishing starts by pushing a tag.",
);
say("");

if (problems.length > 0) {
	for (const problem of problems) say(`✗ ${problem}\n`);
	process.exit(1);
}

/** Keeps later steps from recomputing the dist-tag; computing twice leaves room to diverge. */
if (process.env.GITHUB_OUTPUT !== undefined && tag.ok)
	appendFileSync(
		process.env.GITHUB_OUTPUT,
		`version=${manifest.version}\ndist-tag=${tag.distTag}\npublishing=${publishing}\n`,
	);
