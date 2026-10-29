import { eq, isNull, or } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import {
	account,
	block,
	favorite,
	follow,
	media,
	media_blob,
	member,
	member_restriction,
	moderation_action,
	moderation_appeal,
	moderation_case,
	moderation_report,
	notification,
	session,
	story,
	story_play_starter,
	story_view_log,
	sync_keyring,
	sync_pairing,
	sync_push_dedupe,
	sync_record,
	sync_state,
	user,
} from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import { createTestMember, TEST_PASSWORD } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { cookieFromResponse, WEB_ORIGIN } from "../../test/http.ts";

/**
 * Account deletion: verifies the whole data graph, not just the member row. Failures happen around
 * it: view records left on others' works, follows of me, counters drifting when favorites are
 * removed, and above all other people's data. So each test makes two people, deletes Alice, and
 * checks that Bob is untouched.
 *
 * Runs on real Postgres and the real Hono app: half of what is verified is FK cascades and
 * transaction boundaries, the other half is Better Auth's identity check, and mocks only imitate
 * both.
 */

const EMAIL_PREFIX = "account-deletion-test-";

/**
 * A member. The final `/me` matters: member rows are created on the first request, not at signup
 * (`ensureMember` in `auth/viewer.ts`).
 */
const signUp = (name = "Account deletion test") =>
	createTestMember(EMAIL_PREFIX, { name });

/** A second device of the same account; checking that all sessions are revoked needs two sessions. */
async function signIn(email: string): Promise<string> {
	const response = await app.request("/v2/auth/sign-in/email", {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: WEB_ORIGIN },
		body: JSON.stringify({ email, password: TEST_PASSWORD }),
	});
	return cookieFromResponse(response);
}

/**
 * Converts to a social-only account by dropping the credential row and adding a Google row. The
 * real OAuth round trip cannot run here and leaves only an account row, which is also what Better
 * Auth checks for "has a password".
 */
async function makeSocialOnly(authUserId: string): Promise<void> {
	await db.delete(account).where(eq(account.userId, authUserId));
	const at = new Date();
	await db.insert(account).values({
		id: newId(),
		accountId: `google-${authUserId}`,
		providerId: "google",
		issuer: "local:oauth:google",
		userId: authUserId,
		createdAt: at,
		updatedAt: at,
	});
}

/** Pushes the session into the past; the "recent login" check reads `createdAt`. */
const ageSession = (authUserId: string, days: number) =>
	db
		.update(session)
		.set({ createdAt: new Date(Date.now() - days * 24 * 60 * 60 * 1000) })
		.where(eq(session.userId, authUserId));

const deleteAccount = (
	cookie: string,
	body: Record<string, unknown> = {},
): Promise<Response> =>
	Promise.resolve(
		app.request("/v2/auth/delete-user", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				Cookie: cookie,
			},
			body: JSON.stringify(body),
		}),
	);

interface SeedStory {
	id: string;
	visibility: "public" | "private" | "archived";
}

async function seedStory(
	ownerId: string,
	visibility: SeedStory["visibility"],
): Promise<SeedStory> {
	const id = newId();
	await db.insert(story).values({
		id,
		owner: ownerId,
		title: `Story ${id.slice(0, 6)}`,
		visibility,
		origin_draft_id: newId(),
		play_payload: { v: 1 },
	});
	return { id, visibility };
}

/** One sync namespace: cursor, keyring, ciphertext, idempotency records and an open pairing. */
async function seedSync(ownerId: string): Promise<void> {
	await db.insert(sync_state).values({ owner: ownerId, seq: 1 });
	await db.insert(sync_keyring).values({
		owner: ownerId,
		keyring: '{"v":1}',
		auth_key: "opaque",
	});
	await db.insert(sync_record).values({
		owner: ownerId,
		id: newId(),
		type: "chat.room",
		ciphertext: "opaque",
		envelope: 1,
		version: 1,
		seq: 1,
		bytes: 6,
	});
	/**
	 * An open device pairing, a key-material relay that may exist at deletion time. If it survived, a
	 * new device holding that envelope could still receive the key after deletion.
	 */
	await db.insert(sync_pairing).values({
		owner: ownerId,
		code_hash: "a".repeat(64),
		new_pub: "opaque",
		payload: null,
		expires_at: new Date(Date.now() + 300_000),
	});
	await db.insert(sync_push_dedupe).values({
		owner: ownerId,
		idempotency_key: newId(),
		request_hash: "hash",
		response: "{}",
		expires_at: new Date(Date.now() + 60_000),
	});
}

