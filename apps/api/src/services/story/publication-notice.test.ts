import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { StoryVisibility } from "@rowcat/domain";
import { describe, expect, test } from "vitest";
import { enteredPublicVisibility } from "./publication-notice.ts";

/**
 * The new-public-story notification decision, checked without a database. Both failures it guards
 * are silent because the success response looks the same:
 * 1. Republishing an already public story is not an event; otherwise followers gained since
 *    receive an old story as "new" (the ledger's idempotency only covers existing recipients).
 * 2. Unlisted and archived are not destinations.
 */

const VISIBILITIES: readonly StoryVisibility[] = [
	"public",
	"unlisted",
	"private",
	"archived",
];

/** Every origin, including a missing row. */
const ORIGINS: readonly (StoryVisibility | null)[] = [null, ...VISIBILITIES];

describe("did it enter public for the first time", () => {
	test("coming from any non-public state, public is an event", () => {
		for (const before of ORIGINS)
			if (before !== "public")
				expect(enteredPublicVisibility(before, "public"), String(before)).toBe(
					true,
				);
	});

	// `null` (no row) must not fold into "private".
	test("publishing as public where there was no row is an event", () => {
		expect(enteredPublicVisibility(null, "public")).toBe(true);
	});

	// The most important false: fan-out here would deliver an old story as new to later followers.
	test("if it was already public, making it public again isn't an event", () => {
		expect(enteredPublicVisibility("public", "public")).toBe(false);
	});

	test("a non-public destination is not an event from any starting point", () => {
		for (const before of ORIGINS)
			for (const after of VISIBILITIES)
				if (after !== "public")
					expect(
						enteredPublicVisibility(before, after),
						`${String(before)} → ${after}`,
					).toBe(false);
	});

	// Withdrawing, archiving and restoring are not events; pin the table by value.
	test("only four combinations are actually true", () => {
		const truthy = ORIGINS.flatMap((before) =>
			VISIBILITIES.filter((after) =>
				enteredPublicVisibility(before, after),
			).map((after) => `${String(before)}→${after}`),
		);
		expect(truthy).toEqual([
			"null→public",
			"unlisted→public",
			"private→public",
			"archived→public",
		]);
	});
});

const read = (path: string): string =>
	readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("the fan-out is a set", () => {
	// No per-recipient round trips: that would hold the transaction open and make the block check N+1,
	// which never reproduces on a dev account with few followers, so the absence is pinned.
	test("the notification service doesn't pull followers into the application", () => {
		const source = read("../notifications.ts");
		const fanout =
			/export async function notifyFollowersOfSocialEvent\([\s\S]*?\n}\n/.exec(
				source,
			)?.[0];
		expect(fanout, "couldn't find the set fan-out").toBeDefined();
		const body = fanout ?? "";
		// No loop over the follower list. The `.map` relaying `returning` ids to the delivery layer is
		// excepted (it passes already-created rows on), so it is removed before checking.
		const withoutIdRelay = body.replace(
			/result\.rows\.map\(\(row\) => String\(row\.id\)\)/g,
			"",
		);
		for (const forbidden of [
			".map(",
			"for (",
			"forEach",
			"Promise.all",
			"notifySocialEvent(",
		])
			expect(withoutIdRelay, forbidden).not.toContain(forbidden);
		// And it is one statement: `INSERT … SELECT … FROM follow`. The needle is concatenated because
		// lint reads a plain `$` + `{` as a missed template placeholder.
		expect(body).toContain("insert into");
		expect(body).toContain(`from $${"{follow}"}`);
		expect(body).toContain(
			'on conflict ("recipient", "source_key") do nothing',
		);
	});

	// One block predicate shared by the single (`notifySocialEvent`) and set paths; two copies would
	// drift and show up only as "I blocked them but still get their story notifications".
	test("one block predicate", () => {
		const source = read("../notifications.ts");
		const uses = source.match(/blockedActorPredicate\(/g) ?? [];
		// One definition plus two consumers.
		expect(uses).toHaveLength(3);
		expect(source.match(/from \$\{block\}/g) ?? []).toHaveLength(1);
	});

	// The notice service does not choose recipients; follows and blocks are answered in SQL.
	test("the announcement service doesn't know the follow or block tables", () => {
		const source = read("./publication-notice.ts");
		for (const forbidden of ["follow", "block", "push_delivery", "fetch("])
			expect(source, forbidden).not.toContain(forbidden);
	});
});

describe("there are three public paths and all go through the same door", () => {
	// Three paths can write `public`; one that skips this function silently loses notifications.
	test("publish, update and lifecycle transitions all call the announcement function", () => {
		const publication = read("./publication.ts");
		const lifecycle = read("./lifecycle.ts");
		expect(
			publication.match(/notifyFollowersOfNewPublicStory\(/g) ?? [],
			"both first publish and update publish",
		).toHaveLength(2);
		expect(
			lifecycle.match(/notifyFollowersOfNewPublicStory\(/g) ?? [],
			"lifecycle public transition",
		).toHaveLength(1);
	});

	// Unlisted is not in the catalogue; notifying there would announce a story nobody can discover.
	test("unlisted, private, archive and restore transitions don't call the announcement", () => {
		const lifecycle = read("./lifecycle.ts");
		for (const fn of [
			"unlistStory",
			"unpublishStory",
			"archiveStory",
			"restoreStory",
		]) {
			const body = new RegExp(
				`export async function ${fn}\\([\\s\\S]*?\\n}\\n`,
			).exec(lifecycle)?.[0];
			expect(body, fn).toBeDefined();
			expect(body ?? "", fn).not.toContain("notifyFollowersOfNewPublicStory");
		}
	});
});
