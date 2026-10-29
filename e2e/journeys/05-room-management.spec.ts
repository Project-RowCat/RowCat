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
 * Journey 5: do rename and delete reach every surface together?
 *
 * A room appears in three places: the sidebar's recent conversations, the /chats list, and the open
 * room itself. All three must come from one IndexedDB subscription rather than being synced by
 * hand, and only a browser that can show all three at once confirms that.
 *
 * The last assertion is the key: a deleted room's address must not come back. Neither the recent
 * list, the cache, nor navigation context may cover the tombstone.
 */

/**
 * The two surfaces are checked separately. The room action trigger appears in both the sidebar's
 * recent list and the /chats row, on purpose (see §App shell). Searching the whole page by name
 * would count one room as two triggers, so a 'two rows' assertion would fail on seeing four. More
 * importantly, a journey written that way would miss the bug where only one surface updates, which
 * is why this journey exists.
 */
const sidebar = (page: import("@playwright/test").Page) =>
	page.getByRole("navigation", { name: "Main navigation" });
const library = (page: import("@playwright/test").Page) =>
	page.getByRole("main");

test("rename and delete reach the sidebar, the list and the address together", async ({
	page,
	context,
}) => {
	const account = newAccount("journey5");
	await createAccount(context, account);

	// Two rooms. One is changed while the other must stay unaffected.
	const keepId = await startChatFromStory(page);
	await scriptGeneration(page, { chunks: ["Kept."], ending: { kind: "done" } });
	await sendMessage(page, "The first line of the room to keep");
	await expect(page.getByText("Kept.")).toBeVisible();

	const targetId = await startChatFromStory(page);
	expect(targetId).not.toBe(keepId);

	await page.goto("/chats");
	const rows = library(page).getByRole("button", {
		name: /^Manage conversation /,
	});
	await expect(rows).toHaveCount(2);

	// The first row in the list (most recent activity) is the room just created.
	await rows.first().click();
	await page.getByRole("menuitem", { name: "Rename" }).click();

	const titleField = page.getByRole("textbox", { name: "Conversation name" });
	await titleField.fill("Renamed conversation");
	await page.getByRole("button", { name: "Save" }).click();

	/**
	 * One write reaches both surfaces together. If three React states were synced by hand, one would
	 * go stale here.
	 */
	await expect(
		library(page)
			.getByRole("link", { name: /Renamed conversation/ })
			.first(),
	).toBeVisible();
	await expect(
		sidebar(page).getByRole("link", { name: /Renamed conversation/ }),
	).toBeVisible();

	await library(page)
		.getByRole("button", { name: "Manage conversation Renamed conversation" })
		.first()
		.click();
	await page.getByRole("menuitem", { name: "Delete conversation" }).click();
	await expect(page.getByText("Delete this conversation?")).toBeVisible();
	await page.getByRole("button", { name: "Delete", exact: true }).click();

	/** A deleted room disappears from both surfaces immediately, without waiting for a refetch. */
	await expect(library(page).getByText("Renamed conversation")).toHaveCount(0);
	await expect(
		sidebar(page).getByRole("link", { name: /Renamed conversation/ }),
	).toHaveCount(0);

	/** The other room was not disturbed. */
	await expect(rows).toHaveCount(1);

	await page.goto(`/chat/${targetId}`);
	/**
	 * The tombstone is not covered by any path. If it came back, only the screen would have been
	 * cleared, not the room soft-deleted, and the next sync would spread the room to other devices.
	 */
	await expect(page.getByText("Conversation not found")).toBeVisible();
	/** Not a dead end: there is a way out. */
	await expect(
		page.getByRole("link", { name: "Back to conversations" }),
	).toBeVisible();

	// The room that was kept opens as before.
	await page.goto(`/chat/${keepId}`);
	await expect(
		page.getByText("The first line of the room to keep"),
	).toBeVisible();
	await expect(ui.composer(page)).toBeEnabled();
});
