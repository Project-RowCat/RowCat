import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { app } from "../app.ts";
import { closeDb, db } from "../db/client.ts";
import { member, user } from "../db/schema.ts";
import { newId } from "../lib/id.ts";
import type { TransactionalMessage } from "../services/mail/index.ts";
import { TEST_PASSWORD } from "../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../test/database.ts";
import { authPost, cookieFromResponse, WEB_ORIGIN } from "../test/http.ts";
import { captureMail } from "../test/mail.ts";

/**
 * Email change completes only when both addresses agree. Two invariants:
 *
 * 1. `user.email` never changes without confirmation.
 * 2. Changing the email never moves the RowCat member identity. The local database scope and
 *    sync namespace are keyed on `Viewer.id`, so a changed member id makes conversations and drafts
 *    look wiped, and that state does not heal.
 *
 * Also pins that an email collision never merges accounts.
 */

const EMAIL_PREFIX = "change-email-test-";

// Mail is captured in-process and never reaches the network.
const mail = captureMail();

const openLink = async (url: string, cookie?: string): Promise<Response> => {
	const parsed = new URL(url);
	return app.request(parsed.pathname + parsed.search, {
		headers: {
			Origin: WEB_ORIGIN,
			...(cookie ? { Cookie: cookie } : {}),
		},
	});
};

const linkIn = mail.linkIn;
const mailsTo = (email: string): TransactionalMessage[] =>
	mail.messages.filter((message) => message.to === email);
/**
 * The senders do not await the mail (so response time does not reveal registration; see
 * `sendWithoutWaiting` in `auth/index.ts`), so the mailbox may still be empty when the response
 * returns.
 */
const lastMailTo = (email: string) =>
	vi.waitFor(() => mail.lastTo(email), { timeout: 2000, interval: 10 });

/**
 * A short wait before asserting that **no** mail went out. With background sending, a wrongly sent
 * mail would arrive after the response; checking at once would pass whatever the code did.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

const newAddress = (): string => `${EMAIL_PREFIX}${newId()}@example.test`;

interface Account {
	cookie: string;
	email: string;
	authUserId: string;
	memberId: string;
}

/**
 * A verified account. The verification link must really be followed: setting `emailVerified` by
 * hand skips the first step (the approval request to the current address), because the library
 * branches on that flag.
 */
async function signUpVerified(): Promise<Account> {
	const email = newAddress();
	await authPost("/sign-up/email", {
		name: "Change test",
		email,
		password: TEST_PASSWORD,
	});
	await openLink(linkIn(await lastMailTo(email)));

	const signedIn = await authPost("/sign-in/email", {
		email,
		password: TEST_PASSWORD,
	});
	const cookie = cookieFromResponse(signedIn);

	const [authUser] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, email));
	// The member row is created on the first request (ensureMember in auth/viewer.ts).
	const viewer = (await (
		await app.request("/v2/me", { headers: { Cookie: cookie } })
	).json()) as { id: string };

	return { cookie, email, authUserId: authUser?.id ?? "", memberId: viewer.id };
}

const emailOf = async (authUserId: string): Promise<string | undefined> => {
	const [row] = await db
		.select({ email: user.email })
		.from(user)
		.where(eq(user.id, authUserId));
	return row?.email;
};

const databaseReady = await connectTestDatabase();

beforeEach(() => {
	mail.reset();
});

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	mail.restore();
	await closeDb();
});

