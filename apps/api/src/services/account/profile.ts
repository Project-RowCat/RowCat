import type { PublicProfile } from "@rowcat/domain";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { follow, member } from "../../db/schema.ts";
import { avatarUrlOf, memberAvatarMediaId } from "../media.ts";

/**
 * Public profile projection: picks only what may leave the member row.
 *
 * It is an allowlist, not an exclusion list. `const { email, ...rest } = row` blocks only sensitive
 * fields known today and publishes any new column silently; `PUBLIC_COLUMNS` fails the other way (a
 * new column stays private until listed, and forgetting shows up at once as a missing value).
 * Columns are also never SELECTed rather than stripped afterwards, since values could reach logs,
 * profilers and stack traces in between (the story projection has the same shape).
 *
 * Deliberately absent: email (auth side, not in this table), identity verification, adult flags,
 * adult display opt-in, member status, auth account id and signup time.
 * - `status` is the operator's internal state; exposing it would let anyone query another
 *   member's sanction history. Profiles of suspended or blocked members are not hidden either:
 *   suspension currently blocks writes only and their public stories stay in the gallery, so a 404
 *   profile would leave a dead creator link on visible work. When viewing sanctions become real,
 *   the policy must apply to gallery, detail and profile together.
 * - `created_at` has no product reason to be public, and account age aids impersonation and
 *   targeting.
 *
 * `followers` is the one non-column value, counted by a scalar subquery (`idx_follow_creator`). It
 * belongs because it is public and creator-bound and **the same for every viewer**, so this
 * function still takes no viewer and the response can still sit in a shared cache. "Am I following
 * them" stays out: it is a viewer relation, and one such value would make the bytes per-person and
 * collapse the shared cache; `/me/state` answers it in batch.
 */
const PUBLIC_COLUMNS = {
	id: member.id,
	displayName: member.nickname,
	/**
	 * The avatar comes from two axes, media pointer first and the legacy column as fallback;
	 * `avatarUrlOf` merges them. The condition extracting the media id (`status = 'ready'`) lives in
	 * this constant because there are three consumers (profile, comments, notifications), and a join
	 * written per consumer would eventually omit it with only a broken image as the symptom.
	 */
	avatarMediaId: memberAvatarMediaId,
	avatarUrl: member.avatar_url,
	bio: member.bio,
	/**
	 * No denormalized counter, the opposite call from favorites: those are read by dozens of list
	 * cards every time, while followers are read on the profile alone and rarely, so a column would
	 * only add drift to manage.
	 */
	followers:
		sql<number>`(select count(*) from ${follow} where ${follow.creator} = ${member.id})`
			.mapWith(Number)
			.as("followers"),
};

/**
 * Stored row to public profile. The only work is folding `""` to null: the column is `notNull
 * default ''` as a storage choice (to avoid two meanings of "none"), while the product model's
 * "unspecified" is null, so screens need no branch separating "wrote an empty bio" from "wrote
 * none". `avatarUrl` merges two axes, the media pointer (`avatar_media_id`) first and the legacy
 * `avatar_url` as fallback, via `avatarUrlOf`.
 */
const toProfile = (row: {
	id: string;
	displayName: string;
	avatarMediaId: string | null;
	avatarUrl: string;
	bio: string;
	followers: number;
}): PublicProfile => ({
	id: row.id,
	displayName: row.displayName,
	avatarUrl: avatarUrlOf(row.avatarMediaId, row.avatarUrl),
	bio: row.bio || null,
	// Copied as the subquery counted it; it cannot be negative (count) and cannot drift.
	followers: row.followers,
});

/**
 * One member's public profile, or null (the route turns it into a 404).
 *
 * A deleted account disappears naturally: the deletion transaction removes the member row
 * (`services/account/deletion.ts`), so no "was deleted" branch is needed. A tombstone row would
 * require code reading that state, and one miss would resurrect a deleted account's profile.
 *
 * It takes no viewer: the response is the same bytes for guests, the owner and other members. A
 * viewer argument would create values visible only on one's own profile and remove any way to check
 * how it looks from outside.
 */
export async function getPublicProfile(
	memberId: string,
): Promise<PublicProfile | null> {
	const [row] = await db
		.select(PUBLIC_COLUMNS)
		.from(member)
		.where(eq(member.id, memberId))
		.limit(1);
	return row ? toProfile(row) : null;
}

/**
 * Updates one's own bio and returns the confirmed public profile.
 *
 * It does not return `ViewerDto`: the bio is not in the viewer model (`/me` is read by the whole
 * app every time, and adding a value one account screen writes would put it in every route's SSR
 * HTML). Returning the very cell this write changes lets the screen seat the response in the public
 * profile cache with no invalidation or refetch.
 *
 * An empty string is stored as is; clearing the bio empties the value, and since the column is
 * `notNull` the stored form of unspecified is `""`, which `toProfile` folds back to null.
 *
 * The target is one argument that comes only from the session; the request body has no slot for a
 * member id (`BioUpdateDto`), since a caller would eventually pass a client value.
 */
export async function updateOwnBio(
	memberId: string,
	bio: string,
): Promise<PublicProfile | null> {
	const [row] = await db
		.update(member)
		.set({ bio })
		.where(eq(member.id, memberId))
		.returning(PUBLIC_COLUMNS);
	return row ? toProfile(row) : null;
}
