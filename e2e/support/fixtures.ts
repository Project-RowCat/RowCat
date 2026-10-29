import {
	type APIRequestContext,
	type BrowserContext,
	test as base,
	expect,
	type Page,
} from "@playwright/test";
import {
	encodeGenerationScript,
	GENERATION_SCRIPT_HEADER,
	type GenerationScript,
} from "./generation-script.ts";
import { STUB_ORIGIN } from "./origins.ts";

/**
 * Preparation steps and vocabulary shared by the journeys.
 *
 * - Helpers around screen interactions are kept to a minimum. Wrapping a journey in names like
 *   `clickSendButton()` hides what it verifies, and after a markup change it is unclear which
 *   journey broke and why. This file holds only what is not the journey's concern: creating
 *   accounts and scripting the generation stub.
 */

/** The story seeded by `db:seed:e2e`. Journeys navigate straight to this URL. */
export const E2E_STORY_ID = "e2e-story-chat";
export const E2E_STORY_PATH = `/stories/${E2E_STORY_ID}`;

/**
 * The story that runtime playback journeys open. It is a different row from the conversation
 * fixture. Merging them would set that story's `playMode` to `runtime`, and the conversation
 * journeys' `Start conversation` would disappear.
 */
export const E2E_RUNTIME_STORY_ID = "e2e-story-runtime";
export const E2E_RUNTIME_STORY_PATH = `/stories/${E2E_RUNTIME_STORY_ID}`;

export interface Account {
	email: string;
	password: string;
	name: string;
}

/**
 * Creates a new account for every journey. Reusing a fixed account carries rooms and memories from
 * earlier journeys into the next one's sidebar, so assertions such as 'one room is visible' come to
 * depend on run order. That kind of failure passes when run alone, which makes it the longest to
 * diagnose.
 */
export function newAccount(prefix: string): Account {
	const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
	return {
		email: `e2e-${prefix}-${unique}@rowcat.test`,
		password: "rowcat-e2e-pass",
		name: `E2E ${prefix}`,
	};
}

/**
 * Setup requests go through the stub, so they share the browser's origin and cookies land in one
 * place. `baseURL` is the web (3100), so a relative path would ask the SPA for an API path. The
 * request would then get the SPA document instead of a 404 from the dev server, and the failure is
 * silent.
 */
const api = (path: string): string => `${STUB_ORIGIN}${path}`;

/**
 * Absolute URL for setup and verification requests. Exported because some journeys call it
 * directly. The one checking that re-login fails after account deletion cannot use `signIn`, which
 * asserts success.
 *
 * Paths are still not assembled by journeys, for the same reason: `baseURL` is the web, so a
 * relative path returns the SPA document with 200 and the failure is silent.
 */
export const apiUrl = api;

const apiBase = (
	context: BrowserContext | APIRequestContext,
): APIRequestContext => ("request" in context ? context.request : context);

/**
 * Brings a member to a state where the app is usable: sign-up, then the first /me. The sign-up
 * form is not filled in, because it is not the subject of most journeys. Going through it would tie
 * every conversation journey to the auth screen's markup, and a failure would not show whether the
 * cause is conversation or login.
 *
 * The /me step is required. The member row is created at the first /me, not at sign-up, and
 * without it the next server call that needs a member (a notification, a story start) finds none.
 */
export async function createAccount(
	context: BrowserContext,
	account: Account,
): Promise<void> {
	const request = apiBase(context);

	const signUp = await request.post(api("/v2/auth/sign-up/email"), {
		data: {
			email: account.email,
			password: account.password,
			name: account.name,
		},
	});
	expect(
		signUp.ok(),
		`sign-up failed: ${signUp.status()} ${await signUp.text()}`,
	).toBe(true);

	const me = await request.get(api("/v2/me"));
	expect(me.ok(), `couldn't read the viewer: ${me.status()}`).toBe(true);
}

/**
 * Signs back in to an account that already exists. The account-isolation journey uses it to return
 * to Alice.
 */
export async function signIn(
	context: BrowserContext,
	account: Account,
): Promise<void> {
	const response = await apiBase(context).post(api("/v2/auth/sign-in/email"), {
		data: { email: account.email, password: account.password },
	});
	expect(
		response.ok(),
		`sign-in failed: ${response.status()} ${await response.text()}`,
	).toBe(true);
}

/**
 * Decides how the next generation responds. The script is attached as a page header, so each
 * request carries its own script. The reason the stub holds no server-side state is recorded in
 * `generation-script.ts`.
 *
 * A page without a script gets its generation from the real API, which fails when no provider key
 * is configured. That is how this journey expresses that it does not exercise generation.
 */
