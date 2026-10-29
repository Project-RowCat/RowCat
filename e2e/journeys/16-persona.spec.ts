import type { Page } from "@playwright/test";
import {
	createAccount,
	expect,
	newAccount,
	scriptGeneration,
	sendMessage,
	test,
	ui,
} from "../support/fixtures.ts";

/**
 * Journey 16: which persona this conversation uses.
 *
 * The pure tests already cover priority, validation and snapshot independence
 * (packages/chat/src/persona.test.ts and the repo tests), so this journey does not re-check them.
 * The axes it adds need a browser:
 * - Library to chat start: the chosen persona is carried in when the room is created.
 * - Speaker: the saved utterances carry the persona name.
 * - Mid-conversation change: only utterances after the change get the new name; earlier ones
 *   stay.
 *
 * The last point is the quietest failure. Code that rewrites history leaves the conversation
 * looking normal, and the user only notices an unrequested edit several turns later.
 *
 * No model is called. The generation send is intercepted by the test double (scriptGeneration), so
 * this journey verifies wiring, not provider availability.
 */

const PERSONA_A = "Alex";
const PERSONA_B = "Ray";

/**
 * Creates one persona on the settings persona screen. The dialog closing is the success signal.
 *
 * The canonical route is /settings/personas. The old /personas route survives only as a screen-less
 * redirect, which a separate journey verifies. Going through the old route here would make this
 * journey test the redirect's side effect instead of the library action.
 */
async function createPersona(
	page: Page,
	name: string,
	description: string,
): Promise<void> {
	await page.goto("/settings/personas");
	/*
	 * Does not cover hydration with an arbitrary wait. The screen is ClientOnly, so the body is first
	 * drawn in the browser, and the button being pressed is itself the readiness signal.
	 */
	const trigger = page.getByRole("button", {
		name: /Create your first persona$|New persona$/,
	});
	await expect(async () => {
		await trigger.first().click({ timeout: 2_000 });
		await expect(page.getByRole("dialog")).toBeVisible({ timeout: 3_000 });
	}).toPass({ timeout: 30_000 });

	const dialog = page.getByRole("dialog");
	await dialog.getByRole("textbox", { name: "Name" }).fill(name);
	await dialog.getByRole("textbox", { name: "Description" }).fill(description);
	await dialog.getByRole("button", { name: "Create" }).click();

	await expect(page.getByRole("dialog")).toHaveCount(0);
	await expect(page.getByText(name, { exact: true })).toBeVisible();
}

/**
 * Clicks the row (label) that holds a choice, not the control itself. The control is a visually
 * hidden input type=radio because the whole row is the target. Pressing the input directly is
 * intercepted by the text drawn over it. A person presses the row, so the journey does too. force:
 * true would only prove the element is pressable under an overlay, which a user cannot do.
 *
 * The check reads the control's state (toBeChecked). That value is the authority for the selection;
 * the check mark is only a visual aid.
 */
async function choosePersona(
	scope: ReturnType<Page["getByRole"]>,
	personaName: string,
): Promise<void> {
	await scope.locator("label").filter({ hasText: personaName }).click();
	await expect(
		scope.getByRole("radio", { name: new RegExp(personaName) }),
	).toBeChecked();
}

/**
 * Starts a chat from a story, but chooses a persona first. Unlike startChatFromStory, when the
 * library has choices the `Start conversation` button opens a dialog instead of creating the room at once. The
 * value picked in that dialog is written into the room in the same transaction as its creation.
 */
async function startChatAs(page: Page, personaName: string): Promise<string> {
	await page.goto("/stories/e2e-story-chat");

	await expect(async () => {
		await ui.startChat(page).click({ timeout: 2_000 });
		await expect(page.getByRole("dialog")).toBeVisible({ timeout: 3_000 });
	}).toPass({ timeout: 30_000 });

	const dialog = page.getByRole("dialog");
	await choosePersona(dialog, personaName);
	await dialog.getByRole("button", { name: "Start conversation" }).click();

	await page.waitForURL(/\/chat\/[^/]+$/, { timeout: 10_000 });
	const roomId = new URL(page.url()).pathname.split("/").pop();
	expect(roomId, "couldn't read the room address").toBeTruthy();
	return roomId as string;
}

/**
 * Changes the persona of the open room through its settings. The entry point is the `Conversation settings` button
 * in the header.
 */
