import { eq, inArray, like } from "drizzle-orm";
import { db, pingDb } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { admin_audit_log, member, story, user } from "../db/schema.ts";
import { failIfServiceRequired } from "./required-services.ts";

/**
 * Setup and cleanup for tests that talk to a real Postgres.
 *
 * With no DB the tests skip instead of failing (`vitest.config.ts` header), so changes unrelated to
 * the auth schema do not force a local Postgres — except in runs that require their services
 * (`required-services.ts`, set by CI), where the same miss fails the file. Repeating this decision per file would eventually
 * miss the migration in one of them, and that failure would not name configuration as the cause.
 */
export async function connectTestDatabase(): Promise<boolean> {
	try {
		await pingDb();
		await runMigrations();
		return true;
	} catch (error) {
		failIfServiceRequired(
			"Postgres",
			`it couldn't be reached or migrated — ${String(error)}`,
		);
		console.warn(
			`[api.test] skipping because Postgres couldn't be reached — ${String(error)}`,
		);
		return false;
	}
}

/**
 * Deletes the auth accounts created with this prefix; members, stories and ledgers follow by FK
 * cascade.
 *
 * The prefix is this suite's ownership boundary, which is why there is no single fixed address:
 * cleanup that deletes another suite's rows fails in the victim, not the deleter.
 *
 * Stories are deleted first. When a member goes, the `story.owner` and `media.owner` cascades run
 * separately within one statement, in FK creation order. If media runs first it is blocked by a
 * live `story_media` reference (`media_id → restrict`) and the whole statement bounces; rebuilding
 * the migrations as one baseline reversed that order. Product account deletion
 * (`services/account/deletion.ts`) deletes stories explicitly first, and cleanup does the same.
 *
 * Audit rows are deleted first too, and that one is not about order but about reach. An audit row
 * outlives its operator's account by design (`operator` is `set null`), so once the account is gone
 * the row belongs to no suite and no prefix can find it again. On a database that is reused across
 * runs (worker databases are, and a role without CREATEDB shares one) those rows pile up, and a suite
 * that counts audit rows for the same target fails depending on which file ran before it.
 */
export async function deleteTestUsers(emailPrefix: string): Promise<unknown> {
	await db
		.delete(admin_audit_log)
		.where(inArray(admin_audit_log.operator, testMemberIds(emailPrefix)));
	await db
		.delete(story)
		.where(inArray(story.owner, testMemberIds(emailPrefix)));
	return db.delete(user).where(like(user.email, `${emailPrefix}%`));
}

/**
 * A subquery selecting the member ids created with this prefix, to narrow cleanup to its own rows.
 *
 * `deleteTestUsers` covers deleting the suite's accounts and FK cascades take the member's
 * children. Some rows are member children that are also deleted along another axis (push
 * registrations, deliveries, notifications); without a predicate, a test emptying them mid-run
 * would take rows this suite never created, and the failure surfaces in the victim. So cleanup
 * statements go through this subquery.
 *
 * It is a subquery to remove the window between reading and deleting, not to save a round trip:
 * reading the id list first would miss members created in between (a suite's `beforeEach` must also
 * cover members created mid-test).
 */
export const testMemberIds = (emailPrefix: string) =>
	db
		.select({ id: member.id })
		.from(member)
		.innerJoin(user, eq(user.id, member.user_id))
		.where(like(user.email, `${emailPrefix}%`));
