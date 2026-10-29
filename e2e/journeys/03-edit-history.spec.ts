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
 * Journey 3: editing a user message rewrites the tail.
 *
 * Three things are checked: the content after the anchor really disappears, a new response
 * continues from that spot, and after a reload the deleted tail does not come back. The last point
 * is why this runs in the browser: whether the tombstone was committed can only be confirmed by
 * reopening the database.
 */

test("editing an earlier user message removes what followed, and a refresh does not bring it back", async ({
	page,
	context,
}) => {
	const account = newAccount("journey3");
	await createAccount(context, account);
	await startChatFromStory(page);

	// Builds two turns first. There has to be a real tail behind the anchor to be deleted.
	await scriptGeneration(page, {
		chunks: ["The first answer."],
		ending: { kind: "done" },
	});
	await sendMessage(page, "The first question");
	await expect(page.getByText("The first answer.")).toBeVisible();

	await scriptGeneration(page, {
		chunks: ["The second answer."],
		ending: { kind: "done" },
	});
	await sendMessage(page, "The second question");
	await expect(page.getByText("The second answer.")).toBeVisible();

	/**
	 * Edits the first user message. The action row only appears on hover or focus, so this follows the
	 * same order a real user would.
	 */
	const anchor = page.getByText("The first question");
	await anchor.hover();
	await page.getByRole("button", { name: "Edit message" }).first().click();

	/**
	 * The dialog states how many items will be deleted. A message that only says the message will be
	 * edited would have the user agree without knowing what they agreed to, and the gap only shows
	 * after deletion.
	 */
	await expect(
		page.getByText(/deletes the 3 messages after this one/),
	).toBeVisible();

	await scriptGeneration(page, {
		chunks: ["An answer to the edited question."],
		ending: { kind: "done" },
	});

	const editor = page.getByRole("textbox", { name: "Message content" });
	await editor.fill("The edited first question");
	await page.getByRole("button", { name: "Save" }).click();

	// Once the edit commits, the history is read again and generation continues from there.
	await expect(page.getByText("The edited first question")).toBeVisible();
	await expect(
		page.getByText("An answer to the edited question."),
	).toBeVisible();

	/** Everything after the anchor is gone: the old question and both responses. */
	await expect(
		page.getByText("The first question", { exact: true }),
	).toHaveCount(0);
	await expect(page.getByText("The first answer.")).toHaveCount(0);
	await expect(page.getByText("The second question")).toHaveCount(0);
	await expect(page.getByText("The second answer.")).toHaveCount(0);

	await page.reload();

	/**
	 * Deleted items stay deleted. If they came back, only the screen was cleared, not the tombstone,
	 * and the next sync would spread that state to other devices.
	 */
	await expect(page.getByText("The edited first question")).toBeVisible();
	await expect(
		page.getByText("An answer to the edited question."),
	).toBeVisible();
	await expect(page.getByText("The first answer.")).toHaveCount(0);
	await expect(page.getByText("The second answer.")).toHaveCount(0);
	await expect(ui.composer(page)).toBeEnabled();
});
