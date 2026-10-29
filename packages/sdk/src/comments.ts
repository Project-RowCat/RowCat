import {
	StoryCommentCreateRequest,
	StoryCommentCreateResponse,
	StoryCommentDeleteResponse,
	type StoryCommentReactionKind,
	StoryCommentReactionResponse,
	StoryCommentRepliesQuery,
	StoryCommentReplyCreateRequest,
	StoryCommentReplyCreateResponse,
	StoryCommentsPage,
	StoryCommentsQuery,
	toStoryCommentRepliesSearchParams,
	toStoryCommentsSearchParams,
} from "@rowcat/contracts";
import type { StoryComment, StoryCommentPage } from "@rowcat/domain";
import type { RequestOptions, RowCatTransport } from "./client.ts";
import { invalidResponse } from "./errors.ts";

/** List input. Any axis left out is filled by the contract's defaults. */
export type StoryCommentsListInput = Partial<StoryCommentsQuery>;
/**
 * Replies list input. Only the default page size differs, and the contract's two defaults carry
 * that difference.
 */
export type StoryCommentRepliesListInput = Partial<StoryCommentRepliesQuery>;

/**
 * Story comments. This is the only place that knows the path sits under a story.
 *
 * It sits beside the stories resource, not inside `client.stories`, because the lifetimes differ. A
 * story is fetched once and cached long, while comments are appended by cursor and written often.
 * Merging them would give the story resource pagination and a write policy. The same reasoning
 * keeps favorites (`/favorites`) separate.
 *
 * Replies and reactions also live here. A reply is a comment, and a separate resource would
 * duplicate the report, delete, and reaction logic. A reaction is an aggregate attached to a
 * comment, so the returned row is the result of the action.
 */
export interface CommentsApi {
	/**
	 * One page of top-level comments. Call the first page without a cursor. For later pages, pass the
	 * server's `nextCursor` back as-is.
	 *
	 * The client must not build the cursor. Its shape (a combination of sort keys) belongs to the
	 * server, and if the client assembled it, changing the server's sort would become a client
	 * deploy-order problem.
	 *
	 * Replies are not returned; only `replyCount` comes back. Expanding a thread uses `listReplies`.
	 */
	list(
		storyId: string,
		input?: StoryCommentsListInput,
		options?: RequestOptions,
	): Promise<StoryCommentPage>;

	/**
	 * One page of replies in a thread, with the same cursor rule and the same order (oldest first).
	 *
	 * If the parent does not belong to this story, the result is a 404. It is not an empty page: an
	 * empty page would make a request pointing at another story's thread indistinguishable from a
	 * comment with no replies.
	 */
	listReplies(
		storyId: string,
		commentId: string,
		input?: StoryCommentRepliesListInput,
		options?: RequestOptions,
	): Promise<StoryCommentPage>;

	/**
	 * Creates one comment. Only the body is sent.
	 *
	 * There is no author field in the contract. The server reads the member from the session, so a
	 * request that writes under someone else's name cannot be constructed.
	 */
	create(
		storyId: string,
		body: string,
		options?: RequestOptions,
	): Promise<StoryComment>;

	/**
	 * Creates one reply. The parent is in the path.
	 *
	 * The body has no `parentId`, so a path and body that disagree cannot be constructed. The response
	 * carries two values because the parent's `replyCount` just changed; if the screen added 1
	 * locally, it would be wrong whenever someone else replied at the same moment.
	 */
	reply(
		storyId: string,
		commentId: string,
		body: string,
		options?: RequestOptions,
	): Promise<{ reply: StoryComment; parent: StoryComment }>;

	/**
	 * Turns the reaction **on**. Idempotent (PUT), not a toggle.
	 *
	 * If the response is lost and the request is sent again, the result is the same, so the screen can
	 * expect the state it requested. The response carries the updated row, and the cache just replaces
	 * it.
	 */
	react(
		storyId: string,
		commentId: string,
		kind: StoryCommentReactionKind,
		options?: RequestOptions,
	): Promise<StoryComment>;

	/**
	 * Turns the reaction **off**. Idempotent. Succeeds even if it was never pressed, and returns the
	 * current state.
	 */
	unreact(
		storyId: string,
		commentId: string,
		kind: StoryCommentReactionKind,
		options?: RequestOptions,
	): Promise<StoryComment>;

	/**
	 * Deletes one of the member's own comments or replies.
	 *
	 * Ownership is decided by the server. Deleting someone else's comment returns the same 404 as a
	 * missing comment, so a failure cannot reveal that the comment exists.
	 *
	 * The returned value states the outcome: `null` means the row was removed, and a value means the
	 * reply remained as a tombstone. The screen does not guess from `replyCount`, because that guess
	 * goes stale when someone else replies.
	 */
	remove(
		storyId: string,
		commentId: string,
		options?: RequestOptions,
	): Promise<StoryComment | null>;
}