const rows = async <T>(query: Promise<T[]>): Promise<number> =>
	(await query).length;

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) {
		/**
		 * The anonymized story has no owner, so it is not removed with the user; it is the only orphan
		 * row the test leaves, so it is cleaned up here.
		 */
		await db.delete(story).where(isNull(story.owner));
		await deleteTestUsers(EMAIL_PREFIX);
	}
	await closeDb();
});

describe.skipIf(!databaseReady)("account deletion — identity check", () => {
	test("a guest has no account to delete", async () => {
		const response = await deleteAccount("");
		expect(response.status).toBe(401);
	});

	test("a wrong password deletes **nothing**", async () => {
		const alice = await signUp();
		await seedStory(alice.memberId, "private");
		await seedSync(alice.memberId);

		const response = await deleteAccount(alice.cookie, {
			password: "wrong-password-entirely",
		});
		expect(response.status).toBe(400);

		// Account, member and data are untouched, and the session stays alive so a retry is possible.
		expect(
			await rows(db.select().from(user).where(eq(user.id, alice.authUserId))),
		).toBe(1);
		expect(
			await rows(db.select().from(member).where(eq(member.id, alice.memberId))),
		).toBe(1);
		expect(
			await rows(
				db.select().from(story).where(eq(story.owner, alice.memberId)),
			),
		).toBe(1);
		expect(
			await rows(
				db
					.select()
					.from(sync_record)
					.where(eq(sync_record.owner, alice.memberId)),
			),
		).toBe(1);
		expect(
			(await app.request("/v2/me", { headers: { Cookie: alice.cookie } }))
				.status,
		).toBe(200);
	});

	test("a social-only account is deleted after a recent sign-in", async () => {
		const alice = await signUp();
		await makeSocialOnly(alice.authUserId);

		// A just-created session is fresh, so no password prompt is needed.
		const response = await deleteAccount(alice.cookie);
		expect(response.status).toBe(200);
		expect(
			await rows(db.select().from(user).where(eq(user.id, alice.authUserId))),
		).toBe(0);
	});

	/**
	 * The library checks a password only when one is sent, so a fresh session alone used to delete a
	 * password account. Our rule (`auth/account-deletion-policy.ts`) closes that.
	 */
	test("a password account is not deleted on a fresh session alone", async () => {
		const alice = await signUp();

		const response = await deleteAccount(alice.cookie);
		expect(response.status).toBe(400);
		expect(((await response.json()) as { code?: string }).code).toBe(
			"INVALID_PASSWORD",
		);
		expect(
			await rows(db.select().from(user).where(eq(user.id, alice.authUserId))),
		).toBe(1);

		expect(
			(await deleteAccount(alice.cookie, { password: TEST_PASSWORD })).status,
		).toBe(200);
	});

	test("an old session can't delete without a password", async () => {
		const alice = await signUp();
		await makeSocialOnly(alice.authUserId);
		await ageSession(alice.authUserId, 3);

		const response = await deleteAccount(alice.cookie);
		expect(response.status).toBe(400);
		// A months-old stolen session must not permanently delete the account.
		expect(
			await rows(db.select().from(user).where(eq(user.id, alice.authUserId))),
		).toBe(1);
	});

	test("a second request doesn't revive anything", async () => {
		const alice = await signUp();
		expect(
			(await deleteAccount(alice.cookie, { password: TEST_PASSWORD })).status,
		).toBe(200);

		// Retry by a client that lost the response: authentication is gone, so 401 and nothing more.
		const retry = await deleteAccount(alice.cookie, {
			password: TEST_PASSWORD,
		});
		expect(retry.status).toBe(401);
		expect(
			await rows(db.select().from(user).where(eq(user.id, alice.authUserId))),
		).toBe(0);
		expect(
			await rows(db.select().from(member).where(eq(member.id, alice.memberId))),
		).toBe(0);
	});
});

