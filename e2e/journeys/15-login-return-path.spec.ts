import type { Page } from "@playwright/test";
import {
	type Account,
	createAccount,
	expect,
	newAccount,
	test,
	ui,
} from "../support/fixtures.ts";
import { CHOSEN_LOCALE_COOKIE } from "../support/locale.ts";

/**
 * Journey 15: after login, the user returns to the page they were heading to. The bug: `?redirect=`
 * is attached by the router when a guest opens a protected screen, and its validator
 * (`redirectTargetFrom`) was correct. Still, only email login lost the destination:
 * - the sign-in/email call sends a callbackURL, used as the return point of the verification
 *   email
 * - the server answers with redirect:true and that URL (better-auth 1.7.0)
 * - the client's redirectPlugin reloads the whole document at window.location.href
 * - that address is /login?verified=1, which has no redirect parameter
 * - the login route's beforeLoad then sends the viewer to the default destination (/) The screen
 *   code was fine (`navigate({ href: redirectPath })` is still there). Google login put its
 *   destination in callbackURL and worked, which hid the defect. It only appears when browser,
 *   library, server and router line up. The pure test (`features/auth/email-verification.test.ts`)
 *   confirms the destination is carried, but not where the router goes once that address reopens
 *   the document. The destination is `/notifications`: its route redirects guests in beforeLoad, so
 *   entry is deterministic and needs no fixture. The check is that the user came back, not what the
 *   page shows. (It was once `/billing`, removed together with payments.)
 */

const PROTECTED_PATH = "/notifications";

/**
 * Fills the login form and submits it until the page arrives. Not lazy retry: this is hydration
 * again. The form is clickable before React's submit handler is attached, and actionability checks
 * cannot see that. A form without a `method` once submitted as GET and put the password in the URL.
 * It is now `post`, so no value leaks and the same login screen just returns; pressing again while
 * waiting for the arrival signal is therefore safe. No fixed `waitForTimeout`: it breaks on slow
 * devices. If the first attempt already succeeds, `waitForURL` passes at once, so the form is not
 * submitted twice. The password field has no `textbox` role, so it is located by its label.
 */
async function signIn(
	page: Page,
	account: Account,
	arrived: string | RegExp | ((url: URL) => boolean),
): Promise<void> {
	await expect(async () => {
		await page.getByLabel("Email").fill(account.email, { timeout: 2_000 });
		await page
			.getByLabel("Password", { exact: true })
			.fill(account.password, { timeout: 2_000 });
		await page
			.getByRole("button", { name: "Sign in", exact: true })
			.click({ timeout: 2_000 });
		await page.waitForURL(arrived, { timeout: 5_000 });
	}).toPass({ timeout: 30_000 });
}

test("a guest opening a protected address returns there after signing in", async ({
	page,
	context,
}) => {
	const account = newAccount("return");
	await createAccount(context, account);
	/**
	 * Keeps the account but returns this browser to guest. If setup left the session in place, the
	 * navigation below would reach the destination directly, pass without ever using the login form,
	 * and show green. The language cookie goes back right away: without it the first-visit language
	 * window would stand over the login form.
	 */
	await context.clearCookies();
	await context.addCookies([CHOSEN_LOCALE_COOKIE]);

	await page.goto(PROTECTED_PATH);
	await page.waitForURL(/\/login\?/);
	expect(
		new URL(page.url()).searchParams.get("redirect"),
		"the intended destination did not ride on the address",
	).toBe(PROTECTED_PATH);

	await signIn(page, account, (url) => url.pathname === PROTECTED_PATH);

	await expect(
		page.getByRole("heading", { name: "Notifications" }),
	).toBeVisible();

	/**
	 * The arrived screen must belong to **the logged-in person**. If only the address matches while
	 * the gate blocks, this journey confirms nothing: the account menu appears only in the member's
	 * header.
	 */
	await expect(ui.accountMenu(page)).toBeVisible();
});

test("with no destination it goes to the default place", async ({
	page,
	context,
}) => {
	const account = newAccount("return-default");
	await createAccount(context, account);
	await context.clearCookies();
	await context.addCookies([CHOSEN_LOCALE_COOKIE]);

	await page.goto("/login");
	/**
	 * The default destination is `Discover`. This journey pins the opposite side of the one
	 * above: if the fix that carries a destination always produced one (for example by carrying the
	 * login screen itself), login would lead nowhere or loop.
	 */
	await signIn(page, account, (url) => url.pathname === "/");

	await expect(page.getByRole("heading", { name: "Discover" })).toBeVisible();
});
