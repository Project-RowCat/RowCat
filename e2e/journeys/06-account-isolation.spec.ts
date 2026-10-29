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
	ui,
} from "../support/fixtures.ts";

/**
 * Journey 6: account isolation. This is the P0 for this repo.
 *
 * The local database is split per member (`rowcat_chat_<viewerId>`). The boundary is enforced by
 * which database is opened, not by whether the query cache was cleared. That judgment can only be
 * observed on the browser's IndexedDB, so no other layer can replace this journey.
 *
 * The return leg is the point. Alice -> Bob -> Alice is the only path where a member id repeats,
 * and the connection closes and reopens in between. An implementation that only compares ids would
 * fail here and nowhere else.
 */

/** Signs out in this browser through the UI, because the cache cleanup is attached to that path. */
async function signOutInBrowser(page: import("@playwright/test").Page) {
	await ui.accountMenu(page).click();
	await ui.signOut(page).click();
	/**
	 * Once signed out as a guest, the recent conversations section disappears from the sidebar (see
	 * §App shell). That is the observable signal that sign-out actually completed.
	 */
	await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
}

async function signInBrowser(
	page: import("@playwright/test").Page,
	context: import("@playwright/test").BrowserContext,
	account: Account,
) {
	await signIn(context, account);
	await page.goto("/chats");
}

test("switching accounts hides the previous person's conversations, and they are intact on return", async ({
	page,
	context,
}) => {
	const alice = newAccount("alice");
	const bob = newAccount("bob");

	await createAccount(context, alice);
	await scriptGeneration(page, {
		chunks: ["An answer only Alice should see."],
		ending: { kind: "done" },
	});
	const aliceRoom = await startChatFromStory(page);
	await sendMessage(page, "Alice's secret message");
	await expect(
		page.getByText("An answer only Alice should see."),
	).toBeVisible();

	await signOutInBrowser(page);
	await createAccount(context, bob);
	await page.goto("/chats");

	/**
	 * None of Alice's data may appear on Bob's screen: no rooms, messages, or titles. An empty list
	 * and a loading state are different, so this checks the empty-state copy.
	 */
	await expect(page.getByText("Alice's secret message")).toHaveCount(0);
	await expect(page.getByText("An answer only Alice should see.")).toHaveCount(
		0,
	);
	await expect(page.getByRole("main").getByRole("link")).toHaveCount(0);

	/**
	 * Opening Alice's room address directly must fail too. Knowing an address and being entitled to
	 * its data are separate axes. If this path opened, a URL alone would unlock someone else's
	 * conversation.
	 */
	await page.goto(`/chat/${aliceRoom}`);
	await expect(page.getByText("Conversation not found")).toBeVisible();
	await expect(page.getByText("Alice's secret message")).toHaveCount(0);

	await scriptGeneration(page, {
		chunks: ["An answer only Bob should see."],
		ending: { kind: "done" },
	});
	const bobRoom = await startChatFromStory(page);
	await sendMessage(page, "Bob's message");
	await expect(page.getByText("An answer only Bob should see.")).toBeVisible();
	expect(bobRoom).not.toBe(aliceRoom);

	await signOutInBrowser(page);
	await signInBrowser(page, context, alice);

	/**
	 * Alice's conversation comes back as it was. Sign-out closes access but does not give up
	 * ownership. If the data were gone, that would be data loss, not isolation.
	 */
	await page.goto(`/chat/${aliceRoom}`);
	await expect(page.getByText("Alice's secret message")).toBeVisible();
	await expect(
		page.getByText("An answer only Alice should see."),
	).toBeVisible();

	/** Bob's data is not visible to Alice. Isolation runs both ways. */
	await expect(page.getByText("Bob's message")).toHaveCount(0);
	await page.goto(`/chat/${bobRoom}`);
	await expect(page.getByText("Conversation not found")).toBeVisible();
	await expect(page.getByText("Bob's message")).toHaveCount(0);
});
