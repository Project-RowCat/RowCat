import { eq, like } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import { media, media_blob, member, user } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";

import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";

/**
 * `PUT` / `DELETE /v2/me/avatar` and `GET /v2/media/:id`: the whole avatar lifecycle.
 *
 * 1. Ownership isolation. Nothing in the path or body names a target, so the check is that each
 *    member's writes reach only that member, not that "someone else's" was requested.
 * 2. Atomic replacement. A failed upload must not delete the existing photo; this is the slice's
 *    only irreversible harm.
 * 3. Cleanup. Replace and delete must actually remove displaced bytes, or storage grows
 *    monotonically and a departed member's photo lingers.
 * 4. Projection boundary. The response's whole key set is counted: `not.toHaveProperty(...)`
 *    would block only fields known today and let the storage key leak when a column is added or a
 *    column constant is reused.
 *
 * Runs against real Postgres and the real Hono app, since session-to-member wiring and transaction
 * order are what is being verified.
 */

const EMAIL_PREFIX = "me-avatar-test-";

/** One member; the final `/me` creates the member row (created on the first request, not at signup). */
const signUp = (name = "Avatar test") =>
	createTestMember(EMAIL_PREFIX, { name });

/**
 * Deterministic image. Size is a parameter because this file also covers rejection: the
 * normalization rules belong to `lib/media/image.test.ts`, and here the check is that a rejection
 * leaves stored state untouched.
 */
const png = (size = 600) => {
	const bytes = Buffer.alloc(size * size * 3);
	for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 7) % 256;
	return sharp(bytes, { raw: { width: size, height: size, channels: 3 } })
		.png()
		.toBuffer();
};

const putAvatar = (cookie: string, body: Buffer, type = "image/png") =>
	app.request("/v2/me/avatar", {
		method: "PUT",
		headers: { Origin: WEB_ORIGIN, Cookie: cookie, "Content-Type": type },
		body: new Uint8Array(body),
	});

const deleteAvatar = (cookie: string) =>
	app.request("/v2/me/avatar", {
		method: "DELETE",
		headers: { Origin: WEB_ORIGIN, Cookie: cookie },
	});

interface AvatarBody {
	avatar: {
		mediaId: string;
		url: string;
		width: number;
		height: number;
	} | null;
}

/** All of the member's media rows, to count whether cleanup actually happened. */
const mediaRowsOf = (memberId: string) =>
	db.select().from(media).where(eq(media.owner, memberId));

const blobExists = async (storageKey: string): Promise<boolean> =>
	(
		await db
			.select({ key: media_blob.storage_key })
			.from(media_blob)
			.where(eq(media_blob.storage_key, storageKey))
	).length > 0;

const avatarPointerOf = async (memberId: string): Promise<string | null> => {
	const [row] = await db
		.select({ id: member.avatar_media_id })
		.from(member)
		.where(eq(member.id, memberId))
		.limit(1);
	return row?.id ?? null;
};

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) {
		/**
		 * Deleting the member cascades to media rows but not to blobs (the store does not know the DB's
		 * cascade, by design), so the test clears them the same way.
		 */
		const rows = await db
			.select({ key: media.storage_key })
			.from(media)
			.innerJoin(member, eq(member.id, media.owner))
			.innerJoin(user, eq(user.id, member.user_id))
			.where(like(user.email, `${EMAIL_PREFIX}%`));
		for (const row of rows)
			await db.delete(media_blob).where(eq(media_blob.storage_key, row.key));
		await deleteTestUsers(EMAIL_PREFIX);
	}
	await closeDb();
});

describe.skipIf(!databaseReady)("avatar — authorization", () => {
	test("a guest can't upload", async () => {
		const response = await app.request("/v2/me/avatar", {
			method: "PUT",
			headers: { Origin: WEB_ORIGIN, "Content-Type": "image/png" },
			body: new Uint8Array(await png()),
		});
		expect(response.status).toBe(401);
	});

	test("a guest can't delete", async () => {
		const response = await app.request("/v2/me/avatar", {
			method: "DELETE",
			headers: { Origin: WEB_ORIGIN },
		});
		expect(response.status).toBe(401);
	});

	/**
	 * Expresses that no target can be named: since "change someone else's avatar" cannot be built, the
	 * check is that two people uploading separately never mix pointers. Mixing would mean the target
	 * is resolved from something other than the session.
	 */
	test("two members' writes don't reach each other", async () => {
		const alice = await signUp("Alice");
		const bob = await signUp("Bob");

		await putAvatar(alice.cookie, await png());
		await putAvatar(bob.cookie, await png());

		const aliceMedia = await mediaRowsOf(alice.memberId);
		const bobMedia = await mediaRowsOf(bob.memberId);
		expect(aliceMedia).toHaveLength(1);
		expect(bobMedia).toHaveLength(1);
		expect(aliceMedia[0]?.id).not.toBe(bobMedia[0]?.id);

		/** Bob deleting his own leaves Alice's untouched. */
		await deleteAvatar(bob.cookie);
		expect(await avatarPointerOf(alice.memberId)).toBe(aliceMedia[0]?.id);
		expect(await avatarPointerOf(bob.memberId)).toBeNull();
		expect(await mediaRowsOf(alice.memberId)).toHaveLength(1);
	});

	/**
	 * The storage key contains the member id but authorization does not come from it (the column
	 * answers). The direct check is the key's shape: no user input, only values we built.
	 */
	test("the storage key is made only of server-made values", async () => {
		const person = await signUp();
		await putAvatar(person.cookie, await png());
		const [row] = await mediaRowsOf(person.memberId);
		expect(row?.storage_key).toBe(
			`media/avatar/${person.memberId}/${row?.id}.webp`,
		);
		/** No path-escaping fragments. */
		expect(row?.storage_key).not.toContain("..");
	});
});

