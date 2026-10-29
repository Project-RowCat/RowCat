import {
	ADMIN_PAGE_SIZE,
	AdminAdultVerificationRequest,
	type AdminAdultVerificationResponse,
	AdminAppUpdateBroadcastRequest,
	type AdminAppUpdateBroadcastResponse,
	AdminManagedGenerationRequest,
	type AdminManagedGenerationResponse,
	type AdminMemberDetailDto,
	type AdminMemberPage,
	AdminMemberQuery,
	type AdminOverviewDto,
	AdminStoryDeleteRequest,
	type AdminStoryDeleteResponse,
	type AdminStoryDetailDto,
	type AdminStoryPage,
	AdminStoryQuery,
	AppPlatform,
	type AppUpdateBroadcastStatusesDto,
	type AppVersionFloorDto,
	AppVersionFloorSetRequest,
	type AppVersionFloorsDto,
	type AuditLogPage,
	AuditLogQuery,
	type FeatureFlagDto,
	FeatureFlagKey,
	FeatureFlagSetRequest,
	type FeatureFlagsDto,
	OPS_ERROR_CODE,
} from "@rowcat/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { badRequest, invalidInput, notFound } from "../../lib/errors.ts";
import { requireAdminViewer, requireModeratorViewer } from "../../lib/gates.ts";
import { noStore, readJson, readLimit } from "../../lib/http.ts";
import { getViewer } from "../../middleware/viewer.ts";
import { setAdultVerificationAsAdmin } from "../../services/admin/adult-verification.ts";
import {
	broadcastAppUpdate,
	readAppUpdateBroadcastStatuses,
} from "../../services/admin/app-update-notice.ts";
import { listAuditLog, recordReadAudit } from "../../services/admin/audit.ts";
import { setManagedGenerationAsAdmin } from "../../services/admin/managed-generation.ts";
import {
	listAdminMembers,
	readAdminMemberDetail,
} from "../../services/admin/members.ts";
import { readAdminOverview } from "../../services/admin/overview.ts";
import {
	listAdminStories,
	readAdminStoryDetail,
} from "../../services/admin/stories.ts";
import { deleteStoryAsOperator } from "../../services/admin/story-deletion.ts";
import {
	listAppVersionFloors,
	listFeatureFlags,
	setAppVersionFloor,
	setFeatureFlag,
} from "../../services/ops.ts";
import { adminMobileUpdateJobs, adminMobileUpdates } from "./mobile-updates.ts";

/**
 * Operations console, `/v2/admin/*`.
 *
 * Two gates:
 * - `requireModeratorViewer`: all reads plus member/story lookups (staff, admin).
 * - `requireAdminViewer`: lending the operator's provider key and locking the app (admin only).
 *
 * Every handler passes one of them on its first line. Hand-written role comparisons per route
 * eventually loosen on a single endpoint, and that looks identical in a success response (§21).
 * Both gates sit on `requireActiveViewer`, so a suspended or blocked operator is refused even while
 * the role column still says `admin`.
 *
 * The moderation routes were not moved: report queue, enforcement and appeals stay under
 * `/v2/moderation/*`, because moving them would break deployed clients' paths for naming
 * consistency. The console uses that router as-is; there is no second moderation system.
 *
 * No enforcement endpoint lives here. Hiding a story, suspending a member and deleting a comment
 * all go through `POST /v2/moderation/actions`, which keeps the action ledger and `member.status`
 * consistent (§66). A convenience route such as `PATCH /v2/admin/stories/:id { hidden }` would be a
 * second enforcement path with no audit record and nothing to appeal.
 *
 * Caches are all `private, no-cache`: responses are operator-specific and member detail carries an
 * email.
 */

