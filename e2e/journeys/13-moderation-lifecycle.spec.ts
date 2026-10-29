import type { BrowserContext, Page } from "@playwright/test";
import {
	apiUrl,
	createAccount,
	E2E_STORY_PATH,
	expect,
	newAccount,
	test,
} from "../support/fixtures.ts";
import {
	executeModerationAction,
	findOpenAppeal,
	findOpenReport,
	promoteToOperator,
	resolveAppeal,
	resolveReport,
} from "../support/operator.ts";

/**
 * Journey 13: moderation. Can a restricted person contest the restriction?
 * - Only a browser can answer this: can a restricted user reach their account screen to appeal?
 *   If the gate on that route (`requireActiveViewer`) were chosen wrongly, the whole screen would
 *   be empty with no error; the appeal control would simply be missing. A server test shows the
 *   route returns 200, not that the screen can be reached.
 * - The other checks also connect layers: reports accepted from the user UI (menu, reason,
 *   submit, the 'my reports' lifecycle); restrictions blocking a real action, not just a badge; an
 *   accepted appeal making the blocked action work again.
 * - Enforcement and reversal per action, the incident/action/appeal invariants, folding of
 *   reporter-facing vocabulary, and notification copy are covered lower down
 *   (apps/api/src/routes/moderation.test.ts; services/moderation.ts; my-reports-state.test.ts;
 *   features/notifications). So only one complete lifecycle is walked here.
 * - The operator side is test scaffolding. The admin console is a separate app and not this
 *   journey's subject, so the journey calls the same API the console calls (`support/operator.ts`).
 *   It neither edits tables directly nor adds journey-only routes.
 */

/**
 * Report reason used by this journey. It is picked from a list, so it is identified by its label.
 */
const REASON = "Harassment or bullying";

/** The comment input on the story page. Its label is hidden, but its accessible name is kept. */
const commentBox = (page: Page) =>
	page.getByRole("textbox", { name: "Write a comment" });

/**
 * Writes one comment. Waits for hydration to finish before typing, because the story page is
 * server-rendered: the input takes a value before React is listening. Once hydration completes,
 * React resets the DOM to its own empty state and the typed text vanishes. The symptom is a submit
 * button that stays disabled forever. Retrying the click does not fix it, since that click only
 * waits. So the awaited signal is 'React received my input', not 'the button was pressed'. A fixed
 * `waitForTimeout` is not used, because the device decides how long to wait.
 *
 * Waits for the server's reply after submitting. Returning on click only means 'sent', but callers
 * then assume the comment is on the server (they look up its id to file a report). If that window
 * is open, the list request can overtake the in-flight POST and get an empty list. This race was
 * actually hit: the trace shows the list fetch leaving 8.7 ms after the POST started. Checking the
 * screen is no substitute either: `getByText(body)` can match a row, or the input that is not yet
 * cleared (it is cleared only after success) still holding the same text.
 *
 * Does not assert success. Callers also use it where the write must fail (the
 * capability-restriction check expects a 403 here). Requiring `ok()` would stop those journeys from
 * using this helper and duplicate the procedure. Waiting and judging are different jobs; the caller
 * judges.
 */
async function writeComment(page: Page, body: string): Promise<void> {
	const submit = page.getByRole("button", { name: "Comment" });
	await expect(async () => {
		await commentBox(page).fill(body, { timeout: 2_000 });
		await expect(submit).toBeEnabled({ timeout: 1_000 });
	}).toPass({ timeout: 30_000 });

	/** Attach this listener **before** pressing. Attaching it afterwards misses a fast response. */
	const settled = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			new URL(response.url()).pathname ===
				"/v2/stories/e2e-story-chat/comments",
	);
	await submit.click();
	await settled;
}

/**
 * All comments saved on this story: what the server knows, not what the screen shows. Read to the
 * end. Reading only the first page makes this helper's name false. Comments are listed oldest first
 * (`(created_at, id)` cursor), and this fixture story has a fixed id that is never deleted, so
 * comments accumulate across runs. The helper would pass the 20th comment and fail from the 21st,
 * while the just-written comment is visible on screen on the last page. The symptom reads as 'not
 * saved'; the cause is that only the first page was read. Do not hide this by raising the page size
 * (`?limit=50`): that only moves the failure. Following the cursor until it is `null` is the list
 * contract (`packages/contracts/src/comments.ts`).
 */
