import type { Locator, Page } from "@playwright/test";
import {
	apiUrl,
	createAccount,
	E2E_RUNTIME_STORY_ID,
	E2E_RUNTIME_STORY_PATH,
	expect,
	newAccount,
	test,
} from "../support/fixtures.ts";

/**
 * Journey 20: a member actually opens a published runtime.
 *
 * This is the Phase 7 acceptance scenario. That the server compiles and stores the source is
 * verified by the API integration test against real Postgres (routes/stories/runtime.test.ts). The
 * engine invariants run on real QuickJS in @rowcat/runtime-host. This journey adds four axes that
 * need a browser:
 * - The meaning of the main action: on a runtime story the button is `Play`, and it does
 *   not create a room.
 * - Product playback: the artifact the server returns runs in QuickJS and becomes the screen.
 * - Save lifetime: after leaving and returning, progress is intact. It belongs to storage, not to
 *   the studio's memory.
 * - Reset: `Reset play` clears only that progress.
 *
 * The fixture is seeded by `db:seed:e2e`, and its artifact goes through the same compiler as the
 * product. A journey that passes with a hand-written artifact says nothing about whether the code a
 * creator published actually runs.
 */

/**
 * Presses `Play` until the play screen is reached.
 *
 * Not covered by an arbitrary wait. The button already has its name and enabled state in the
 * server-rendered HTML. For a viewer the server does not know, the main action is `start` in SSR,
 * so it can be pressed before hydration. That press has no React handler, and Playwright's
 * actionability check cannot see the difference. The journey waits for an observable success signal
 * instead, here the URL.
 */
async function openPlayer(page: Page): Promise<void> {
	await expect(async () => {
		if (!PLAYER_URL.test(page.url()))
			await page
				.getByRole("button", { name: "Play" })
				.click({ timeout: 3_000 });
		await page.waitForURL(PLAYER_URL, { timeout: 5_000 });
	}).toPass({ timeout: 60_000 });
}

/**
 * The canonical play address is inside the chat canvas. `/stories/:id/play` survives only as a
 * compatibility route that redirects here, which a second journey below checks by value.
 */
const PLAYER_URL = /\/chat\/runtime\/e2e-story-runtime$/;
const PLAYER_HREF = "/chat/runtime/e2e-story-runtime";

/** The element the published runtime is drawn into. Everything below it belongs to the renderer. */
const surface = (page: Page): Locator =>
	page.getByTestId("runtime-player-surface");

const count = (page: Page): Locator => surface(page).getByText(/^Count \d+$/);

