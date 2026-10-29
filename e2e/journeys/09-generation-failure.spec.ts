import {
	breakMessageWrites,
	createAccount,
	expect,
	installMessageWriteBreaker,
	newAccount,
	scriptGeneration,
	sendMessage,
	startChatFromStory,
	test,
	ui,
} from "../support/fixtures.ts";

/**
 * Journey 9: whether failures leave the history intact. It checks four things: the user message
 * stays, the composer recovers, the provider's raw text never reaches the screen, and input
 * survives a local save failure. The last two need a browser. Pure tests can show that a failed
 * save is not reported as accepted, but only the DOM can show that a string is absent and the
 * sentence is still in the composer. Failure journeys share one file on purpose. One file per
 * failure axis would duplicate the same setup, and a reader would have to open every file to see
 * which failure each one covers.
 */

test("when the stream fails the user's line stays, and regenerate carries on", async ({
	page,
	context,
}) => {
	const account = newAccount("journey9");
	await createAccount(context, account);
	await startChatFromStory(page);

	/**
	 * Fails without emitting anything. With no text there is no assistant message to save, and the
	 * turn stays an unanswered turn, which is why `Regenerate` is available.
	 */
	await scriptGeneration(page, {
		chunks: [],
		ending: {
			kind: "error",
			code: "chat_provider_failed",
			// Imitates the provider's raw error text. This string must never appear on screen.
			message: "upstream 500: api.example.com/v1/chat key=sk-secret-123",
		},
	});

	await sendMessage(page, "A question that will fail");

	/**
	 * The failure is announced right above the composer, so users who are not watching the screen
	 * still learn of it.
	 */
	const alert = page.getByRole("alert");
	await expect(alert).toBeVisible();

	/**
	 * Failures of unknown kind are folded into a generic sentence. Echoing the raw provider message is
	 * the most common leak path; here the upstream host and a key-shaped string passed through
	 * unchanged.
	 */
	await expect(alert).toContainText("No response was received");
	await expect(page.getByText(/sk-secret-123/)).toHaveCount(0);
	await expect(page.getByText(/api\.example\.com/)).toHaveCount(0);
	await expect(page.getByText(/upstream 500/)).toHaveCount(0);

	/** The user message is not undone. The user actually sent it. */
	await expect(page.getByText("A question that will fail")).toBeVisible();
	/** No empty assistant bubble is left, because there was no text to save. */
	await expect(ui.composer(page)).toBeEnabled();
	await expect(ui.stop(page)).toHaveCount(0);

	await scriptGeneration(page, {
		chunks: ["This time the answer succeeded."],
		ending: { kind: "done" },
	});
	await page.getByRole("button", { name: "Regenerate" }).click();

	await expect(page.getByText("This time the answer succeeded.")).toBeVisible();
	/** A successful retry removes the failure notice, so a past failure does not stay on screen. */
	await expect(page.getByRole("alert")).toHaveCount(0);
	/** There is still exactly one question: regenerating must not duplicate the user's message. */
	await expect(page.getByText("A question that will fail")).toHaveCount(1);

	await page.reload();
	await expect(page.getByText("A question that will fail")).toHaveCount(1);
	await expect(page.getByText("This time the answer succeeded.")).toBeVisible();
});

test("a failure after a partial reply keeps what arrived", async ({
	page,
	context,
}) => {
	const account = newAccount("journey9b");
	await createAccount(context, account);
	await startChatFromStory(page);

	await scriptGeneration(page, {
		chunks: ["This much arrived."],
		delayMs: 20,
		ending: {
			kind: "error",
			code: "chat_provider_failed",
			message: "The connection dropped",
		},
	});

	await sendMessage(page, "A question cut off midway");

	/**
	 * Whatever was received is saved (lifecycle: `failed` with text is stored as `incomplete`). A
	 * partly read reply is not discarded just because the request failed, and it persists across
	 * reloads.
	 */
	await expect(page.getByText("This much arrived.")).toBeVisible();

	/**
	 * There is an action on that partial response: `Continue generating`. This assertion was added
	 * recently. For a while nothing could be pressed there. The failure notice replaced the neutral
	 * notice, and `Regenerate` only appears on turns that got no answer (`awaitsAnswer`). A
	 * turn with a saved partial reply counts as answered, so the user saw only the failure sentence
	 * and had no way to continue the text. No value test catches this, because each predicate is
	 * correct on its own.
	 */
	const failure = page.getByRole("alert");
	await expect(
		failure.getByRole("button", { name: "Continue generating" }),
	).toBeVisible();
	/**
	 * A failure row has exactly one action (see docs/design/FAILURE-FEEDBACK.md). The `Regenerate` button
	 * in the message's action row is a different control, so it is not counted here; the assertion is
	 * narrowed to the failure row.
	 */
	await expect(failure.getByRole("button", { name: "Regenerate" })).toHaveCount(
		0,
	);

	await page.reload();
	await expect(page.getByText("This much arrived.")).toBeVisible();
	await expect(page.getByText("A question cut off midway")).toBeVisible();
	await expect(ui.composer(page)).toBeEnabled();

	/**
	 * The path survives a reload because the decision rests on the stored status (`incomplete`), not
	 * on screen state. The failure notice is gone, so the neutral notice takes its place and the
	 * action stays.
	 */
	await expect(page.getByRole("alert")).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Continue generating" }),
	).toBeVisible();

	await scriptGeneration(page, {
		chunks: [" And then the rest came."],
		ending: { kind: "done" },
	});
	await page.getByRole("button", { name: "Continue generating" }).click();
	await expect(
		page.getByText("This much arrived. And then the rest came."),
	).toBeVisible();
	/** The continuation completed normally, so its continue action disappears too. */
	await expect(
		page.getByRole("button", { name: "Continue generating" }),
	).toHaveCount(0);
});

