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
 * Journey 2: does Stop actually cut the connection, and can the user send again afterward?
 *
 * Two axes that pure tests cannot express. First, a real connection has to exist to be cut (the
 * double holds the response open and waits). Second, the composer must come back after stopping.
 * That recovery runs in the hook's finally block; if it did not run, the composer would look dead
 * to the user.
 */

test("stopping mid-stream halts it, and you can send again right away", async ({
	page,
	context,
}) => {
	const account = newAccount("journey2");
	await createAccount(context, account);

	/**
	 * Flushes some chunks and does not finish. That leaves a real window to press Stop. Closing the
	 * response right away would verify stopping a generation that had already ended.
	 */
	await scriptGeneration(page, {
		chunks: ["This is the first chunk. "],
		delayMs: 20,
		ending: { kind: "hang" },
	});

	await startChatFromStory(page);
	await sendMessage(page, "Please answer at length");

	// While streaming, the same spot becomes Stop, so the two buttons never sit side by side.
	await expect(ui.stop(page)).toBeVisible();
	await expect(ui.send(page)).toHaveCount(0);
	await expect(page.getByText("This is the first chunk.")).toBeVisible();

	await ui.stop(page).click();

	/**
	 * Stopping is not an error, so no failure text is attached to something the user ended themselves.
	 * The composer comes back (Send returning is the sign).
	 */
	await expect(ui.send(page)).toBeVisible();
	await expect(ui.stop(page)).toHaveCount(0);
	await expect(page.getByRole("alert")).toHaveCount(0);

	/**
	 * Partial text already received is kept (see the save-rules table in the generation lifecycle
	 * section: stopped with text becomes incomplete). Text is not discarded just because the user
	 * stopped reading.
	 */
	await expect(page.getByText("This is the first chunk.")).toBeVisible();

	// The second turn after the stop completes normally, which shows ownership was actually released.
	await scriptGeneration(page, {
		chunks: ["The second reply."],
		ending: { kind: "done" },
	});
	await sendMessage(page, "Sending again");
	await expect(page.getByText("Sending again")).toBeVisible();
	await expect(page.getByText("The second reply.")).toBeVisible();
	await expect(ui.send(page)).toBeVisible();
});

test("stopping before the first token still brings the composer back", async ({
	page,
	context,
}) => {
	const account = newAccount("journey2b");
	await createAccount(context, account);

	// Sends nothing and leaves the stream open. This is the ending path where no confirmed save
	// happens.
	await scriptGeneration(page, {
		chunks: [],
		leadMs: 60_000,
		ending: { kind: "hang" },
	});

	await startChatFromStory(page);
	await sendMessage(page, "Stopping before the first token");

	await expect(ui.stop(page)).toBeVisible();
	await ui.stop(page).click();

	await expect(ui.send(page)).toBeVisible();
	await expect(ui.composer(page)).toBeEnabled();
	/**
	 * User messages are not rolled back. The user really sent that message, and erasing it because
	 * generation never started would lose what they wrote.
	 */
	await expect(page.getByText("Stopping before the first token")).toBeVisible();
});
