import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Static scan of the background-job boundaries. Everything locked here breaks without a compile
 * error or a red test:
 *
 * ```text
 * request path imports the scheduler   → one import turns on destruction jobs
 * job re-implements a domain rule      → "different conclusion only when run by the scheduler"
 * job makes its own timer              → an execution path that skips locking, shutdown, isolation
 * job re-reads the clock               → the cutoff drifts per batch
 * job builds an HTTP surface           → an address that can start destruction from outside
 * ```
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));
const JOBS = join(SRC, "jobs");

function filesIn(dir: string, found: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			if (entry === "test") continue;
			filesIn(full, found);
		} else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
			found.push(full);
	}
	return found;
}

const read = (file: string): string => readFileSync(file, "utf8");

/**
 * Source with comments stripped. The scans ask whether a name appears in code, and those names also
 * appear in comments (explaining why they are not called); counting comments would make explaining
 * a rule a violation, and the next person would delete the explanation.
 */
const code = (file: string): string =>
	read(file)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The names in `import { A, B } from "..."`; string literals never reach here. */
function importedNames(file: string): string {
	const source = code(file);
	return [...source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from/g)]
		.map((m) => m[1])
		.join(" ");
}

const rel = (file: string): string => file.slice(SRC.length);

/** All job infrastructure (runner, scheduler, lock included). */
const jobFiles = filesIn(JOBS);
/** Domain job implementations only; infrastructure follows different rules. */
const jobImplementations = jobFiles.filter((f) =>
	/\/(media|legal|push)\//.test(f),
);

describe("the job files actually exist", () => {
	test("the set to scan is not empty", () => {
		expect(jobFiles.length).toBeGreaterThan(6);
		expect(jobImplementations.length).toBeGreaterThanOrEqual(3);
	});
});

describe("the request path does not know the scheduler", () => {
	/** Only the server entry (`index.ts`) and the jobs folder are exempt. */
	const outside = [
		...filesIn(join(SRC, "routes")),
		...filesIn(join(SRC, "services")),
		...filesIn(join(SRC, "middleware")),
		...filesIn(join(SRC, "auth")),
		join(SRC, "app.ts"),
	];

	test("routes, services, middleware and the app do not import `jobs/`", () => {
		const violations = outside.filter((file) =>
			/from\s+"[^"]*\/jobs\/[^"]+"/.test(read(file)),
		);
		expect(violations.map(rel)).toEqual([]);
	});

	test("`index.ts` is the only place that starts the scheduler", () => {
		const starters = [
			...outside,
			...filesIn(SRC).filter((f) => !f.startsWith(JOBS)),
		]
			.filter((file) => read(file).includes("startBackgroundJobs("))
			.map(rel);
		expect(new Set(starters)).toEqual(new Set(["index.ts"]));
	});

	test("the jobs folder has no HTTP surface", () => {
		const violations = jobFiles.filter((file) =>
			/new Hono|from "hono/.test(code(file)),
		);
		expect(violations.map(rel)).toEqual([]);
	});
});

describe("jobs do not re-implement domain rules", () => {
	test("the push job knows neither the provider nor the state machine", () => {
		const source = code(join(JOBS, "push", "deliver-push.ts"));
		/** The adapter finishes the provider surface; the job does not even know its names. */
		expect(source).not.toMatch(/exp\.host|expo-server-sdk|ExpoPushToken/i);
		/** State vocabulary, lifetime and backoff belong to the service. */
		expect(source).not.toMatch(/push_delivery|push_registration|db\.update/);
		expect(source).not.toMatch(/'accepted'|"accepted"|TTL|backoff/);
		/** The job never holds a token, so there is no place for it to leak into logs. */
		expect(source).not.toMatch(/\btoken\b/);
	});

	test("the media job does not call storage directly", () => {
		const source = code(join(JOBS, "media", "cleanup-orphans.ts"));
		/**
		 * The bytes-first, row-second order lives inside `purgeMedia`. Calling the store here would write
		 * that order a second time, and a reversed copy creates orphans that can never be found.
		 */
		expect(source).not.toMatch(/media_blob|resolveMediaStore|store\.delete/);
	});

	test("job implementations do not grab `db` directly — retention destruction is the only exception", () => {
		const violations = jobImplementations
			.filter((file) => /from\s+"[^"]*db\/client\.ts"/.test(code(file)))
			.map(rel);
		/**
		 * Retention destruction is the exception: its targets are tables with no domain service (auth
		 * tokens, sessions, relay), and a service just for them would put the destruction predicates in
		 * two places. The predicates sit in one registry file.
		 */
		expect(violations).toEqual(["jobs/legal/cleanup-expired-retention.ts"]);
	});
});

describe("time and timers have one owner", () => {
	test("job implementations have no `new Date()` — the context's clock gives the time", () => {
		const violations = jobImplementations
			.filter((file) => /new Date\(\s*\)/.test(code(file)))
			.map(rel);
		expect(violations).toEqual([]);
	});

	test("job implementations have no `Date.now()`", () => {
		const violations = jobImplementations
			.filter((file) => /Date\.now\(\)/.test(code(file)))
			.map(rel);
		expect(violations).toEqual([]);
	});

	test("the scheduler is the only place that creates timers", () => {
		const violations = jobFiles
			.filter((file) => /setInterval\(|setTimeout\(/.test(code(file)))
			.map(rel);
		expect(violations).toEqual(["jobs/scheduler.ts"]);
	});
});

describe("the retention registry does not know the unresolved categories", () => {
	test("there is no predicate deleting member rows — deleting long-dormant accounts is not expiry", () => {
		expect(
			importedNames(join(JOBS, "legal", "retention-policies.ts")),
		).not.toMatch(/\bmember\b/);
	});
});

describe("a manual run is a process, not a route", () => {
	test("there is no HTTP path that runs a job", () => {
		const routes = filesIn(join(SRC, "routes"));
		const violations = routes
			.filter((file) =>
				/runJob|backgroundJobs|inspectRetention/.test(code(file)),
			)
			.map(rel);
		expect(violations).toEqual([]);
	});

	test("the CLI takes no cutoff as an argument", () => {
		const source = code(join(JOBS, "cli.ts"));
		/**
		 * The only choices are which job to run now and whether to count instead of destroy. Accepting a
		 * cutoff would make this a tool that can express "delete the next 100 years' worth now".
		 */
		expect(source).not.toMatch(/--cutoff|--before|--since|--limit/);
	});
});
