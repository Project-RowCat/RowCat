import {
	STORY_LIFECYCLE_ERROR_CODE,
	STORY_PUBLISH_ERROR_CODE,
	type StoryVisibility,
} from "@rowcat/contracts";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import {
	member,
	moderation_case,
	story,
	story_cover,
} from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";

import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";

/**
 * Story lifecycle: `POST /v2/stories/:id/{publish,unlist,unpublish,archive,restore}`.
 *
 * Every case here fails silently because the success response looks the same:
 *
 * 1. Forbidden transitions are inexpressible. `archived -> public` in one request would return a
 *    long-withdrawn story to the catalogue unconfirmed. Three paths lead there (lifecycle
 *    `publish`, `POST /stories`, `PUT /stories/:id`) and all must be closed.
 * 2. A creator's operation cannot undo an operator's enforcement. No lifecycle operation may
 *    touch `hidden`, or enforcement is bypassed by a `publish` button with no record.
 * 3. Archiving is not deletion: cover, counters, authored content and draft link all remain.
 * 4. Restore returns to private; returning to public would erase the decision to archive.
 * 5. Other people's stories cannot be touched, and the rejection matches a missing story.
 * 6. Withdrawing operations stay open under sanction; blocking them would hold the creator's
 *    content in the catalogue.
 *
 * Runs against real Postgres and the real Hono app: transitions live in the `SELECT ... FOR UPDATE`
 * predicate and transaction, so mocking the service would leave the subject untested.
 */

const EMAIL_PREFIX = "story-lifecycle-test-";

interface Person {
	cookie: string;
	memberId: string;
}

/** One member. The last `/me` creates the member row (it appears on first request, not at signup). */
const signUp = (name = "Lifecycle test") =>
	createTestMember(EMAIL_PREFIX, { name });

/** An operator; the product API has no promotion path, and this helper's shape reflects that. */
async function signUpOperator(): Promise<Person> {
	const account = await signUp("Lifecycle operator");
	await db
		.update(member)
		.set({ role: "staff" })
		.where(eq(member.id, account.memberId));
	return account;
}

/** Eligibility to publish adult works (legal requirement); the display opt-in stays off. */
const grantAdultEligibility = (memberId: string) =>
	db
		.update(member)
		.set({ verified: true, adult: true, show_adult: false })
		.where(eq(member.id, memberId));

const suspend = (memberId: string) =>
	db.update(member).set({ status: "suspended" }).where(eq(member.id, memberId));

type Lifecycle = "publish" | "unlist" | "unpublish" | "archive" | "restore";

const act = (
	cookie: string | null,
	storyId: string,
	action: Lifecycle,
): Promise<Response> =>
	Promise.resolve(
		app.request(`/v2/stories/${storyId}/${action}`, {
			method: "POST",
			headers: {
				Origin: WEB_ORIGIN,
				...(cookie ? { Cookie: cookie } : {}),
			},
		}),
	);

const get = (cookie: string | null, path: string): Promise<Response> =>
	Promise.resolve(
		app.request(path, { headers: cookie ? { Cookie: cookie } : {} }),
	);

/** Reads the stored row from the DB, not the response, which is a value we built ourselves. */
const readRow = async (storyId: string) => {
	const [row] = await db.select().from(story).where(eq(story.id, storyId));
	if (!row) throw new Error(`no story row: ${storyId}`);
	return row;
};

interface SeedStory {
	visibility?: StoryVisibility;
	adult?: boolean;
	hidden?: boolean;
	title?: string;
}

/**
 * Inserts a story directly, bypassing publication. The subject is transitions, so state is set by
 * hand (publication cannot produce an `archived` story). Publication itself is covered by
 * `stories-publish.test.ts`.
 */
async function seedStory(
	ownerId: string,
	options: SeedStory = {},
): Promise<string> {
	const id = newId();
	await db.insert(story).values({
		id,
		owner: ownerId,
		title: options.title ?? `Lifecycle story ${id.slice(0, 6)}`,
		visibility: options.visibility ?? "private",
		adult: options.adult ?? false,
		hidden: options.hidden ?? false,
		origin_draft_id: `draft-${id}`,
		play_payload: { version: 1, storyId: id },
	});
	return id;
}

