import type { Locator, Page } from "@playwright/test";
import {
	createAccount,
	expect,
	newAccount,
	test,
} from "../support/fixtures.ts";

/**
 * Journey 22: a `Story test` (story playtest) opened from a runtime-enabled draft runs the code.
 *
 * The reason is a defect. While `Story test` only drew the conversation, the screen it opened from a
 * runtime-enabled draft was an empty conversation with no opening and no prompt. Turning on the
 * runtime locks four conversation fields (`resolveConversationAuthoringMode`), so there was nothing
 * to render. Nothing failed, so there was no error and no failing test.
 *
 * Pure tests (wiring in `runtime-playtest-branch.test.ts`, the reconciler and renderer in their
 * packages) are not repeated here. This journey adds the axis that needs a browser: the creator's
 * code actually runs and renders in the full-screen view opened from the editor button.
 *
 * Unlike journey 18, which checks the studio's preview panel, this checks a full-screen view opened
 * without the code editor. Both use the same hook, worker and surface, but from different places.
 */

/** Text inside the shadow root. Playwright locators pierce shadow DOM boundaries. */
const surface = (page: Page): Locator =>
	page.getByTestId("runtime-preview-surface");

test("a story test of a runtime draft runs the code and draws the screen", async ({
	page,
	context,
}) => {
	/**
	 * The worker chunk (TypeScript compiler + WASM, several MB) is transformed by the dev server on
	 * request and sent down. The wait ends not on time but on the renderer drawing the first glyph.
	 */
	test.setTimeout(240_000);
	const account = newAccount("journey22");
	await createAccount(context, account);

	await page.goto("/create");
	const create = page.getByRole("button", { name: /^New story/ });
	const DRAFT_URL = /\/create\/[^/]+$/;
	/** A click before hydration is silently ignored, so retry until the URL changes. */
	await expect(async () => {
		if (!DRAFT_URL.test(page.url()))
			await create.first().click({ timeout: 2_000 });
		await page.waitForURL(DRAFT_URL, { timeout: 10_000 });
	}).toPass({ timeout: 60_000 });

	const enable = page.getByRole("button", { name: "Get started", exact: true });
	await expect(enable).toBeVisible({ timeout: 30_000 });
	await enable.click();

	/**
	 * Picks `Blank`. The gallery's first selection is the recommended template (flagship, over thirty
	 * files). This journey asks whether code runs on that screen, not about templates.
	 */
	const dialog = page.getByRole("dialog");
	const blank = dialog.getByRole("button", { name: /^Blank/ });
	await expect(blank).toBeVisible({ timeout: 15_000 });
	await blank.click();
	const confirm = dialog.getByRole("button", { name: /^Start with / });
	await expect(confirm).toBeEnabled({ timeout: 15_000 });
	await confirm.click();

	const STUDIO_URL = /\/create\/[^/]+\/runtime$/;
	await expect(async () => {
		if (!STUDIO_URL.test(page.url()))
			await page
				.getByRole("link", { name: "Open studio" })
				.click({ timeout: 3_000 });
		await page.waitForURL(STUDIO_URL, { timeout: 10_000 });
	}).toPass({ timeout: 45_000 });

	/**
	 * The entry is in the studio header. It is the same component as the editor's and passes through
	 * the same order function, which flushes pending saves first. The wait is long because Monaco and
	 * the preview worker load before the header arrives.
	 */
	const openPlaytest = page.getByRole("button", { name: "Story test" });
	await expect(openPlaytest).toBeVisible({ timeout: 120_000 });
	const TEST_URL = /\/create\/[^/]+\/test$/;
	await expect(async () => {
		if (!TEST_URL.test(page.url()))
			await openPlaytest.click({ timeout: 3_000 });
		await page.waitForURL(TEST_URL, { timeout: 10_000 });
	}).toPass({ timeout: 45_000 });

	/**
	 * Not the conversation screen. This assertion is the core of the journey. While the defect was
	 * alive, what stood here was an input box and an empty conversation.
	 */
	await expect(page.getByPlaceholder("Type a message")).toHaveCount(0);

	const run = page.getByRole("button", { name: "Run", exact: true });
	await expect(run).toBeEnabled({ timeout: 60_000 });
	await run.click();

	/**
	 * The signal to wait for is not time but the first glyph drawn by the renderer (the sentence from
	 * the `Blank` template).
	 */
	await expect(surface(page).getByText("Hello, RowCat!")).toBeVisible({
		timeout: 120_000,
	});

	/**
	 * The renderer draws inside the shadow root, not in React's tree. The container having no direct
	 * children observes that boundary.
	 */
	const lightChildren = await surface(page).evaluate(
		(element) => element.childNodes.length,
	);
	expect(lightChildren).toBe(0);

	await page.getByRole("button", { name: "Stop" }).click();
	await expect(run).toBeVisible({ timeout: 15_000 });
	await expect(surface(page).getByText("Hello, RowCat!")).toHaveCount(0);
});
