import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { app } from "../app.ts";
import { closeDb } from "../db/client.ts";
import { newId } from "../lib/id.ts";
import { TEST_PASSWORD } from "../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../test/database.ts";
import {
	apiGet,
	authPost,
	cookieFromResponse,
	jsonOf,
	WEB_ORIGIN,
} from "../test/http.ts";
import { captureMail } from "../test/mail.ts";

/**
 * Password reset: the mailbox owner sets a new password. The library builds and verifies the token;
 * this file checks the facts we fixed by configuration, two of which the mail body promises to the
 * user:
 *
 * ```text
 * known and unknown addresses get the same response   existence hiding
 * the link returns only to a constant path on our web trusted return origins
 * a token is used once                                single use
 * reset revokes other devices' sessions               promised by the mail
 * ```
 *
 * It runs under the mail config (`vitest.mail.config.ts`) because the sender is registered only
 * when a transport exists; the flow does not exist in the default config.
 */

const EMAIL_PREFIX = "password-reset-test-";
const RESET_RETURN = `${WEB_ORIGIN}/reset-password`;
const NEW_PASSWORD = "a-brand-new-passphrase";

const mail = captureMail();

const newAddress = (): string => `${EMAIL_PREFIX}${newId()}@example.test`;

/**
 * The sender does not await the mail (so response time does not reveal registration; see
 * `auth/index.ts`), so the mailbox may still be empty when the response returns.
 */
const awaitMailTo = (email: string) =>
	vi.waitFor(() => mail.lastTo(email), { timeout: 2000, interval: 10 });

/** Opens the link without following the redirect, so the destination can be inspected. */
const openLink = (url: string): Promise<Response> => {
	const parsed = new URL(url);
	return Promise.resolve(app.request(parsed.pathname + parsed.search));
};

/** A verified account plus its session cookie, the thing checked for revocation. */
async function signUpVerified(): Promise<{ email: string; cookie: string }> {
	const email = newAddress();
	await authPost("/sign-up/email", {
		name: "Reset test",
		email,
		password: TEST_PASSWORD,
	});
	await openLink(mail.linkIn(mail.lastTo(email)));
	const signedIn = await authPost("/sign-in/email", {
		email,
		password: TEST_PASSWORD,
	});
	expect(signedIn.status).toBe(200);
	return { email, cookie: cookieFromResponse(signedIn) };
}

/** Requests the reset mail, opens its link and reads the token from the return address. */
async function tokenFor(email: string): Promise<string> {
	mail.reset();
	const requested = await authPost("/request-password-reset", {
		email,
		redirectTo: RESET_RETURN,
	});
	expect(requested.status).toBe(200);
	const message = await awaitMailTo(email);
	const opened = await openLink(mail.linkIn(message));
	expect(opened.status).toBe(302);
	const location = new URL(opened.headers.get("location") ?? "");
	expect(`${location.origin}${location.pathname}`).toBe(RESET_RETURN);
	const token = location.searchParams.get("token");
	if (!token) throw new Error("the returning address carries no token");
	return token;
}

const signInStatus = async (email: string, password: string) =>
	(await authPost("/sign-in/email", { email, password })).status;

const databaseReady = await connectTestDatabase();

beforeEach(() => {
	mail.reset();
});

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	mail.restore();
	await closeDb();
});

describe.skipIf(!databaseReady)("password reset", () => {
	test("setting a new password through the mail's link signs in only with that password", async () => {
		const { email } = await signUpVerified();
		const token = await tokenFor(email);

		const reset = await authPost("/reset-password", {
			token,
			newPassword: NEW_PASSWORD,
		});
		expect(reset.status).toBe(200);

		expect(await signInStatus(email, TEST_PASSWORD)).not.toBe(200);
		expect(await signInStatus(email, NEW_PASSWORD)).toBe(200);
	});

	/** The mail body promises that other sessions are revoked; if this breaks, the mail lies. */
	test("resetting cuts already signed-in sessions", async () => {
		const { email, cookie } = await signUpVerified();
		expect(await jsonOf(await apiGet("/me", cookie))).not.toBeNull();

		const token = await tokenFor(email);
		await authPost("/reset-password", { token, newPassword: NEW_PASSWORD });

		expect(await jsonOf(await apiGet("/me", cookie))).toBeNull();
	});

	/**
	 * Unknown addresses get no mail either: a "not registered" mail would reach the address's owner,
	 * not the requester.
	 */
	test("an unknown address gets the same response, and no mail goes out", async () => {
		const { email } = await signUpVerified();
		mail.reset();

		const known = await authPost("/request-password-reset", {
			email,
			redirectTo: RESET_RETURN,
		});
		const stranger = newAddress();
		const unknown = await authPost("/request-password-reset", {
			email: stranger,
			redirectTo: RESET_RETURN,
		});

		expect(unknown.status).toBe(known.status);
		expect(await jsonOf(unknown)).toEqual(await jsonOf(known));

		await awaitMailTo(email);
		expect(mail.messages.filter((m) => m.to === stranger)).toHaveLength(0);
	});

	test("a token is used only once", async () => {
		const { email } = await signUpVerified();
		const token = await tokenFor(email);

		expect(
			(await authPost("/reset-password", { token, newPassword: NEW_PASSWORD }))
				.status,
		).toBe(200);
		const replay = await authPost("/reset-password", {
			token,
			newPassword: "someone-elses-passphrase",
		});
		expect(replay.status).toBe(400);
		expect(await signInStatus(email, NEW_PASSWORD)).toBe(200);
	});

	/** A length-rule rejection must not burn the token, or someone one character short needs a new mail. */
	test("an attempt that fails the length rule doesn't consume the token", async () => {
		const { email } = await signUpVerified();
		const token = await tokenFor(email);

		const short = await authPost("/reset-password", {
			token,
			newPassword: "short",
		});
		expect(short.status).toBe(400);
		expect(
			(await authPost("/reset-password", { token, newPassword: NEW_PASSWORD }))
				.status,
		).toBe(200);
	});

	/** The login screen draws the link based on this value; this suite has both transport and switch, so it must be true. */
	test("the public runtime config says reset is open", async () => {
		const config = await jsonOf<{ passwordReset?: boolean }>(
			await apiGet("/runtime-config"),
		);
		expect(config.passwordReset).toBe(true);
	});

	/** The request cannot choose the return address: the link is mailed, so an untrusted target would make our mail a phishing link. */
	test("a return address outside the trusted list is refused and no mail goes out", async () => {
		const { email } = await signUpVerified();
		mail.reset();

		const hostile = await authPost("/request-password-reset", {
			email,
			redirectTo: "https://evil.example/reset-password",
		});
		expect(hostile.status).toBe(403);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(mail.messages).toHaveLength(0);
	});
});
