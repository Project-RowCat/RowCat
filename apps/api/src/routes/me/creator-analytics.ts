import type { CreatorAnalyticsPage } from "@rowcat/contracts";
import { CreatorAnalyticsQuery } from "@rowcat/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { invalidInput } from "../../lib/errors.ts";
import { requireViewer } from "../../lib/gates.ts";
import { getViewer } from "../../middleware/viewer.ts";
import { readCreatorAnalytics } from "../../services/creator-analytics.ts";

/**
 * Creator analytics: `GET /v2/me/creator-analytics`.
 *
 * Ownership comes only from the session: `CreatorAnalyticsQuery` has no field for a target member
 * and the service takes `viewer.id` alone.
 *
 * Public resources (profile grid, gallery) are not reused: they answer "what is visible" and strip
 * private, archived and operator-hidden work, while this asks "what is mine". Loosening their
 * predicates to fill the gap would leak other people's private work.
 *
 * The gate is `requireViewer`, not `requireActiveViewer`: sanctions block outward writes, and a
 * suspended creator must still read facts about their own assets (same as `/me/account`,
 * `/me/moderation`, `/me/stories`).
 *
 * Aggregation, ownership and the meaning of the metrics live in the service; this router only
 * parses the query string and translates to HTTP (`routes/no-route-db-access.test.ts`).
 */
export const meCreatorAnalytics = new Hono<AppEnv>().get("/", async (c) => {
	const viewer = requireViewer(await getViewer(c));

	const sp = new URL(c.req.url).searchParams;
	const int = (key: string): number | undefined => {
		const raw = sp.get(key);
		if (raw === null) return undefined;
		const n = Number(raw);
		// Passing fractions/NaN/Infinity through as undefined would apply the default and hide the typo.
		return Number.isSafeInteger(n) ? n : Number.NaN;
	};
	const parsed = CreatorAnalyticsQuery.safeParse({
		window: sp.get("window") ?? undefined,
		page: int("page"),
		pageSize: int("pageSize"),
	});
	if (!parsed.success) throw invalidInput(parsed.error);
	const q = parsed.data;

	const { since, summary, items, total } = await readCreatorAnalytics({
		ownerId: viewer.id,
		window: q.window,
		page: q.page,
		pageSize: q.pageSize,
	});

	const body: CreatorAnalyticsPage = {
		window: q.window,
		since: since ? since.toISOString() : null,
		summary,
		items,
		total,
		page: q.page,
		pageSize: q.pageSize,
		// An empty result is still one page: the contract is min(1), and 0 would make the client's `page
		// < pageCount` check read as having no first page.
		pageCount: Math.max(1, Math.ceil(total / q.pageSize)),
	};
	/**
	 * Private to the owner, hence `no-store`: it carries titles of not-yet-public works and their
	 * performance (same as `/me/stories`).
	 */
	c.header("Cache-Control", "private, no-store");
	return c.json(body);
});