describe.skipIf(!databaseReady)("account deletion — uploaded media", () => {
	/**
	 * Guards that the bytes are not tied to the DB cascade. The `media` row goes with the
	 * `media.owner` FK, but `media_blob` deliberately has no FK (storage is key-value), so the
	 * deletion service deletes the bytes explicitly, outside the transaction. Without this test,
	 * removing that step passes silently and the deleted person's face photo stays in storage forever.
	 */
	test("the avatar row and bytes disappear together", async () => {
		const person = await signUp();

		/** Goes through the real normalization boundary; the storage key must be server-issued to be meaningful. */
		const size = 600;
		const raw = Buffer.alloc(size * size * 3);
		for (let i = 0; i < raw.length; i += 1) raw[i] = (i * 7) % 256;
		const image = await sharp(raw, {
			raw: { width: size, height: size, channels: 3 },
		})
			.png()
			.toBuffer();

		const uploaded = await app.request("/v2/me/avatar", {
			method: "PUT",
			headers: {
				Origin: WEB_ORIGIN,
				Cookie: person.cookie,
				"Content-Type": "image/png",
			},
			body: new Uint8Array(image),
		});
		expect(uploaded.status).toBe(200);

		const [row] = await db
			.select({ id: media.id, key: media.storage_key })
			.from(media)
			.where(eq(media.owner, person.memberId));
		expect(row).toBeDefined();
		const storageKey = row?.key ?? "";

		const response = await deleteAccount(person.cookie, {
			password: TEST_PASSWORD,
		});
		expect(response.status).toBe(200);

		/** Rows go by cascade, bytes by the service; both must be gone. */
		expect(
			await rows(
				db.select().from(media).where(eq(media.owner, person.memberId)),
			),
		).toBe(0);
		expect(
			await rows(
				db
					.select()
					.from(media_blob)
					.where(eq(media_blob.storage_key, storageKey)),
			),
		).toBe(0);
	});
});

describe.skipIf(!databaseReady)("account deletion — sessions", () => {
	test("sessions on other devices are cut too", async () => {
		const alice = await signUp();
		const secondDevice = await signIn(alice.email);
		expect(
			(await app.request("/v2/me", { headers: { Cookie: secondDevice } }))
				.status,
		).toBe(200);

		expect(
			(await deleteAccount(alice.cookie, { password: TEST_PASSWORD })).status,
		).toBe(200);

		/**
		 * If the second device is still signed in, deletion is half done. `/me` returns null rather than
		 * 401 for guests, so check the body.
		 */
		const me = await app.request("/v2/me", {
			headers: { Cookie: secondDevice },
		});
		expect(await me.json()).toBeNull();
		expect(
			await rows(
				db.select().from(session).where(eq(session.userId, alice.authUserId)),
			),
		).toBe(0);
		// Login methods (password hash, OAuth tokens) are gone too.
		expect(
			await rows(
				db.select().from(account).where(eq(account.userId, alice.authUserId)),
			),
		).toBe(0);
	});
});