async function switchPersona(page: Page, personaName: string): Promise<void> {
	await page.getByRole("button", { name: "Conversation settings" }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();

	/*
	 * The dialog opens on the home pane. Its groups, rows and order come from ROOM_SETTINGS_IA in
	 * @rowcat/chat, which both apps read as the same table. The persona is one pane inside it, so one
	 * more step is needed.
	 */
	await dialog.getByRole("button", { name: /^Persona/ }).click();
	await choosePersona(dialog, personaName);

	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("starts a conversation with a library role, and switching midway leaves old speakers alone", async ({
	page,
	context,
}) => {
	const account = newAccount("journey16");
	await createAccount(context, account);

	await scriptGeneration(page, {
		chunks: ["…", "I see."],
		delayMs: 10,
		ending: { kind: "done" },
	});

	await createPersona(
		page,
		PERSONA_A,
		"A college student. Loves mystery novels.",
	);
	await createPersona(page, PERSONA_B, "A detective.");

	const roomId = await startChatAs(page, PERSONA_A);

	await expect(ui.composer(page)).toBeEnabled();
	await sendMessage(page, "The first line");

	/**
	 * The speaker name appears on screen. This is the journey's first observation point, and the value
	 * comes from the saved record. If rendering computed the current persona each time, the final
	 * assertion below would fail.
	 */
	await expect(page.getByText("The first line")).toBeVisible();
	await expect(
		page.getByText(PERSONA_A, { exact: true }).first(),
	).toBeVisible();
	await expect(page.getByText("I see.")).toBeVisible();

	await switchPersona(page, PERSONA_B);

	await sendMessage(page, "The second line");
	await expect(page.getByText("The second line")).toBeVisible();
	await expect(
		page.getByText(PERSONA_B, { exact: true }).first(),
	).toBeVisible();

	/**
	 * The old speaker stays. This is the reason for the whole journey. It reloads on purpose, because
	 * that is when it becomes visible that the screen reads the saved value rather than in-memory
	 * state.
	 */
	await page.reload();
	await expect(page.getByText("The first line")).toBeVisible();
	await expect(page.getByText("The second line")).toBeVisible();
	await expect(
		page.getByText(PERSONA_A, { exact: true }).first(),
	).toBeVisible();
	await expect(
		page.getByText(PERSONA_B, { exact: true }).first(),
	).toBeVisible();

	expect(new URL(page.url()).pathname).toBe(`/chat/${roomId}`);
});

/**
 * Deleting the persona from the library leaves a conversation already using it intact. Whether the
 * room stores a value or a reference cannot be confirmed by reading the code, so the journey
 * deletes and then checks. With a reference, the speaker would disappear here.
 */
test("a conversation held with a role deleted from the library still opens", async ({
	page,
	context,
}) => {
	const account = newAccount("journey16b");
	await createAccount(context, account);

	await scriptGeneration(page, {
		chunks: ["Yes."],
		delayMs: 10,
		ending: { kind: "done" },
	});

	await createPersona(page, PERSONA_A, "A college student.");
	const roomId = await startChatAs(page, PERSONA_A);
	await sendMessage(page, "Hi");
	await expect(page.getByText("Hi", { exact: true })).toBeVisible();

	/*
	 * Deletes the persona from the library. The confirmation dialog states that the conversations
	 * remain.
	 */
	await page.goto("/settings/personas");
	await page
		.getByRole("button", { name: `Manage persona ${PERSONA_A}` })
		.click();
	await page.getByRole("menuitem", { name: "Delete" }).click();
	const confirm = page.getByRole("dialog");
	await expect(confirm).toContainText("stay as they are");
	await confirm.getByRole("button", { name: "Delete" }).click();
	await expect(page.getByRole("dialog")).toHaveCount(0);

	await page.goto(`/chat/${roomId}`);
	await expect(page.getByText("Hi", { exact: true })).toBeVisible();
	await expect(
		page.getByText(PERSONA_A, { exact: true }).first(),
	).toBeVisible();
});

/**
 * The old address is not dead. /personas was the library's canonical route for a time and still
 * lives in bookmarks, open tabs and saved navigation state. A 404 would look like the feature
 * vanished, so the address is kept as a redirect and the screen is not. Whether that wiring is in
 * place cannot be confirmed without a browser.
 *
 * Checking back navigation is the point. If the redirect records a history entry, a person arriving
 * from the old address who presses back returns to /personas and is bounced again, trapped in a
 * loop.
 */
test("the old /personas address leads to the persona screen in settings", async ({
	page,
	context,
}) => {
	const account = newAccount("journey16c");
	await createAccount(context, account);

	await page.goto("/chats");
	/*
	 * The chat list has no standalone link to the library any more. The library is a settings
	 * category.
	 */
	await expect(page.getByRole("link", { name: "Personas" })).toHaveCount(0);

	await page.goto("/personas");
	await page.waitForURL(/\/settings\/personas$/, { timeout: 10_000 });

	/*
	 * It sits in the settings navigation list. Of the two containers, only the one matching the
	 * current width renders.
	 */
	await expect(
		page.getByRole("link", { name: "Personas" }).first(),
	).toBeVisible();

	await page.goBack();
	expect(new URL(page.url()).pathname).not.toBe("/personas");
});