/** If the id contains `/` or `?`, the path breaks. Encode it before appending. */
const commentsPath = (storyId: string) =>
	`/stories/${encodeURIComponent(storyId)}/comments`;
const commentPath = (storyId: string, commentId: string) =>
	`${commentsPath(storyId)}/${encodeURIComponent(commentId)}`;

export function createCommentsApi({
	requestJson,
}: RowCatTransport): CommentsApi {
	return {
		async list(storyId, input = {}, options) {
			// Validates the input through the contract as well. The serialization rule (omitting defaults)
			// assumes normalized values.
			const query = StoryCommentsQuery.parse(input);
			const json = await requestJson({
				method: "GET",
				path: commentsPath(storyId),
				search: toStoryCommentsSearchParams(query),
				signal: options?.signal,
			});

			const parsed = StoryCommentsPage.safeParse(json);
			if (!parsed.success) throw invalidResponse("/stories/:id/comments");
			/**
			 * The contract and the domain shape are 1:1 today. As on the story side, no pass-through mapper
			 * is kept. If they diverge, the compile error appears at this return.
			 */
			return parsed.data;
		},

		async listReplies(storyId, commentId, input = {}, options) {
			const query = StoryCommentRepliesQuery.parse(input);
			const json = await requestJson({
				method: "GET",
				path: `${commentPath(storyId, commentId)}/replies`,
				search: toStoryCommentRepliesSearchParams(query),
				signal: options?.signal,
			});

			const parsed = StoryCommentsPage.safeParse(json);
			if (!parsed.success)
				throw invalidResponse("/stories/:id/comments/:commentId/replies");
			return parsed.data;
		},

		async create(storyId, body, options) {
			const json = await requestJson({
				method: "POST",
				path: commentsPath(storyId),
				/**
				 * The body is built with the same schema the server reads. Trimming whitespace is not coded
				 * separately here; trimming belongs to the contract, so the screen, the SDK, and the server all
				 * apply one rule.
				 */
				body: StoryCommentCreateRequest.parse({ body }),
				signal: options?.signal,
			});
			const parsed = StoryCommentCreateResponse.safeParse(json);
			if (!parsed.success) throw invalidResponse("POST /stories/:id/comments");
			return parsed.data.comment;
		},

		async reply(storyId, commentId, body, options) {
			const json = await requestJson({
				method: "POST",
				path: `${commentPath(storyId, commentId)}/replies`,
				body: StoryCommentReplyCreateRequest.parse({ body }),
				signal: options?.signal,
			});
			const parsed = StoryCommentReplyCreateResponse.safeParse(json);
			if (!parsed.success)
				throw invalidResponse("POST /stories/:id/comments/:commentId/replies");
			return parsed.data;
		},

		async react(storyId, commentId, kind, options) {
			const json = await requestJson({
				method: "PUT",
				/**
				 * The reaction kind goes in the path. The request has no body, so there is nowhere to put it in
				 * one.
				 */
				path: `${commentPath(storyId, commentId)}/reactions/${encodeURIComponent(kind)}`,
				signal: options?.signal,
			});
			const parsed = StoryCommentReactionResponse.safeParse(json);
			if (!parsed.success)
				throw invalidResponse("PUT /stories/:id/comments/:commentId/reactions");
			return parsed.data.comment;
		},

		async unreact(storyId, commentId, kind, options) {
			const json = await requestJson({
				method: "DELETE",
				path: `${commentPath(storyId, commentId)}/reactions/${encodeURIComponent(kind)}`,
				signal: options?.signal,
			});
			const parsed = StoryCommentReactionResponse.safeParse(json);
			if (!parsed.success)
				throw invalidResponse(
					"DELETE /stories/:id/comments/:commentId/reactions",
				);
			return parsed.data.comment;
		},

		async remove(storyId, commentId, options) {
			/**
			 * The response is 200, not 204, so there is a body to read. Its value says which of the two
			 * outcomes occurred (see the interface comment). Failures were already converted into
			 * `RowCatApiError` by the shared error conversion.
			 */
			const json = await requestJson({
				method: "DELETE",
				path: commentPath(storyId, commentId),
				signal: options?.signal,
			});
			const parsed = StoryCommentDeleteResponse.safeParse(json);
			if (!parsed.success)
				throw invalidResponse("DELETE /stories/:id/comments/:commentId");
			return parsed.data.comment;
		},
	};
}