export async function scriptGeneration(
	page: Page,
	script: GenerationScript,
): Promise<void> {
	await page.setExtraHTTPHeaders({
		[GENERATION_SCRIPT_HEADER]: encodeGenerationScript(script),
	});
}

/**
 * Installs a switch that makes local message writes fail.
 *
 * One journey needs this: when a user message fails to save, does the input keep the sentence as
 * typed? The failure exists only on the browser side (IndexedDB), so pure tests cannot express it.
 * What is lost is the text the user just typed, so value tests alone are not enough.
 *
 * The switch is turned on later on purpose. Blocking from the start makes room creation fail, and
 * the journey never reaches the chat screen. What is checked is a single write during a
 * conversation.
 *
 * Must be installed before `page.goto`, since `addInitScript` runs from the next document on.
 */
export async function installMessageWriteBreaker(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const proto = IDBObjectStore.prototype;
		const add = proto.add;
		proto.add = function patched(
			this: IDBObjectStore,
			value: unknown,
			key?: IDBValidKey,
		): IDBRequest<IDBValidKey> {
			const armed = (
				window as unknown as { __rowcatBreakMessageWrites?: boolean }
			).__rowcatBreakMessageWrites;
			if (armed && this.name === "messages")
				throw new DOMException("e2e: storage refused", "UnknownError");
			return add.call(this, value, key);
		};
	});
}

/** Turns the switch on. Every message write after this is rejected. */
export async function breakMessageWrites(page: Page): Promise<void> {
	await page.evaluate(() => {
		(
			window as unknown as { __rowcatBreakMessageWrites?: boolean }
		).__rowcatBreakMessageWrites = true;
	});
}

/**
 * Journeys do not look at CSS classes. Pointing at elements by accessible name gets two things at
 * once: the journey survives markup changes, and the fact that the name exists is itself an
 * accessibility check. Pointing by class lets the name disappear entirely while the journey stays
 * green.
 */
export const ui = {
	composer: (page: Page) => page.getByRole("textbox", { name: "Message" }),
	send: (page: Page) => page.getByRole("button", { name: "Send" }),
	stop: (page: Page) => page.getByRole("button", { name: "Stop generating" }),
	startChat: (page: Page) =>
		page.getByRole("button", { name: "Start conversation" }),
	accountMenu: (page: Page) =>
		page.getByRole("button", { name: /account menu$/ }),
	signOut: (page: Page) => page.getByRole("menuitem", { name: "Sign out" }),
};

/**
 * Starts a chat from a story and waits until the room address is fixed. Returning the room id is
 * the point: several journeys check 're-enter that room' or 'the address does not come back alive',
 * and that requires holding the address as a value.
 */
export async function startChatFromStory(page: Page): Promise<string> {
	/**
	 * No precondition here: any signed-in member can start a public story. This spot used to seed the
	 * story into the user's collection first (a 500-unit purchase), and that stage prop went away when story
	 * collection was removed.
	 */
	await page.goto(E2E_STORY_PATH);

	/**
	 * Clicks and retries until navigation happens.
	 *
	 * This is about hydration, not laziness. The story detail page is server-rendered, so the button
	 * is visible and clickable as soon as the document arrives, but the markup at that moment has no
	 * React handlers attached. Playwright's actionability checks cannot see that difference, so the
	 * click silently does nothing.
	 *
	 * It is not covered by an arbitrary waitForTimeout, which breaks on slow devices, and nobody knows
	 * how long to wait. Navigation is the success signal, so wait for it directly.
	 *
	 * If the first click already succeeded, waitForURL passes immediately and the button is not
	 * pressed twice, so two rooms for the same story are never created.
	 */
	await expect(async () => {
		await ui.startChat(page).click({ timeout: 2_000 });
		await page.waitForURL(/\/chat\/[^/]+$/, { timeout: 3_000 });
	}).toPass({ timeout: 30_000 });
	const roomId = new URL(page.url()).pathname.split("/").pop();
	expect(roomId, "couldn't read the room address").toBeTruthy();
	return roomId as string;
}

/** Sends one turn: types into the composer and presses Enter. */
export async function sendMessage(page: Page, text: string): Promise<void> {
	const composer = ui.composer(page);
	await composer.click();
	await composer.fill(text);
	await composer.press("Enter");
}

export { expect };

/**
 * The journey's `test`, currently Playwright's own, unchanged.
 *
 * It once aborted browser requests to an external payment provider, as a last defense in case the
 * payment SDK stub did not come up. Payments were removed, which removed that defense too. The
 * export stays so journeys still import the name from here. If shared setup returns, extend it
 * here.
 */
export const test = base;