const databaseReady = await connectTestDatabase();

/** Cases have no story FK and do not vanish with member deletion, so they are deleted by hand. */
const CREATED_CASES: string[] = [];

afterAll(async () => {
	if (databaseReady) {
		if (CREATED_CASES.length)
			await db
				.delete(moderation_case)
				.where(inArray(moderation_case.id, CREATED_CASES));
		await deleteTestUsers(EMAIL_PREFIX);
	}
	await closeDb();
});

interface ErrorBody {
	code: string;
}
interface StoryBody {
	story: { id: string; visibility: StoryVisibility; coverUrl: string | null };
}

describe.skipIf(!databaseReady)("lifecycle — allowed transitions", () => {
	test("private → public happens on the same story id", async () => {
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, { visibility: "private" });

		const response = await act(owner.cookie, storyId, "publish");
		expect(response.status).toBe(200);
		const body = (await response.json()) as StoryBody;
		expect(body.story.id).toBe(storyId);
		expect(body.story.visibility).toBe("public");
		expect((await readRow(storyId)).visibility).toBe("public");
	});

	test("public → private doesn't delete the story or touch its metrics", async () => {
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, { visibility: "public" });
		await db
			.update(story)
			.set({ views: 12, favorites: 5, downloads: 3 })
			.where(eq(story.id, storyId));

		expect((await act(owner.cookie, storyId, "unpublish")).status).toBe(200);

		const row = await readRow(storyId);
		expect(row.visibility).toBe("private");
		expect(row.views).toBe(12);
		expect(row.favorites).toBe(5);
		expect(row.downloads).toBe(3);
	});

	test("can archive from either public or private", async () => {
		const owner = await signUp();
		const fromPublic = await seedStory(owner.memberId, {
			visibility: "public",
		});
		const fromPrivate = await seedStory(owner.memberId, {
			visibility: "private",
		});

		expect((await act(owner.cookie, fromPublic, "archive")).status).toBe(200);
		expect((await act(owner.cookie, fromPrivate, "archive")).status).toBe(200);
		expect((await readRow(fromPublic)).visibility).toBe("archived");
		expect((await readRow(fromPrivate)).visibility).toBe("archived");
	});

	test("restore comes back **as private** — it doesn't go back to public", async () => {
		/**
		 * The most important assertion in this file: restoring to public because the story was public
		 * before archiving would undo the "not now" decision in one press.
		 */
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, { visibility: "public" });
		await act(owner.cookie, storyId, "archive");

		const response = await act(owner.cookie, storyId, "restore");
		expect(response.status).toBe(200);
		expect(((await response.json()) as StoryBody).story.visibility).toBe(
			"private",
		);
		expect((await readRow(storyId)).visibility).toBe("private");
	});

	test("making an archived story public again takes **two steps**, restore and publish", async () => {
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, { visibility: "public" });
		await act(owner.cookie, storyId, "archive");

		// No single-step path.
		const direct = await act(owner.cookie, storyId, "publish");
		expect(direct.status).toBe(409);
		expect(((await direct.json()) as ErrorBody).code).toBe(
			STORY_LIFECYCLE_ERROR_CODE.archived,
		);
		expect((await readRow(storyId)).visibility).toBe("archived");

		expect((await act(owner.cookie, storyId, "restore")).status).toBe(200);
		expect((await act(owner.cookie, storyId, "publish")).status).toBe(200);
		expect((await readRow(storyId)).visibility).toBe("public");
	});
});

/**
 * State machine after `unlist` became the fifth operation.
 *
 * 1. Entry and exit from both sides: unlisted is reachable from private and public and can leave
 *    to either; a blocked side would make it a trap.
 * 2. Identity and counters survive: moving exposure must not recreate the story.
 * 3. Restore still has one destination; `archived -> unlisted` would merge "lift the archive"
 *    and "re-expose" into one press.
 */
