import {
	StoryCommentCreateRequest,
	type StoryCommentCreateResponse,
	type StoryCommentDeleteResponse,
	StoryCommentReactionKind,
	type StoryCommentReactionResponse,
	type StoryCommentRepliesPage,
	StoryCommentRepliesQuery,
	StoryCommentReplyCreateRequest,
	type StoryCommentReplyCreateResponse,
	type StoryCommentsPage,
	StoryCommentsQuery,
} from "@rowcat/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { invalidInput, notFound } from "../../lib/errors.ts";
import { requireActiveViewer, requireViewer } from "../../lib/gates.ts";
import { readJson, readLimit } from "../../lib/http.ts";
import { getViewer } from "../../middleware/viewer.ts";
import {
	addStoryCommentReaction,
	createStoryComment,
	createStoryCommentReply,
	deleteStoryComment,
	listStoryCommentReplies,
	listStoryComments,
	readCommentAfterDelete,
	removeStoryCommentReaction,
} from "../../services/comments.ts";
import { requireCapability } from "../../services/moderation-capability.ts";
import { requireCommentableStory } from "./access.ts";

/**
 * Story comments, mounted under `/v2/stories/:id/comments` by the stories router
 * (`routes/stories/index.ts`).
 *
 * There is no top-level `/comments`: ownership must live in the path. A body carrying the story id
 * would be trusted before the "can this viewer see the story" decision, and a request whose path
 * and body disagree would become expressible.
 *
 * Every endpoint passes through `requireCommentableStory`. Seven separate gates would eventually
 * loosen one, with a quiet symptom such as private-story discussion readable by id.
 *
 * ```text
 * GET    /                                 one page of top-level comments   guests may read
 * POST   /                                 write a top-level comment        active member + comment.write
 * DELETE /:commentId                       delete my comment or reply       member (suspended may delete)
 * GET    /:commentId/replies               one page of a thread's replies   guests may read
 * POST   /:commentId/replies               write a reply                    active member + comment.write
 * PUT    /:commentId/reactions/:kind       turn a reaction on (idempotent)  active member
 * DELETE /:commentId/reactions/:kind       turn it off (idempotent)         member
 * ```
 *
 * The parent is always in the path, so a request whose path and body name different comments is not
 * expressible. The reaction kind is in the path too: in a body it would need an extra schema pass,
 * and `PUT` means "make it this state" while the state's name would sit elsewhere.
 */

/** Query string to contract. `z.coerce` is avoided for the same reason as in the gallery route. */
function parseQuery(url: string) {
	const sp = new URL(url).searchParams;
	const limit = readLimit(sp);
	return StoryCommentsQuery.safeParse({
		cursor: sp.get("cursor") ?? undefined,
		limit,
	});
}

/** Same rule for replies; only the default page size differs. */
function parseRepliesQuery(url: string) {
	const sp = new URL(url).searchParams;
	const limit = readLimit(sp);
	return StoryCommentRepliesQuery.safeParse({
		cursor: sp.get("cursor") ?? undefined,
		limit,
	});
}

/**
 * Narrows the path's reaction kind to the public vocabulary. An unknown kind is a 404, not a 400:
 * answering "unsupported reaction" for `/reactions/wow` would publish the vocabulary.
 */
function parseReactionKind(raw: string | undefined) {
	return StoryCommentReactionKind.safeParse(raw);
}

