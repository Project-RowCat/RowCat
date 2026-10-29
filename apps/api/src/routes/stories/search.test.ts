import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { closeDb, db } from "../../db/client.ts";
import { member, story } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import { relevanceScore } from "../../services/story/ranking.ts";
import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { api } from "../../test/http.ts";

/**
 * Relevance sort and tag filter against real Postgres.
 *
 * SQL computes the relevance score and the pure `relevanceScore` is its specification. If they
 * diverge nothing errors: a work matching only in its description outranks a title match, which
 * only a real query shows. This file pins that both orders agree.
 *
 * Page boundaries are only observable here too: without the deterministic tail (`created_at desc,
 * id desc`), rows with equal scores repeat or vanish across pages while HTTP still answers 200.
 */

const EMAIL_PREFIX = "stories-search-test-";

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

interface Seed {
	title: string;
	tags?: string[];
	description?: string;
	author?: string;
	adult?: boolean;
}

async function seedStory(ownerId: string, seed: Seed): Promise<string> {
	const id = newId();
	await db.insert(story).values({
		id,
		owner: ownerId,
		title: seed.title,
		tags: seed.tags ?? [],
		description: seed.description ?? "",
		author: seed.author ?? "",
		adult: seed.adult ?? false,
		visibility: "public",
		origin_draft_id: `draft-${id}`,
	});
	return id;
}

interface Page {
	items: {
		id: string;
		title: string;
		tags: string[];
		description: string;
		author: string;
		creator: { nickname: string } | null;
	}[];
	total: number;
	pageCount: number;
}

const pageOf = async (search: string): Promise<Page> => {
	const response = await api(`/stories?${search}`);
	expect(response.status).toBe(200);
	return (await response.json()) as Page;
};

/** A random word keeps the term from overlapping works outside this suite. */
const term = () => `zq${newId().slice(0, 10)}`;

describe.skipIf(!databaseReady)("relevance", () => {
	test("title exact > title prefix > tag > nickname/author > description, the same order as the pure function", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const q = term();
		/** Creator whose nickname contains the term, so the nickname tier is exercised. */
		const named = await createTestMember(EMAIL_PREFIX);
		await db
			.update(member)
			.set({ nickname: `${q}Author` })
			.where(eq(member.id, named.memberId));

		const exact = await seedStory(owner.memberId, { title: q });
		const prefix = await seedStory(owner.memberId, { title: `${q} story` });
		const tagged = await seedStory(owner.memberId, {
			title: "Tag only",
			tags: [q],
		});
		const byNickname = await seedStory(named.memberId, {
			title: "Nickname only",
		});
		const byAuthor = await seedStory(owner.memberId, {
			title: "Author credit only",
			author: `${q} pen name`,
		});
		const described = await seedStory(owner.memberId, {
			title: "Description only",
			description: `A description mentioning ${q}`,
		});
		await seedStory(owner.memberId, { title: "An unrelated story" });

		const page = await pageOf(`q=${q}&sort=relevance`);
		const ids = page.items.map((item) => item.id);

		expect(page.total).toBe(6);
		expect(ids.slice(0, 3)).toEqual([exact, prefix, tagged]);
		/** Nickname and author credit share a tier, so the newest-first tail orders them: later insert first. */
		expect(ids.slice(3, 5)).toEqual([byAuthor, byNickname]);
		expect(ids[5]).toBe(described);

		/** SQL order equals the pure function's score order. */
		const scores = page.items.map((item) =>
			relevanceScore(q, {
				title: item.title,
				tags: item.tags,
				creatorNickname: item.creator?.nickname ?? null,
				author: item.author,
				description: item.description,
			}),
		);
		for (let i = 1; i < scores.length; i += 1)
			expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i] ?? 0);
	});

	test("relevance with no query is recency — folded rather than refused", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const older = await seedStory(owner.memberId, {
			title: `${term()} earlier`,
		});
		const newer = await seedStory(owner.memberId, { title: `${term()} later` });
		const page = await pageOf("sort=relevance&pageSize=100");
		const ids = page.items.map((item) => item.id);
		expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));
	});

	test("rows with equal scores neither duplicate nor drop at page boundaries", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const q = term();
		const seeded = await Promise.all(
			Array.from({ length: 5 }, (_, i) =>
				seedStory(owner.memberId, { title: `Unrelated ${i}`, description: q }),
			),
		);

		const seen: string[] = [];
		for (let pageNumber = 1; pageNumber <= 5; pageNumber += 1) {
			const page = await pageOf(
				`q=${q}&sort=relevance&page=${pageNumber}&pageSize=1`,
			);
			expect(page.pageCount).toBe(5);
			seen.push(...page.items.map((item) => item.id));
		}
		expect(new Set(seen).size).toBe(5);
		expect([...seen].sort()).toEqual([...seeded].sort());
	});

	test("wildcards are characters — `%` can't catch everything", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		await seedStory(owner.memberId, { title: term() });
		const page = await pageOf(`q=${encodeURIComponent("%")}&sort=relevance`);
		expect(page.total).toBe(0);
	});
});

describe.skipIf(!databaseReady)("tag filter", () => {
	test("only stories with exactly that tag — not a partial match", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const tag = term();
		const exact = await seedStory(owner.memberId, {
			title: "Exact",
			tags: ["Other", tag],
		});
		await seedStory(owner.memberId, { title: "Partial", tags: [`${tag}x`] });
		await seedStory(owner.memberId, {
			title: "uppercase",
			tags: [tag.toUpperCase()],
		});
		await seedStory(owner.memberId, { title: "Title only", description: tag });

		const page = await pageOf(`tag=${tag}`);
		expect(page.items.map((item) => item.id)).toEqual([exact]);
		expect(page.total).toBe(1);
	});

	test("tag and query narrow together", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const tag = term();
		const q = term();
		const both = await seedStory(owner.memberId, {
			title: `${q} story`,
			tags: [tag],
		});
		await seedStory(owner.memberId, { title: `${q} no tag` });
		await seedStory(owner.memberId, { title: "No query", tags: [tag] });

		const page = await pageOf(`tag=${tag}&q=${q}&sort=relevance`);
		expect(page.items.map((item) => item.id)).toEqual([both]);
	});

	test("the visibility boundary is unchanged — private, hidden and adult stories don't open through tags either", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const tag = term();
		const visible = await seedStory(owner.memberId, {
			title: "Public",
			tags: [tag],
		});
		const hiddenId = await seedStory(owner.memberId, {
			title: "Hidden",
			tags: [tag],
		});
		await db.update(story).set({ hidden: true }).where(eq(story.id, hiddenId));
		const privateId = await seedStory(owner.memberId, {
			title: "private",
			tags: [tag],
		});
		await db
			.update(story)
			.set({ visibility: "private" })
			.where(eq(story.id, privateId));
		const unlistedId = await seedStory(owner.memberId, {
			title: "unlisted",
			tags: [tag],
		});
		await db
			.update(story)
			.set({ visibility: "unlisted" })
			.where(eq(story.id, unlistedId));
		await seedStory(owner.memberId, {
			title: "Adult",
			tags: [tag],
			adult: true,
		});

		const page = await pageOf(`tag=${tag}`);
		expect(page.items.map((item) => item.id)).toEqual([visible]);
	});

	test("a tag or query over the cap is a 400", async () => {
		expect((await api(`/stories?tag=${"a".repeat(41)}`)).status).toBe(400);
		expect((await api(`/stories?q=${"a".repeat(101)}`)).status).toBe(400);
	});
});