describe.skipIf(!databaseReady)("account deletion — the data graph", () => {
	/**
	 * Guards the P0: nothing of Bob's is touched. Alice is deleted while the two follow, favorite and
	 * block each other; a delete predicate that misses the member axis makes Bob vanish here.
	 */
	test("only Alice disappears and Bob stays as is", async () => {
		const alice = await signUp("Alice");
		const bob = await signUp("Bob");

		const alicePublic = await seedStory(alice.memberId, "public");
		const alicePrivate = await seedStory(alice.memberId, "private");
		const aliceArchived = await seedStory(alice.memberId, "archived");
		const bobPublic = await seedStory(bob.memberId, "public");

		// Mutual favorites; counters are raised too, to match real state.
		await db.insert(favorite).values([
			{ story_id: bobPublic.id, member_id: alice.memberId },
			{ story_id: alicePublic.id, member_id: bob.memberId },
		]);
		await db
			.update(story)
			.set({ favorites: 1 })
			.where(or(eq(story.id, bobPublic.id), eq(story.id, alicePublic.id)));

		await db.insert(follow).values([
			{ follower: alice.memberId, creator: bob.memberId },
			{ follower: bob.memberId, creator: alice.memberId },
		]);
		await db.insert(block).values([
			{ blocker: alice.memberId, creator: bob.memberId },
			{ blocker: bob.memberId, creator: alice.memberId },
		]);

		// View records left on others' works; no member FK, so the cascade does not reach them.
		await db.insert(story_view_log).values([
			{
				story_id: bobPublic.id,
				viewer: `m:${alice.memberId}`,
				day: "2026-01-01",
			},
			{
				story_id: alicePublic.id,
				viewer: `m:${bob.memberId}`,
				day: "2026-01-01",
			},
		]);

		await seedSync(alice.memberId);
		await seedSync(bob.memberId);

		expect(
			(await deleteAccount(alice.cookie, { password: TEST_PASSWORD })).status,
		).toBe(200);

		/* Kept: one public story, with identity erased */
		const [preserved] = await db
			.select({
				owner: story.owner,
				originDraftId: story.origin_draft_id,
				title: story.title,
			})
			.from(story)
			.where(eq(story.id, alicePublic.id));
		expect(preserved).toBeDefined();
		expect(preserved?.owner).toBeNull();
		// The device-created draft id is not kept either; it is a trace of the deleted person.
		expect(preserved?.originDraftId).toBeNull();

		/* Removed: private and archived stories */
		expect(
			await rows(db.select().from(story).where(eq(story.id, alicePrivate.id))),
		).toBe(0);
		expect(
			await rows(db.select().from(story).where(eq(story.id, aliceArchived.id))),
		).toBe(0);

		/* Removed: relations, view records, sync */
		expect(
			await rows(
				db
					.select()
					.from(favorite)
					.where(eq(favorite.member_id, alice.memberId)),
			),
		).toBe(0);
		expect(
			await rows(
				db
					.select()
					.from(follow)
					.where(
						or(
							eq(follow.follower, alice.memberId),
							eq(follow.creator, alice.memberId),
						),
					),
			),
		).toBe(0);
		expect(
			await rows(
				db
					.select()
					.from(block)
					.where(
						or(
							eq(block.blocker, alice.memberId),
							eq(block.creator, alice.memberId),
						),
					),
			),
		).toBe(0);
		expect(
			await rows(
				db
					.select()
					.from(story_view_log)
					.where(eq(story_view_log.viewer, `m:${alice.memberId}`)),
			),
		).toBe(0);
		/**
		 * The sync namespace must vanish as all five parts together. If any remains, the next person
		 * signing up with the same method meets an old cursor or keyring, which is a reset rather than a
		 * deletion.
		 */
		expect({
			record: await rows(
				db
					.select()
					.from(sync_record)
					.where(eq(sync_record.owner, alice.memberId)),
			),
			state: await rows(
				db
					.select()
					.from(sync_state)
					.where(eq(sync_state.owner, alice.memberId)),
			),
			keyring: await rows(
				db
					.select()
					.from(sync_keyring)
					.where(eq(sync_keyring.owner, alice.memberId)),
			),
			dedupe: await rows(
				db
					.select()
					.from(sync_push_dedupe)
					.where(eq(sync_push_dedupe.owner, alice.memberId)),
			),
			pairing: await rows(
				db
					.select()
					.from(sync_pairing)
					.where(eq(sync_pairing.owner, alice.memberId)),
			),
		}).toEqual({ record: 0, state: 0, keyring: 0, dedupe: 0, pairing: 0 });

		/* Bob is entirely untouched */
		expect(
			await rows(db.select().from(member).where(eq(member.id, bob.memberId))),
		).toBe(1);
		expect(
			await rows(db.select().from(story).where(eq(story.id, bobPublic.id))),
		).toBe(1);
		expect(
			await rows(
				db
					.select()
					.from(sync_record)
					.where(eq(sync_record.owner, bob.memberId)),
			),
		).toBe(1);
		expect(
			await rows(
				db
					.select()
					.from(sync_keyring)
					.where(eq(sync_keyring.owner, bob.memberId)),
			),
		).toBe(1);
		// Bob's favorite on the kept public story survives because the story does.
		expect(
			await rows(
				db.select().from(favorite).where(eq(favorite.member_id, bob.memberId)),
			),
		).toBe(1);
		expect(
			await rows(
				db
					.select()
					.from(story_view_log)
					.where(eq(story_view_log.viewer, `m:${bob.memberId}`)),
			),
		).toBe(1);

		/**
		 * The counter was rolled back. Deleting only the row would leave Bob's story total inflated by
		 * one permanently, a drift that does not self-heal.
		 */
		const [bobStory] = await db
			.select({ favorites: story.favorites })
			.from(story)
			.where(eq(story.id, bobPublic.id));
		expect(bobStory?.favorites).toBe(0);
	});

	/**
	 * Notification asymmetry: received ones are deleted, ones made for others only lose identity
	 * (§124). Both directions are checked together because they are a pair: checking only the first
	 * passes a wrong implementation that erases lines from others' inboxes (something that really
	 * happened to them), and checking only the second passes even if the deleted person's private
	 * inbox remains. Also confirms there is no name to erase, since no nickname snapshot exists: a
	 * NULL `actor` means the name is nowhere.
	 */
	test("received notifications disappear, and notifications created for others lose only the identity", async () => {
		const alice = await signUp("Alice");
		const bob = await signUp("Bob");

		// Alice follows Bob, creating a line in Bob's inbox with Alice as actor.
		await app.request("/v2/follows", {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				Cookie: alice.cookie,
			},
			body: JSON.stringify({ creator: bob.memberId, following: true }),
		});
		// The other direction creates a line in Alice's inbox.
		await app.request("/v2/follows", {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				Cookie: bob.cookie,
			},
			body: JSON.stringify({ creator: alice.memberId, following: true }),
		});

		const summary = await deleteAccount(alice.cookie, {
			password: TEST_PASSWORD,
		});
		expect(summary.status).toBe(200);

		// What Alice received is gone.
		expect(
			await rows(
				db
					.select()
					.from(notification)
					.where(eq(notification.recipient, alice.memberId)),
			),
		).toBe(0);

		// Bob's inbox keeps the line but loses the identity.
		const bobInbox = await db
			.select({ actor: notification.actor, kind: notification.kind })
			.from(notification)
			.where(eq(notification.recipient, bob.memberId));
		expect(bobInbox).toHaveLength(1);
		expect(bobInbox[0]?.kind).toBe("follow");
		expect(bobInbox[0]?.actor).toBeNull();
	});

	test("an account that only signed up and has no member row is deleted too", async () => {
		const email = `${EMAIL_PREFIX}${newId()}@example.test`;
		const response = await app.request("/v2/auth/sign-up/email", {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: WEB_ORIGIN },
			body: JSON.stringify({
				name: "No activity",
				email,
				password: TEST_PASSWORD,
			}),
		});
		const cookie = cookieFromResponse(response);
		const authUserId = ((await response.json()) as { user: { id: string } })
			.user.id;
		// `/me` was not called, so no member row exists (members are created on the first request).
		expect(
			await rows(
				db.select().from(member).where(eq(member.user_id, authUserId)),
			),
		).toBe(0);

		expect(
			(await deleteAccount(cookie, { password: TEST_PASSWORD })).status,
		).toBe(200);
		expect(
			await rows(db.select().from(user).where(eq(user.id, authUserId))),
		).toBe(0);
	});
});