describe.skipIf(!databaseReady)("avatar — lifecycle", () => {
	test("uploading makes the profile point at the new media", async () => {
		const person = await signUp();
		const response = await putAvatar(person.cookie, await png());
		expect(response.status).toBe(200);

		const body = (await response.json()) as AvatarBody;
		expect(body.avatar).not.toBeNull();
		expect(await avatarPointerOf(person.memberId)).toBe(body.avatar?.mediaId);

		/** Always a 512 square after normalization. */
		expect([body.avatar?.width, body.avatar?.height]).toEqual([512, 512]);

		/** The public profile reports the same address: one source of truth. */
		const profile = (await (
			await app.request(`/v2/creators/${person.memberId}`, {
				headers: { Origin: WEB_ORIGIN },
			})
		).json()) as { avatarUrl: string | null };
		expect(profile.avatarUrl).toBe(body.avatar?.url);
	});

	/**
	 * Core property of replacement: a new media id changes the whole address, which is what makes the
	 * URL immutable. The same address is never overwritten, so a cache cannot draw the old image.
	 */
	test("replacing changes the whole address and the old one disappears", async () => {
		const person = await signUp();
		const first = (await (
			await putAvatar(person.cookie, await png())
		).json()) as AvatarBody;
		const [firstRow] = await mediaRowsOf(person.memberId);
		const firstKey = firstRow?.storage_key ?? "";
		expect(await blobExists(firstKey)).toBe(true);

		const second = (await (
			await putAvatar(person.cookie, await png(700))
		).json()) as AvatarBody;

		expect(second.avatar?.mediaId).not.toBe(first.avatar?.mediaId);
		expect(second.avatar?.url).not.toBe(first.avatar?.url);
		expect(await avatarPointerOf(person.memberId)).toBe(second.avatar?.mediaId);

		/** Cleanup really happened, rows and bytes; otherwise storage grows with every replacement. */
		const rows = await mediaRowsOf(person.memberId);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.id).toBe(second.avatar?.mediaId);
		expect(await blobExists(firstKey)).toBe(false);
	});

	test("deleting empties the pointer and the bytes disappear too", async () => {
		const person = await signUp();
		await putAvatar(person.cookie, await png());
		const [row] = await mediaRowsOf(person.memberId);
		const key = row?.storage_key ?? "";

		const response = await deleteAvatar(person.cookie);
		expect(response.status).toBe(200);
		expect((await response.json()) as AvatarBody).toEqual({ avatar: null });

		expect(await avatarPointerOf(person.memberId)).toBeNull();
		expect(await mediaRowsOf(person.memberId)).toHaveLength(0);
		expect(await blobExists(key)).toBe(false);
	});

	/**
	 * Idempotent: if a retry that only lost its response looked like an error, the screen would draw
	 * failure while the wanted state is already true.
	 */
	test("deleting twice is safe and gives the same response", async () => {
		const person = await signUp();
		await putAvatar(person.cookie, await png());

		const first = await deleteAvatar(person.cookie);
		const second = await deleteAvatar(person.cookie);
		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		expect(await second.json()).toEqual({ avatar: null });
	});

	/** Deleting from an account that never had an avatar also succeeds. */
	test("deleting a missing avatar also succeeds", async () => {
		const person = await signUp();
		const response = await deleteAvatar(person.cookie);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ avatar: null });
	});
});

