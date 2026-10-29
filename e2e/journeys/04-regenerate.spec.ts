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
 * Journey 4: regenerate is also a tail rewrite.
 *
 * It is kept separate from edit because the confirmation differs. Regenerating the last response
 * runs with no confirmation, since only the response just read is removed. Regenerating an earlier
 * response drops everything below it, so it asks first. The question for this journey is whether
 * both paths delete by the same rule.
 */

test("the last reply regenerates without confirmation, and the old reply disappears", async ({
	page,
	context,
}) => {
	const account = newAccount("journey4");
	await createAccount(context, account);
	await startChatFromStory(page);

	await scriptGeneration(page, {
		chunks: ["An answer I don't like."],
		ending: { kind: "done" },
	});
	await sendMessage(page, "One question");
	await expect(page.getByText("An answer I don't like.")).toBeVisible();

	await scriptGeneration(page, {
		chunks: ["A freshly made answer."],
		ending: { kind: "done" },
	});

	const answer = page.getByText("An answer I don't like.");
	await answer.hover();
	await page
		.getByRole("button", { name: "Regenerate from this reply" })
		.first()
		.click();

	/**
	 * Last response, so there is no confirmation dialog. The new response appears in its place right
	 * away.
	 */
	await expect(page.getByText("A freshly made answer.")).toBeVisible();
	await expect(page.getByText("An answer I don't like.")).toHaveCount(0);
	/** The user message stays. Regeneration only rebuilds the response for that turn. */
	await expect(page.getByText("One question")).toBeVisible();

	await page.reload();
	await expect(page.getByText("A freshly made answer.")).toBeVisible();
	await expect(page.getByText("An answer I don't like.")).toHaveCount(0);
});

test("regenerating an earlier reply asks for confirmation and discards what followed", async ({
	page,
	context,
}) => {
	const account = newAccount("journey4b");
	await createAccount(context, account);
	await startChatFromStory(page);

	await scriptGeneration(page, {
		chunks: ["The old answer."],
		ending: { kind: "done" },
	});
	await sendMessage(page, "The earlier question");
	await expect(page.getByText("The old answer.")).toBeVisible();

	await scriptGeneration(page, {
		chunks: ["The later answer."],
		ending: { kind: "done" },
	});
	await sendMessage(page, "The later question");
	await expect(page.getByText("The later answer.")).toBeVisible();

	await page.getByText("The old answer.").hover();
	await page
		.getByRole("button", { name: "Regenerate from this reply" })
		.first()
		.click();

	/**
	 * The confirmation states the count. Regenerating an upper response throws away everything below
	 * it; if that were silent, the user would not know what they lost.
	 */
	await expect(page.getByText("Regenerate from this reply?")).toBeVisible();
	await expect(page.getByText(/deletes the 2 messages after it/)).toBeVisible();

	await scriptGeneration(page, {
		chunks: ["The remade answer."],
		ending: { kind: "done" },
	});
	await page.getByRole("button", { name: "Regenerate", exact: true }).click();

	await expect(page.getByText("The remade answer.")).toBeVisible();
	await expect(page.getByText("The old answer.")).toHaveCount(0);
	await expect(page.getByText("The later question")).toHaveCount(0);
	await expect(page.getByText("The later answer.")).toHaveCount(0);
	// Everything before the anchor stays.
	await expect(page.getByText("The earlier question")).toBeVisible();
	await expect(ui.composer(page)).toBeEnabled();
});

test("cancelling the confirmation writes nothing", async ({
	page,
	context,
}) => {
	const account = newAccount("journey4c");
	await createAccount(context, account);
	await startChatFromStory(page);

	await scriptGeneration(page, {
		chunks: ["The first answer."],
		ending: { kind: "done" },
	});
	await sendMessage(page, "Question A");
	await expect(page.getByText("The first answer.")).toBeVisible();

	await scriptGeneration(page, {
		chunks: ["The second answer."],
		ending: { kind: "done" },
	});
	await sendMessage(page, "Question B");
	await expect(page.getByText("The second answer.")).toBeVisible();

	await page.getByText("The first answer.").hover();
	await page
		.getByRole("button", { name: "Regenerate from this reply" })
		.first()
		.click();
	await expect(page.getByText("Regenerate from this reply?")).toBeVisible();
	await page.getByRole("button", { name: "Cancel" }).click();

	/**
	 * A cancelled confirmation performs no writes, so the conversation is unchanged after a reload.
	 */
	await page.reload();
	for (const text of [
		"Question A",
		"The first answer.",
		"Question B",
		"The second answer.",
	])
		await expect(page.getByText(text)).toBeVisible();
});
