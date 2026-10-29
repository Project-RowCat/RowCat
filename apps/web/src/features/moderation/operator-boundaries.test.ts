import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Guards statically that the operations UI is absent from this app.
 * - Boundary: reporting, appeals, my-reports and sanctions stay in apps/web. The queue, evidence
 *   review, enforcement and appeal handling live in apps/admin. The moderation domain and endpoints
 *   (/v2/moderation/*) are shared.
 * - The concern is drift, not duplication. Both apps once drew the same queue; reliability fixes
 *   (offline handling, stale values, retry of stalled queries) landed only in the console, and the
 *   web's operator screens quietly fell behind. Both still called the same API, so nothing failed
 *   and no test caught it.
 * - Matched by operator-only operations, not by the word "moderation". Banning the word would
 *   also block the report dialog, appeal form, my-reports and sanctions section, which are product
 *   features. The boundary follows who performs the action: users report, appeal and view their
 *   status here; operators review, enforce and handle appeals in the console.
 * - This does not enforce authorization. The server remains authoritative
 *   (requireModeratorViewer). The test guards UI ownership; the web app not calling operator
 *   queries is an architectural property, not a security one.
 */

const WEB_SRC = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Comments are not inspected. This folder's comments describe exactly the forbidden operations, so
 * they would match.
 */
const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

/** All sources under apps/web/src, excluding tests and generated files. */
function webSources(): { path: string; body: string }[] {
	const out: { path: string; body: string }[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir).sort()) {
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) {
				walk(full);
				continue;
			}
			if (!/\.tsx?$/.test(entry)) continue;
			if (entry.includes(".test.")) continue;
			/**
			 * Declaration files are skipped: they describe types and execute nothing. A `.d.ts` that
			 * declares environment variable types does not read them, and the test asks what the source
			 * does.
			 */
			if (entry.endsWith(".d.ts")) continue;
			/**
			 * The generated route tree is skipped here. The router regenerates it, and it is checked
			 * separately below.
			 */
			if (entry === "routeTree.gen.ts") continue;
			out.push({
				path: full.slice(WEB_SRC.length),
				body: stripComments(readFileSync(full, "utf8")),
			});
		}
	};
	walk(WEB_SRC);
	return out;
}

describe("the web has no operator moderation UI", () => {
	const files = webSources();

	test("the files to scan exist", () => {
		/**
		 * The most dangerous failure mode of this test is passing while scanning zero files, which a
		 * changed path would cause. The count assertion guards against it.
		 */
		expect(files.length).toBeGreaterThan(100);
	});

	/**
	 * No operations console route exists. The file tree and the generated route tree are both checked,
	 * since either alone has an escape: files miss routes registered in code, and the tree alone
	 * passes a commit where the generator was not run. Redirect-only stubs are blocked too: a
	 * compatibility shell route is tempting, but the canonical operations UI is another app and there
	 * is nowhere in this app to redirect to.
	 */
	test("there is no `/(app)/moderation` route", () => {
		expect(existsSync(join(WEB_SRC, "routes/(app)/moderation"))).toBe(false);

		const tree = readFileSync(join(WEB_SRC, "routeTree.gen.ts"), "utf8");
		expect(tree.includes("/moderation")).toBe(false);
	});

	/**
	 * Operator-only queries are not called by the web app. These three resources sit behind
	 * requireModeratorViewer and render the queue, the appeal queue and report details; if the web app
	 * calls them again, that screen has returned. @rowcat/query keeps these options on purpose, since
	 * the package is UI-neutral and the console uses the same functions. Cache keys must not diverge,
	 * or a report handled in one place would linger in the other's list.
	 */
	test("does not consume operator queue queries", () => {
		/**
		 * Matches queue and appeal lists by stem (moderationQueue, moderationAppeals). Those lists became
		 * infinite queries and their names changed to …InfiniteQueryOptions. An unchanged list of old
		 * full names would have stopped matching anything, while a stem also covers the next rename.
		 */
		const forbidden = [
			"moderationQueue",
			"moderationAppeals",
			"moderationReportQueryOptions",
		];
		const offences: string[] = [];
		for (const { path, body } of files)
			for (const needle of forbidden)
				if (body.includes(needle)) offences.push(`${path}: ${needle}`);
		expect(offences).toEqual([]);
	});

	/**
	 * The web does not call enforcement, closing or appeal handling. The SDK's moderation resource
	 * holds both audiences in one object (see the table in packages/sdk/src/moderation.ts), and they
	 * differ by method name. The four blocked here are the operator side.
	 * client.moderation.report(...), myStatus(), myReports() and appeal() are not blocked: users
	 * invoke them under their own name, so they belong to this app.
	 */
	test("does not call operator operations", () => {
		const forbidden = [
			"moderation.act",
			"moderation.queue",
			"moderation.appeals",
			"moderation.resolveReport",
			"moderation.resolveAppeal",
		];
		const offences: string[] = [];
		for (const { path, body } of files)
			for (const needle of forbidden)
				if (body.includes(needle)) offences.push(`${path}: ${needle}`);
		expect(offences).toEqual([]);
	});

	/**
	 * Checks the other side too: removing the operations UI must not take user features with it. A
	 * guard only for the forbidden side would pass a change that deletes reporting, appeals and
	 * my-reports together. That loss is costly, since users lose the ability to report, and the
	 * symptom, a missing menu item, is silent.
	 */
	test("consumer moderation features remain", () => {
		const here = fileURLToPath(new URL(".", import.meta.url));
		const kept = [
			"report-dialog.tsx",
			"report-menu.tsx",
			"report-error.ts",
			"appeal-dialog.tsx",
			"my-reports-section.tsx",
			"my-reports-state.ts",
			"account-moderation-section.tsx",
			"ai-evidence.ts",
		];
		expect(kept.filter((name) => !existsSync(join(here, name)))).toEqual([]);

		/** Confirms the actions are actually wired, not only that the files exist. */
		const consumerCalls = ["moderation.report(", "moderation.appeal("];
		for (const needle of consumerCalls)
			expect(files.some(({ body }) => body.includes(needle))).toBe(true);
	});

	/**
	 * The operations-tool link must point at the configured console origin. The most plausible
	 * regression is a return to the router's Link: it resolves the absolute address inside its own
	 * tree, renders a 404, and the types still pass. The address is pinned to one source
	 * (lib/admin-console.ts); if the screen read import.meta.env.VITE_ADMIN_ORIGIN directly, the
	 * unset-state behavior would differ between places.
	 */
	test("the operator tools link address comes from admin-console.ts alone", () => {
		const here = fileURLToPath(new URL(".", import.meta.url));
		const section = stripComments(
			readFileSync(join(here, "account-moderation-section.tsx"), "utf8"),
		);
		expect(section).toContain("ADMIN_CONSOLE_ORIGIN");
		expect(section).not.toContain('to="/moderation"');

		const readers = files.filter(
			({ path, body }) =>
				path !== "lib/admin-console.ts" && body.includes("VITE_ADMIN_ORIGIN"),
		);
		expect(readers.map(({ path }) => path)).toEqual([]);
	});
});
