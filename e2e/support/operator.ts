import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { apiUrl, expect } from "./fixtures.ts";

/**
 * Sets up a trusted operator as setup for the moderation journey. The operator is not the thing
 * under test.
 *
 * The moderation journey checks the user side: whether a report is accepted in the UI, whether a
 * restriction actually blocks abilities, whether a restricted person can appeal, and whether an
 * accepted appeal reverses that action. Watching an operator work through the queue does not change
 * those answers, so instead of opening the operator console, this calls the same API the console
 * calls.
 *
 * Two rules follow:
 * - Tables are not edited directly. Inserting into `moderation_action` would skip state
 *   recalculation, notifications and the appealable list, and the journey would go green on a
 *   broken state.
 * - No journey-only route is added. A public bypass on the operator surface would become the most
 *   costly vulnerability in this repository.
 *
 * Promotion is a script because no product API changes `member.role`. If such a route existed under
 * /me, anyone could make themselves an operator on the day it shipped. The only sanctioned path is
 * `db:seed:moderator`, and the journey uses that path rather than adding a second one.
 */

const run = promisify(execFile);

/**
 * Gives an operator role to an account that already exists.
 *
 * The script does not create accounts; it refuses to run when no member row exists. Callers must
 * therefore create the member first with `createAccount`. That ordering expresses that promotion
 * only changes a column on an existing account.
 */
export async function promoteToOperator(email: string): Promise<void> {
	const { stdout, stderr } = await run(
		"pnpm",
		["--filter", "@rowcat/api", "db:seed:moderator", email, "staff"],
		/**
		 * Playwright compiles journey code to CJS, so there is no `import.meta` and `__dirname` exists.
		 * `playwright.config.ts` uses the same value for the same reason.
		 */
		{ cwd: resolve(__dirname, "../..") },
	);
	expect(
		`${stdout}${stderr}`,
		`couldn't grant the operator role: ${stdout}${stderr}`,
	).not.toMatch(
		/seed-moderator]\s(no account for that email|the account exists but|unknown role)/,
	);
}

const asRequest = (context: BrowserContext): APIRequestContext =>
	context.request;

/** One queued report. Only the fields this journey uses are declared. */
interface QueuedReport {
	id: string;
	caseId: string;
	targetType: string;
	targetId: string | null;
	reason: string;
}

/**
 * Finds this target's report in the open report queue.
 *
 * The first row is not simply taken, for isolation. The database holds reports from other journeys
 * and from development, so taking the first row would sanction someone else's case, and the journey
 * would pass without knowing what it sanctioned.
 *
 * Follow the cursor to the end. The queue is oldest-first, so a report filed just now sits on the
 * last page. Looking only at the first page would silently break this journey once more than 25
 * reports pile up, and the development database reaches that point.
 */
export async function findOpenReport(
	context: BrowserContext,
	targetId: string,
): Promise<QueuedReport> {
	let cursor = "";
	for (let page = 0; page < 50; page++) {
		const response = await asRequest(context).get(
			apiUrl(
				`/v2/moderation/reports?status=open&targetType=comment${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
			),
		);
		expect(
			response.ok(),
			`couldn't read the report queue: ${response.status()} ${await response.text()}`,
		).toBe(true);
		const body = (await response.json()) as {
			items: QueuedReport[];
			nextCursor: string | null;
		};
		const match = body.items.find((row) => row.targetId === targetId);
		if (match) return match;
		if (!body.nextCursor) break;
		cursor = body.nextCursor;
	}
	throw new Error(`couldn't find a report for target ${targetId} in the queue`);
}

/**
 * Executes a moderation action through the operator API's only write path, as is.
 *
 * The target is not passed as an argument. What to execute is derived by the server from the case
 * (`resolveCaseMember`), and that fact is visible in this helper too. If a member id could be
 * passed, the journey could express 'sanctions a member unrelated to the case under review'.
 */
export async function executeModerationAction(
	context: BrowserContext,
	body: {
		caseId: string;
		kind: string;
		reason: string;
		publicReason?: string;
		capability?: string;
	},
): Promise<{ id: string }> {
	const response = await asRequest(context).post(
		apiUrl("/v2/moderation/actions"),
		{ data: body },
	);
	expect(
		response.ok(),
		`couldn't execute the action: ${response.status()} ${await response.text()}`,
	).toBe(true);
	return (await response.json()) as { id: string };
}

/**
 * Resolves a report. This is the only transition that sends the `Reviewed`
 * notification to the reporter.
 */
export async function resolveReport(
	context: BrowserContext,
	reportId: string,
	status: "resolved" | "dismissed",
): Promise<void> {
	const response = await asRequest(context).post(
		apiUrl(`/v2/moderation/reports/${reportId}/resolve`),
		{ data: { status, note: "e2e" } },
	);
	expect(
		response.ok(),
		`couldn't close the report: ${response.status()} ${await response.text()}`,
	).toBe(true);
}

/**
 * One open appeal, selected for that action only. It follows the cursor like the report queue does,
 * since the list is oldest-first and the development database holds past appeals.
 */
export async function findOpenAppeal(
	context: BrowserContext,
	actionId: string,
): Promise<{ id: string }> {
	let cursor = "";
	for (let page = 0; page < 50; page++) {
		const response = await asRequest(context).get(
			apiUrl(
				`/v2/moderation/appeals?status=open${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
			),
		);
		expect(
			response.ok(),
			`couldn't read the appeal queue: ${response.status()} ${await response.text()}`,
		).toBe(true);
		const body = (await response.json()) as {
			items: { id: string; actionId: string }[];
			nextCursor: string | null;
		};
		const match = body.items.find((row) => row.actionId === actionId);
		if (match) return match;
		if (!body.nextCursor) break;
		cursor = body.nextCursor;
	}
	throw new Error(`no open appeal for that action (${actionId})`);
}

/**
 * Handles an appeal. Accepting actually runs the reversal.
 *
 * That the server has no route which only changes a status is one of the things this journey
 * verifies.
 */
export async function resolveAppeal(
	context: BrowserContext,
	appealId: string,
	status: "accepted" | "rejected",
): Promise<void> {
	const response = await asRequest(context).post(
		apiUrl(`/v2/moderation/appeals/${appealId}/resolve`),
		{ data: { status, note: "e2e" } },
	);
	expect(
		response.ok(),
		`couldn't resolve the appeal: ${response.status()} ${await response.text()}`,
	).toBe(true);
}