describe.skipIf(!databaseReady)(
	"account deletion — remaining stories don't break",
	() => {
		test("a public story whose identity was erased stays visible in the gallery and detail", async () => {
			const alice = await signUp("Alice");
			const bob = await signUp("Bob");
			const preserved = await seedStory(alice.memberId, "public");

			/**
			 * Bob has blocked someone. This condition is the point of the test: in SQL `NULL NOT IN (…)` is
			 * NULL, so a block predicate left as is would drop ownerless stories from the list entirely,
			 * regardless of the block list.
			 */
			const carol = await signUp("Carol");
			await db
				.insert(block)
				.values({ blocker: bob.memberId, creator: carol.memberId });

			expect(
				(await deleteAccount(alice.cookie, { password: TEST_PASSWORD })).status,
			).toBe(200);

			const detail = await app.request(`/v2/stories/${preserved.id}`, {
				headers: { Cookie: bob.cookie },
			});
			expect(detail.status).toBe(200);
			const body = (await detail.json()) as {
				creator: unknown;
				title: string;
			};
			// The creator slot is null, not a fake account or an empty string.
			expect(body.creator).toBeNull();

			const list = await app.request("/v2/stories", {
				headers: { Cookie: bob.cookie },
			});
			const page = (await list.json()) as { items: { id: string }[] };
			expect(page.items.map((item) => item.id)).toContain(preserved.id);
		});
	},
);

