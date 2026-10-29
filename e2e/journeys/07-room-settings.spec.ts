import {
	createAccount,
	expect,
	newAccount,
	startChatFromStory,
	test,
	ui,
} from "../support/fixtures.ts";

/**
 * Journey 7: generation settings precedence is room > global > product default.
 *
 * The resolution is a pure function (`resolveEffectiveGeneration` in @rowcat/chat) already covered
 * by unit tests. This journey adds one thing: the two screens must read the same authority. Global
 * and conversation settings pass through different store windows, so if one screen kept its own
 * copy, the rule would stay correct while the screens drifted apart. That only shows when moving
 * between them.
 *
 * The key axis is that a room override must not move when the global value changes. If a room set
 * to B were dragged to C after a global change, the user would be chatting with a model they never
 * chose.
 */

/** Model select on the global settings screen, matched by a name ending in `Model`. */
const modelSelect = (scope: import("@playwright/test").Locator) =>
	scope.getByRole("combobox", { name: /Model$/ });

const providerSelect = (scope: import("@playwright/test").Locator) =>
	scope.getByRole("combobox", { name: /Provider$/ });

/**
 * Opens the list and picks one item, matching the name exactly. A partial match would also catch
 * `RowCat` inside `Use default (RowCat)`. Those two options do opposite things (set an override versus
 * clear it), so a loose match could pass or fail without the journey knowing which one it pressed.
 */
async function chooseOption(
	page: import("@playwright/test").Page,
	trigger: import("@playwright/test").Locator,
	optionName: string,
) {
	await trigger.click();
	await page.getByRole("option", { name: optionName, exact: true }).click();
}

/**
 * Opens the current room's settings from the header trigger. The sidebar row's overflow menu opens
 * the same dialog (one set of controls, see §App shell). The point here is this conversation's
 * settings, so the header trigger matches that intent exactly. Going through the sidebar would tie
 * the journey to the recent list's ordering.
 */
async function openRoomSettings(page: import("@playwright/test").Page) {
	await page.getByRole("button", { name: "Conversation settings" }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	/**
	 * The dialog opens on its home pane. The grouping, rows and order come from ROOM_SETTINGS_IA in
	 * @rowcat/chat, which both apps read. The generation target is one pane inside, so one more step
	 * is needed. The dialog used to draw those fields directly, and this journey still carried that
	 * older shape.
	 */
	await dialog.getByRole("button", { name: /^Generation settings/ }).click();
	await expect(dialog.getByRole("button", { name: /^Back to / })).toBeVisible();
}

/** Inherit items carry the parent value in their name, so an exact match cannot be used. */
async function chooseInherit(
	page: import("@playwright/test").Page,
	trigger: import("@playwright/test").Locator,
) {
	await trigger.click();
	await page.getByRole("option", { name: /^Use default/ }).click();
}

test("a room override ignores global changes, and clearing it follows the global again", async ({
	page,
	context,
}) => {
	const account = newAccount("journey7");
	await createAccount(context, account);
	const roomId = await startChatFromStory(page);

	/**
	 * The default generation target lives at `/settings/ai`, not `/settings` (see §Settings and
	 * preferences: the settings routes are split in two, and `/settings` holds only the theme). This
	 * journey used to open `/settings`, which has no provider field at all, so it stopped at its first
	 * step.
	 */
	await page.goto("/settings/ai");
	const settings = page.getByRole("main");
	await chooseOption(page, providerSelect(settings), "RowCat");
	await chooseOption(page, modelSelect(settings), "Claude Sonnet 5");
	await expect(modelSelect(settings)).toContainText("Claude Sonnet 5");

	await page.goto(`/chat/${roomId}`);
	await openRoomSettings(page);

	const dialog = page.getByRole("dialog");
	/**
	 * While inheriting, the inherited name is shown. Leaving the field blank would hide what is in
	 * effect, and the user would read it as no model being set.
	 */
	await expect(providerSelect(dialog)).toContainText("Use default");
	await expect(dialog).toContainText("Claude Sonnet 5");

	await chooseOption(page, providerSelect(dialog), "RowCat");
	await chooseOption(page, modelSelect(dialog), "Gemini 3.7 Flash");
	await expect(modelSelect(dialog)).toContainText("Gemini 3.7 Flash");
	await page.keyboard.press("Escape");

	await page.goto("/settings/ai");
	await chooseOption(page, modelSelect(settings), "Claude Haiku 4.5");
	await expect(modelSelect(settings)).toContainText("Claude Haiku 4.5");

	await page.goto(`/chat/${roomId}`);
	await openRoomSettings(page);
	const dialog2 = page.getByRole("dialog");
	/**
	 * This line is the whole point of this journey. If the room were dragged to C, the user would be
	 * chatting with a model they never chose, and nothing on screen would say so.
	 */
	await expect(modelSelect(dialog2)).toContainText("Gemini 3.7 Flash");

	await chooseInherit(page, providerSelect(dialog2));
	/**
	 * `Use default` does not copy the current global value; it removes the override. A copy would pin
	 * this user to the old value the day the product default changes. That difference is observed
	 * here: after clearing, the room must show the current global value, C.
	 */
	await expect(dialog2).toContainText("Claude Haiku 4.5");
	await expect(dialog2).not.toContainText("Gemini 3.7 Flash");

	// After a reload the state holds, which means the override was actually cleared.
	await page.reload();
	await openRoomSettings(page);
	const dialog3 = page.getByRole("dialog");
	await expect(providerSelect(dialog3)).toContainText("Use default");
	await expect(dialog3).toContainText("Claude Haiku 4.5");
});

/**
 * Journey 7-b: open settings from a conversation, leave, and return in one step.
 *
 * Value tests cannot express this axis. The rule that decides where to return is a pure function
 * (settings-return.ts), but whether that value survives being carried in a link across the router
 * and across category changes is a browser fact. Dropping it at any one point would strand only the
 * people who entered through that path.
 */
test("settings opened from a conversation carry the way back to it", async ({
	page,
	context,
}) => {
	const account = newAccount("journey7b");
	await createAccount(context, account);
	const roomId = await startChatFromStory(page);

	/* The gear in the header is the most common way to go from a conversation to settings. */
	await page.getByRole("link", { name: "Settings" }).click();
	await expect(page).toHaveURL(
		new RegExp(`/settings\\?from=%2Fchat%2F${roomId}`),
	);

	/**
	 * The return destination must survive a category change too. This is the easiest place to lose it.
	 */
	await page.getByRole("link", { name: "AI", exact: true }).click();
	await expect(page).toHaveURL(/\/settings\/ai\?from=/);

	const back = page.getByRole("link", { name: "Back to the conversation" });
	await expect(back).toBeVisible();
	await back.click();
	await expect(page).toHaveURL(new RegExp(`/chat/${roomId}$`));
	await expect(ui.composer(page)).toBeVisible();
});

/**
 * If the user came from somewhere other than a conversation, that path does not appear. The rule of
 * not sending users to a place they have never visited must hold on screen as well.
 */
test("settings opened outside a conversation have no such way back", async ({
	page,
	context,
}) => {
	const account = newAccount("journey7c");
	await createAccount(context, account);
	await page.goto("/");
	await page.getByRole("link", { name: "Settings" }).click();
	await expect(page).toHaveURL(/\/settings$/);
	await expect(
		page.getByRole("link", { name: "Back to the conversation" }),
	).toHaveCount(0);
});
