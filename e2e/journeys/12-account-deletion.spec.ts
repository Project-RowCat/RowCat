import type { Page } from "@playwright/test";
import {
	apiUrl,
	createAccount,
	expect,
	newAccount,
	scriptGeneration,
	sendMessage,
	startChatFromStory,
	test,
	ui,
} from "../support/fixtures.ts";

/**
 * Journey 12: account deletion. The server account and this browser's private data must be removed
 * together. Deletion is the only irreversible operation in this repo, and it spans two stores with
 * opposite properties:
 * - server: the Better Auth user and everything under it (`/v2/auth/delete-user`)
 * - device: the per-member IndexedDB of conversations, drafts, keys and preferences
 *   (`deleteLocalDbForViewer`) Each layer has its own tests (`services/account/deletion.ts`,
 *   `lib/local-data/purge.test.ts`). None of them checks that the on-screen button joins the two,
 *   since the dialog, password, ordering, cleanup and navigation run in one browser-side hook. The
 *   journey must fail if local data is gone but the server account remains (a 'clear local data'
 *   disguised as deletion), or if the server account is gone but device data remains (a handed-over
 *   device keeps old conversations). So it does not judge by an empty sidebar. It reads the storage
 *   directly, because the screen also looks empty when the scope merely drops to guest.
 */

/** Whether this browser still has the member's database. Database names differ per member. */
const localDbExists = (page: Page, viewerId: string): Promise<boolean> =>
	page.evaluate(async (id) => {
		const names = await indexedDB.databases();
		return names.some((entry) => entry.name === `rowcat_chat_${id}`);
	}, viewerId);

test("deleting the account removes the server account and this device's private data together", async ({
	page,
	context,
}) => {
	const account = newAccount("delete");
	await createAccount(context, account);

	const viewerId = (await (await context.request.get(apiUrl("/v2/me"))).json())
		.id as string;
	expect(viewerId, "couldn't read the viewer id").toBeTruthy();

	/**
	 * One conversation turn is enough. The journey needs private data that exists only in this
	 * browser. Rooms and messages are exactly that, since the server has no room-list endpoint.
	 */
	await scriptGeneration(page, {
		chunks: ["An answer that will be erased."],
		ending: { kind: "done" },
	});
	const roomId = await startChatFromStory(page);
	await sendMessage(page, "A secret message that will be erased");
	await expect(page.getByText("An answer that will be erased.")).toBeVisible();

	expect(
		await localDbExists(page, viewerId),
		"this member's local database must exist before deletion",
	).toBe(true);

	await page.goto("/account");

	const dialog = page.getByRole("dialog");
	/**
	 * Click, then keep clicking until the dialog appears. This is due to hydration, not lazy retry.
	 * The account screen is server-rendered, so the button is visible and clickable as soon as the
	 * document arrives, but React's handler is not attached yet. Playwright's actionability check
	 * cannot see that difference, so the click silently does nothing (`startChatFromStory` has the
	 * same shape for the same reason). The dialog opening is the success signal, so wait for it
	 * directly. The trigger only sets state, so pressing twice does not open two dialogs.
	 */
	await expect(async () => {
		await page
			.getByRole("button", { name: "Delete account" })
			.first()
			.click({ timeout: 2_000 });
		await expect(dialog).toBeVisible({ timeout: 3_000 });
	}).toPass({ timeout: 30_000 });

	await expect(
		dialog.getByRole("heading", { name: "Delete your account?" }),
	).toBeVisible();
	/**
	 * States irreversibility and **what disappears**. The full wording is not copied here (that
	 * is the pure test's job); only the minimum that separates this from logout is checked. If the
	 * dialog looked like an ordinary action, users would click through without reading.
	 */
	await expect(dialog).toContainText("This can't be undone.");
	await expect(dialog).toContainText("Your account and sign-in details");
	await expect(dialog).toContainText(
		"Conversations and drafts saved on this device",
	);

	await dialog.getByLabel("Current password").fill(account.password);
	await dialog.getByRole("button", { name: "Delete account" }).click();

	/**
	 * After cleanup the app leaves for the login screen with `replace`, so back navigation cannot
	 * return to the deleted account's screen. It waits for that navigation instead of an arbitrary
	 * delay.
	 */
	await page.waitForURL(/\/login/, { timeout: 30_000 });

	/**
	 * This assertion is why the journey lives in Playwright. Deleting the database can be delayed
	 * while another connection holds it, so the check re-polls until the value settles. It waits on
	 * the fact itself rather than an arbitrary `waitForTimeout`.
	 */
	await expect
		.poll(() => localDbExists(page, viewerId), { timeout: 15_000 })
		.toBe(false);

	/**
	 * Knowing the address does not bring the content back. Local data is the source of truth, so this
	 * screen must have nothing left to draw.
	 */
	await page.goto(`/chat/${roomId}`);
	await expect(
		page.getByText("A secret message that will be erased"),
	).toHaveCount(0);
	await expect(page.getByText("An answer that will be erased.")).toHaveCount(0);

	/**
	 * This is why the query cache is cleared by **reset, not invalidation**. Invalidation alone would
	 * leave the stored value in place, so the deleted account's nickname and email would keep
	 * rendering until the refetch finishes.
	 */
	await page.goto("/");
	await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
	await expect(page.getByRole("button", { name: /account menu$/ })).toHaveCount(
		0,
	);
	await expect(page.getByText(account.name)).toHaveCount(0);
	await expect(page.getByText(account.email)).toHaveCount(0);

	/**
	 * **Both sides are checked.** Checking only locally lets a 'clear local data' that imitates
	 * deletion pass; checking only the server misses conversations left on the device.
	 */
	const reauth = await context.request.post(apiUrl("/v2/auth/sign-in/email"), {
		data: { email: account.email, password: account.password },
	});
	expect(reauth.ok(), "a deleted account must not sign in again").toBe(false);

	const me = await context.request.get(apiUrl("/v2/me"));
	expect(await me.json()).toBeNull();

	/** The account screen also stays closed: the router redirects to login. */
	await page.goto("/account");
	await page.waitForURL(/\/login/);
	await expect(ui.accountMenu(page)).toHaveCount(0);
});
