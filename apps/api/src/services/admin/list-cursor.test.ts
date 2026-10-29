import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { closeDb, db } from "../../db/client.ts";
import { story } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { listAdminMembers } from "./members.ts";
import { listAdminStories } from "./stories.ts";

/**
 * Admin list cursors must not drop rows created in the same millisecond. `created_at` stores
 * microseconds but the cursor carries a millisecond `Date`; a row lost at a page boundary is
 * invisible to the operator (the list looks fine and that member or story is simply nowhere). So
 * the test pages one row at a time and checks that everything was collected.
 */

const EMAIL_PREFIX = "admin-list-cursor-test-";

/** Three times within one millisecond (.123); they differ only in microseconds. */
const SAME_MILLISECOND = [
	"2026-01-01T00:00:00.123100Z",
	"2026-01-01T00:00:00.123200Z",
	"2026-01-01T00:00:00.123300Z",
];

const databaseReady = await connectTestDatabase();
const CREATED_STORIES: string[] = [];

afterAll(async () => {
	if (databaseReady) {
		if (CREATED_STORIES.length)
			await db.delete(story).where(inArray(story.id, CREATED_STORIES));
		await deleteTestUsers(EMAIL_PREFIX);
	}
	await closeDb();
});

describe.skipIf(!databaseReady)("cursors in operations lists", () => {
	test("members — three rows in the same millisecond all come out, one row per page", async () => {
		const token = `Cursor${newId().slice(0, 8)}`;
		const ids: string[] = [];
		for (const at of SAME_MILLISECOND) {
			const account = await createTestMember(EMAIL_PREFIX);
			/** Passed as a string: a JS `Date` truncates to milliseconds and would erase the microsecond difference before storage. */
			await db.$client.query(
				"update member set nickname = $1, created_at = $2::timestamptz where id = $3",
				[`${token}-${ids.length}`, at, account.memberId],
			);
			ids.push(account.memberId);
		}

		const seen: string[] = [];
		let cursor = "";
		for (let page = 0; page < 5; page++) {
			const result = await listAdminMembers({
				q: token,
				status: "",
				role: "",
				cursor,
				limit: 1,
			});
			seen.push(...result.items.map((item) => item.id));
			if (!result.nextCursor) break;
			cursor = result.nextCursor;
		}
		expect(seen.sort()).toEqual([...ids].sort());
	});

	test("stories — three rows in the same millisecond all come out, one row per page", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const ids: string[] = [];
		for (const at of SAME_MILLISECOND) {
			const id = newId();
			await db.insert(story).values({
				id,
				owner: owner.memberId,
				title: `Cursor ${id.slice(0, 6)}`,
				visibility: "public",
				origin_draft_id: newId(),
				play_payload: { v: 1 },
			});
			CREATED_STORIES.push(id);
			await db.$client.query(
				"update story set created_at = $1::timestamptz where id = $2",
				[at, id],
			);
			ids.push(id);
		}

		const seen: string[] = [];
		let cursor = "";
		for (let page = 0; page < 5; page++) {
			const result = await listAdminStories({
				q: "",
				ownerId: owner.memberId,
				visibility: "",
				hidden: "",
				adult: "",
				cursor,
				limit: 1,
			});
			seen.push(...result.items.map((item) => item.id));
			if (!result.nextCursor) break;
			cursor = result.nextCursor;
		}
		expect(seen.sort()).toEqual([...ids].sort());
	});
});