/**
 * What deletion does to moderation data splits three ways (§69, §70):
 *
 * ```text
 * delete ①  reports carrying private conversation evidence (ai_response)   that person's conversation
 * delete ②  cases whose target vanished, with their actions and appeals    nothing left to point at
 * detach identity only  reports about others' content                      review must continue
 * ```
 *
 * This block checks that the split exists in code. Collapsing to "delete all" loses review of
 * others' works, and "keep all" leaves the deleted account's conversations and sanction history on
 * the server.
 */
describe.skipIf(!databaseReady)("deletion — engagement signals", () => {
	/**
	 * Deletion detaches identity only; the performance of others' works does not shrink. Same rule as
	 * views and play starts: removing rows would retroactively shrink the window's engagement signal
	 * and split the cumulative counter from the ledger, which creators would see only as last week's
	 * performance silently dropping.
	 */
	test("participant rows lose only the identity and remain — the counters stay", async () => {
		const creator = await signUp("Creator");
		const player = await signUp("Player");
		const target = await seedStory(creator.memberId, "public");

		await db.insert(story_play_starter).values({
			story_id: target.id,
			member_id: player.memberId,
		});
		await db
			.update(story)
			.set({ unique_play_starters: 1 })
			.where(eq(story.id, target.id));

		expect(
			(await deleteAccount(player.cookie, { password: TEST_PASSWORD })).status,
		).toBe(200);

		const rows = await db
			.select()
			.from(story_play_starter)
			.where(eq(story_play_starter.story_id, target.id));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.member_id).toBeNull();

		const [counted] = await db
			.select({ n: story.unique_play_starters })
			.from(story)
			.where(eq(story.id, target.id));
		expect(counted?.n).toBe(1);
	});

	/** When a story disappears, its participant rows go with it (cascade). */
	test("participant rows of stories deleted with the creator's account disappear with them", async () => {
		const creator = await signUp("Creator");
		const player = await signUp("Player");
		/** Private stories are deleted with the account; only public ones survive with identity detached. */
		const target = await seedStory(creator.memberId, "private");
		await db.insert(story_play_starter).values({
			story_id: target.id,
			member_id: player.memberId,
		});

		expect(
			(await deleteAccount(creator.cookie, { password: TEST_PASSWORD })).status,
		).toBe(200);

		expect(
			await db
				.select()
				.from(story_play_starter)
				.where(eq(story_play_starter.story_id, target.id)),
		).toHaveLength(0);
	});
});