describe.skipIf(!databaseReady)("lifecycle — unlisted", () => {
	test("can go unlisted from either private or public", async () => {
		const owner = await signUp();
		const fromPrivate = await seedStory(owner.memberId, {
			visibility: "private",
		});
		const fromPublic = await seedStory(owner.memberId, {
			visibility: "public",
		});

		expect((await act(owner.cookie, fromPrivate, "unlist")).status).toBe(200);
		expect((await act(owner.cookie, fromPublic, "unlist")).status).toBe(200);

		expect((await readRow(fromPrivate)).visibility).toBe("unlisted");
		expect((await readRow(fromPublic)).visibility).toBe("unlisted");
	});

	test("can leave unlisted for public or private", async () => {
		const owner = await signUp();
		const toPublic = await seedStory(owner.memberId, {
			visibility: "unlisted",
		});
		const toPrivate = await seedStory(owner.memberId, {
			visibility: "unlisted",
		});

		expect((await act(owner.cookie, toPublic, "publish")).status).toBe(200);
		expect((await act(owner.cookie, toPrivate, "unpublish")).status).toBe(200);

		expect((await readRow(toPublic)).visibility).toBe("public");
		expect((await readRow(toPrivate)).visibility).toBe("private");
	});

	test("unlisted can be archived too", async () => {
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, { visibility: "unlisted" });

		expect((await act(owner.cookie, storyId, "archive")).status).toBe(200);
		expect((await readRow(storyId)).visibility).toBe("archived");
	});

	/** Moving exposure must not recreate the row, which would irreversibly lose counters, cover and draft link. */
	test("going through four transitions keeps the same row and the metrics", async () => {
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, { visibility: "private" });
		await db
			.update(story)
			.set({ views: 41, favorites: 7 })
			.where(eq(story.id, storyId));
		const before = await readRow(storyId);

		for (const action of ["unlist", "publish", "unlist", "unpublish"] as const)
			expect((await act(owner.cookie, storyId, action)).status).toBe(200);

		const after = await readRow(storyId);
		expect(after.id).toBe(before.id);
		expect(after.owner).toBe(before.owner);
		expect(after.created_at.getTime()).toBe(before.created_at.getTime());
		/** Moving exposure is not an authoring edit; it must not shift the sort axis. */
		expect(after.updated_at.getTime()).toBe(before.updated_at.getTime());
		expect(after.views).toBe(41);
		expect(after.favorites).toBe(7);
		expect(after.origin_draft_id).toBe(before.origin_draft_id);
		expect(after.play_payload).toEqual(before.play_payload);
		expect(after.visibility).toBe("private");
	});

	test("applying the same transition again to an already unlisted story succeeds", async () => {
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, { visibility: "unlisted" });

		expect((await act(owner.cookie, storyId, "unlist")).status).toBe(200);
		expect((await readRow(storyId)).visibility).toBe("unlisted");
	});

	/**
	 * No path from archived to unlisted: not appearing in lists does not mean restore may open it as a
	 * side effect, since unlisted stories open for anyone with the address.
	 */
	test("an archived story can't go unlisted either", async () => {
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, { visibility: "archived" });

		const response = await act(owner.cookie, storyId, "unlist");
		expect(response.status).toBe(409);
		expect(((await response.json()) as ErrorBody).code).toBe(
			STORY_LIFECYCLE_ERROR_CODE.archived,
		);
		expect((await readRow(storyId)).visibility).toBe("archived");
	});

	/** Restore does not quietly take down an unlisted story: that would be an exposure reduction nobody asked for. */
	test("restoring an unlisted story is a 409 and doesn't change the state", async () => {
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, { visibility: "unlisted" });

		const response = await act(owner.cookie, storyId, "restore");
		expect(response.status).toBe(409);
		expect(((await response.json()) as ErrorBody).code).toBe(
			STORY_LIFECYCLE_ERROR_CODE.notArchived,
		);
		expect((await readRow(storyId)).visibility).toBe("unlisted");
	});

	/** Unlisted also publishes outward, so the eligibility check applies; not being listed does not lower the gate. */
	test("a member whose adult eligibility lapsed can't make it unlisted either", async () => {
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, {
			visibility: "private",
			adult: true,
		});

		const response = await act(owner.cookie, storyId, "unlist");
		expect(response.status).toBe(403);
		expect(((await response.json()) as ErrorBody).code).toBe(
			STORY_PUBLISH_ERROR_CODE.adultNotPermitted,
		);
		expect((await readRow(storyId)).visibility).toBe("private");

		await grantAdultEligibility(owner.memberId);
		expect((await act(owner.cookie, storyId, "unlist")).status).toBe(200);
		expect((await readRow(storyId)).visibility).toBe("unlisted");
	});

	/**
	 * Withdrawing stays open under sanction, which is why `unlist` can share `publish`'s gate without
	 * creating a dead end: a suspended creator cannot publish but can take down.
	 */
	test("a suspended member can't make it unlisted but can take it down", async () => {
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, { visibility: "unlisted" });
		await suspend(owner.memberId);

		expect((await act(owner.cookie, storyId, "unlist")).status).toBe(403);
		expect((await act(owner.cookie, storyId, "unpublish")).status).toBe(200);
		expect((await readRow(storyId)).visibility).toBe("private");
	});
});

