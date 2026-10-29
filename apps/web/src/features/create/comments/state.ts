/**
 * The web adapter for what the comments panel draws. The rules (order, and why a row has no
 * destination) live in `@rowcat/domain`'s `creator-comments.ts`, and the mobile panel calls the
 * same functions. Two things stay here: collapsing the failure cause into 'session lost or not'
 * (the verdict uses `@rowcat/sdk` vocabulary, which the domain cannot know), and formatting
 * timestamps in this app's style.
 *
 * The workspace entry guard (`beforeLoad`) only checks the way in, so a session can still expire
 * while the user is looking at the panel. That user needs to sign in, not retry.
 */

import {
	type CreatorCommentInboxItem,
	type CreatorCommentsPanelView,
	creatorCommentDestination,
	creatorCommentsPanelView as resolvePanelView,
} from "@rowcat/domain";
import { isRowCatApiError } from "@rowcat/sdk";
import { formatDateTime } from "#/lib/format/date-time.ts";
import { translator } from "#/lib/i18n/current.ts";

export type {
	CreatorCommentsPanelState,
	CreatorCommentsPanelView,
} from "@rowcat/domain";

/** Accepts only the query fields read here, so it can be tested without the library. */
export interface CreatorCommentsQueryView {
	isPaused: boolean;
	isError: boolean;
	isPending: boolean;
	hasData: boolean;
	itemCount: number;
	/** The cause of the last failure. Only used to check whether it was a 401. */
	error: unknown;
}

/**
 * Whether the response means the session was lost: the 401 the server returns from `requireViewer`.
 */
export const isSessionLost = (error: unknown): boolean =>
	isRowCatApiError(error) && error.status === 401;

export function creatorCommentsPanelView(
	q: CreatorCommentsQueryView,
): CreatorCommentsPanelView {
	return resolvePanelView({
		isPaused: q.isPaused,
		isError: q.isError,
		isPending: q.isPending,
		hasData: q.hasData,
		itemCount: q.itemCount,
		sessionLost: q.isError && isSessionLost(q.error),
	});
}

export interface CreatorCommentRowView {
	/** Both the React key and the report target. This is the comment id, not the list position. */
	key: string;
	/** Either `Comment` or `Reply`. */
	kindLabel: string;
	/** Written time. Empty string when unreadable; the screen then reserves no space. */
	at: string;
	/** Where the title navigates. When there is none, the title is plain text. */
	destination: ReturnType<typeof creatorCommentDestination>;
	/**
	 * A quiet reason shown beside the title, saying why a row has no destination. Without it, users
	 * cannot tell why some titles are clickable and others are not. The reason comes from the work's
	 * state, not from anything done to this row.
	 */
	unreachableReason: string | null;
}

export function creatorCommentRowView(
	item: CreatorCommentInboxItem,
): CreatorCommentRowView {
	return {
		key: item.comment.id,
		kindLabel: translator("create")(
			item.comment.parentId === null
				? "comments.kind.comment"
				: "comments.kind.reply",
		),
		at: formatDateTime(item.comment.createdAt),
		destination: creatorCommentDestination(item),
		unreachableReason: unreachableReason(item),
	};
}

/**
 * The same three reasons, in the same order, as `creatorCommentUnreachableReason` in
 * `@rowcat/domain`: that function decides, this one names in the render's locale.
 */
function unreachableReason(item: CreatorCommentInboxItem): string | null {
	if (creatorCommentDestination(item)) return null;
	const t = translator("create");
	if (item.story.hidden) return t("comments.unreachable.hidden");
	if (item.story.visibility === "archived")
		return t("comments.unreachable.archived");
	if (item.story.visibility === "private")
		return t("comments.unreachable.private");
	return null;
}
