import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { closeDb, db } from "../../db/client.ts";
import { passkey, session, user } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { apiGet, apiPost } from "../../test/http.ts";
import { captureMail } from "../../test/mail.ts";

/**
 * Passkeys: the sanitized projection and the ownership boundary.
 *
 * The WebAuthn ceremony cannot run here (it needs a browser and an authenticator), and a fake
 * authenticator would prove only our own fake. So the state after the ceremony is created directly
 * and four rules are checked on top of it:
 *
 * ```text
 * 1. does the response carry cryptographic material   (it must not)
 * 2. can someone else's passkey be renamed or deleted (it must not)
 * 3. do rename and delete actually change state
 * 4. what does an operation on a missing passkey answer
 * ```
 *
 * Inserting rows is test-data setup, not imitating the protocol: listing, renaming and deleting all
 * go through the real routes and the real plugin (ownership is decided by its
 * `requireResourceOwnership`).
 */

const EMAIL_PREFIX = "me-account-passkeys-test-";

/** Mail sent by this file; the capture transport guarantees nothing reaches the network. */
const mail = captureMail();

const signUp = () => createTestMember(EMAIL_PREFIX, { name: "Passkey test" });

/**
 * Creates what the registration ceremony leaves behind.
 *
 * The public key need not be real: this file does not test signature verification (the library's
 * job), only whether the value leaves in a response. So a conspicuous string is used, which is
 * caught immediately if it shows up in a body.
 */
async function seedPasskey(
	authUserId: string,
	name: string | null,
	createdAt = new Date(),
): Promise<{ id: string; publicKey: string; credentialID: string }> {
	const id = newId();
	const row = {
		id,
		name,
		publicKey: `PUBLIC-KEY-MUST-NOT-LEAK-${id}`,
		userId: authUserId,
		credentialID: `CREDENTIAL-ID-MUST-NOT-LEAK-${id}`,
		counter: 0,
		deviceType: "singleDevice",
		backedUp: false,
		transports: "internal",
		createdAt,
		aaguid: "00000000-0000-0000-0000-000000000000",
	};
	await db.insert(passkey).values(row);
	return { id, publicKey: row.publicKey, credentialID: row.credentialID };
}

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	mail.restore();
	await closeDb();
});

interface PasskeysBody {
	passkeys: { id: string; name: string | null; createdAt: string }[];
}

describe.skipIf(!databaseReady)("passkey projection", () => {
	/**
	 * Counts the response's whole key set.
	 *
	 * Written as "no sensitive fields", the test would pass and leak the day the plugin adds a column;
	 * the public profile and owner-work projections already have the same kind of test.
	 */
	test("only three fields go out", async () => {
		const alice = await signUp();
		await seedPasskey(alice.authUserId, "MacBook");

		const response = await apiGet("/me/account/passkeys", alice.cookie);
		expect(response.status).toBe(200);
		const body = (await response.json()) as PasskeysBody;
		expect(body.passkeys).toHaveLength(1);
		expect(Object.keys(body.passkeys[0] ?? {}).sort()).toEqual([
			"createdAt",
			"id",
			"name",
		]);
	});

	/**
	 * No cryptographic material appears as a string anywhere in the body.
	 *
	 * The key-set test above already catches most of this; this one covers another failure mode, the
	 * server sending the value under a different name (a debug field), by scanning raw text.
	 */
	test("no public key, credential id or auth user id in the body", async () => {
		const bob = await signUp();
		const seeded = await seedPasskey(bob.authUserId, "iPhone");

		const raw = await (await apiGet("/me/account/passkeys", bob.cookie)).text();
		expect(raw).not.toContain(seeded.publicKey);
		expect(raw).not.toContain(seeded.credentialID);
		expect(raw).not.toContain(bob.authUserId);
		expect(raw).not.toContain("aaguid");
		expect(raw).not.toContain("counter");
	});

	/** No invented label: absent is `null`, and the screen picks the name. */
	test("a passkey with no name goes out as null", async () => {
		const carol = await signUp();
		await seedPasskey(carol.authUserId, null);
		const body = (await (
			await apiGet("/me/account/passkeys", carol.cookie)
		).json()) as PasskeysBody;
		expect(body.passkeys[0]?.name).toBeNull();
	});

	/** The server fixes the order; a shifting list would move the delete button to another row. */
	test("the most recently registered comes first", async () => {
		const dave = await signUp();
		const older = await seedPasskey(
			dave.authUserId,
			"old one",
			new Date(Date.now() - 60_000),
		);
		const newer = await seedPasskey(dave.authUserId, "new one", new Date());

		const body = (await (
			await apiGet("/me/account/passkeys", dave.cookie)
		).json()) as PasskeysBody;
		expect(body.passkeys.map((row) => row.id)).toEqual([newer.id, older.id]);
	});

	/** Guests get 401, not an empty list: the screen exists only for signed-in members. */
	test("no session is a 401", async () => {
		expect((await apiGet("/me/account/passkeys")).status).toBe(401);
	});
});

