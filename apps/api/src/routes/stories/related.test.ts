import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import { block, story } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { api, WEB_ORIGIN } from "../../test/http.ts";

/**
 * `GET /v2/stories/:id/related`: ranking (tag > creator > popularity > recency) together with the
 * exposure boundary. If this address does not pass through the discovery screen's predicate, the
 * symptom is not an error but a private work's cover showing on someone else's detail, and a
 * mistake in that direction cannot be undone.
 */

const EMAIL_PREFIX = "stories-related-test-";

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

interface Seed {
	title: string;
	tags?: string[];
	favorites?: number;
	adult?: boolean;
	hidden?: boolean;
	visibility?: "public" | "unlisted" | "private" | "archived";
}

async function seedStory(ownerId: string, seed: Seed): Promise<string> {
	const id = newId();
	await db.insert(story).values({
		id,
		owner: ownerId,
		title: seed.title,
		tags: seed.tags ?? [],
		favorites: seed.favorites ?? 0,
		adult: seed.adult ?? false,
		hidden: seed.hidden ?? false,
		visibility: seed.visibility ?? "public",
		origin_draft_id: `draft-${id}`,
	});
	return id;
}

const tag = () => `rt${newId().slice(0, 10)}`;

const related = async (
	storyId: string,
	cookie?: string,
): Promise<{ status: number; ids: string[] }> => {
	const response = await api(`/stories/${storyId}/related`, {
		headers: cookie ? { Cookie: cookie } : {},
	});
	if (response.status !== 200) return { status: response.status, ids: [] };
	const body = (await response.json()) as { items: { id: string }[] };
	return { status: 200, ids: body.items.map((item) => item.id) };
};

describe.skipIf(!databaseReady)("ranking", () => {
	test("more shared tags rank higher, and the same creator ranks below a single tag", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const other = await createTestMember(EMAIL_PREFIX);
		const [a, b, c] = [tag(), tag(), tag()];
		const source = await seedStory(owner.memberId, {
			title: "Original",
			tags: [a, b, c],
		});
		const two = await seedStory(other.memberId, {
			title: "Two shared",
			tags: [a, b],
		});
		const one = await seedStory(other.memberId, {
			title: "One shared",
			tags: [c],
		});
		const sameCreator = await seedStory(owner.memberId, {
			title: "Same creator",
			tags: [tag()],
		});
		const sameCreatorAndTag = await seedStory(owner.memberId, {
			title: "Same creator + tag",
			tags: [a],
		});
		await seedStory(other.memberId, { title: "Unrelated", tags: [tag()] });

		const { ids } = await related(source);
		expect(ids).toEqual([two, sameCreatorAndTag, one, sameCreator]);
	});

	test("the original doesn't come, and nothing related is an empty array", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const lonely = await seedStory(owner.memberId, { title: "Alone" });
		const { status, ids } = await related(lonely);
		expect(status).toBe(200);
		expect(ids).toEqual([]);
	});

	test("ties break deterministically by favorites, recency and id", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const other = await createTestMember(EMAIL_PREFIX);
		const t = tag();
		const source = await seedStory(owner.memberId, {
			title: "Original",
			tags: [t],
		});
		const older = await seedStory(other.memberId, {
			title: "Earlier",
			tags: [t],
		});
		const newer = await seedStory(other.memberId, {
			title: "Later",
			tags: [t],
		});
		const loved = await seedStory(other.memberId, {
			title: "Saved",
			tags: [t],
			favorites: 5,
		});
		const once = await related(source);
		expect(once.ids).toEqual([loved, newer, older]);
		expect((await related(source)).ids).toEqual(once.ids);
	});

	test("the cap is eight", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const t = tag();
		const source = await seedStory(owner.memberId, {
			title: "Original",
			tags: [t],
		});
		await Promise.all(
			Array.from({ length: 10 }, (_, i) =>
				seedStory(owner.memberId, { title: `Candidate ${i}`, tags: [t] }),
			),
		);
		expect((await related(source)).ids).toHaveLength(8);
	});
});

