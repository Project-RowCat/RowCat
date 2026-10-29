import {
	createAccount,
	expect,
	newAccount,
	test,
} from "../support/fixtures.ts";

/**
 * Journey 23: a user who forgot their password can follow the reset path in the browser.
 *
 * - Not covered: the real token flow. The journey API has no mail transport. Enabling one would
 *   also enable email ownership checks and break sign-up sessions in every other journey, and that
 *   derivation is deliberately impossible to disable (see `apps/api/vitest.mail.config.ts`). The
 *   real flow (password changed, other sessions ended, token single-use) is tested against real
 *   Postgres in `apps/api/src/routes/password-reset.verified.test.ts`.
 * - Covered, because only the browser shows it: the login page draws no reset link when reset is
 *   disabled; the typed email does not appear in the URL; the form still submits the token after
 *   the URL drops it; a dead token leads to the request-a-new-link screen; a deployment that cannot
 *   send mail does not claim it did; a signed-in user can still open the page.
 * - The token-after-navigation check matters most. If the token is lost when the URL is cleaned,
 *   the server answers INVALID_TOKEN and the screen shows the expired-link message, which looks
 *   identical to the normal path. So the request body is inspected.
 */

/**
 * A made-up value with the same shape as the library's token (24 alphanumeric characters). The
 * server does not have it.
 */
const FABRICATED_TOKEN = "E2eFabricatedToken000000";
const THROWAWAY_PASSWORD = "e2e-throwaway-passphrase";

/**
 * When reset is disabled on a deployment, the login page does not draw the reset link.
 *
 * The journey API has neither mail sending nor `PASSWORD_RESET_ENABLED`, so the public runtime
 * config answers `passwordReset: false`. If the link were drawn, the path would only lead to the
 * 'cannot send' message tested below. The case where the link is shown is
 * decided by a server-rendered value and is not covered here.
 */
test("a deployment with reset closed has no link on the sign-in screen", async ({
	page,
}) => {
	await page.goto("/login?redirect=%2Fnotifications");
	await expect(
		page.getByRole("button", { name: "Sign in", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: "Forgot your password?" }),
	).toHaveCount(0);
	await expect(page.getByText("Forgot your password?")).toHaveCount(0);
});

test("a deployment that can't send mail does not claim it did", async ({
	page,
}) => {
	const email = `${newAccount("reset-request").email}`;
	await page.goto("/reset-password");

	/**
	 * Pressed before hydration, the form submits as a `post` and receives the same screen again, so
	 * values do not leak into the URL. Retry the click while waiting for the observable signal: the
	 * sentence the response renders.
	 */
	await expect(async () => {
		await page.getByLabel("Email").fill(email, { timeout: 2_000 });
		await page
			.getByRole("button", { name: "Get a reset link" })
			.click({ timeout: 2_000 });
		await expect(page.getByText("can't be sent")).toBeVisible({
			timeout: 3_000,
		});
	}).toPass({ timeout: 30_000 });

	await expect(
		page.getByRole("heading", { name: "Check your inbox" }),
	).toHaveCount(0);
	expect(page.url(), "the typed email rode on the address").not.toContain(
		encodeURIComponent(email),
	);
	expect(page.url()).not.toContain(email);
});

test("submits with the token taken off the address, and a dead token leads to the request-again face", async ({
	page,
}) => {
	await page.goto(
		`/reset-password?token=${FABRICATED_TOKEN}&redirect=%2Fnotifications`,
	);

	await page.waitForURL((url) => !url.searchParams.has("token"));
	expect(new URL(page.url()).searchParams.get("redirect")).toBe(
		"/notifications",
	);
	await expect(
		page.getByRole("heading", { name: "Set a new password" }),
	).toBeVisible();

	const submitted = page.waitForRequest(
		(request) =>
			request.method() === "POST" &&
			new URL(request.url()).pathname.endsWith("/auth/reset-password"),
	);
	await page
		.getByLabel("New password", { exact: true })
		.fill(THROWAWAY_PASSWORD);
	await page.getByLabel("Confirm new password").fill(THROWAWAY_PASSWORD);
	await page.getByRole("button", { name: "Change password" }).click();

	const body = (await submitted).postDataJSON() as { token?: string };
	expect(body.token, "the token was lost along with the address").toBe(
		FABRICATED_TOKEN,
	);

	await expect(
		page.getByRole("heading", { name: "Please get a new link" }),
	).toBeVisible();
});

test("returning with an expired-link marker opens the request-again face", async ({
	page,
}) => {
	await page.goto("/reset-password?error=INVALID_TOKEN");
	await expect(
		page.getByRole("heading", { name: "Please get a new link" }),
	).toBeVisible();
	await expect(page.getByLabel("Email")).toBeVisible();
});

/**
 * Does not eject signed-in users. Being signed in on another device while forgetting the password
 * is common. If this screen redirected like the login screen does, through `beforeLoad`, a person
 * opening the reset link could not reach the place to set a new password.
 */
test("the reset screen opens in a signed-in browser too", async ({
	page,
	context,
}) => {
	await createAccount(context, newAccount("reset-signed-in"));

	await page.goto(`/reset-password?token=${FABRICATED_TOKEN}`);
	await expect(
		page.getByRole("heading", { name: "Set a new password" }),
	).toBeVisible();
	expect(new URL(page.url()).pathname).toBe("/reset-password");
});