describe.skipIf(!databaseReady)("passkey ownership", () => {
	/**
	 * Someone else's passkey is the same as a missing one.
	 *
	 * Knowing the opaque reference does not allow touching it. The library's
	 * `requireResourceOwnership` decides (we do not recount), and since the codes do not diverge the
	 * response is not a detector for "that id exists".
	 */
	test("can't rename someone else's passkey", async () => {
		const alice = await signUp();
		const bob = await signUp();
		const bobKey = await seedPasskey(bob.authUserId, "Bob's MacBook");

		const response = await apiPost(
			"/me/account/passkeys/rename",
			{ id: bobKey.id, name: "hijacked" },
			alice.cookie,
		);
		expect(response.status).toBe(404);

		// Bob's row is untouched, name and existence.
		const [row] = await db
			.select({ name: passkey.name })
			.from(passkey)
			.where(eq(passkey.id, bobKey.id));
		expect(row?.name).toBe("Bob's MacBook");
	});

	test("can't delete someone else's passkey", async () => {
		const alice = await signUp();
		const bob = await signUp();
		const bobKey = await seedPasskey(bob.authUserId, "Bob's iPhone");

		const response = await apiPost(
			"/me/account/passkeys/delete",
			{ id: bobKey.id },
			alice.cookie,
		);
		expect(response.status).toBe(404);

		const rows = await db
			.select({ id: passkey.id })
			.from(passkey)
			.where(eq(passkey.id, bobKey.id));
		expect(rows).toHaveLength(1);
	});

	/** An unknown id gives the same 404 (existence hiding). */
	test("an unknown passkey is the same 404 as someone else's", async () => {
		const alice = await signUp();
		const response = await apiPost(
			"/me/account/passkeys/delete",
			{ id: newId() },
			alice.cookie,
		);
		expect(response.status).toBe(404);
		expect((await response.json()) as { code: string }).toMatchObject({
			code: "passkey_not_found",
		});
	});
});

/**
 * Deleting removes a way in, so it needs a recent sign-in, as registration does: a stolen cookie of
 * any age must not be able to strip the owner's passkeys. `createdAt` is pushed back because 24
 * hours cannot be waited out, and it is the value the freshness check reads.
 */
describe.skipIf(!databaseReady)("passkey deletion and an old session", () => {
	test("an old session cannot delete a passkey, and nothing changes", async () => {
		const alice = await signUp();
		const key = await seedPasskey(alice.authUserId, "Alice's iPhone");
		await db
			.update(session)
			.set({ createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48) })
			.where(eq(session.userId, alice.authUserId));

		const response = await apiPost(
			"/me/account/passkeys/delete",
			{ id: key.id },
			alice.cookie,
		);
		expect(response.status).toBe(403);
		expect((await response.json()) as { code: string }).toMatchObject({
			code: "recent_login_required",
		});
		const rows = await db
			.select({ id: passkey.id })
			.from(passkey)
			.where(eq(passkey.id, key.id));
		expect(rows).toHaveLength(1);
	});
});