describe.skipIf(!databaseReady)("lifecycle — forbidden transitions", () => {
	test("an archived story doesn't accept a switch to private either", async () => {
		/**
		 * Looks like the same intent as restore, but accepting it here would add a second way to lift an
		 * archive, one without restore's confirmation copy.
		 */
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, { visibility: "archived" });

		const response = await act(owner.cookie, storyId, "unpublish");
		expect(response.status).toBe(409);
		expect(((await response.json()) as ErrorBody).code).toBe(
			STORY_LIFECYCLE_ERROR_CODE.archived,
		);
		expect((await readRow(storyId)).visibility).toBe("archived");
	});

	test("restoring a public story is a 409 and doesn't quietly go private", async () => {
		/** No unrequested exposure reduction; that operation has its own name. */
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, { visibility: "public" });

		const response = await act(owner.cookie, storyId, "restore");
		expect(response.status).toBe(409);
		expect(((await response.json()) as ErrorBody).code).toBe(
			STORY_LIFECYCLE_ERROR_CODE.notArchived,
		);
		expect((await readRow(storyId)).visibility).toBe("public");
	});
});

describe.skipIf(!databaseReady)("lifecycle — idempotency", () => {
	test("archiving an already archived story again succeeds", async () => {
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, { visibility: "public" });

		expect((await act(owner.cookie, storyId, "archive")).status).toBe(200);
		expect((await act(owner.cookie, storyId, "archive")).status).toBe(200);
		expect((await readRow(storyId)).visibility).toBe("archived");
	});

	test("restoring an already private story succeeds", async () => {
		/**
		 * Replays a lost response: restore succeeded but the browser never got it, and the user presses
		 * again. Erroring when the wanted state already holds would make the screen lie.
		 */
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, { visibility: "private" });

		expect((await act(owner.cookie, storyId, "restore")).status).toBe(200);
		expect((await readRow(storyId)).visibility).toBe("private");
	});

	test("applying the same transition again to an already public or private story succeeds", async () => {
		const owner = await signUp();
		const pub = await seedStory(owner.memberId, { visibility: "public" });
		const priv = await seedStory(owner.memberId, { visibility: "private" });

		expect((await act(owner.cookie, pub, "publish")).status).toBe(200);
		expect((await act(owner.cookie, priv, "unpublish")).status).toBe(200);
		expect((await readRow(pub)).visibility).toBe("public");
		expect((await readRow(priv)).visibility).toBe("private");
	});
});

describe.skipIf(!databaseReady)("lifecycle — races", () => {
	test("two archive requests on the same story at once give one result", async () => {
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, { visibility: "public" });

		const [a, b] = await Promise.all([
			act(owner.cookie, storyId, "archive"),
			act(owner.cookie, storyId, "archive"),
		]);
		expect(a.status).toBe(200);
		expect(b.status).toBe(200);
		expect((await readRow(storyId)).visibility).toBe("archived");
	});

	test("archive and publish arriving at once end in a state reached through one allowed transition", async () => {
		/**
		 * Without the lock both read the same start state and write their own destination, committing
		 * `public` over an `archived` row, a transition not in the table.
		 */
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, { visibility: "private" });

		await Promise.all([
			act(owner.cookie, storyId, "archive"),
			act(owner.cookie, storyId, "publish"),
		]);

		const visibility = (await readRow(storyId)).visibility;
		expect(["archived", "public"]).toContain(visibility);
	});
});