async function storedComments(
	context: BrowserContext,
): Promise<{ id: string; body: string }[]> {
	const items: { id: string; body: string }[] = [];
	let cursor: string | null = null;

	/**
	 * A page cap is set. If the server ever keeps returning the same cursor, this helper would loop
	 * forever and the journey would hang until the timeout instead of failing with a visible cause.
	 */
	for (let page = 0; page < 50; page += 1) {
		const url = new URL(apiUrl("/v2/stories/e2e-story-chat/comments"));
		if (cursor) url.searchParams.set("cursor", cursor);
		const response = await context.request.get(url.toString());
		expect(response.ok(), "couldn't read the comment list").toBe(true);
		const body = (await response.json()) as {
			items: { id: string; body: string }[];
			nextCursor: string | null;
		};
		items.push(...body.items);
		if (!body.nextCursor) return items;
		cursor = body.nextCursor;
	}
	throw new Error(
		"the comment list never ends — the cursor seems not to advance",
	);
}

const commentBodies = async (context: BrowserContext): Promise<string[]> =>
	(await storedComments(context)).map((row) => row.body);

/**
 * The id of this body's comment on this story. The journey must know what a report is attached to.
 */
async function commentIdByBody(
	context: BrowserContext,
	body: string,
): Promise<string> {
	const match = (await storedComments(context)).find(
		(row) => row.body === body,
	);
	expect(match, `couldn't find a comment with that body: ${body}`).toBeTruthy();
	return (match as { id: string }).id;
}