describe.skipIf(!databaseReady)("avatar — failed replacement", () => {
	/**
	 * The most important test here. In a naive implementation (delete the old one, then upload the
	 * new) this scenario destroys the user's photo: they asked to change it, not delete it, and one
	 * broken file erases a good profile picture, irreversibly.
	 *
	 * Covers three branches: wrong format, undecodable, too small. All die in normalization, so
	 * storage and DB must not move at all.
	 */
	test.each([
		[
			"SVG",
			Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600"/>'),
			"media_unsupported_type",
		],
		[
			"broken PNG",
			Buffer.concat([
				Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
				Buffer.from("junk"),
			]),
			"media_invalid_image",
		],
	])("trying to replace it with %s leaves the old photo as is", async (_, bad, code) => {
		const person = await signUp();
		const good = (await (
			await putAvatar(person.cookie, await png())
		).json()) as AvatarBody;
		const [beforeRow] = await mediaRowsOf(person.memberId);
		const key = beforeRow?.storage_key ?? "";

		const failed = await putAvatar(person.cookie, bad);
		expect(failed.status).toBe(400);
		expect(((await failed.json()) as { code: string }).code).toBe(code);

		/** Pointer, rows and bytes all unchanged. */
		expect(await avatarPointerOf(person.memberId)).toBe(good.avatar?.mediaId);
		expect(await mediaRowsOf(person.memberId)).toHaveLength(1);
		expect(await blobExists(key)).toBe(true);
	});

	/** Too-small photo: an axis only avatars have, so it runs separately. */
	test("replacing it with a photo below the minimum leaves the old photo", async () => {
		const person = await signUp();
		const good = (await (
			await putAvatar(person.cookie, await png())
		).json()) as AvatarBody;

		const failed = await putAvatar(person.cookie, await png(32));
		expect(failed.status).toBe(400);
		expect(((await failed.json()) as { code: string }).code).toBe(
			"media_invalid_dimensions",
		);
		expect(await avatarPointerOf(person.memberId)).toBe(good.avatar?.mediaId);
	});

	/**
	 * A failed first upload leaves nothing. It is separate from replacement because there is no old
	 * one to delete, which makes it the easiest place for an orphan.
	 */
	test("a failed first upload leaves no orphan", async () => {
		const person = await signUp();
		const failed = await putAvatar(
			person.cookie,
			Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
		);
		expect(failed.status).toBe(400);
		expect(await mediaRowsOf(person.memberId)).toHaveLength(0);
		expect(await avatarPointerOf(person.memberId)).toBeNull();
	});
});

describe.skipIf(!databaseReady)("GET /v2/media/:id", () => {
	test("guests can read it too, with an immutable cache", async () => {
		const person = await signUp();
		const body = (await (
			await putAvatar(person.cookie, await png())
		).json()) as AvatarBody;

		/** No session: avatars are public. */
		const response = await app.request(
			new URL(body.avatar?.url ?? "").pathname,
			{ headers: { Origin: WEB_ORIGIN } },
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("image/webp");
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
		/**
		 * The address is the media id so the content never changes, which is why `immutable` can be
		 * attached unconditionally; covers differ (only after comparing `?v=`).
		 */
		expect(response.headers.get("Cache-Control")).toBe(
			"public, max-age=31536000, immutable",
		);
		expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
	});

	test("a matching ETag is a 304 with no body", async () => {
		const person = await signUp();
		const body = (await (
			await putAvatar(person.cookie, await png())
		).json()) as AvatarBody;
		const path = new URL(body.avatar?.url ?? "").pathname;

		const first = await app.request(path, { headers: { Origin: WEB_ORIGIN } });
		const etag = first.headers.get("ETag") ?? "";
		const second = await app.request(path, {
			headers: { Origin: WEB_ORIGIN, "If-None-Match": etag },
		});
		expect(second.status).toBe(304);
	});

	/**
	 * After deletion the address dies. A missing media and a deleted media must be the same 404, or
	 * this path becomes an existence probe.
	 */
	test("a deleted avatar's address and a missing address are the same 404", async () => {
		const person = await signUp();
		const body = (await (
			await putAvatar(person.cookie, await png())
		).json()) as AvatarBody;
		const path = new URL(body.avatar?.url ?? "").pathname;
		await deleteAvatar(person.cookie);

		const gone = await app.request(path, { headers: { Origin: WEB_ORIGIN } });
		const never = await app.request(`/v2/media/${newId()}`, {
			headers: { Origin: WEB_ORIGIN },
		});
		expect(gone.status).toBe(404);
		expect(never.status).toBe(404);
		expect(((await gone.json()) as { code: string }).code).toBe(
			((await never.json()) as { code: string }).code,
		);
	});
});

describe.skipIf(!databaseReady)("avatar — projection", () => {
	/**
	 * Counts the whole key set. `not.toHaveProperty("storageKey")` would block only fields known today
	 * and let the storage key and owner id leak when a column is added or `MEDIA_COLUMNS` is exported
	 * as is.
	 */
	test("the storage implementation doesn't leak into the response", async () => {
		const person = await signUp();
		const body = (await (
			await putAvatar(person.cookie, await png())
		).json()) as AvatarBody;

		expect(Object.keys(body).sort()).toEqual(["avatar"]);
		expect(Object.keys(body.avatar ?? {}).sort()).toEqual([
			"height",
			"mediaId",
			"url",
			"width",
		]);
	});
});
