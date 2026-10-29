import {
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
 * Narrow screen (375px): checks only what the width actually changes, not the whole journey.
 * Running it at two widths doubles the time and catches the same defects.
 * - Navigation: the fixed sidebar becomes a left drawer opened by the header trigger.
 * - Row actions: five icons collapse into one overflow menu (the icon row hides below `sm`).
 * - Composer: uses the full screen width without pushing the conversation aside. The
 *   no-horizontal-scroll assertion matters most. One long unbroken word can push the page sideways,
 *   and the wide layout never shows that.
 */

test("on a narrow screen you can send, reach row actions and reach navigation", async ({
	page,
	context,
}) => {
	const account = newAccount("narrow");
	await createAccount(context, account);

	await scriptGeneration(page, {
		chunks: ["A narrow-screen reply."],
		ending: { kind: "done" },
	});
	await startChatFromStory(page);

	await expect(ui.composer(page)).toBeEnabled();
	await sendMessage(page, "Sending from a narrow screen");
	await expect(page.getByText("A narrow-screen reply.")).toBeVisible();
	/**
	 * After sending, the composer and send button must stay in the viewport. The conversation must not
	 * push them out of view.
	 */
	await expect(ui.composer(page)).toBeInViewport();
	await expect(ui.send(page)).toBeInViewport();

	/**
	 * The icon row hides below `sm`, so at this width the only way to reach row actions is one menu.
	 * If that path is blocked, narrow-screen users cannot edit or delete at all.
	 */
	await page.getByRole("button", { name: "Reply menu" }).first().click();
	await expect(
		page.getByRole("menuitem", { name: "Regenerate" }),
	).toBeVisible();
	await expect(
		page.getByRole("menuitem", { name: "Delete from here" }),
	).toBeVisible();
	await page.keyboard.press("Escape");

	/**
	 * The fixed sidebar is absent at this width. The same navigation content goes into the drawer
	 * instead, so the app does not keep two copies of it.
	 */
	await page.getByRole("button", { name: "Open main navigation" }).click();
	const drawer = page.getByRole("dialog");
	await expect(drawer.getByRole("link", { name: "Discover" })).toBeVisible();
	await expect(
		drawer.getByRole("link", { name: "All conversations" }),
	).toBeVisible();
	await page.keyboard.press("Escape");

	/**
	 * An unbroken long string is the most common cause of horizontal overflow on narrow screens. When
	 * the page scrolls sideways, the bubble, the header and the composer all shift together.
	 */
	await scriptGeneration(page, {
		chunks: ["A".repeat(400)],
		ending: { kind: "done" },
	});
	await sendMessage(page, "\uac00".repeat(200));
	await expect(page.getByText("A".repeat(400))).toBeVisible();

	const overflow = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	}));
	expect(
		overflow.scrollWidth,
		`horizontal scroll appeared: ${overflow.scrollWidth} > ${overflow.clientWidth}`,
	).toBeLessThanOrEqual(overflow.clientWidth);
});
