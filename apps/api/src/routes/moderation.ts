import {
	AppealStatus,
	MODERATION_PAGE_SIZE,
	type ModerationActionDto,
	ModerationActionRequest,
	ModerationAppealResolveRequest,
	type ModerationAppealsPage,
	type ModerationQueuePage,
	ModerationQueueQuery,
	type ModerationReportDetailDto,
	ModerationResolveRequest,
} from "@rowcat/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { invalidInput, notFound } from "../lib/errors.ts";
import { requireModeratorViewer } from "../lib/gates.ts";
import { readJson, readLimit } from "../lib/http.ts";
import { getViewer } from "../middleware/viewer.ts";
import {
	executeAction,
	getReportDetail,
	listAppeals,
	listReports,
	resolveAppeal,
	resolveReport,
} from "../services/moderation.ts";

/**
 * Operator tooling, `/v2/moderation/*`.
 *
 * Every endpoint goes through the same gate (`requireModeratorViewer`); per-route role checks would
 * eventually loosen one endpoint to ordinary members with no visible symptom (§21). The gate sits
 * on `requireActiveViewer`, so a suspended or blocked operator cannot enter.
 *
 * Responses carry the operator's internal `reason` and member status. What keeps them off public
 * surfaces is the DTO, not the path: members read `MyModerationStatusDto`, which has no slot for
 * `reason` (§57). All responses are `private, no-cache` because the viewer is the operator (§85).
 */

/** Query string to contract. `z.coerce` is avoided for the reason given on `readLimit`. */
function parseQueueQuery(url: string) {
	const sp = new URL(url).searchParams;
	const limit = readLimit(sp);
	return ModerationQueueQuery.safeParse({
		status: sp.get("status") ?? undefined,
		targetType: sp.get("targetType") ?? undefined,
		cursor: sp.get("cursor") ?? undefined,
		limit,
	});
}

export const moderation = new Hono<AppEnv>()
	/**
	 * Queue of open reports, oldest first. Filters are status and target kind only; trends, aggregates
	 * and assignment are not questions this screen answers yet (§52).
	 */
	.get("/reports", async (c) => {
		requireModeratorViewer(await getViewer(c));
		const parsed = parseQueueQuery(c.req.url);
		if (!parsed.success) throw invalidInput(parsed.error);

		const page = await listReports({
			status: parsed.data.status,
			targetType: parsed.data.targetType,
			cursor: parsed.data.cursor,
			limit: parsed.data.limit ?? MODERATION_PAGE_SIZE,
		});
		const body: ModerationQueuePage = page;
		c.header("Cache-Control", "private, no-cache");
		return c.json(body);
	})

	/**
	 * Report detail keeps snapshot, canonical and case history separate (§53) so the operator knows
	 * what they are looking at. AI-response evidence is a private conversation the user chose to
	 * submit, and the data must say so for the screen to draw it as a different card.
	 */
	.get("/reports/:id", async (c) => {
		requireModeratorViewer(await getViewer(c));
		const detail = await getReportDetail(c.req.param("id"));
		if (!detail) throw notFound("Report not found.");
		const body: ModerationReportDetailDto = detail;
		c.header("Cache-Control", "private, no-cache");
		return c.json(body);
	})

	/**
	 * Closes a report as resolved or dismissed. Closing an already-closed report is a 404; a 200 would
	 * let two operators each close the same item and both believe they handled it.
	 */
	.post("/reports/:id/resolve", async (c) => {
		const viewer = requireModeratorViewer(await getViewer(c));
		const parsed = ModerationResolveRequest.safeParse(await readJson(c));
		if (!parsed.success) throw invalidInput(parsed.error);

		const done = await resolveReport({
			reportId: c.req.param("id"),
			resolverId: viewer.id,
			status: parsed.data.status,
			note: parsed.data.note,
		});
		if (!done) throw notFound("No report under review was found.");
		return c.body(null, 204);
	})

	/**
	 * Enforcement, the only write path of the operator API. The request carries no target, only a case
	 * id and action kind; the service derives the target from the case so enforcing something
	 * unrelated to the case under review is inexpressible. `reason` is required by the contract, so an
	 * empty-reason block is rejected by the schema (§56).
	 */
	.post("/actions", async (c) => {
		const viewer = requireModeratorViewer(await getViewer(c));
		const parsed = ModerationActionRequest.safeParse(await readJson(c));
		if (!parsed.success) throw invalidInput(parsed.error);

		const action = await executeAction({
			actorId: viewer.id,
			request: parsed.data,
		});
		const body: ModerationActionDto = action;
		return c.json(body, 201);
	})

	/** Appeal queue; same cursor and ordering (oldest first) as the report queue. */
	.get("/appeals", async (c) => {
		requireModeratorViewer(await getViewer(c));
		const sp = new URL(c.req.url).searchParams;
		const status = AppealStatus.safeParse(sp.get("status") ?? "open");
		if (!status.success) throw invalidInput(status.error);

		const page = await listAppeals({
			status: status.data,
			cursor: sp.get("cursor") ?? "",
			limit: MODERATION_PAGE_SIZE,
		});
		const body: ModerationAppealsPage = page;
		c.header("Cache-Control", "private, no-cache");
		return c.json(body);
	})

	/**
	 * Resolves an appeal. Acceptance actually executes the reversal (§64); only the appealed action is
	 * reversed, so other active actions on the same member leave the status unchanged (§65).
	 */
	.post("/appeals/:id/resolve", async (c) => {
		const viewer = requireModeratorViewer(await getViewer(c));
		const parsed = ModerationAppealResolveRequest.safeParse(await readJson(c));
		if (!parsed.success) throw invalidInput(parsed.error);

		const done = await resolveAppeal({
			appealId: c.req.param("id"),
			resolverId: viewer.id,
			status: parsed.data.status,
			note: parsed.data.note,
		});
		if (!done) throw notFound("No appeal under review was found.");
		return c.body(null, 204);
	});
