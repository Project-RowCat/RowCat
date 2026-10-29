import {
	type CreatorCommentInboxPage,
	CreatorCommentInboxQuery,
} from "@rowcat/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { invalidInput } from "../../lib/errors.ts";
import { requireViewer } from "../../lib/gates.ts";
import { readLimit } from "../../lib/http.ts";
import { getViewer } from "../../middleware/viewer.ts";
import { listCreatorCommentInbox } from "../../services/comments.ts";
import { listBlocked } from "../../services/social.ts";

/**
 * Creator comment inbox: `GET /v2/me/creator-comments`.
 *
 * Ownership comes only from the session: the query contract has no field for a target, and the
 * service takes `viewer.id` and decides ownership inside the join condition. A two-step "list my
 * works, then ask for comments by those ids" would move the "which works may I read" decision into
 * this route.
 *
 * The per-story comments path is not reused: it is a public-discussion resource behind the exposure
 * gate (private, archived, hidden), which 404s comments on my archived works, and calling it per
 * work costs one round trip per work.
 *
 * The gate is `requireViewer`, same as analytics: a sanctioned creator still reads what was said on
 * their works. Reporting a line goes through the report path's own gate.
 *
 * This router only parses the query and translates to HTTP (`routes/no-route-db-access.test.ts`).
 */
export const meCreatorComments = new Hono<AppEnv>().get("/", async (c) => {
	const viewer = requireViewer(await getViewer(c));

	const sp = new URL(c.req.url).searchParams;
	const parsed = CreatorCommentInboxQuery.safeParse({
		cursor: sp.get("cursor") ?? undefined,
		limit: readLimit(sp),
	});
	if (!parsed.success) throw invalidInput(parsed.error);

	const page = await listCreatorCommentInbox({
		ownerId: viewer.id,
		cursor: parsed.data.cursor,
		limit: parsed.data.limit,
		/**
		 * Comments by authors I blocked are dropped here too, matching the story detail's comment section
		 * so block means the same thing on every screen.
		 */
		hiddenAuthors: await listBlocked(viewer.id),
	});

	const body: CreatorCommentInboxPage = page;
	/**
	 * Private to the owner: it can carry titles of archived (non-public) works, same as analytics and
	 * the published-works tab.
	 */
	c.header("Cache-Control", "private, no-store");
	return c.json(body);
});