test("a runtime story opens with Play, keeps progress, and reset clears it", async ({
	page,
	context,
}) => {
	/**
	 * WASM loading and the first evaluation of the compiled graph take time, so this is more generous
	 * than the chat journeys.
	 */
	test.setTimeout(240_000);
	const account = newAccount("journey20");
	await createAccount(context, account);

	await page.goto(E2E_RUNTIME_STORY_PATH);
	await expect(page.getByRole("button", { name: "Play" })).toBeEnabled({
		timeout: 60_000,
	});
	/**
	 * Asserts that `Start conversation` is absent. The change in wording is what this slice does on screen, so its
	 * absence is checked too. If the button appeared, the play mode had not reached the screen.
	 */
	await expect(
		page.getByRole("button", { name: "Start conversation" }),
	).toHaveCount(0);

	await openPlayer(page);

	/**
	 * The first frame reads `Count 0`, the exact value for a first run with no save. If another number
	 * is visible here, either hydration came after render or another player's save was read.
	 */
	await expect(count(page)).toHaveText("Count 0", { timeout: 180_000 });

	const increment = surface(page).getByRole("button", { name: "Increment" });
	await increment.click();
	await expect(count(page)).toHaveText("Count 1");

	/**
	 * The sidebar's `Conversations` is active: this screen sits where a chat room does. But the header has no
	 * room controls (search and settings belong to `ChatRoom`). There is no chat input either, because
	 * this fixture does not draw `TextInput`, so the screen should contain no text box at all (§72).
	 */
	await expect(
		page.getByRole("link", { name: "Conversations", exact: true }).first(),
	).toHaveAttribute("aria-current", "page");
	await expect(
		page.getByRole("button", { name: "Find in conversation" }),
	).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Conversation settings" }),
	).toHaveCount(0);
	await expect(page.getByRole("textbox")).toHaveCount(0);

	/**
	 * The play-through appears in the library even though no chat room was created. A runtime
	 * play-through is saved state, not a conversation. Creating a room would leave it sitting in the
	 * list doing nothing. What appears instead is its own library row (`runtime.conversation`). That
	 * row goes to the runtime play address, and room operations (rename, room settings, delete) are
	 * not on it.
	 */
	await page.goto("/chats");
	/**
	 * Narrows to the canvas. The same row also appears in the sidebar's recent chats (checked
	 * separately below), so a page-wide search would match both and break strict mode. That failure
	 * would not mean the library is broken; it would mean this locator does not tell the two surfaces
	 * apart.
	 */
	const canvas = page.getByRole("main");
	const libraryRow = canvas.getByRole("link", { name: /Runtime story/ });
	await expect(libraryRow).toBeVisible({ timeout: 60_000 });
	await expect(libraryRow).toHaveAttribute("href", PLAYER_HREF);
	await expect(
		canvas.getByRole("button", { name: /Manage conversation/ }),
	).toHaveCount(0);
	await canvas.getByRole("button", { name: /in the list$/ }).click();
	await expect(page.getByRole("menuitem", { name: "Rename" })).toHaveCount(0);
	await expect(
		page.getByRole("menuitem", { name: "Delete conversation" }),
	).toHaveCount(0);
	await page.keyboard.press("Escape");
	/** The same row also appears in the sidebar's recent chats: the same row from the same library. */
	await expect(
		page
			.getByRole("navigation", { name: "Main navigation" })
			.getByRole("link", {
				name: /Runtime story/,
			})
			.first(),
	).toBeVisible();

	/**
	 * Enters again through the old address, which is how people who played at that address in Phase 7
	 * arrive, via bookmarks. The redirect must land on the canonical address (§69), and that screen
	 * must open the same save (§50). The save's identity is the story id plus the default slot, so
	 * moving the address does not erase progress. The entry is a fresh navigation rather than back
	 * navigation, because going back may keep the same mount alive, and that round trip would not show
	 * the save's lifetime.
	 */
	await page.goto(`${E2E_RUNTIME_STORY_PATH}/play`);
	await page.waitForURL(PLAYER_URL, { timeout: 30_000 });
	await expect(count(page)).toHaveText("Count 1", { timeout: 180_000 });

	/**
	 * The reset trigger lives in the header, where a chat room's `Conversation settings` sits. A confirmation dialog
	 * appears first because the action cannot be undone. That dialog belongs to the platform, not to
	 * the creator's code.
	 */
	await page.getByRole("button", { name: "Reset play" }).click();
	await page.getByRole("button", { name: "Start over" }).click();
	/**
	 * The new VM starts with an empty play-through. If `Count 1` is still visible here, the reset ran
	 * after the session was established, and hydration read the old progress once.
	 */
	await expect(count(page)).toHaveText("Count 0", { timeout: 180_000 });

	/**
	 * A fresh VM showing `Count 0` alone does not prove the reset is durable. If the old session's
	 * last write commits after the reset, the screen shows 0 while storage holds 1, which is the race
	 * the Phase 7 work closed. So this leaves completely, opens again, and reads the value a new
	 * session loads from storage.
	 */
	await page.goto(E2E_RUNTIME_STORY_PATH);
	await openPlayer(page);
	await expect(count(page)).toHaveText("Count 0", { timeout: 180_000 });
});

test("no artifact goes out to a guest", async ({ page, context }) => {
	test.setTimeout(120_000);

	/**
	 * A logged-out viewer. The detail page opens (the story is public), but the server refuses the
	 * play response, so the body is never sent. The screen does not merely hide it. Story ownership
	 * has been removed, so login is the only entitlement boundary.
	 */
	await page.goto(E2E_RUNTIME_STORY_PATH);
	await expect(page.getByRole("button", { name: "Play" })).toBeEnabled({
		timeout: 60_000,
	});

	const response = await context.request.get(
		apiUrl(`/v2/stories/${E2E_RUNTIME_STORY_ID}/playback`),
	);
	expect(response.status()).toBe(401);
	expect(await response.text()).not.toContain("src/main.tsx");
});