describe.skipIf(!databaseReady)("deletion — moderation data", () => {
	/** Operator account; columns are written directly (the product API has no promotion path). */
	const promote = (memberId: string) =>
		db.update(member).set({ role: "staff" }).where(eq(member.id, memberId));

	const report = (cookie: string, body: unknown) =>
		app.request("/v2/reports", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				Cookie: cookie,
			},
			body: JSON.stringify(body),
		});

	test("reports about other people's content lose **only the identity**", async () => {
		const alice = await signUp("Alice");
		const bob = await signUp("Bob");
		const target = await seedStory(bob.memberId, "public");
		expect(
			(
				await report(alice.cookie, {
					target: { type: "story", storyId: target.id },
					reason: "spam",
				})
			).status,
		).toBe(201);

		expect(
			(await deleteAccount(alice.cookie, { password: TEST_PASSWORD })).status,
		).toBe(200);

		const [row] = await db
			.select()
			.from(moderation_report)
			.where(eq(moderation_report.target_id, target.id));
		expect(row).toBeDefined();
		expect(row?.reporter).toBeNull();
	});

	test("reports carrying private conversation evidence disappear **entirely**", async () => {
		const alice = await signUp("Alice");
		const created = await report(alice.cookie, {
			target: {
				type: "ai_response",
				evidence: {
					response: {
						content: "Alice's conversation content",
						createdAt: "2026-08-20T00:00:00.000Z",
					},
				},
			},
			reason: "minor_safety",
		});
		expect(created.status).toBe(201);
		const { reportId } = (await created.json()) as { reportId: string };
		const [before] = await db
			.select()
			.from(moderation_report)
			.where(eq(moderation_report.id, reportId));
		const caseId = before?.case_id ?? "";

		await deleteAccount(alice.cookie, { password: TEST_PASSWORD });

		/**
		 * Detaching identity only is not the answer here: an anonymized conversation log is still that
		 * person's writing, and the only plaintext that left E2EE.
		 */
		expect(
			await rows(
				db
					.select()
					.from(moderation_report)
					.where(eq(moderation_report.id, reportId)),
			),
		).toBe(0);
		/** Cases whose target is gone disappear too. */
		expect(
			await rows(
				db.select().from(moderation_case).where(eq(moderation_case.id, caseId)),
			),
		).toBe(0);
	});

	test("sanction history, capability restrictions and appeals disappear with the member", async () => {
		const alice = await signUp("Alice");
		const reporter = await signUp("Reporter");
		const operator = await signUp("Operator");
		await promote(operator.memberId);

		const created = await report(reporter.cookie, {
			target: { type: "member", memberId: alice.memberId },
			reason: "harassment",
		});
		const { reportId } = (await created.json()) as { reportId: string };
		const detail = await app.request(`/v2/moderation/reports/${reportId}`, {
			headers: { Cookie: operator.cookie, Origin: WEB_ORIGIN },
		});
		const { caseId } = (await detail.json()) as { caseId: string };

		const acted = await app.request("/v2/moderation/actions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				Cookie: operator.cookie,
			},
			body: JSON.stringify({
				caseId,
				kind: "restrict_capability",
				capability: "comment.write",
				reason: "repeated violations",
			}),
		});
		expect(acted.status).toBe(201);
		const { id: actionId } = (await acted.json()) as { id: string };

		expect(
			(
				await app.request("/v2/me/moderation/appeals", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Origin: WEB_ORIGIN,
						Cookie: alice.cookie,
					},
					body: JSON.stringify({
						actionId,
						message: "It's a misunderstanding",
					}),
				})
			).status,
		).toBe(201);

		await deleteAccount(alice.cookie, { password: TEST_PASSWORD });

		/**
		 * With no re-signup restriction or dispute handling, holding a deleted account's sanction history
		 * is a retention habit, not a basis; same axis as this function's existing decision not to keep a
		 * minimal deletion record.
		 */
		expect(
			await rows(
				db
					.select()
					.from(moderation_action)
					.where(eq(moderation_action.target_member, alice.memberId)),
			),
		).toBe(0);
		expect(
			await rows(
				db
					.select()
					.from(member_restriction)
					.where(eq(member_restriction.member_id, alice.memberId)),
			),
		).toBe(0);
		expect(
			await rows(
				db
					.select()
					.from(moderation_appeal)
					.where(eq(moderation_appeal.member_id, alice.memberId)),
			),
		).toBe(0);
		/** The target member is gone, so its case and reports do not remain. */
		expect(
			await rows(
				db
					.select()
					.from(moderation_case)
					.where(eq(moderation_case.target_id, alice.memberId)),
			),
		).toBe(0);
	});

	test("even when an operator deletes their account, records of actions **against others** remain with only the identity removed", async () => {
		const target = await signUp("Target");
		const reporter = await signUp("Reporter");
		const operator = await signUp("Operator");
		await promote(operator.memberId);

		const created = await report(reporter.cookie, {
			target: { type: "member", memberId: target.memberId },
			reason: "harassment",
		});
		const { reportId } = (await created.json()) as { reportId: string };
		const detail = await app.request(`/v2/moderation/reports/${reportId}`, {
			headers: { Cookie: operator.cookie, Origin: WEB_ORIGIN },
		});
		const { caseId } = (await detail.json()) as { caseId: string };
		await app.request("/v2/moderation/actions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				Cookie: operator.cookie,
			},
			body: JSON.stringify({
				caseId,
				kind: "suspend_member",
				reason: "violation",
			}),
		});

		await deleteAccount(operator.cookie, { password: TEST_PASSWORD });

		const [action] = await db
			.select()
			.from(moderation_action)
			.where(eq(moderation_action.target_member, target.memberId));
		/** That action is a record about another person, so it cannot be deleted; only identity is detached. */
		expect(action).toBeDefined();
		expect(action?.actor).toBeNull();
		expect(action?.reason).toBe("violation");
	});
});