export const comments = new Hono<AppEnv>()
	/**
	 * Guests may read: a public story's discussion is public, and only writing requires login.
	 *
	 * Only top-level comments are returned. Embedding replies would tie a page's cost to thread length
	 * and need pagination inside it; the page carries `replyCount` from one set query.
	 */
	.get("/", async (c) => {
		const parsed = parseQuery(c.req.url);
		if (!parsed.success) throw invalidInput(parsed.error);

		const { story, blocked, viewer } = await requireCommentableStory(c);
		const page = await listStoryComments({
			storyId: story.id,
			cursor: parsed.data.cursor,
			limit: parsed.data.limit,
			/** Reuses the block list the gate already read; calling again would run the query twice. */
			hiddenAuthors: blocked,
			/** Fills `viewerLiked`; null for guests, so always false. */
			viewerId: viewer?.id ?? null,
		});

		const body: StoryCommentsPage = page;
		/**
		 * Gating differs per viewer, so a shared cache could hand an adult story's discussion to an
		 * ineligible person. `viewerLiked` adds a second reason: the body now really differs.
		 */
		c.header("Cache-Control", "private, no-cache");
		return c.json(body);
	})

	/**
	 * Requires an active member: suspended or blocked accounts can read but not post. The author comes
	 * only from the session; the contract has no field for it.
	 *
	 * Two moderation gates because they ask different questions: `requireActiveViewer` is about the
	 * whole account, `requireCapability("comment.write")` about this one action, so a narrow sanction
	 * exists between "fine" and "fully suspended". Active comes first so a suspended account skips the
	 * later lookup. Deletion has neither gate (see below).
	 */
	.post("/", async (c) => {
		const viewer = requireActiveViewer(await getViewer(c));
		await requireCapability(viewer.id, "comment.write");
		const parsed = StoryCommentCreateRequest.safeParse(await readJson(c));
		if (!parsed.success) throw invalidInput(parsed.error);

		// Gate first: a request for an invisible story must be a 404 whatever the body says.
		const { story, blocked } = await requireCommentableStory(c);

		/** `Retry-After` is not handled here: the limiter's error carries it and `app.ts` `onError` attaches the header. */
		const comment = await createStoryComment({
			storyId: story.id,
			/** From the session; the body has no slot for it. */
			authorId: viewer.id,
			body: parsed.data.body,
			hiddenAuthors: blocked,
		});
		const body: StoryCommentCreateResponse = { comment };
		return c.json(body, 201);
	})

	/**
	 * Guests may read, same as the top-level list.
	 *
	 * A parent that is not a top-level comment of this story is a 404, decided by the service. An
	 * empty page would make 200 mean "something is there" and turn this into a probe for other
	 * stories' comment ids. Replies under a tombstone stay readable; only new ones are blocked.
	 */
	.get("/:commentId/replies", async (c) => {
		const parsed = parseRepliesQuery(c.req.url);
		if (!parsed.success) throw invalidInput(parsed.error);

		const { story, blocked, viewer } = await requireCommentableStory(c);
		const parentId = c.req.param("commentId");
		const page = await listStoryCommentReplies({
			storyId: story.id,
			parentId,
			cursor: parsed.data.cursor,
			limit: parsed.data.limit,
			hiddenAuthors: blocked,
			viewerId: viewer?.id ?? null,
		});

		const body: StoryCommentRepliesPage = page;
		c.header("Cache-Control", "private, no-cache");
		return c.json(body);
	})

	/**
	 * Same gate, limiter and body rules as top-level writing. The only difference is the three parent
	 * checks, done by the service inside its transaction. Reading the parent here first would let it
	 * be deleted before the insert, leaving a new reply under a tombstone.
	 */
	.post("/:commentId/replies", async (c) => {
		const viewer = requireActiveViewer(await getViewer(c));
		await requireCapability(viewer.id, "comment.write");
		const parsed = StoryCommentReplyCreateRequest.safeParse(await readJson(c));
		if (!parsed.success) throw invalidInput(parsed.error);

		const { story, blocked } = await requireCommentableStory(c);
		const { reply, parent } = await createStoryCommentReply({
			storyId: story.id,
			parentId: c.req.param("commentId"),
			authorId: viewer.id,
			body: parsed.data.body,
			hiddenAuthors: blocked,
		});
		const body: StoryCommentReplyCreateResponse = { reply, parent };
		return c.json(body, 201);
	})

	/**
	 * PUT and idempotent, not a toggle: a toggle would let a retry after a lost response undo the
	 * press, forcing the server to guess intent. `PUT` states the target state.
	 *
	 * Active members only, since this is outward interaction like writing. The `comment.write`
	 * capability is not checked: it restricts text, and a like leaves none. Widening it would need
	 * that decision made in the moderation vocabulary first.
	 */
	.put("/:commentId/reactions/:kind", async (c) => {
		const viewer = requireActiveViewer(await getViewer(c));
		const kind = parseReactionKind(c.req.param("kind"));
		if (!kind.success) throw notFound("Unsupported reaction.");

		const { story, blocked } = await requireCommentableStory(c);
		const comment = await addStoryCommentReaction({
			storyId: story.id,
			commentId: c.req.param("commentId"),
			memberId: viewer.id,
			kind: kind.data,
			hiddenAuthors: blocked,
		});
		const body: StoryCommentReactionResponse = { comment };
		c.header("Cache-Control", "private, no-cache");
		return c.json(body);
	})

	/**
	 * Idempotent. `requireViewer` (unlike turning on) for the same reason as deletion: withdrawing an
	 * expression must work while restricted. Succeeds even if never pressed; a 404 would reveal
	 * whether you pressed and make a retry after a lost response read as failure.
	 */
	.delete("/:commentId/reactions/:kind", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const kind = parseReactionKind(c.req.param("kind"));
		if (!kind.success) throw notFound("Unsupported reaction.");

		const { story, blocked } = await requireCommentableStory(c);
		const comment = await removeStoryCommentReaction({
			storyId: story.id,
			commentId: c.req.param("commentId"),
			memberId: viewer.id,
			kind: kind.data,
			hiddenAuthors: blocked,
		});
		const body: StoryCommentReactionResponse = { comment };
		c.header("Cache-Control", "private, no-cache");
		return c.json(body);
	})

	/**
	 * Own comments and replies only. Neither `requireActiveViewer` nor `comment.write` applies:
	 * suspension and capability limits stop new posts, not removing what you already said. Ownership
	 * lives in the service predicate (someone else's comment deletes 0 rows), so it is not re-asked
	 * here.
	 *
	 * The response changed from 204 to 200 because there are now two outcomes: a top-level comment
	 * with surviving replies becomes a tombstone and the row stays. Without the distinction the client
	 * would guess from `replyCount`, which goes stale when someone else replies, and wipe a live
	 * thread until refresh. Old clients are unaffected: the SDK's `requestVoid` discards the body.
	 */
	.delete("/:commentId", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const { story, blocked } = await requireCommentableStory(c);

		const deleted = await deleteStoryComment({
			kind: "author",
			storyId: story.id,
			commentId: c.req.param("commentId"),
			authorId: viewer.id,
		});
		/**
		 * Someone else's comment, a missing one and an already-tombstoned one all get the same response;
		 * a 403 would reveal that the comment exists.
		 */
		if (!deleted) throw notFound("Comment not found.");
		const body: StoryCommentDeleteResponse = {
			comment: await readCommentAfterDelete(deleted, viewer.id, blocked),
		};
		c.header("Cache-Control", "private, no-cache");
		return c.json(body);
	});
