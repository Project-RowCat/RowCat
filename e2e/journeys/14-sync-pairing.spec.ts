import type { BrowserContext, Page } from "@playwright/test";
import {
	type Account,
	createAccount,
	expect,
	newAccount,
	scriptGeneration,
	sendMessage,
	signIn,
	startChatFromStory,
	test,
} from "../support/fixtures.ts";

/**
 * Journey 14: device pairing. Two real browsers exchange keys and data actually moves between them.
 * Sync rules are covered by lower layers: envelope-encryption golden vectors, HLC and merge order,
 * codecs, the engine, and the in-process two-device harness (`apps/web/src/test/sync-devices.ts`),
 * which reproduces convergence, conflict and deletion without React. That harness cannot represent
 * real browsers:
 * - each has its own IndexedDB; in one process the two stores can see each other
 * - each remembers its device key; whether trust survives a reload is a document-lifetime matter
 * - a person copies the code by eye; there is no clipboard or variable between the two screens So
 *   the journey does not read the code from the database. It reads it from the new device's screen
 *   and types it into the existing device, as a user would. Reading from the server would let
 *   through a defect where the code is never drawn. The server still learns nothing: keys are never
 *   written to Postgres. The journey goes only through the real procedure; the server sees a single
 *   envelope in transit, which this journey does not inspect. What only a browser shows:
 * - the code is not drawn (the server session is fine)
 * - the new device does not open after approval (polling and state transitions live in the
 *   document)
 * - a reload drops trust (the remembered key was held only in memory)
 * - another account can approve (is channel binding actually enforced?)
 */

const syncButton = (page: Page, name: string) =>
	page.getByRole("button", { name, exact: true });

/**
 * Opens sync on this device for the first time: settings plus recovery-code confirmation. Wrapped
 * in a helper because it is not this journey's subject. The thing checked is pairing; recovery-code
 * issuance is only a precondition. It still goes through the real UI, since calling the controller
 * directly would skip checking that the settings button does that job.
 */
async function setUpSync(page: Page): Promise<void> {
	await page.goto("/account");
	const dialog = page.getByRole("dialog");
	await expect(async () => {
		await syncButton(page, "Set up sync").click({ timeout: 2_000 });
		await expect(dialog).toBeVisible({ timeout: 5_000 });
	}).toPass({ timeout: 30_000 });

	/** The dialog does not close before confirmation, since closing it by mistake cannot be undone. */
	await dialog
		.getByRole("checkbox", {
			name: "I've written the code down somewhere safe.",
		})
		.click();
	await dialog.getByRole("button", { name: "I've saved it" }).click();
	await expect(dialog).toHaveCount(0);
	await expect(syncButton(page, "Sync now")).toBeVisible();
}

async function syncNow(page: Page): Promise<void> {
	await page.goto("/account");
	const button = syncButton(page, "Sync now");
	await expect(async () => {
		await button.click({ timeout: 2_000 });
		await expect(page.getByText(/Last synced/)).toBeVisible({
			timeout: 5_000,
		});
	}).toPass({ timeout: 30_000 });
}

/**
 * Signs into the same account in this browser. This is setup, since the sign-up form is not this
 * journey's subject.
 */
async function openAs(
	context: BrowserContext,
	account: Account,
): Promise<Page> {
	await signIn(context, account);
	return context.newPage();
}

