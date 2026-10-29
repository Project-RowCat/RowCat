import {
	type AdminMobileUpdateDetailDto,
	AdminMobileUpdateJobCancelRequest,
	type AdminMobileUpdateJobDto,
	type AdminMobileUpdateJobPage,
	AdminMobileUpdateJobQuery,
	type AdminMobileUpdateJobsConfigDto,
	type AdminMobileUpdatePage,
	AdminMobileUpdatePauseRequest,
	AdminMobileUpdatePublishRequest,
	AdminMobileUpdateQuery,
	AdminMobileUpdateResumeRequest,
	type AdminMobileUpdateRollbackPlanDto,
	AdminMobileUpdateRollbackRequest,
	AdminMobileUpdateRolloutRequest,
	type AdminMobileUpdateTransitionResponse,
	MOBILE_UPDATE_ADMIN_ERROR_CODE,
} from "@rowcat/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { invalidInput, notFound } from "../../lib/errors.ts";
import { requireMobileUpdateCapability } from "../../lib/gates.ts";
import { noStore, readJson, readLimit } from "../../lib/http.ts";
import { getViewer } from "../../middleware/viewer.ts";
import {
	listMobileUpdateReleases,
	operateMobileUpdateRelease,
	readMobileUpdateRelease,
	readMobileUpdateRollbackPlan,
} from "../../services/mobile-updates/admin.ts";
import {
	cancelMobileUpdateJob,
	listMobileUpdateJobs,
	mobileUpdateJobsConfig,
	readMobileUpdateJob,
	requestPublishJob,
	requestRollbackJob,
} from "../../services/mobile-updates/jobs.ts";

/**
 * Mobile OTA for the operations console: `/v2/admin/mobile-updates/*` and
 * `/v2/admin/mobile-update-jobs/*`.
 *
 * Every handler passes one of three capability gates on its first line:
 *
 * ```text
 * read      releases · history · rollback plan · jobs     staff · admin
 * operate   raise rollout · pause · resume                admin
 * publish   publish request · rollback request · cancel   admin
 * ```
 *
 * Role comparison is not written here; `requireMobileUpdateCapability` reads the table in
 * `@rowcat/domain`, and the console's buttons read the same table.
 *
 * Routes deliberately absent:
 * - `PATCH /mobile-updates/:id { status, rolloutPercentage }`: the operation's name picks the
 *   allowed transition. A status-field patch would make combinations outside the transition table
 *   (re-enabling a rolled-back release, lowering the percentage) requestable.
 * - Uploads of manifest, bundle, assets or signatures: publishing starts from a repository commit
 *   and CI signs. An upload path would turn this console into a remote code uploader.
 * - Deleting releases or history: history is append-only and releases persist because installs
 *   already received them.
 *
 * All responses are `private, no-cache` (`noStore`).
 */

const parseReleaseQuery = (url: string) => {
	const sp = new URL(url).searchParams;
	return AdminMobileUpdateQuery.safeParse({
		channel: sp.get("channel") ?? undefined,
		platform: sp.get("platform") ?? undefined,
		runtimeVersion: sp.get("runtimeVersion") ?? undefined,
		status: sp.get("status") ?? undefined,
		cursor: sp.get("cursor") ?? undefined,
		limit: readLimit(sp),
	});
};

const releaseMissing = () =>
	notFound("No release.", MOBILE_UPDATE_ADMIN_ERROR_CODE.releaseMissing);