/**
 * If local saving fails, the typed input must survive. This journey needs a browser because the
 * storage is IndexedDB. Pure tests can only show that a failed save is not reported as accepted;
 * the text the user actually loses is confirmed only in the DOM. The composer used to be cleared
 * right after `onSend()`. Nothing was saved by then, so on this path the user lost the sentence
 * from both the screen and the conversation, with no way back.
 */
test("if the user's line can't be saved the composer still holds it", async ({
	page,
	context,
}) => {
	const account = newAccount("journey9c");
	await createAccount(context, account);
	// The write that creates the room must succeed, so the failure switch is turned on only after
	// entering the conversation.
	await installMessageWriteBreaker(page);
	await startChatFromStory(page);

	/**
	 * A succeeding script is set up anyway. This reply must still never appear: since the user message
	 * was not saved, the provider request itself must never start.
	 */
	await scriptGeneration(page, {
		chunks: ["This answer must not exist."],
		ending: { kind: "done" },
	});
	await breakMessageWrites(page);

	await sendMessage(page, "A sentence that must not be lost");

	const alert = page.getByRole("alert");
	await expect(alert).toBeVisible();
	await expect(alert).toContainText("No response was received");

	/** The composer still holds the original text, so the user can send the same sentence again. */
	await expect(ui.composer(page)).toHaveValue(
		"A sentence that must not be lost",
	);
	await expect(ui.composer(page)).toBeEnabled();

	/** No request went out carrying the unsaved user message. */
	await expect(page.getByText("This answer must not exist.")).toHaveCount(0);

	/**
	 * Does not show `Regenerate` for a turn that never happened. That button generates from the earlier
	 * history, so pressing it here would attach an answer while the just-typed sentence exists
	 * nowhere.
	 */
	await expect(page.getByRole("button", { name: "Regenerate" })).toHaveCount(0);

	await page.reload();
	await expect(ui.composer(page)).toBeEnabled();
	await scriptGeneration(page, {
		chunks: ["This time it was saved."],
		ending: { kind: "done" },
	});
	await sendMessage(page, "A sentence that must not be lost");

	await expect(
		page.getByText("A sentence that must not be lost"),
	).toBeVisible();
	await expect(page.getByText("This time it was saved.")).toBeVisible();
	// The composer clears only after the send. The commit's success signal arrives at that point.
	await expect(ui.composer(page)).toHaveValue("");
});

/**
 * Note: the turn ended normally but had no text to read, so it stalled silently for a while. This
 * happens in a conversation with the narrative pack enabled. When the whole response is tracking
 * blocks, the screen strips them from the body (`splitChatTrackingBlocks`), and the save rule
 * stores nothing because the body is empty (`resolveGenerationOutcome`). Only the user's own
 * message remains. It is not a failure, so no failure notice appears and the generation simply
 * disappears. The browser is needed because 'an empty response is not saved' is confirmed by value,
 * but what the screen shows afterwards can only be confirmed in the rendered page.
 */
test("a reply that ended with no body says why and offers regenerate", async ({
	page,
	context,
}) => {
	const account = newAccount("journey9c");
	await createAccount(context, account);
	await startChatFromStory(page);

	/**
	 * A single tracking block added by the pack is the whole response, with not one character of body.
	 */
	await scriptGeneration(page, {
		chunks: [
			"<details><summary>Logic</summary>\n- one internal ruling line\n</details>",
		],
		ending: { kind: "done" },
	});

	await sendMessage(page, "A question that gets an empty reply");

	/**
	 * Now there is an action to press, and it is not a red error state. The wording is locked by a
	 * pure test (`generation-error.test.ts`). This journey checks that the sentence appears on screen
	 * and that nothing is reported as a failure, since nothing broke.
	 */
	await expect(page.getByRole("button", { name: "Regenerate" })).toBeVisible();
	await expect(page.getByRole("alert")).toHaveCount(0);

	/** The user message stays as is; the turn remains one that got no answer. */
	await expect(
		page.getByText("A question that gets an empty reply"),
	).toBeVisible();
	/** Leaves no empty bubble, because there was no body to save. */
	await expect(ui.composer(page)).toBeEnabled();

	await scriptGeneration(page, {
		chunks: ["This time there is a body."],
		ending: { kind: "done" },
	});
	await page.getByRole("button", { name: "Regenerate" }).click();

	await expect(page.getByText("This time there is a body.")).toBeVisible();
	/**
	 * Receiving a reply removes the notice, so the earlier turn's sentence does not linger on screen.
	 */
	await expect(
		page.getByText("A question that gets an empty reply"),
	).toHaveCount(1);
});
