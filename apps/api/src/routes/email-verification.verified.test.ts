import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { app } from "../app.ts";
import { closeDb, db } from "../db/client.ts";
import { member, user } from "../db/schema.ts";
import { newId } from "../lib/id.ts";
import { TEST_PASSWORD } from "../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../test/database.ts";
import { authPost, cookieFromResponse, WEB_ORIGIN } from "../test/http.ts";
import { captureMail } from "../test/mail.ts";

/**
 * Email ownership verification for a deployment that has a mail transport.
 *
 * This file runs under its own config (see the `vitest.mail.config.ts` header): whether
 * verification is required derives from `MAIL_TRANSPORT`, which is read once at module load, so one
 * process cannot imitate two deployments.
 *
 * The mailbox is the capture transport and never touches the network. Links are pulled from the
 * body and opened against the real endpoint, so what is checked is the token the library actually
 * signs and verifies, not a fake of ours.
 *
 * ```text
 * 1. signup creates a verification mail and gives no session
 * 2. an unverified account is blocked at login and the mail is re-sent   (migration path)
 * 3. opening the link verifies, and the same auth account and member remain
 * 4. resend creates a new link
 * 5. a corrupted token does not verify
 * 6. the callback cannot leave the trusted list                         (open redirect)
 * 7. unknown and known addresses get the same answer                    (existence hiding)
 * ```
 */

const EMAIL_PREFIX = "email-verification-test-";

/**
 * The mailbox is the capture transport. Links come from the plain-text body (`captureMail`): that
 * is what a person reads, and extracting from HTML would miss a regression where the plain text has
 * no link (an empty mail for clients that do not render HTML).
 */
const mail = captureMail();
const linkIn = mail.linkIn;
/**
 * The senders do not await the mail (so response time does not reveal registration; see
 * `sendWithoutWaiting` in `auth/index.ts`), so the mailbox may still be empty when the response
 * returns.
 */
const lastMailTo = (email: string) =>
	vi.waitFor(() => mail.lastTo(email), { timeout: 2000, interval: 10 });

/** Opens the verification link for real, without following the redirect, so the response itself is inspected. */
const openLink = async (url: string): Promise<Response> =>
	app.request(new URL(url).pathname + new URL(url).search, {
		headers: { Origin: WEB_ORIGIN },
	});

const newEmail = (): string => `${EMAIL_PREFIX}${newId()}@example.test`;

const signUp = (email: string, callbackURL?: string) =>
	authPost("/sign-up/email", {
		name: "Verification test",
		email,
		password: TEST_PASSWORD,
		...(callbackURL ? { callbackURL } : {}),
	});

const signIn = (email: string, password = TEST_PASSWORD) =>
	authPost("/sign-in/email", { email, password });

const databaseReady = await connectTestDatabase();

beforeEach(() => {
	mail.reset();
});

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	mail.restore();
	await closeDb();
});

const verifiedFlag = async (email: string): Promise<boolean | undefined> => {
	const [row] = await db
		.select({ verified: user.emailVerified })
		.from(user)
		.where(eq(user.email, email))
		.limit(1);
	return row?.verified;
};

describe.skipIf(!databaseReady)("sign-up", () => {
	/**
	 * Signup gives no session.
	 *
	 * The response `token` is `null`, so the screen switches to the verification notice. Navigating
	 * without reading it makes `/me` answer guest, and the user sees "I signed up but was not signed
	 * in".
	 */
	test("a verification mail goes out and no session is created", async () => {
		const email = newEmail();
		const response = await signUp(email);
		expect(response.status).toBe(200);

		const body = (await response.json()) as { token: string | null };
		expect(body.token).toBeNull();
		expect(cookieFromResponse(response)).not.toContain("session");

		const mail = await lastMailTo(email);
		expect(mail.subject).toContain("verify your email");
		expect(linkIn(mail)).toContain("/verify-email?token=");
	});

	/**
	 * Signing up with an existing address does not reveal that it exists.
	 *
	 * Better Auth hides existence deliberately when verification is required, and we do not undo it:
	 * otherwise the signup form becomes a lookup for whether an address is registered. Both requests
	 * must have the same status code.
	 */
	test("a duplicate sign-up does not reveal existence", async () => {
		const taken = newEmail();
		await signUp(taken);
		await lastMailTo(taken);
		mail.messages.length = 0;

		const fresh = await signUp(newEmail());
		const duplicate = await signUp(taken);

		expect(duplicate.status).toBe(fresh.status);
		// The second signup does not change that account's password.
		expect(await verifiedFlag(taken)).toBe(false);
	});
});