describe.skipIf(!databaseReady)("visibility boundary", () => {
	test("private, archived, operator-hidden, unlisted, adult and blocked creators' stories don't come", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const other = await createTestMember(EMAIL_PREFIX);
		const blocked = await createTestMember(EMAIL_PREFIX);
		const t = tag();
		const source = await seedStory(owner.memberId, {
			title: "Original",
			tags: [t],
		});
		const visible = await seedStory(other.memberId, {
			title: "Public",
			tags: [t],
		});
		await seedStory(other.memberId, {
			title: "private",
			tags: [t],
			visibility: "private",
		});
		await seedStory(other.memberId, {
			title: "archived",
			tags: [t],
			visibility: "archived",
		});
		await seedStory(other.memberId, {
			title: "unlisted",
			tags: [t],
			visibility: "unlisted",
		});
		await seedStory(other.memberId, {
			title: "Hidden",
			tags: [t],
			hidden: true,
		});
		await seedStory(other.memberId, { title: "Adult", tags: [t], adult: true });
		const byBlocked = await seedStory(blocked.memberId, {
			title: "Blocked",
			tags: [t],
		});

		// Guest: blocking is a personal setting, so the guest sees that work (later insert comes first).
		expect((await related(source)).ids).toEqual([byBlocked, visible]);

		// Blocking member: the blocked creator's work drops out.
		await db
			.insert(block)
			.values({ blocker: owner.memberId, creator: blocked.memberId });
		expect((await related(source, owner.cookie)).ids).toEqual([visible]);
	});

	test("your own private stories come only to the owner — same as the discovery screen", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const t = tag();
		const source = await seedStory(owner.memberId, {
			title: "Original",
			tags: [t],
		});
		const mine = await seedStory(owner.memberId, {
			title: "My private",
			tags: [t],
			visibility: "private",
		});
		expect((await related(source, owner.cookie)).ids).toEqual([mine]);
		expect((await related(source)).ids).toEqual([]);
	});

	test("an original you can't see is a 404 — related stories can't be opened through a private story's tags", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const stranger = await createTestMember(EMAIL_PREFIX);
		const t = tag();
		const hiddenSource = await seedStory(owner.memberId, {
			title: "Private original",
			tags: [t],
			visibility: "private",
		});
		await seedStory(owner.memberId, { title: "Public", tags: [t] });
		expect((await related(hiddenSource)).status).toBe(404);
		expect((await related(hiddenSource, stranger.cookie)).status).toBe(404);
		expect((await related(newId())).status).toBe(404);
	});

	test("an unlisted original opens, and its related stories don't include unlisted ones either", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const t = tag();
		const unlistedSource = await seedStory(owner.memberId, {
			title: "Unlisted original",
			tags: [t],
			visibility: "unlisted",
		});
		const visible = await seedStory(owner.memberId, {
			title: "Public",
			tags: [t],
		});
		await seedStory(owner.memberId, {
			title: "Another unlisted",
			tags: [t],
			visibility: "unlisted",
		});
		const { status, ids } = await related(unlistedSource);
		expect(status).toBe(200);
		expect(ids).toEqual([visible]);
	});

	test("ownerless stories relate by tags too — only the creator signal is missing", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const t = tag();
		const source = await seedStory(owner.memberId, {
			title: "Original",
			tags: [t],
		});
		const orphan = await seedStory(owner.memberId, {
			title: "deletion",
			tags: [t],
		});
		await db.update(story).set({ owner: null }).where(eq(story.id, orphan));
		expect((await related(source)).ids).toEqual([orphan]);
	});
});

describe.skipIf(!databaseReady)("response", () => {
	test("not cached, and the same shape as the gallery", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const t = tag();
		const source = await seedStory(owner.memberId, {
			title: "Original",
			tags: [t],
		});
		await seedStory(owner.memberId, { title: "Related", tags: [t] });
		const response = await app.request(`/v2/stories/${source}/related`, {
			headers: { Origin: WEB_ORIGIN },
		});
		expect(response.headers.get("cache-control")).toContain("private");
		const body = (await response.json()) as {
			items: Record<string, unknown>[];
		};
		expect(Object.keys(body)).toEqual(["items"]);
		expect(body.items[0]).not.toHaveProperty("score");
		expect(body.items[0]).not.toHaveProperty("play_payload");
		expect(body.items[0]).toHaveProperty("tags");
	});
});