test("from report to restriction, appeal and lifting — the restricted person can contest it on their own screen", async ({
	browser,
}) => {
	const targetAccount = newAccount("modtarget");
	const reporterAccount = newAccount("modreporter");
	const operatorAccount = newAccount("modoperator");

	const target = await browser.newContext();
	const reporter = await browser.newContext();
	const operator = await browser.newContext();

	try {
		await createAccount(target, targetAccount);
		await createAccount(reporter, reporterAccount);
		await createAccount(operator, operatorAccount);
		/**
		 * Promotion goes through the only path the repository recognises (`db:seed:moderator`), not the
		 * product API. A member row must already exist, so this runs after account creation.
		 */
		await promoteToOperator(operatorAccount.email);

		const targetPage = await target.newPage();
		const reporterPage = await reporter.newPage();

		const body = `Reported comment ${Date.now().toString(36)}`;
		await targetPage.goto(E2E_STORY_PATH);
		await writeComment(targetPage, body);
		await expect(targetPage.getByText(body)).toBeVisible();
		const commentId = await commentIdByBody(target, body);

		await reporterPage.goto(E2E_STORY_PATH);
		const row = reporterPage.getByRole("listitem").filter({ hasText: body });
		await expect(row).toBeVisible();

		const dialog = reporterPage.getByRole("dialog");
		/**
		 * The menu opens only after hydration: the markup present when the document arrives has no
		 * handlers, and actionability checks cannot see that difference. The opened menu is the success
		 * signal.
		 */
		await expect(async () => {
			await row
				.getByRole("button", { name: /^Report menu for .*'s post$/ })
				.click({ timeout: 2_000 });
			await reporterPage
				.getByRole("menuitem", { name: "Report" })
				.click({ timeout: 2_000 });
			await expect(dialog).toBeVisible({ timeout: 3_000 });
		}).toPass({ timeout: 30_000 });

		await dialog.getByRole("combobox", { name: "Reason" }).click();
		await reporterPage.getByRole("option", { name: REASON }).click();
		await dialog.getByRole("button", { name: "Report" }).click();
		await expect(
			dialog.getByRole("heading", { name: "Your report was received" }),
		).toBeVisible();
		/**
		 * Two buttons carry this name: the footer's and the dialog's corner X. Both close the dialog, so
		 * the first is pressed rather than telling them apart by markup.
		 */
		await dialog.getByRole("button", { name: "Close" }).first().click();

		/**
		 * Filing creates persistent state. Because the product promises no processing deadline, the
		 * screen can only say `Under review` or `Reviewed`. Keeping that vocabulary
		 * apart from internal dispositions is the point of this area.
		 */
		await reporterPage.goto("/account");
		/**
		 * Finds the row **by its reason**. The account screen shows status words in several places (for
		 * example `Your appeal was received and is under review.`), so searching the whole screen for `Under review` would leave the
		 * assertion unable to say what it confirmed.
		 */
		const myReportRow = reporterPage
			.getByRole("listitem")
			.filter({ hasText: REASON });
		await expect(myReportRow).toContainText("Under review");

		const report = await findOpenReport(operator, commentId);
		const action = await executeModerationAction(operator, {
			caseId: report.caseId,
			kind: "restrict_capability",
			capability: "comment.write",
			reason: "enforcement by the e2e journey",
			publicReason:
				"Commenting is restricted for breaking the community rules.",
		});

		await targetPage.goto("/account");
		await expect(targetPage.getByText("Commenting restricted")).toBeVisible();
		await expect(
			targetPage.getByText(
				"Commenting is restricted for breaking the community rules.",
			),
		).toBeVisible();

		/**
		 * **Do not trust the badge.** Restriction is confirmed only by actually attempting one operation
		 * that must be blocked. A screen drawing the state wrongly and a server letting the action
		 * through are very different defects, and the latter is far more costly.
		 */
		const blocked = `Attempt while restricted ${Date.now().toString(36)}`;
		await targetPage.goto(E2E_STORY_PATH);
		await writeComment(targetPage, blocked);

		/**
		 * The assertion is on the outcome, not the wording. `commentErrorMessage` handles the
		 * `capability_restricted` error in the same branch as `account_restricted`: it says retrying will
		 * not help and points to the account screen. The journey does not lock that sentence down.
		 * Wording boundaries belong to the pure test (`features/story/comments/comment-error.test.ts`),
		 * and a wording change should not break this journey. The journey answers one question: did the
		 * server actually block it? So it checks that an error appeared and that the comment is absent
		 * from the list.
		 */
		await expect(targetPage.getByRole("alert")).toBeVisible();
		/**
		 * Checked against the list. A rejected comment **stays in the input**, since the component's rule
		 * is not to erase what was written. Searching the whole screen would always find one match, and
		 * the assertion would confirm nothing.
		 */
		await expect(
			targetPage.getByRole("listitem").filter({ hasText: blocked }),
		).toHaveCount(0);
		/** Also not on the server: screen and storage are different facts. */
		expect(await commentBodies(target)).not.toContain(blocked);

		/**
		 * This section is why the journey exists. If the gate on `/me/moderation` were
		 * `requireActiveViewer`, the screen would be blank here with no error; the place to appeal would
		 * simply be gone.
		 */
		await targetPage.goto("/account");
		const appealDialog = targetPage.getByRole("dialog");
		await expect(async () => {
			await targetPage
				.getByRole("button", { name: "Appeal" })
				.first()
				.click({ timeout: 2_000 });
			await expect(appealDialog).toBeVisible({ timeout: 3_000 });
		}).toPass({ timeout: 30_000 });

		await appealDialog
			.getByLabel("Appeal")
			.fill("I never broke the rules. Please check again.");
		await appealDialog.getByRole("button", { name: "Appeal" }).click();
		await expect(
			targetPage.getByText("Your appeal was received and is under review."),
		).toBeVisible();

		const appeal = await findOpenAppeal(operator, action.id);
		await resolveAppeal(operator, appeal.id, "accepted");

		await targetPage.goto("/account");
		await expect(targetPage.getByText("Accepted")).toBeVisible();
		await expect(targetPage.getByText("Commenting restricted")).toHaveCount(0);

		/**
		 * Checked by an operation again rather than a status: acceptance must do more than change the
		 * label.
		 */
		const afterBody = `Comment after lifting ${Date.now().toString(36)}`;
		await targetPage.goto(E2E_STORY_PATH);
		await writeComment(targetPage, afterBody);
		await expect(targetPage.getByText(afterBody)).toBeVisible();

		/**
		 * Do not seed a notification row. The line must be created by the appeal-processing transaction,
		 * because that is the only evidence that moderation and notifications are connected.
		 */
		await targetPage.goto("/notifications");
		await expect(
			targetPage.getByText("Your appeal was accepted."),
		).toBeVisible();

		await resolveReport(operator, report.id, "resolved");
		await reporterPage.goto("/account");
		await expect(myReportRow).toContainText("Reviewed");
		await reporterPage.goto("/notifications");
		await expect(
			reporterPage.getByText("We reviewed your report."),
		).toBeVisible();
	} finally {
		await target.close();
		await reporter.close();
		await operator.close();
	}
});
