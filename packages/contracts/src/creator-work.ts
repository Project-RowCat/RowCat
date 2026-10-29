import { z } from "zod";
import { StoryVisibility } from "./publication.ts";

/**
 * The owner's own works list, GET /v2/me/stories. It is kept separate from the gallery (StoryDto)
 * and the public profile. Three resources answer three different questions:
 * - GET /v2/stories: which works can anyone discover?
 * - GET /v2/creators/:id/stories: what has this person made public to others?
 * - GET /v2/me/stories: which works does the server hold for me? (this file)
 *
 * The first two have a viewing gate (adult-display opt-in, blocks, private hiding) that defines
 * them. Applying that gate here would make a creator's own works disappear from their management
 * screen. An adult work would vanish for a creator with adult display off, and a work hidden by an
 * operator would vanish even from its owner. So the only predicate here is owner = the member the
 * session resolved.
 *
 * Not included: play_payload, cover bytes, view and favorite counts, download counts, size,
 * description, tags, orientation, author name, and all moderation internals (who hid it, the
 * internal reason, report id, case id, reporter). The first group is not drawn by this screen,
 * which is work management, not a performance report. The second group is another authority's data.
 * What a member may see about sanctions is answered by GET /v2/me/moderation in its own type. View
 * and favorite counts exist in the columns but are not sent: once a value is in the contract, the
 * screen starts drawing it, and creator analytics is a separate product decision.
 *
 * hidden is here. The public projection lacks it. Without it, the screen would show a work in the
 * list that 404s on click, indistinguishable from a broken product. Here hidden is not another
 * member's sanction history; it is the current state of the creator's own work.
 */

/**
 * Allow-list owner projection of one work row. Not reusing StoryDto is the point of this shape. The
 * two projections answer different questions (what is visible versus what I hold), so only this one
 * carries originDraftId and hidden. Those two are never fillable for another person's work.
 *
 * Visibility now uses the same canonical value in both projections. For a while the public side
 * folded it into one isPrivate boolean. That could not tell public from archived even with only two
 * or three values. Once unlisted was added, the fold turned four states into one true/false, so it
 * was removed.
 */
export const CreatorWorkDto = z.object({
	/** Server work id. It differs from the local draft id; see originDraftId. */
	id: z.string(),
	/**
	 * The local draft id that created this work. It is the only bridge between the server work and the
	 * draft on the device. null is a normal value. Works migrated in from operations and seed data
	 * have no matching draft, and inventing one would collide with a real draft later
	 * (db/tables/story.ts). In that case the screen does not draw `Edit draft`, and it does not create a
	 * draft that does not exist.
	 */
	originDraftId: z.string().nullable(),
	title: z.string(),
	visibility: StoryVisibility,
	adult: z.boolean(),
	promptProtected: z.boolean(),
	/**
	 * Operator hide, an axis independent of the creator's visibility. The public response never sends
	 * it, but this response does. The owner must be able to see why their work is missing from the
	 * gallery and detail page; without that they would read the product as broken. The reason itself
	 * is not here; it lives in /v2/me/moderation.
	 */
	hidden: z.boolean(),
	/**
	 * The address of the current cover, or null. An address, not bytes. This field exists because
	 * cover management is on this screen. Without it the screen would call GET /v2/stories/:id once
	 * per row to learn the current cover. That call passes the viewing gate, so it returns 404 for the
	 * owner's own work when that work is archived or operator-hidden. The one state where the owner
	 * most wants to change the cover is the state where the value could not be read.
	 *
	 * Nothing new leaks. The address derives from the work id, and the cover route re-checks access
	 * with the same predicate as the work.
	 *
	 * The list query joins story_cover for this value but selects no bytes, only two small metadata
	 * columns. Crossing that boundary would make opening the works manager download every cover.
	 */
	coverUrl: z.string().nullable(),
	/** ISO 8601. */
	createdAt: z.iso.datetime(),
	/**
	 * Last time authoring content was edited. Replacing the cover does not move this value. A cover is
	 * its own resource with its own cache identity (story_cover.version), so swapping an image must
	 * not disturb the list's sort axis (updated_at desc). If it did, a work the user had not edited
	 * would rise to the top as if it had been updated.
	 */
	updatedAt: z.iso.datetime(),
});
export type CreatorWorkDto = z.infer<typeof CreatorWorkDto>;

/**
 * Not the gallery's 24 (one grid screen). This list is a row list, not a grid. A shared axis is not
 * a reason to share the constant: changing the gallery's column count would otherwise change this
 * list's page size too.
 */
export const CREATOR_WORKS_PAGE_SIZE = 20;
export const CREATOR_WORKS_MAX_PAGE_SIZE = 100;

/**
 * Page number only. No sort, search, or status filter. This screen manages one's own works rather
 * than discovering them, and with one person's work count those axes answer no real question. Add
 * them when needed; that is cheaper than server, SDK, and cache keys carrying unused axes ahead of
 * time.
 *
 * No slot for a target member: no ownerId, memberId, creatorId, or viewerId. A caller that passes
 * one fails at the type level. The owner is always the session's member; living under /me/* is the
 * rule.
 */
export const CreatorWorksQuery = z.object({
	page: z.number().int().min(1).default(1),
	pageSize: z
		.number()
		.int()
		.min(1)
		.max(CREATOR_WORKS_MAX_PAGE_SIZE)
		.default(CREATOR_WORKS_PAGE_SIZE),
});
export type CreatorWorksQuery = z.infer<typeof CreatorWorksQuery>;

export function toCreatorWorksSearchParams(
	q: CreatorWorksQuery,
): URLSearchParams {
	const sp = new URLSearchParams();
	if (q.page !== 1) sp.set("page", String(q.page));
	if (q.pageSize !== CREATOR_WORKS_PAGE_SIZE)
		sp.set("pageSize", String(q.pageSize));
	return sp;
}

/**
 * Same envelope as the gallery, with a different item type. The total is included for two reasons.
 * The screen must know when to stop 'load more', and the section label can show a count such as
 * `Published works 2`. No separate COUNT endpoint is opened for this.
 */
export const CreatorWorksPage = z.object({
	items: z.array(CreatorWorkDto),
	total: z.number().int().nonnegative(),
	page: z.number().int().min(1),
	pageSize: z.number().int().min(1),
	pageCount: z.number().int().min(1),
});
export type CreatorWorksPage = z.infer<typeof CreatorWorksPage>;