export const admin = new Hono<AppEnv>()
	/**
	 * Mobile OTA keeps its own file and its gate is the capability table (read, operate, publish), not
	 * the staff/admin pair.
	 */
	.route("/mobile-updates", adminMobileUpdates)
	.route("/mobile-update-jobs", adminMobileUpdateJobs)

	/**
	 * Operations overview. Answers 200 even when the DB is down: the service card exists to say what
	 * is dead, and a 500 would fail to answer that.
	 */
	.get("/overview", async (c) => {
		requireModeratorViewer(await getViewer(c));
		const body: AdminOverviewDto = await readAdminOverview();
		noStore(c);
		return c.json(body);
	})

	.get("/members", async (c) => {
		requireModeratorViewer(await getViewer(c));
		const sp = new URL(c.req.url).searchParams;
		const parsed = AdminMemberQuery.safeParse({
			q: sp.get("q") ?? undefined,
			status: sp.get("status") ?? undefined,
			role: sp.get("role") ?? undefined,
			cursor: sp.get("cursor") ?? undefined,
			limit: readLimit(sp),
		});
		if (!parsed.success) throw invalidInput(parsed.error);

		const body: AdminMemberPage = await listAdminMembers({
			...parsed.data,
			limit: parsed.data.limit ?? ADMIN_PAGE_SIZE,
		});
		noStore(c);
		return c.json(body);
	})

	/**
	 * Member detail. The only lookup that returns an email, so it leaves an audit record.
	 *
	 * The audit does not block the read (`recordReadAudit` swallows failures): a member lookup 500ing
	 * because the audit table wobbled mid-incident amplifies the failure. Writes differ; there an
	 * audit failure rolls the operation back.
	 *
	 * A missing member and a deleted member are the same 404.
	 */
	.get("/members/:id", async (c) => {
		const viewer = requireModeratorViewer(await getViewer(c));
		const memberId = c.req.param("id");

		const detail = await readAdminMemberDetail(memberId);
		if (!detail) throw notFound("Member not found.");

		await recordReadAudit({
			operatorId: viewer.id,
			action: "admin.member.view",
			targetType: "member",
			targetId: memberId,
			/** The email stays out of the metadata; the target id is enough to trace it. */
			metadata: {},
		});

		const body: AdminMemberDetailDto = detail;
		noStore(c);
		return c.json(body);
	})

	/**
	 * Manual adult-eligibility grant. Admin only.
	 *
	 * The value opens a legal requirement (identity verification and age 19+). A mistaken grant puts
	 * adult publishing and viewing on a fact we never verified, with no way to pull back what has
	 * already circulated.
	 *
	 * Not an enforcement route. Suspension, blocking and capability restriction still go through `POST
	 * /v2/moderation/actions` (§26). This lives here because it is not a sanction: it is an
	 * eligibility state with nothing to appeal, and putting it in the action ledger would leave
	 * `reverseAction` with no meaning.
	 *
	 * No idempotency key: the request carries a target state, so any number of retries gives the same
	 * result (unlike deltas, where a retry moves twice).
	 *
	 * Whether the member exists is answered by the service (`null` when the locked row is missing).
	 * Looking up beforehand would let a deletion between lookup and write leak out as a 500.
	 */
	.post("/members/:id/adult-verification", async (c) => {
		const viewer = requireAdminViewer(await getViewer(c));
		const memberId = c.req.param("id");

		const parsed = AdminAdultVerificationRequest.safeParse(await readJson(c));
		if (!parsed.success) throw invalidInput(parsed.error);

		const result = await setAdultVerificationAsAdmin({
			memberId,
			operatorId: viewer.id,
			verified: parsed.data.verified,
			adult: parsed.data.adult,
			reason: parsed.data.reason,
		});
		if (!result) throw notFound("Member not found.");

		const body: AdminAdultVerificationResponse = result;
		noStore(c);
		return c.json(body);
	})

	/**
	 * Managed-generation allowlist. Admin only, no idempotency key (target state).
	 *
	 * Admin-only because it lends the operator's provider key; in an unmetered release it is the only
	 * lever on spend. With `MANAGED_GENERATION_ACCESS=everyone` the value is not consulted for the
	 * decision but can still be changed, so the list is intact the day the mode goes back.
	 */
	.post("/members/:id/managed-generation", async (c) => {
		const viewer = requireAdminViewer(await getViewer(c));
		const parsed = AdminManagedGenerationRequest.safeParse(await readJson(c));
		if (!parsed.success) throw invalidInput(parsed.error);

		const result = await setManagedGenerationAsAdmin({
			memberId: c.req.param("id"),
			operatorId: viewer.id,
			allowed: parsed.data.allowed,
			reason: parsed.data.reason,
		});
		if (!result) throw notFound("Member not found.");

		const body: AdminManagedGenerationResponse = result;
		noStore(c);
		return c.json(body);
	})

	.get("/stories", async (c) => {
		requireModeratorViewer(await getViewer(c));
		const sp = new URL(c.req.url).searchParams;
		const parsed = AdminStoryQuery.safeParse({
			q: sp.get("q") ?? undefined,
			ownerId: sp.get("ownerId") ?? undefined,
			visibility: sp.get("visibility") ?? undefined,
			hidden: sp.get("hidden") ?? undefined,
			adult: sp.get("adult") ?? undefined,
			cursor: sp.get("cursor") ?? undefined,
			limit: readLimit(sp),
		});
		if (!parsed.success) throw invalidInput(parsed.error);

		const body: AdminStoryPage = await listAdminStories({
			...parsed.data,
			limit: parsed.data.limit ?? ADMIN_PAGE_SIZE,
		});
		noStore(c);
		return c.json(body);
	})

	.get("/stories/:id", async (c) => {
		requireModeratorViewer(await getViewer(c));
		const detail = await readAdminStoryDetail(c.req.param("id"));
		if (!detail) throw notFound("Story not found.");
		const body: AdminStoryDetailDto = detail;
		noStore(c);
		return c.json(body);
	})

	/**
	 * Published-story deletion. Admin only, irreversible.
	 *
	 * Creators have no self-service story deletion; requests arrive through the operator's contact
	 * channel and this route is that channel's hand. It is not enforcement and does not go through `POST /v2/moderation/actions`; a
	 * story with ledger actions is refused by the service because deleting would erase that record.
	 *
	 * One outcome (`deleted`). The body is a single reason and `.strict()`. No idempotency key (target
	 * state): resending for a deleted story is a 404, which the console reads as "already gone".
	 */
	.post("/stories/:id/delete", async (c) => {
		const viewer = requireAdminViewer(await getViewer(c));
		const parsed = AdminStoryDeleteRequest.safeParse(await readJson(c));
		if (!parsed.success) throw invalidInput(parsed.error);

		const outcome = await deleteStoryAsOperator({
			storyId: c.req.param("id"),
			operatorId: viewer.id,
			reason: parsed.data.reason,
		});
		const body: AdminStoryDeleteResponse = { outcome };
		noStore(c);
		return c.json(body);
	})

	/** All switches. Operators may read them; knowing what is off is material for incident response. */
	.get("/operations/features", async (c) => {
		requireModeratorViewer(await getViewer(c));
		const body: FeatureFlagsDto = { items: await listFeatureFlags() };
		noStore(c);
		return c.json(body);
	})

	/**
	 * Changes one switch. Admin only.
	 *
	 * The key is in the path and out-of-vocabulary keys are rejected here (fail-closed). Not building
	 * a generic form that takes free keys is the point of this slice: one typo would create a row no
	 * route reads while the operator believes the feature is off.
	 */
	.put("/operations/features/:key", async (c) => {
		const viewer = requireAdminViewer(await getViewer(c));

		const key = FeatureFlagKey.safeParse(c.req.param("key"));
		if (!key.success)
			throw badRequest(
				"Unknown feature switch.",
				OPS_ERROR_CODE.unknownFeature,
			);

		const parsed = FeatureFlagSetRequest.safeParse(await readJson(c));
		if (!parsed.success) throw invalidInput(parsed.error);

		const body: FeatureFlagDto = await setFeatureFlag({
			key: key.data,
			actorId: viewer.id,
			request: parsed.data,
		});
		noStore(c);
		return c.json(body);
	})

	.get("/operations/app-versions", async (c) => {
		requireModeratorViewer(await getViewer(c));
		const body: AppVersionFloorsDto = { items: await listAppVersionFloors() };
		noStore(c);
		return c.json(body);
	})

	/**
	 * Minimum app version. Admin only, and the most dangerous operation in this router.
	 *
	 * A floor set at a version not in the store locks every mobile user out until store review
	 * completes. The server cannot know whether the version is in the store, so it cannot block this;
	 * what blocks is the console's explicit confirmation, and what remains is the audit record. The
	 * contract validates only the format (`MAJOR.MINOR.PATCH`).
	 */
	.put("/operations/app-versions/:platform", async (c) => {
		const viewer = requireAdminViewer(await getViewer(c));

		const platform = AppPlatform.safeParse(c.req.param("platform"));
		if (!platform.success)
			throw badRequest("Unknown platform.", "unknown_platform");

		const parsed = AppVersionFloorSetRequest.safeParse(await readJson(c));
		if (!parsed.success) throw invalidInput(parsed.error);

		const body: AppVersionFloorDto = await setAppVersionFloor({
			platform: platform.data,
			actorId: viewer.id,
			request: parsed.data,
		});
		noStore(c);
		return c.json(body);
	})

	/**
	 * App-update announcement status. Readable by all operators: answering "I never got the update notice" requires knowing whether that version was
	 * sent, and narrowing reads to admin would leave staff unable to answer.
	 */
	.get("/operations/app-versions/notice", async (c) => {
		requireModeratorViewer(await getViewer(c));
		const body: AppUpdateBroadcastStatusesDto = {
			items: await readAppUpdateBroadcastStatuses(),
		};
		noStore(c);
		return c.json(body);
	})

	/**
	 * App-update announcement send. Admin only; the server reads the version from the floor row.
	 *
	 * The request names neither version nor copy. The body is one audit reason and the contract is
	 * `.strict()`, so a request carrying `version` or `message` is a 400 rather than silently ignored
	 * (the sender would believe they announced that version).
	 *
	 * Separate from setting the floor: the `PUT` above changes the server's decision (the app locks
	 * from that moment) while this `POST` announces it. Merged, every mistake adjusting the floor
	 * would leave an irreversible row in every member's inbox (the idempotency key is the version, so
	 * restoring the same version sends no correction).
	 *
	 * Idempotent: a rerun creates nothing and returns current state, and already-read notices are not
	 * reverted to unread (`onConflictDoNothing`).
	 */
	.post("/operations/app-versions/:platform/notice", async (c) => {
		const viewer = requireAdminViewer(await getViewer(c));

		const platform = AppPlatform.safeParse(c.req.param("platform"));
		if (!platform.success)
			throw badRequest("Unknown platform.", "unknown_platform");

		const parsed = AdminAppUpdateBroadcastRequest.safeParse(await readJson(c));
		if (!parsed.success) throw invalidInput(parsed.error);

		const body: AdminAppUpdateBroadcastResponse = await broadcastAppUpdate({
			platform: platform.data,
			operatorId: viewer.id,
			reason: parsed.data.reason,
		});
		noStore(c);
		return c.json(body);
	})

	/**
	 * Audit log. Read-only: the router has no `DELETE` or `PATCH`, which is what "append-only" means
	 * here, and the service has none either.
	 */
	.get("/audit", async (c) => {
		requireModeratorViewer(await getViewer(c));
		const sp = new URL(c.req.url).searchParams;
		const parsed = AuditLogQuery.safeParse({
			operatorId: sp.get("operatorId") ?? undefined,
			action: sp.get("action") ?? undefined,
			targetId: sp.get("targetId") ?? undefined,
			cursor: sp.get("cursor") ?? undefined,
			limit: readLimit(sp),
		});
		if (!parsed.success) throw invalidInput(parsed.error);

		const body: AuditLogPage = await listAuditLog({
			...parsed.data,
			limit: parsed.data.limit ?? ADMIN_PAGE_SIZE,
		});
		noStore(c);
		return c.json(body);
	});