export const adminMobileUpdates = new Hono<AppEnv>()
	.get("/", async (c) => {
		requireMobileUpdateCapability(await getViewer(c), "read");
		const parsed = parseReleaseQuery(c.req.url);
		if (!parsed.success) throw invalidInput(parsed.error);
		const body: AdminMobileUpdatePage = await listMobileUpdateReleases(
			parsed.data,
		);
		noStore(c);
		return c.json(body);
	})

	.get("/:id", async (c) => {
		requireMobileUpdateCapability(await getViewer(c), "read");
		const detail = await readMobileUpdateRelease(c.req.param("id"));
		if (!detail) throw releaseMissing();
		const body: AdminMobileUpdateDetailDto = detail;
		noStore(c);
		return c.json(body);
	})

	/**
	 * Rollback plan. Changes nothing: the confirmation dialog draws it first, and the request re-runs
	 * the same query server-side because state may have changed in between.
	 */
	.get("/:id/rollback-plan", async (c) => {
		requireMobileUpdateCapability(await getViewer(c), "read");
		const plan = await readMobileUpdateRollbackPlan(c.req.param("id"));
		if (!plan) throw releaseMissing();
		const body: AdminMobileUpdateRollbackPlanDto = plan;
		noStore(c);
		return c.json(body);
	})

	/** Raise only: the transition table rejects lower values with 409. Blocking new installs is pause. */
	.post("/:id/rollout", async (c) => {
		const viewer = requireMobileUpdateCapability(await getViewer(c), "operate");
		const parsed = AdminMobileUpdateRolloutRequest.safeParse(await readJson(c));
		if (!parsed.success) throw invalidInput(parsed.error);
		const body: AdminMobileUpdateTransitionResponse =
			await operateMobileUpdateRelease(viewer.id, c.req.param("id"), {
				action: "rollout",
				percentage: parsed.data.percentage,
				reason: parsed.data.reason,
			});
		noStore(c);
		return c.json(body);
	})

	/** Installs that check afterwards stop receiving it; installs that already have it are unaffected. Reason required. */
	.post("/:id/pause", async (c) => {
		const viewer = requireMobileUpdateCapability(await getViewer(c), "operate");
		const parsed = AdminMobileUpdatePauseRequest.safeParse(await readJson(c));
		if (!parsed.success) throw invalidInput(parsed.error);
		const body: AdminMobileUpdateTransitionResponse =
			await operateMobileUpdateRelease(viewer.id, c.req.param("id"), {
				action: "pause",
				reason: parsed.data.reason,
			});
		noStore(c);
		return c.json(body);
	})

	/** Reopens at the paused percentage, so there is no percentage field. */
	.post("/:id/resume", async (c) => {
		const viewer = requireMobileUpdateCapability(await getViewer(c), "operate");
		const parsed = AdminMobileUpdateResumeRequest.safeParse(await readJson(c));
		if (!parsed.success) throw invalidInput(parsed.error);
		const body: AdminMobileUpdateTransitionResponse =
			await operateMobileUpdateRelease(viewer.id, c.req.param("id"), {
				action: "resume",
				reason: parsed.data.reason,
			});
		noStore(c);
		return c.json(body);
	})

	/**
	 * Requests a signed rollback; this route does not change release state. CI's publish tool marks
	 * `rolled_back` and then signs and registers the recovery release, in that order. If CI cannot be
	 * started the answer is 502 with nothing changed; the screen says the rollback did not start, and
	 * pause is what stops the spread.
	 */
	.post("/:id/rollback", async (c) => {
		const viewer = requireMobileUpdateCapability(await getViewer(c), "publish");
		const parsed = AdminMobileUpdateRollbackRequest.safeParse(
			await readJson(c),
		);
		if (!parsed.success) throw invalidInput(parsed.error);
		const body: AdminMobileUpdateJobDto = await requestRollbackJob(
			viewer.id,
			c.req.param("id"),
			parsed.data,
		);
		noStore(c);
		return c.json(body, 202);
	});

export const adminMobileUpdateJobs = new Hono<AppEnv>()
	.get("/", async (c) => {
		requireMobileUpdateCapability(await getViewer(c), "read");
		const sp = new URL(c.req.url).searchParams;
		const parsed = AdminMobileUpdateJobQuery.safeParse({
			cursor: sp.get("cursor") ?? undefined,
			limit: readLimit(sp),
		});
		if (!parsed.success) throw invalidInput(parsed.error);
		const body: AdminMobileUpdateJobPage = await listMobileUpdateJobs(
			parsed.data,
		);
		noStore(c);
		return c.json(body);
	})

	/** Whether CI is connected and this deployment's channel. Decides whether to draw the publish button; not authorization. */
	.get("/config", async (c) => {
		requireMobileUpdateCapability(await getViewer(c), "read");
		const body: AdminMobileUpdateJobsConfigDto = mobileUpdateJobsConfig();
		noStore(c);
		return c.json(body);
	})

	.get("/:id", async (c) => {
		requireMobileUpdateCapability(await getViewer(c), "read");
		const job = await readMobileUpdateJob(c.req.param("id"));
		if (!job)
			throw notFound("No job.", MOBILE_UPDATE_ADMIN_ERROR_CODE.jobMissing);
		const body: AdminMobileUpdateJobDto = job;
		noStore(c);
		return c.json(body);
	})

	/**
	 * Requests a new publish. The browser picks closed inputs only (channel, platform, source, initial
	 * percentage, note, reason); runtime, API origin and manifest have no slot, and `.strict()`
	 * rejects those keys with 400.
	 *
	 * 202 because the response means CI was asked, not that a release exists.
	 */
	.post("/", async (c) => {
		const viewer = requireMobileUpdateCapability(await getViewer(c), "publish");
		const parsed = AdminMobileUpdatePublishRequest.safeParse(await readJson(c));
		if (!parsed.success) throw invalidInput(parsed.error);
		const body: AdminMobileUpdateJobDto = await requestPublishJob(
			viewer.id,
			parsed.data,
		);
		noStore(c);
		return c.json(body, 202);
	})

	.post("/:id/cancel", async (c) => {
		const viewer = requireMobileUpdateCapability(await getViewer(c), "publish");
		const parsed = AdminMobileUpdateJobCancelRequest.safeParse(
			await readJson(c),
		);
		if (!parsed.success) throw invalidInput(parsed.error);
		const body: AdminMobileUpdateJobDto = await cancelMobileUpdateJob(
			viewer.id,
			c.req.param("id"),
			parsed.data.reason,
		);
		noStore(c);
		return c.json(body);
	});