test("two browsers pair by exchanging a code, and a conversation then crosses over", async ({
	browser,
}) => {
	const owner = newAccount("syncowner");
	const stranger = newAccount("syncstranger");

	const deviceA = await browser.newContext();
	const deviceB = await browser.newContext();
	const intruder = await browser.newContext();

	try {
		await createAccount(deviceA, owner);
		const pageA = await deviceA.newPage();
		await setUpSync(pageA);

		await scriptGeneration(pageA, {
			chunks: ["An answer that crossed devices."],
			ending: { kind: "done" },
		});
		await startChatFromStory(pageA);
		await sendMessage(pageA, "A message written on A");
		await expect(
			pageA.getByText("An answer that crossed devices."),
		).toBeVisible();
		await syncNow(pageA);

		const pageB = await openAs(deviceB, owner);
		await pageB.goto("/account");
		/**
		 * Being locked even with the same account is the zero-knowledge design: logging in grants access
		 * but not the key. This device has no key yet.
		 */
		await expect(pageB.getByText("Locked on this device.")).toBeVisible();

		const pairDialog = pageB.getByRole("dialog");
		await expect(async () => {
			await syncButton(pageB, "Connect from another device").click({
				timeout: 2_000,
			});
			await expect(pairDialog).toBeVisible({ timeout: 5_000 });
		}).toPass({ timeout: 30_000 });

		/**
		 * The code is read **from the screen**. Pulling it from the server or database would let through
		 * a defect where the code is never drawn, which for the user is the end of the procedure. A
		 * canonical code is 16 Crockford base32 characters, grouped in fours.
		 */
		const codeText = pairDialog.getByText(
			/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/,
		);
		await expect(codeText).toBeVisible({ timeout: 15_000 });
		const code = ((await codeText.textContent()) ?? "").trim();
		expect(code, "couldn't read the pairing code from the screen").not.toBe("");

		/**
		 * **Is channel binding actually in place?** The lookup hash is derived from `(owner, code)`, so
		 * even if another account presents the same code, no session is referenced. This is confirmed
		 * from the screen result, without inspecting the envelope.
		 */
		await createAccount(intruder, stranger);
		const pageC = await intruder.newPage();
		await setUpSync(pageC);

		const approveByStranger = pageC.getByRole("dialog");
		await expect(async () => {
			await syncButton(pageC, "Connect a new device").click({ timeout: 2_000 });
			await expect(approveByStranger).toBeVisible({ timeout: 5_000 });
		}).toPass({ timeout: 30_000 });
		await approveByStranger.getByRole("textbox").fill(code);
		await approveByStranger.getByRole("button", { name: "Approve" }).click();
		await expect(
			approveByStranger.getByText(
				"No device is waiting with that code. It may have expired.",
			),
		).toBeVisible();

		/** That attempt does not disturb B's procedure either: the code still waits. */
		await expect(codeText).toBeVisible();

		await pageA.goto("/account");
		const approveDialog = pageA.getByRole("dialog");
		await expect(async () => {
			await syncButton(pageA, "Connect a new device").click({ timeout: 2_000 });
			await expect(approveDialog).toBeVisible({ timeout: 5_000 });
		}).toPass({ timeout: 30_000 });
		await approveDialog.getByRole("textbox").fill(code);
		await approveDialog.getByRole("button", { name: "Approve" }).click();
		await expect(approveDialog.getByText("Approved.")).toBeVisible();

		/**
		 * B has been waiting on its own screen (polling roughly every 2 seconds). This is why the journey
		 * does not wait arbitrarily: the end of the wait is a named element on screen.
		 */
		await expect(
			pairDialog.getByText("Sync is open on this device."),
		).toBeVisible({ timeout: 30_000 });
		/**
		 * Two buttons carry this name: the footer's and the dialog's corner X. Both close the dialog, so
		 * the first is pressed rather than telling them apart by markup.
		 */
		await pairDialog.getByRole("button", { name: "Close" }).first().click();

		/**
		 * This single line guards against passing merely because React state is still alive. The
		 * remembered device key lives in the per-member IndexedDB, and its lifetime is the browser's.
		 */
		await pageB.reload();
		await expect(pageB.getByText("Locked on this device.")).toHaveCount(0);
		await expect(syncButton(pageB, "Sync now")).toBeVisible();

		await syncNow(pageB);

		/**
		 * Does not re-check the merge rules; the lower layers cover those densely. The only question here
		 * is: **does real data move between two connected browsers?**
		 */
		await pageB.goto("/chats");
		const room = pageB
			.getByRole("main")
			.getByRole("link", { name: "E2E conversation journey story" });
		await expect(room.first()).toBeVisible({ timeout: 30_000 });
		await room.first().click();
		await expect(pageB.getByText("A message written on A")).toBeVisible();
		await expect(
			pageB.getByText("An answer that crossed devices."),
		).toBeVisible();
	} finally {
		await deviceA.close();
		await deviceB.close();
		await intruder.close();
	}
});
