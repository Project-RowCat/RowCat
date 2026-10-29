import {
	AppealCreateRequest,
	type MyAppealDto,
	type MyModerationStatusDto,
	type MyReportsPage,
	MyReportsQuery,
} from "@rowcat/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { invalidInput } from "../../lib/errors.ts";
import { requireViewer } from "../../lib/gates.ts";
import { readJson, readLimit } from "../../lib/http.ts";
import { checkRateLimit } from "../../lib/rate-limit/index.ts";
import { getViewer } from "../../middleware/viewer.ts";
import {
	createAppeal,
	getMyModerationStatus,
	listMyReports,
} from "../../services/moderation.ts";

/**
 * The member's own moderation state, reports and appeals: `/v2/me/moderation/*`.
 *
 * - All three routes are `requireViewer`, not `requireActiveViewer`. Suspended or blocked members
 *   are exactly who needs this screen; locking it would leave them unable to read why they were
 *   sanctioned or to appeal. Appeal submission is a write that stays open for the same reason: it
 *   is a defence against one's own sanction, and abuse is bounded structurally by "one open appeal
 *   per action", not by account status.
 * - It is not folded into `/me`, the hottest read (root SSR, header, auth guard); doing so would
 *   make every route's HTML carry the person's sanction history.
 * - "My reports" lives here, not under `/moderation`. That prefix is the operator's
 *   (`requireModeratorViewer`); opening a reporter filter there would make two authorizations share
 *   one resource, and a request that forgot the reporter parameter would be the whole queue. Here
 *   there is no such parameter and ownership comes only from the session.
 */

/** Query string to contract; `z.coerce` is avoided for the same reason as in the notifications and comments routes. */
function parseReportsQuery(url: string) {
	const sp = new URL(url).searchParams;
	const limit = readLimit(sp);
	return MyReportsQuery.safeParse({
		cursor: sp.get("cursor") ?? undefined,
		limit,
	});
}

export const meModeration = new Hono<AppEnv>()
	/**
	 * Everything currently applied to the member. An account with no restrictions still gets a normal
	 * response (empty arrays); a 404 would make "no restrictions" indistinguishable from a failed
	 * lookup.
	 */
	.get("/", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const body: MyModerationStatusDto = await getMyModerationStatus(viewer.id);
		/** Per-person, so no shared cache. */
		c.header("Cache-Control", "private, no-cache");
		return c.json(body);
	})

	/**
	 * The member's filed reports. Read-only: withdrawal, edit, reopen, reason change and messaging the
	 * operator do not exist, and that absence is expressed by the route being a single `GET`.
	 *
	 * Filing stays `POST /v2/reports`: it acts on a target and must pass the target visibility
	 * decision (`lookupSelector`), which `/me` is not the place to make.
	 */
	.get("/reports", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const parsed = parseReportsQuery(c.req.url);
		if (!parsed.success) throw invalidInput(parsed.error);

		const body: MyReportsPage = await listMyReports({
			reporterId: viewer.id,
			cursor: parsed.data.cursor,
			limit: parsed.data.limit,
		});
		/**
		 * Same policy as `/me/moderation`. `no-store` is not used because only kind, reason and state are
		 * carried, unlike the notification list; two reads of the same section should not have different
		 * cache policies.
		 */
		c.header("Cache-Control", "private, no-cache");
		return c.json(body);
	})

	/**
	 * File one appeal. The target is a single action id, and the server checks it is the member's own
	 * via `target_member`; there is no slot for a member id. Someone else's action and a nonexistent
	 * one are the same 404.
	 */
	.post("/appeals", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		await checkRateLimit("appealCreate", viewer.id);
		const parsed = AppealCreateRequest.safeParse(await readJson(c));
		if (!parsed.success) throw invalidInput(parsed.error);

		const { appealId, createdAt } = await createAppeal({
			memberId: viewer.id,
			actionId: parsed.data.actionId,
			message: parsed.data.message,
		});
		/** Return the created appeal so the screen can draw "under review" without refetching. The operator note (`resolutionNote`) is not in this type. */
		const body: MyAppealDto = {
			id: appealId,
			actionId: parsed.data.actionId,
			status: "open",
			createdAt: createdAt.toISOString(),
			resolvedAt: null,
		};
		return c.json(body, 201);
	});