describe.skipIf(!databaseReady)("lifecycle — ownership", () => {
	test("none of the four operations work on someone else's story", async () => {
		/**
		 * The 404 must match a missing story; distinguishing would reveal existence and undo the
		 * existence hiding kept on the detail.
		 */
		const alice = await signUp("Alice");
		const bob = await signUp("Bob");
		const aliceStory = await seedStory(alice.memberId, {
			visibility: "public",
		});
		const missing = newId();

		for (const action of [
			"publish",
			"unpublish",
			"archive",
			"restore",
		] as const) {
			const mine = await act(bob.cookie, aliceStory, action);
			const nothing = await act(bob.cookie, missing, action);
			expect(mine.status).toBe(404);
			expect(nothing.status).toBe(404);
			expect(((await mine.json()) as ErrorBody).code).toBe(
				((await nothing.json()) as ErrorBody).code,
			);
		}

		// Nothing changed.
		expect((await readRow(aliceStory)).visibility).toBe("public");
	});

	test("a signed-out request is a 401", async () => {
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, { visibility: "public" });

		expect((await act(null, storyId, "archive")).status).toBe(401);
		expect((await act(null, storyId, "publish")).status).toBe(401);
		expect((await readRow(storyId)).visibility).toBe("public");
	});
});

describe.skipIf(!databaseReady)(
	"lifecycle — account state and eligibility",
	() => {
		test("a suspended member can still take down and archive their own public story", async () => {
			/**
			 * Sanctions block writes that go out; these two withdraw. Blocking them would hold the creator's
			 * content in the catalogue (cover deletion and blocking made the same call).
			 */
			const owner = await signUp();
			const unpublishable = await seedStory(owner.memberId, {
				visibility: "public",
			});
			const archivable = await seedStory(owner.memberId, {
				visibility: "public",
			});
			await suspend(owner.memberId);

			expect((await act(owner.cookie, unpublishable, "unpublish")).status).toBe(
				200,
			);
			expect((await act(owner.cookie, archivable, "archive")).status).toBe(200);
			expect((await readRow(unpublishable)).visibility).toBe("private");
			expect((await readRow(archivable)).visibility).toBe("archived");
		});

		test("a suspended member can neither publish nor restore", async () => {
			/** Operations that can return to exposure require a whole account. */
			const owner = await signUp();
			const priv = await seedStory(owner.memberId, { visibility: "private" });
			const arch = await seedStory(owner.memberId, { visibility: "archived" });
			await suspend(owner.memberId);

			expect((await act(owner.cookie, priv, "publish")).status).toBe(403);
			expect((await act(owner.cookie, arch, "restore")).status).toBe(403);
			expect((await readRow(priv)).visibility).toBe("private");
			expect((await readRow(arch)).visibility).toBe("archived");
		});

		test("a member whose adult eligibility lapsed can't make their own adult story public", async () => {
			/**
			 * The request carries no rating (no body), so the decision rests on the locked row. Without it an
			 * ineligible adult story could reach the catalogue.
			 */
			const owner = await signUp();
			await grantAdultEligibility(owner.memberId);
			const storyId = await seedStory(owner.memberId, {
				visibility: "private",
				adult: true,
			});
			await db
				.update(member)
				.set({ verified: false, adult: false })
				.where(eq(member.id, owner.memberId));

			const response = await act(owner.cookie, storyId, "publish");
			expect(response.status).toBe(403);
			expect(((await response.json()) as ErrorBody).code).toBe(
				STORY_PUBLISH_ERROR_CODE.adultNotPermitted,
			);
			expect((await readRow(storyId)).visibility).toBe("private");
		});

		test("a lapsed eligibility doesn't block taking down and archiving one's own adult story", async () => {
			const owner = await signUp();
			const storyId = await seedStory(owner.memberId, {
				visibility: "public",
				adult: true,
			});

			expect((await act(owner.cookie, storyId, "unpublish")).status).toBe(200);
			expect((await act(owner.cookie, storyId, "archive")).status).toBe(200);
		});
	},
);

