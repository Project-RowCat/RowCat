/**
 * Mobile adapter for what the comments tab draws. The rules live in `@rowcat/domain` and the web
 * tab calls the same functions. What stays here is folding a failure into "session lost" (that
 * check is `@rowcat/sdk` vocabulary) and formatting time for this app.
 *
 * It does not use the sibling tabs' `serverPanelView`, because one more state exists: an expired
 * session would get a `Try again` that always hits the same 401, so it needs sign-in instead. Pure
 * because this app's tests do not render React.
 */

import {
	type CreatorCommentInboxItem,
	type CreatorCommentsPanelView,
	creatorCommentDestination,
	creatorCommentKindLabel,
	creatorCommentsPanelView,
	creatorCommentUnreachableReason,
} from "@rowcat/domain";
import { isRowCatApiError } from "@rowcat/sdk";
import { formatDateTime } from "../../lib/format.ts";

/** Only the query axes this adapter reads, so it can be tested without the library. */
export interface CreatorCommentsQueryView {
	isPaused: boolean;
	isError: boolean;
	isPending: boolean;
	hasData: boolean;
	itemCount: number;
	/** Cause of the last failure; used only to check for 401. */
	error: unknown;
}

/** The 401 the server returns from requireViewer. */
export const isSessionLost = (error: unknown): boolean =>
	isRowCatApiError(error) && error.status === 401;

export function creatorCommentsView(
	q: CreatorCommentsQueryView,
): CreatorCommentsPanelView {
	return creatorCommentsPanelView({
		isPaused: q.isPaused,
		isError: q.isError,
		isPending: q.isPending,
		hasData: q.hasData,
		itemCount: q.itemCount,
		sessionLost: q.isError && isSessionLost(q.error),
	});
}

/** Where to return after signing in again: this tab. lib/return-path.ts accepts internal paths only, so this constant needs no re-check. */
export const CREATOR_COMMENTS_RETURN_PATH = "/create?view=comments";

export interface CreatorCommentRowView {
	/** React key and report target: the comment id, not list position. */
	key: string;
	/** `Comments` (comment) or `Reply`, as on screen. */
	kindLabel: string;
	/** Creation time; `null` when unreadable, and the screen then reserves no space. */
	at: string | null;
	/** Story to open on press; without one the title is plain text. Stops at the story: this app's detail has no comments-section anchor (the same reason notification destinations stop there, see notification-destination.ts). */
	storyId: string | null;
	/** Why a row has no destination, derived from the story's state. */
	unreachableReason: string | null;
}

export function creatorCommentRowView(
	item: CreatorCommentInboxItem,
): CreatorCommentRowView {
	const destination = creatorCommentDestination(item);
	return {
		key: item.comment.id,
		kindLabel: creatorCommentKindLabel(item.comment),
		at: formatDateTime(item.comment.createdAt),
		storyId: destination ? destination.storyId : null,
		unreachableReason: creatorCommentUnreachableReason(item),
	};
}
