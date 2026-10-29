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
 * Journey 1: from a story to a finished conversation, and still there after a reload.
 *
 * The boundary this journey covers is that the source of truth for conversations is this device's
 * IndexedDB. The server has no room-list endpoint, so conversations surviving a reload can only be
 * confirmed by actually re-rendering the browser. It is the one axis pure logic tests cannot
 * express.
 */

test("starts a conversation from a story, gets a reply, and it survives a refresh", async ({
	page,
	context,
}) => {
	const account = newAccount("journey1");
	await createAccount(context, account);

	await scriptGeneration(page, {
		chunks: ["Hello, ", "traveler."],
		delayMs: 30,
		ending: { kind: "done" },
	});

	const roomId = await startChatFromStory(page);

	/**
	 * Rooms open empty, because the opening scene is folded into the system prompt rather than shown
	 * as a message (`foldFirstScene` in packages/chat/src/context.ts). That keeps the opening from
	 * vanishing as the history window advances. So what is checked here is that the composer is still
	 * usable, not that the first scene is visible.
	 */
	await expect(ui.composer(page)).toBeEnabled();

	await sendMessage(page, "Nice to meet you");
	await expect(page.getByText("Nice to meet you")).toBeVisible();

	// Confirmed response. When streaming ends, the temporary text disappears and the saved bubble
	// takes its place.
	await expect(page.getByText("Hello, traveler.")).toBeVisible();

	/**
	 * Generation is done, so the composer is usable again. Stop returning to Send is the observable
	 * sign.
	 */
	await expect(ui.send(page)).toBeVisible();
	await expect(ui.stop(page)).toHaveCount(0);

	await page.reload();

	/**
	 * Both turns survive the reload. The stream is not resumed (the structure cannot do that), and the
	 * test does not pretend it was. The composer must be usable right away.
	 */
	await expect(page.getByText("Nice to meet you")).toBeVisible();
	await expect(page.getByText("Hello, traveler.")).toBeVisible();
	await expect(ui.stop(page)).toHaveCount(0);
	await expect(ui.composer(page)).toBeEnabled();

	// The URL is unchanged: a reload does not open a different room.
	expect(new URL(page.url()).pathname).toBe(`/chat/${roomId}`);
});

/**
 * Journey 1-b: an action marker wraps the selected text, and the caret stays inside it.
 *
 * Value tests cannot express this axis. The rule (what gets wrapped) is already a pure function,
 * but whether the selection survives after the value changes is a browser fact. On a controlled
 * input the caret jumps to the end when the value changes, and if focus moves to a button the
 * selection is lost. If either one is off, the button leaves the caret in the wrong place.
 */
test("the action marker wraps exactly the selection and keeps the caret inside it", async ({
	page,
	context,
}) => {
	const account = newAccount("journey1b");
	await createAccount(context, account);
	await startChatFromStory(page);

	const composer = ui.composer(page);
	await composer.click();
	await composer.fill("He opens the door and smiles");

	/* Selects only `opens the door`. The trailing space is left out on purpose. */
	await composer.evaluate((node) => {
		const field = node as HTMLTextAreaElement;
		field.setSelectionRange(3, 17);
	});

	await page.getByRole("button", { name: "Insert action marker" }).click();

	await expect(composer).toHaveValue("He *opens the door* and smiles");

	/**
	 * Focus and selection must both stay alive so the user can keep editing right away. The selection
	 * points at the wrapped content; the asterisks sit outside it.
	 */
	const selected = await composer.evaluate((node) => {
		const field = node as HTMLTextAreaElement;
		return {
			focused: document.activeElement === field,
			text: field.value.slice(field.selectionStart, field.selectionEnd),
		};
	});
	expect(selected).toEqual({ focused: true, text: "opens the door" });

	/* The sent text is unchanged. The marker is part of the body, not a visual decoration. */
	await composer.press("Enter");
	await expect(page.getByText("He opens the door and smiles")).toBeVisible();
});