describe.skipIf(!databaseReady)("passkey management", () => {
	test("renaming leaves the new label on the same id", async () => {
		const alice = await signUp();
		const seeded = await seedPasskey(alice.authUserId, "Old name");

		const response = await apiPost(
			"/me/account/passkeys/rename",
			{ id: seeded.id, name: "  New name  " },
			alice.cookie,
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as PasskeysBody;
		expect(body.passkeys).toHaveLength(1);
		expect(body.passkeys[0]?.id).toBe(seeded.id);
		// The contract applies `.trim()`: surrounding whitespace is not stored.
		expect(body.passkeys[0]?.name).toBe("New name");
	});

	test("an empty name is refused and the previous label stays", async () => {
		const alice = await signUp();
		const seeded = await seedPasskey(alice.authUserId, "unchanged");

		const response = await apiPost(
			"/me/account/passkeys/rename",
			{ id: seeded.id, name: "   " },
			alice.cookie,
		);
		expect(response.status).toBe(400);

		const body = (await (
			await apiGet("/me/account/passkeys", alice.cookie)
		).json()) as PasskeysBody;
		expect(body.passkeys[0]?.name).toBe("unchanged");
	});

	test("deleting removes it from the list", async () => {
		const alice = await signUp();
		const keep = await seedPasskey(alice.authUserId, "keep");
		const drop = await seedPasskey(alice.authUserId, "delete");

		const response = await apiPost(
			"/me/account/passkeys/delete",
			{ id: drop.id },
			alice.cookie,
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as PasskeysBody;
		expect(body.passkeys.map((row) => row.id)).toEqual([keep.id]);
	});

	/**
	 * The security notice goes out only on a successful delete.
	 *
	 * A failed delete (someone else's, or missing) producing a mail would announce something that did
	 * not happen and make the recipient doubt their account.
	 */
	test("a notice goes out only on a successful delete", async () => {
		const alice = await signUp();
		const seeded = await seedPasskey(alice.authUserId, "Notice test");

		mail.messages.length = 0;
		await apiPost("/me/account/passkeys/delete", { id: newId() }, alice.cookie);
		expect(mail.messages).toHaveLength(0);

		await apiPost(
			"/me/account/passkeys/delete",
			{ id: seeded.id },
			alice.cookie,
		);
		expect(mail.messages).toHaveLength(1);
		expect(mail.messages[0]?.to).toBe(alice.email);
		// It names which one was deleted; for someone with several, that is information.
		expect(mail.messages[0]?.text).toContain("Notice test");
		// It does not mention cryptographic material.
		expect(mail.messages[0]?.text).not.toContain(seeded.publicKey);
		expect(mail.messages[0]?.text).not.toContain(seeded.credentialID);
	});

	/**
	 * A retry gives the documented result.
	 *
	 * The second delete is a 404 (not idempotent), which differs from session revocation: there, "that
	 * reference is gone" is part of normal state (another device may have signed out), while a passkey
	 * is this account's asset list, so pointing at a missing one means the screen is stale. The 404 is
	 * indistinguishable from someone else's, so it is not a detector.
	 */
	test("deleting the same passkey twice gives 404 the second time", async () => {
		const alice = await signUp();
		const seeded = await seedPasskey(alice.authUserId, "twice");

		expect(
			(
				await apiPost(
					"/me/account/passkeys/delete",
					{ id: seeded.id },
					alice.cookie,
				)
			).status,
		).toBe(200);
		expect(
			(
				await apiPost(
					"/me/account/passkeys/delete",
					{ id: seeded.id },
					alice.cookie,
				)
			).status,
		).toBe(404);
	});
});

describe.skipIf(!databaseReady)("passkeys and account deletion", () => {
	/**
	 * Passkeys disappear with the auth account.
	 *
	 * The cascade does this, so the deletion service does not enumerate this table; the test confirms
	 * that fact by value. Otherwise ownerless credential rows would remain.
	 */
	test("deleting the auth account leaves no passkey rows", async () => {
		const alice = await signUp();
		const seeded = await seedPasskey(alice.authUserId, "Account deletion test");

		await db.delete(user).where(eq(user.id, alice.authUserId));

		const rows = await db
			.select({ id: passkey.id })
			.from(passkey)
			.where(
				and(eq(passkey.id, seeded.id), eq(passkey.userId, alice.authUserId)),
			);
		expect(rows).toEqual([]);
	});
});