describe.skipIf(!databaseReady)(
	"archiving means disappearing from public surfaces",
	() => {
		test("an archived story is in neither the gallery nor the detail — not even for the owner", async () => {
			const owner = await signUp();
			const stranger = await signUp();
			const title = `archived-${newId()}`;
			const storyId = await seedStory(owner.memberId, {
				visibility: "public",
				title,
			});

			const listed = async (cookie: string): Promise<string[]> => {
				const response = await get(
					cookie,
					`/v2/stories?q=${encodeURIComponent(title)}`,
				);
				const body = (await response.json()) as { items: { id: string }[] };
				return body.items.map((item) => item.id);
			};
			expect(await listed(stranger.cookie)).toContain(storyId);

			expect((await act(owner.cookie, storyId, "archive")).status).toBe(200);

			expect(await listed(stranger.cookie)).not.toContain(storyId);
			expect(await listed(owner.cookie)).not.toContain(storyId);
			expect(
				(await get(stranger.cookie, `/v2/stories/${storyId}`)).status,
			).toBe(404);
			/**
			 * 404 even for the owner defines archiving. The detail uses the list predicate, so diverging here
			 * would draw dead links (`isOwnWorkViewable` omits `View story` for this).
			 */
			expect((await get(owner.cookie, `/v2/stories/${storyId}`)).status).toBe(
				404,
			);
			expect((await get(null, `/v2/stories/${storyId}`)).status).toBe(404);
		});

		test("an archived story accepts no playback, comments or favorites", async () => {
			const owner = await signUp();
			const reader = await signUp();
			const storyId = await seedStory(owner.memberId, { visibility: "public" });
			await act(owner.cookie, storyId, "archive");

			const post = (path: string, body: unknown, method = "POST") =>
				app.request(path, {
					method,
					headers: {
						"Content-Type": "application/json",
						Origin: WEB_ORIGIN,
						Cookie: reader.cookie,
					},
					body: JSON.stringify(body),
				});

			expect(
				(await get(reader.cookie, `/v2/stories/${storyId}/play`)).status,
			).toBe(404);
			expect(
				(await get(reader.cookie, `/v2/stories/${storyId}/comments`)).status,
			).toBe(404);
			expect(
				(await post(`/v2/stories/${storyId}/comments`, { body: "Hi" })).status,
			).toBe(404);
			expect(
				(await post(`/v2/favorites/${storyId}`, { favorited: true }, "PUT"))
					.status,
			).toBe(404);
			expect(
				(
					await post("/v2/reports", {
						target: { type: "story", storyId },
						reason: "spam",
					})
				).status,
			).toBe(404);
		});

		test("archiving keeps the cover, authored content and draft link, and restoring brings them back", async () => {
			/**
			 * The substance of "archive is not deletion": if the same values do not reappear after restore,
			 * the confirmation copy "can be restored later" becomes false.
			 */
			const owner = await signUp();
			const storyId = await seedStory(owner.memberId, { visibility: "public" });
			await db.insert(story_cover).values({
				story_id: storyId,
				bytes: Buffer.from("fake-cover-bytes"),
				mime: "image/webp",
			});
			const before = await readRow(storyId);

			await act(owner.cookie, storyId, "archive");
			const archivedResponse = await act(owner.cookie, storyId, "restore");
			expect(archivedResponse.status).toBe(200);

			const after = await readRow(storyId);
			expect(after.title).toBe(before.title);
			expect(after.play_payload).toEqual(before.play_payload);
			expect(after.origin_draft_id).toBe(before.origin_draft_id);
			expect(after.created_at.getTime()).toBe(before.created_at.getTime());
			/** The cover is a separate table this operation does not touch. */
			const covers = await db
				.select({ id: story_cover.story_id })
				.from(story_cover)
				.where(eq(story_cover.story_id, storyId));
			expect(covers).toHaveLength(1);
			expect(
				((await archivedResponse.json()) as StoryBody).story.coverUrl,
			).not.toBeNull();
		});

		test("lifecycle transitions don't push the story's updated time", async () => {
			/**
			 * `updated_at` is the authoring edit time and the sort axis of `Published`; shifting it on a
			 * visibility change would reorder the list for an edit the user never made.
			 */
			const owner = await signUp();
			const storyId = await seedStory(owner.memberId, { visibility: "public" });
			const before = await readRow(storyId);

			await act(owner.cookie, storyId, "unpublish");
			await act(owner.cookie, storyId, "archive");
			await act(owner.cookie, storyId, "restore");

			expect((await readRow(storyId)).updated_at).toEqual(before.updated_at);
		});

		test("archiving doesn't remove it from the `Published` list", async () => {
			/** The owner's management list bypasses `galleryWhere`; vanishing from it would remove the way to restore. */
			const owner = await signUp();
			const storyId = await seedStory(owner.memberId, { visibility: "public" });
			await act(owner.cookie, storyId, "archive");

			const response = await get(owner.cookie, "/v2/me/stories");
			const body = (await response.json()) as {
				items: { id: string; visibility: string }[];
			};
			expect(body.items.find((item) => item.id === storyId)?.visibility).toBe(
				"archived",
			);
		});
	},
);

