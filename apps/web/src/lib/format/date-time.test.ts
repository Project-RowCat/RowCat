import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, PRODUCT_TIME_ZONE } from "./date-time.ts";

/**
 * Statically checks that absolute date formatting passes through one place.
 *
 * The mistake has a constant shape. A new screen that needs a date copies a formatter from a
 * neighboring file that contains a `timeZone: 'Asia/Seoul'` option. Dropping that line still passes
 * types, renders, and tests. The symptom is not an error, just a different date. This happened once
 * in this repo: draft and published times in the workspace were shown in device time.
 *
 * The check guards the policy, not `Intl`'s behavior. The unit tests below check the strings that
 * come out. This scan only asks whether the place that creates date strings is `lib/format` alone
 * (the same rule as `motion/active-indicator.test.ts` and
 * `local-provider/no-credential-access.test.ts`).
 *
 * Number formatting is out of scope. Counts formatted with `toLocaleString` do not depend on the
 * time zone, and including them would turn this scan into a different rule: that screens never call
 * `Intl`.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_SRC = join(HERE, "..", "..");

/** Patterns that create date text. Relative time (`RelativeTimeFormat`) is outside this axis. */
const DATE_FORMATTER =
	/new Intl\.DateTimeFormat\b|\.toLocaleDateString\(|\.toLocaleTimeString\(|new Date\([^)]*\)\.toLocaleString\(/;

/**
 * Locations still outside the rule. This list is meant to shrink to empty.
 *
 * The entries belong to a slice (web payments and guardian consent) being written in parallel with
 * this audit, so they were left untouched. When that slice settles, switch them to `lib/format` and
 * remove them here. Do not widen the list to a directory: listing filenames one by one makes any
 * growth visible.
 *
 * `guardian-consent-page.tsx` currently omits the time zone (its only match is
 * `toLocaleString('ko-KR')`). The entry records an open defect, not an exception.
 */
const PENDING = [join("features", "onboarding", "guardian-consent-page.tsx")];

function sourceFiles(): string[] {
	const files: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === "node_modules") continue;
				walk(full);
				continue;
			}
			if (!/\.tsx?$/.test(entry.name)) continue;
			if (/\.test\.tsx?$/.test(entry.name)) continue;
			if (entry.name === "routeTree.gen.ts") continue;
			files.push(full);
		}
	};
	walk(WEB_SRC);
	return files;
}

/** `lib/format` owns this rule, so its own files are excluded from the scan. */
const isOwner = (rel: string): boolean =>
	rel.startsWith(join("lib", "format") + sep);

describe("lib/format alone owns absolute time formatting", () => {
	it("screens do not build date formatters themselves", () => {
		const offenders = sourceFiles()
			.map((file) => relative(WEB_SRC, file))
			.filter((rel) => !isOwner(rel))
			.filter((rel) => !PENDING.includes(rel))
			.filter((rel) =>
				DATE_FORMATTER.test(readFileSync(join(WEB_SRC, rel), "utf8")),
			);

		expect(offenders).toEqual([]);
	});

	/**
	 * Checks that the pending list points at files that exist. If a file was deleted or already fixed
	 * but its name stays in the list, that entry silently covers the next violation.
	 */
	it("the pending list has no dead names", () => {
		const stale = PENDING.filter(
			(rel) => !DATE_FORMATTER.test(readFileSync(join(WEB_SRC, rel), "utf8")),
		);
		expect(stale).toEqual([]);
	});
});

describe("formatting", () => {
	/**
	 * Checks the claim that the time zone is pinned, through its result. Just after UTC midnight it is
	 * already the next day in KST, so if the time zone were dropped this expectation would fail first.
	 */
	it("formats in the product time zone, not UTC", () => {
		expect(PRODUCT_TIME_ZONE).toBe("Asia/Seoul");
		expect(formatDate("2026-08-20T15:30:00.000Z")).toBe("August 21, 2026");
		expect(formatDateTime("2026-08-20T15:30:00.000Z")).toContain(
			"August 21, 2026",
		);
	});

	it("an unreadable value is an empty string", () => {
		expect(formatDate("around yesterday")).toBe("");
		expect(formatDateTime("")).toBe("");
	});
});