describe.skipIf(!databaseReady)("email change", () => {
	/**
	 * Nothing changes until both steps are done. `user.email` is re-read at every step rather than
	 * trusting the response, which is `{ status: true }` in all three cases (approval sent,
	 * new-address confirmation sent, collision with nothing done) and only one of them actually moves
	 * the address.
	 */
	test("completes only after the current address approves and the new address confirms", async () => {
		const alice = await signUpVerified();
		const next = newAddress();

		mail.reset();
		const requested = await authPost(
			"/change-email",
			{ newEmail: next, callbackURL: `${WEB_ORIGIN}/account?email=changed` },
			alice.cookie,
		);
		expect(requested.status).toBe(200);

		// Step 1: the approval request goes to the current address; the new one gets nothing yet.
		await vi.waitFor(() => expect(mailsTo(alice.email)).toHaveLength(1));
		expect(mailsTo(next)).toHaveLength(0);
		expect((await lastMailTo(alice.email)).text).toContain(next);
		expect(await emailOf(alice.authUserId)).toBe(alice.email);

		// Step 2: approving sends the confirmation to the new address; the address is still unchanged.
		const approveLink = linkIn(await lastMailTo(alice.email));
		mail.reset();
		await openLink(approveLink, alice.cookie);

		await vi.waitFor(() => expect(mailsTo(next)).toHaveLength(1));
		expect(await emailOf(alice.authUserId)).toBe(alice.email);

		// Step 3: only confirming from the new address changes it.
		await openLink(linkIn(await lastMailTo(next)), alice.cookie);
		expect(await emailOf(alice.authUserId)).toBe(next);

		// The new address is already verified, so sign-in works immediately.
		const [row] = await db
			.select({ verified: user.emailVerified })
			.from(user)
			.where(eq(user.id, alice.authUserId));
		expect(row?.verified).toBe(true);
		expect(
			(
				await authPost("/sign-in/email", {
					email: next,
					password: TEST_PASSWORD,
				})
			).status,
		).toBe(200);
		// The old address no longer signs in.
		expect(
			(
				await authPost("/sign-in/email", {
					email: alice.email,
					password: TEST_PASSWORD,
				})
			).status,
		).not.toBe(200);
	});

	/**
	 * Email is not ownership. The most important assertion here and the quietest failure: a changed
	 * member id splits the local database and sync namespace, which looks like all conversations
	 * vanished.
	 */
	test("the auth account and member stay the same when the address changes", async () => {
		const alice = await signUpVerified();
		const next = newAddress();

		mail.reset();
		await authPost("/change-email", { newEmail: next }, alice.cookie);
		await openLink(linkIn(await lastMailTo(alice.email)), alice.cookie);
		await openLink(linkIn(await lastMailTo(next)), alice.cookie);
		expect(await emailOf(alice.authUserId)).toBe(next);

		// Same auth account id; no new row.
		const rows = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, next));
		expect(rows.map((row) => row.id)).toEqual([alice.authUserId]);

		// Same member row, both its id and the auth account it hangs from.
		const [memberRow] = await db
			.select({ id: member.id, userId: member.user_id })
			.from(member)
			.where(eq(member.user_id, alice.authUserId));
		expect(memberRow?.id).toBe(alice.memberId);
		expect(memberRow?.userId).toBe(alice.authUserId);

		// `/me` answers with the same identity.
		const signedIn = await authPost("/sign-in/email", {
			email: next,
			password: TEST_PASSWORD,
		});
		const viewer = (await (
			await app.request("/v2/me", {
				headers: { Cookie: cookieFromResponse(signedIn) },
			})
		).json()) as { id: string };
		expect(viewer.id).toBe(alice.memberId);
	});

	/**
	 * A collision never silently merges. The library returns success and does nothing when the address
	 * is taken (existence hiding), so what is asserted is state, not the response: both accounts
	 * remain as they were.
	 */
	test("not moved to an address someone else uses, and not merged either", async () => {
		const alice = await signUpVerified();
		const bob = await signUpVerified();

		mail.reset();
		const response = await authPost(
			"/change-email",
			{ newEmail: bob.email },
			alice.cookie,
		);
		// A success-looking response is how existence stays hidden.
		expect(response.status).toBe(200);

		// Bob gets no mail; one would itself be a detection signal.
		await settle();
		expect(mailsTo(bob.email)).toHaveLength(0);

		// Both accounts are unchanged.
		expect(await emailOf(alice.authUserId)).toBe(alice.email);
		expect(await emailOf(bob.authUserId)).toBe(bob.email);

		// Both members unchanged; no trace of a merge.
		const aliceMember = await db
			.select({ id: member.id })
			.from(member)
			.where(eq(member.user_id, alice.authUserId));
		const bobMember = await db
			.select({ id: member.id })
			.from(member)
			.where(eq(member.user_id, bob.authUserId));
		expect(aliceMember.map((row) => row.id)).toEqual([alice.memberId]);
		expect(bobMember.map((row) => row.id)).toEqual([bob.memberId]);
		expect(alice.memberId).not.toBe(bob.memberId);

		// Both still sign in with their own address.
		for (const account of [alice, bob])
			expect(
				(
					await authPost("/sign-in/email", {
						email: account.email,
						password: TEST_PASSWORD,
					})
				).status,
			).toBe(200);
	});

	// Same answer as the screen's own check, which saves the round trip.
	test("can't change to the same address", async () => {
		const alice = await signUpVerified();
		mail.reset();
		const response = await authPost(
			"/change-email",
			{ newEmail: alice.email },
			alice.cookie,
		);
		expect(response.status).not.toBe(200);
		expect(mail.messages).toHaveLength(0);
	});

	// The request has no slot naming a target, so without a session nothing can start.
	test("can't start a change without a session", async () => {
		const response = await authPost("/change-email", {
			newEmail: newAddress(),
		});
		expect(response.status).not.toBe(200);
		expect(mail.messages).toHaveLength(0);
	});

	/**
	 * Without opening the approval link nothing happens. A session thief's attempt lands in the
	 * original owner's mailbox and the account stays put, which is why step 1 goes to the current
	 * address.
	 */
	test("the address stays as is unless the approval link is opened", async () => {
		const alice = await signUpVerified();
		const next = newAddress();

		mail.reset();
		await authPost("/change-email", { newEmail: next }, alice.cookie);

		await lastMailTo(alice.email);
		expect(await emailOf(alice.authUserId)).toBe(alice.email);
		expect(mailsTo(next)).toHaveLength(0);
		expect(
			(
				await authPost("/sign-in/email", {
					email: next,
					password: TEST_PASSWORD,
				})
			).status,
		).not.toBe(200);
	});
});