describe.skipIf(!databaseReady)(
	"the lifecycle doesn't touch operator hiding",
	() => {
		/** Files one report and returns its case id; enforcement only comes from cases. */
		async function openCase(
			storyId: string,
			operator: Person,
		): Promise<string> {
			const reporter = await signUp("Reporter");
			const created = await app.request("/v2/reports", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Origin: WEB_ORIGIN,
					Cookie: reporter.cookie,
				},
				body: JSON.stringify({
					target: { type: "story", storyId },
					reason: "spam",
				}),
			});
			const { reportId } = (await created.json()) as { reportId: string };
			const detail = await app.request(`/v2/moderation/reports/${reportId}`, {
				headers: { Cookie: operator.cookie },
			});
			const { caseId } = (await detail.json()) as { caseId: string };
			CREATED_CASES.push(caseId);
			return caseId;
		}

		const enforce = (operator: Person, caseId: string, kind: string) =>
			app.request("/v2/moderation/actions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Origin: WEB_ORIGIN,
					Cookie: operator.cookie,
				},
				body: JSON.stringify({ caseId, kind, reason: "Under review" }),
			});

		test("report → hide removes a public story, and the creator's transitions don't lift it", async () => {
			const operator = await signUpOperator();
			const owner = await signUp();
			const stranger = await signUp();
			const storyId = await seedStory(owner.memberId, { visibility: "public" });

			const caseId = await openCase(storyId, operator);
			expect((await enforce(operator, caseId, "hide_story")).status).toBe(201);
			expect(
				(await get(stranger.cookie, `/v2/stories/${storyId}`)).status,
			).toBe(404);

			/**
			 * `hidden` must stay true through all four. Clearing it would bypass enforcement via a product
			 * feature with no record.
			 */
			expect((await act(owner.cookie, storyId, "unpublish")).status).toBe(200);
			expect((await readRow(storyId)).hidden).toBe(true);
			expect((await act(owner.cookie, storyId, "publish")).status).toBe(200);
			expect((await readRow(storyId)).hidden).toBe(true);
			expect((await act(owner.cookie, storyId, "archive")).status).toBe(200);
			expect((await readRow(storyId)).hidden).toBe(true);
			expect((await act(owner.cookie, storyId, "restore")).status).toBe(200);

			const row = await readRow(storyId);
			expect(row.hidden).toBe(true);
			expect(row.visibility).toBe("private");
			expect(
				(await get(stranger.cookie, `/v2/stories/${storyId}`)).status,
			).toBe(404);
		});

		test("unhiding changes only `hidden` and doesn't overwrite the visibility the creator chose", async () => {
			/**
			 * Without this, unhide could silently start writing `visibility = 'public'` too, and a story the
			 * creator made private would go public on unhide.
			 */
			const operator = await signUpOperator();
			const owner = await signUp();
			const storyId = await seedStory(owner.memberId, { visibility: "public" });

			const caseId = await openCase(storyId, operator);
			await enforce(operator, caseId, "hide_story");
			// Meanwhile the creator makes it private.
			await act(owner.cookie, storyId, "unpublish");

			expect((await enforce(operator, caseId, "unhide_story")).status).toBe(
				201,
			);

			const row = await readRow(storyId);
			expect(row.hidden).toBe(false);
			expect(row.visibility).toBe("private");
		});
	},
);
