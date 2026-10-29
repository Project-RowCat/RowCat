import {
	ReportCreateRequest,
	type ReportCreateResponse,
} from "@rowcat/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { invalidInput } from "../lib/errors.ts";
import { requireActiveViewer } from "../lib/gates.ts";
import { readJson } from "../lib/http.ts";
import { getViewer } from "../middleware/viewer.ts";
import { createReport } from "../services/moderation.ts";
import { lookupSelector } from "./stories/access.ts";

/**
 * Report intake, `POST /v2/reports`.
 *
 * One endpoint instead of one per target: per-target routes would be three near-identical handlers,
 * and an AI response has no resource path at all (the server holds no such conversation). A
 * discriminated union carries all four targets (§43, §44) and free-form `targetType`/`targetId`
 * pairs are inexpressible.
 *
 * The gate is `requireActiveViewer` because a report creates review work; a restricted account
 * consuming human review time without limit is the abuse §16 guards against. This differs from
 * blocking, which stays open under `social.write` restrictions because it only reduces the
 * blocker's own exposure and costs nobody else's time. Capability restrictions such as
 * `comment.write` do not apply here: there is deliberately no capability that stops reporting,
 * since that would be gagging rather than sanction.
 */

export const reports = new Hono<AppEnv>().post("/", async (c) => {
	const viewer = requireActiveViewer(await getViewer(c));
	const parsed = ReportCreateRequest.safeParse(await readJson(c));
	if (!parsed.success) throw invalidInput(parsed.error);

	/**
	 * Build the story selector in the same place as the single-item path. Assembling it by hand could
	 * drop the adult gate or block list, which leaks as existence being confirmable by id alone (§45).
	 */
	const { selector } = await lookupSelector(c);

	/** `Retry-After` is not handled here; the shared limiter throws the 429 and `app.ts`'s `onError` attaches the header. */
	const { reportId, createdAt } = await createReport({
		reporterId: viewer.id,
		selector,
		request: parsed.data,
	});
	/**
	 * Minimal acknowledgement (§49): no case id, per-target report count or operator status. A "this
	 * target was already reported several times" signal could be used to coordinate targeted
	 * reporting.
	 */
	const body: ReportCreateResponse = {
		reportId,
		createdAt: createdAt.toISOString(),
	};
	return c.json(body, 201);
});
