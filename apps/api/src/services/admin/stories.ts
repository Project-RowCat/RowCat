import type {
	AdminStoryDetailDto,
	AdminStoryPage,
	AdminStoryQuery,
	AdminStorySummaryDto,
	StoryVisibility,
} from "@rowcat/contracts";
import { and, count, desc, eq, ilike, lt, or, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
	member,
	moderation_action,
	moderation_case,
	moderation_report,
	story,
	story_comment,
} from "../../db/schema.ts";
import {
	decodeTimelineCursor,
	encodeTimelineCursor,
} from "../../lib/cursor.ts";
import { containsPattern } from "../../lib/like.ts";

/**
 * Operator story lookup; it does not go through `galleryWhere`. That predicate asks "is it visible
 * to this viewer" while this screen asks "what is in the catalogue"; adding a boolean like
 * `includeHidden` to `listStories` would shake the discovery path's exposure boundary (same as
 * `listOwnedStories` for the creator workspace).
 *
 * `play_payload` is never selected: it is the creator's manuscript, and the one case where an
 * operator must read it (a reported story) is already served by moderation evidence, visible only
 * bound to a case. "Admins see everything" would make this screen a manuscript-reading tool for all
 * users.
 *
 * There is no hide toggle: hiding is an enforcement that leaves a `moderation_action`. Updating
 * `story.hidden` here would be a second enforcement path with no audit row and nothing to appeal.
 * The detail's `openCaseId` is the substitute; the screen crosses over to moderation from there.
 */

const looksLikeStoryId = (value: string): boolean =>
	/^[0-9a-f]{32}$/i.test(value);

/**
 * The cursor's axis: `created_at` truncated to milliseconds. The column stores microseconds but the
 * cursor carries a JS `Date`, so comparing the raw column would treat `.123456` as neither before
 * nor equal to `.123` and silently drop same-millisecond rows at page boundaries. Ordering and
 * predicate both use the truncated value, or they disagree again; id breaks ties within a
 * millisecond.
 */
const createdAtMs = sql<Date>`date_trunc('milliseconds', ${story.created_at})`;

export async function listAdminStories(
	query: AdminStoryQuery,
): Promise<AdminStoryPage> {
	const size = query.limit;
	const after = query.cursor ? decodeTimelineCursor(query.cursor) : null;

	const search = query.q
		? or(
				looksLikeStoryId(query.q) ? eq(story.id, query.q) : undefined,
				ilike(story.title, containsPattern(query.q)),
			)
		: undefined;

	const rows = await db
		.select({
			id: story.id,
			title: story.title,
			ownerId: story.owner,
			ownerNickname: member.nickname,
			visibility: story.visibility,
			hidden: story.hidden,
			adult: story.adult,
			views: story.views,
			favorites: story.favorites,
			createdAt: story.created_at,
			updatedAt: story.updated_at,
		})
		.from(story)
		/**
		 * Left join: `story.owner` is nullable and NULL means identity erased by account deletion. An
		 * inner join would drop those stories, which are still in the catalogue and still moderatable.
		 */
		.leftJoin(member, eq(story.owner, member.id))
		.where(
			and(
				search,
				query.ownerId ? eq(story.owner, query.ownerId) : undefined,
				query.visibility ? eq(story.visibility, query.visibility) : undefined,
				query.hidden ? eq(story.hidden, query.hidden === "1") : undefined,
				query.adult ? eq(story.adult, query.adult === "1") : undefined,
				after
					? or(
							lt(createdAtMs, after.createdAt),
							and(eq(createdAtMs, after.createdAt), lt(story.id, after.id)),
						)
					: undefined,
			),
		)
		/**
		 * `created_at desc` differs from the creator list (`updated_at desc`) because the question
		 * differs: an operator asks what is new. It must match the cursor's axis, so changing it changes
		 * the cursor.
		 */
		.orderBy(desc(createdAtMs), desc(story.id))
		.limit(size + 1);

	const page = rows.slice(0, size);
	const items: AdminStorySummaryDto[] = page.map((row) => ({
		id: row.id,
		title: row.title,
		ownerId: row.ownerId,
		ownerNickname: row.ownerNickname ?? null,
		visibility: row.visibility as StoryVisibility,
		hidden: row.hidden,
		adult: row.adult,
		views: row.views,
		favorites: row.favorites,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	}));

	const last = page.at(-1);
	return {
		items,
		nextCursor:
			rows.length > size && last
				? encodeTimelineCursor({ createdAt: last.createdAt, id: last.id })
				: null,
	};
}

/**
 * Story detail, or `null`. It skips the viewing gate, so private, archived, operator-hidden and
 * adult stories all open: a moderator arriving from the queue cannot judge a target they cannot
 * see. The playback payload and cover bytes still do not go out (see the header).
 */
export async function readAdminStoryDetail(
	storyId: string,
): Promise<AdminStoryDetailDto | null> {
	const [row] = await db
		.select({
			id: story.id,
			title: story.title,
			description: story.description,
			tags: story.tags,
			ownerId: story.owner,
			ownerNickname: member.nickname,
			visibility: story.visibility,
			hidden: story.hidden,
			adult: story.adult,
			views: story.views,
			favorites: story.favorites,
			createdAt: story.created_at,
			updatedAt: story.updated_at,
		})
		.from(story)
		.leftJoin(member, eq(story.owner, member.id))
		.where(eq(story.id, storyId))
		.limit(1);
	if (!row) return null;

	const [openCase, actions, openReports, comments] = await Promise.all([
		db
			.select({ id: moderation_case.id })
			.from(moderation_case)
			.where(
				and(
					eq(moderation_case.target_type, "story"),
					eq(moderation_case.target_id, storyId),
					eq(moderation_case.status, "open"),
				),
			)
			.limit(1),
		/**
		 * Action count comes from `moderation_action`: `story.hidden` only says it is hidden now, and a
		 * story hidden and restored repeatedly looks the same as one never touched.
		 */
		db
			.select({ value: count() })
			.from(moderation_action)
			.where(eq(moderation_action.target_story, storyId)),
		db
			.select({ value: count() })
			.from(moderation_report)
			.where(
				and(
					eq(moderation_report.target_type, "story"),
					eq(moderation_report.target_id, storyId),
					eq(moderation_report.status, "open"),
				),
			),
		db
			.select({ value: count() })
			.from(story_comment)
			.where(eq(story_comment.story_id, storyId)),
	]);

	return {
		story: {
			id: row.id,
			title: row.title,
			ownerId: row.ownerId,
			ownerNickname: row.ownerNickname ?? null,
			visibility: row.visibility as StoryVisibility,
			hidden: row.hidden,
			adult: row.adult,
			views: row.views,
			favorites: row.favorites,
			createdAt: row.createdAt.toISOString(),
			updatedAt: row.updatedAt.toISOString(),
		},
		description: row.description,
		tags: row.tags,
		openCaseId: openCase[0]?.id ?? null,
		actionCount: actions[0]?.value ?? 0,
		openReportCount: openReports[0]?.value ?? 0,
		commentCount: comments[0]?.value ?? 0,
	};
}