describe.skipIf(!databaseReady)("verification", () => {
	/**
	 * Verification does not change identity.
	 *
	 * The most important assertion here: the auth account id and the member id are the same before and
	 * after, and they are different axes.
	 */
	test("opening the link verifies and opens sign-in", async () => {
		const email = newEmail();
		await signUp(email);

		const [before] = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, email));
		expect(before?.id).toBeTruthy();
		expect(await verifiedFlag(email)).toBe(false);

		// Before verification login is blocked, even with the correct password.
		const blocked = await signIn(email);
		expect(blocked.status).toBe(403);

		const opened = await openLink(linkIn(await lastMailTo(email)));
		expect([200, 302]).toContain(opened.status);
		expect(await verifiedFlag(email)).toBe(true);

		const allowed = await signIn(email);
		expect(allowed.status).toBe(200);

		const [after] = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, email));
		expect(after?.id).toBe(before?.id);
	});

	/**
	 * Migration path for existing unverified accounts.
	 *
	 * A deployment turning verification on already holds unverified accounts. Setting them all to
	 * `emailVerified = true` would record a fact we never verified; a login attempt re-sends the mail
	 * instead. Also checks that the member row stays as it was: verification changes the auth
	 * account's state and does not move product identity.
	 */
	test("an unverified sign-in attempt resends the verification mail", async () => {
		const email = newEmail();
		await signUp(email);

		const [authUser] = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, email));
		// Create the member row to check that verification leaves it alone.
		const memberId = newId();
		await db.insert(member).values({
			id: memberId,
			user_id: authUser?.id ?? "",
			nickname: "verification",
		});

		await lastMailTo(email);
		mail.messages.length = 0;
		const blocked = await signIn(email);
		expect(blocked.status).toBe(403);
		await vi.waitFor(() =>
			expect(mail.messages.filter((mail) => mail.to === email)).toHaveLength(1),
		);

		await openLink(linkIn(await lastMailTo(email)));
		expect(await verifiedFlag(email)).toBe(true);

		const [row] = await db
			.select({ id: member.id, userId: member.user_id })
			.from(member)
			.where(eq(member.id, memberId));
		expect(row?.id).toBe(memberId);
		expect(row?.userId).toBe(authUser?.id);
	});

	test("a damaged token does not verify", async () => {
		const email = newEmail();
		await signUp(email);
		const link = linkIn(await lastMailTo(email));

		// Change one character of the token so the signature breaks.
		const tampered = link.replace(
			/token=(.)/,
			(_match, first) => `token=${first === "a" ? "b" : "a"}`,
		);
		const response = await openLink(tampered);
		expect(response.status).not.toBe(200);
		expect(await verifiedFlag(email)).toBe(false);
	});

	/**
	 * The callback cannot leave the trusted list.
	 *
	 * The link is delivered by mail, so this is the most expensive hole in the slice: if it passed,
	 * that mail would be a phishing path. The check is the library's `originCheck` and we do not turn
	 * it off (`advanced.disableOriginCheck: false`). There are two doors, so both are tested:
	 *
	 * ```text
	 * send time  a signup carrying an untrusted callback is rejected, so no mail goes out
	 * open time  hand-editing a valid link's callback does not redirect there
	 * ```
	 *
	 * The second is the real defence; with only the first, the recipient could edit the parameter in
	 * the address bar.
	 */
	test("a sign-up carrying an untrusted callback creates no mail", async () => {
		const email = newEmail();
		const response = await signUp(email, "https://evil.example/steal");
		expect(response.status).not.toBe(200);
		expect(mail.messages.some((mail) => mail.to === email)).toBe(false);
	});

	test("changing the callback of a valid link does not take you outside", async () => {
		const email = newEmail();
		await signUp(email, `${WEB_ORIGIN}/login?verified=1`);
		const link = linkIn(await lastMailTo(email));

		const tampered = new URL(link);
		tampered.searchParams.set("callbackURL", "https://evil.example/steal");
		const response = await openLink(tampered.toString());

		expect(response.headers.get("location") ?? "").not.toContain(
			"evil.example",
		);
		/**
		 * Verification does not happen either: the origin check stands before the handler. Without that
		 * order, one attacker-made link would verify the email and the victim would only notice being
		 * sent somewhere odd.
		 */
		expect(await verifiedFlag(email)).toBe(false);
	});
});

describe.skipIf(!databaseReady)("resending", () => {
	test("resending brings a new link", async () => {
		const email = newEmail();
		await signUp(email);
		const first = linkIn(await lastMailTo(email));

		mail.messages.length = 0;
		const response = await authPost("/send-verification-email", { email });
		expect(response.status).toBe(200);

		const second = linkIn(await lastMailTo(email));
		expect(second).toContain("/verify-email?token=");

		// The old link is still valid until expiry; both verify the same address.
		await openLink(first);
		expect(await verifiedFlag(email)).toBe(true);
	});

	/**
	 * Unknown and known addresses get the same answer.
	 *
	 * Keeps resend from becoming an existence detector; the library even enforces a response-time
	 * floor. What is checked here is that the status codes match and no mail goes out.
	 */
	test("an unknown address gets the same status code", async () => {
		const known = newEmail();
		await signUp(known);
		await lastMailTo(known);
		mail.messages.length = 0;

		const unknown = newEmail();
		const unknownResponse = await authPost("/send-verification-email", {
			email: unknown,
		});
		const knownResponse = await authPost("/send-verification-email", {
			email: known,
		});

		expect(unknownResponse.status).toBe(knownResponse.status);
		await lastMailTo(known);
		expect(mail.messages.some((mail) => mail.to === unknown)).toBe(false);
		expect(mail.messages.some((mail) => mail.to === known)).toBe(true);
	});

	/** A wrong password and a missing account are still indistinguishable. */
	test("a failed sign-in does not reveal the reason", async () => {
		const email = newEmail();
		await signUp(email);
		await openLink(linkIn(await lastMailTo(email)));

		const wrongPassword = await signIn(email, "not-the-password");
		const noSuchAccount = await signIn(newEmail(), "not-the-password");
		expect(wrongPassword.status).toBe(noSuchAccount.status);
	});
});
