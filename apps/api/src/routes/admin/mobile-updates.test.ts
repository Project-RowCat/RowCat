import { randomUUID } from "node:crypto";
import {
	AdminMobileUpdateReleaseDto,
	type MobileUpdateChannel,
	type MobileUpdatePlatform,
} from "@rowcat/contracts";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { closeDb, db } from "../../db/client.ts";
import {
	admin_audit_log,
	member,
	mobile_update_job,
	mobile_update_release,
	mobile_update_release_event,
} from "../../db/schema.ts";
import { env } from "../../env.ts";
import {
	__setMobileUpdateCiForTest,
	type MobileUpdateCiDispatchInput,
	type MobileUpdateCiRun,
} from "../../services/mobile-updates/ci-trigger.ts";
import {
	registerRelease,
	transitionRelease,
} from "../../services/mobile-updates/index.ts";
import { reconcileMobileUpdateJobs } from "../../services/mobile-updates/jobs.ts";
import { validateReleaseBundle } from "../../services/mobile-updates/registration.ts";
import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { api, jsonOf } from "../../test/http.ts";
import {
	type BundleOptions,
	certificatesFor,
	testBundle,
} from "../../test/mobile-updates.ts";
import { __setMobileUpdateReportVerifierForTest } from "../mobile-update-jobs.ts";

/**
 * Mobile OTA in the operations console, run against the real Hono app and real Postgres.
 *
 * 1. Authorization: guest 401, ordinary member 403, staff read-only, admin transitions and
 *    requests. The route's gate decides this, not the screen's buttons.
 * 2. The transition table is intact: percentage never drops, pause requires a reason, resume
 *    keeps the paused percentage. The operator id comes only from the session, and history and
 *    audit each get one row in the same transaction.
 * 3. The browser cannot upload code: the publish request has no slot for runtime, API origin or
 *    manifest, and a request creates a job, never a release. If CI cannot be started, it says so.
 * 4. CI reports are bound and verified: reports from another environment or run are rejected,
 *    result ids are re-checked against the registration table, and a start report for a cancelled
 *    job gets `proceed: false`.
 */

const EMAIL_PREFIX = "admin-ota-test-";
const ready = await connectTestDatabase();
const runtime = `rowcat-native-${700000 + Math.floor(Math.random() * 99999)}`;
const certificates = certificatesFor(
	"rowcat-production-1",
	"rowcat-preview-1",
	"rowcat-testflight-1",
);
const createdReleases: string[] = [];

let clock = Date.now() - 60 * 60 * 1000;
const nextTime = () => {
	clock += 1000;
	return new Date(clock);
};

async function register(
	options: BundleOptions = {},
	rolloutPercentage: number | null = 10,
): Promise<string> {
	const bundle = testBundle({
		runtimeVersion: runtime,
		apiOrigin: env.API_ORIGIN,
		createdAt: nextTime(),
		channel: "production",
		platform: "ios",
		...options,
	});
	const validation = validateReleaseBundle(bundle, {
		deploymentApiOrigin: env.API_ORIGIN,
		certificates,
		now: new Date(),
	});
	if (!validation.ok) throw new Error(validation.problems.join("\n"));
	const result = await registerRelease(validation.release, {
		rolloutPercentage,
		actor: "ci:test",
		reason: "",
		allowDuplicateContent: true,
	});
	createdReleases.push(result.id);
	return result.id;
}

/* ── fake CI ── */

const dispatched: MobileUpdateCiDispatchInput[] = [];
let dispatchFails = false;
const runs = new Map<string, MobileUpdateCiRun>();
let runCounter = 1000;

function installCi(
	channels: MobileUpdateChannel[] = ["production", "preview"],
) {
	__setMobileUpdateCiForTest({
		repository: "rowcat/test",
		channels,
		trigger: {
			async dispatch(input) {
				if (dispatchFails) throw new Error("boom");
				dispatched.push(input);
				const runId = String(++runCounter);
				runs.set(runId, { status: "queued", conclusion: null });
				return {
					runId,
					runUrl: `https://github.com/rowcat/test/actions/runs/${runId}`,
				};
			},
			async run(runId) {
				return runs.get(runId) ?? null;
			},
		},
	});
}

/** The token string is the claims (`env:run`); real signature verification is covered by `github-actions-oidc.test.ts`. */
__setMobileUpdateReportVerifierForTest(async (token) => {
	const [environment, runId] = token.split(":");
	return environment && runId ? { environment, runId } : null;
});

const report = (jobId: string, token: string | null, body: unknown) =>
	api(`/mobile/update-jobs/${jobId}/reports`, {
		body,
		origin: null,
		headers: token ? { Authorization: `Bearer ${token}` } : {},
	});

interface Account {
	cookie: string;
	memberId: string;
}

async function account(role: "user" | "staff" | "admin"): Promise<Account> {
	const created = await createTestMember(EMAIL_PREFIX);
	if (role !== "user")
		await db
			.update(member)
			.set({ role })
			.where(eq(member.id, created.memberId));
	return { cookie: created.cookie, memberId: created.memberId };
}

const get = (path: string, who: Account | null) =>
	api(`/admin${path}`, { cookie: who?.cookie ?? null });
const post = (path: string, who: Account | null, body: unknown) =>
	api(`/admin${path}`, { cookie: who?.cookie ?? null, body });

let user: Account;
let staff: Account;
let admin: Account;

beforeAll(async () => {
	if (!ready) return;
	/** A live job left by an interrupted earlier run would block the stream's unique index. */
	await db
		.delete(mobile_update_job)
		.where(like(mobile_update_job.reason, "test:%"));
	[user, staff, admin] = await Promise.all([
		account("user"),
		account("staff"),
		account("admin"),
	]);
});

afterEach(async () => {
	if (!ready) return;
	dispatchFails = false;
	installCi();
	/** Only one live job per stream is allowed, so no test may leave its job behind. */
	await db
		.update(mobile_update_job)
		.set({ status: "cancelled" })
		.where(
			and(
				like(mobile_update_job.reason, "test:%"),
				inArray(mobile_update_job.status, ["queued", "running"]),
			),
		);
});

afterAll(async () => {
	__setMobileUpdateCiForTest(undefined);
	__setMobileUpdateReportVerifierForTest(null);
	if (ready) {
		await db
			.delete(mobile_update_job)
			.where(like(mobile_update_job.reason, "test:%"));
		if (createdReleases.length > 0) {
			await db
				.delete(mobile_update_release_event)
				.where(
					inArray(mobile_update_release_event.release_id, createdReleases),
				);
			await db
				.delete(mobile_update_release)
				.where(inArray(mobile_update_release.id, createdReleases));
		}
		await deleteTestUsers(EMAIL_PREFIX);
	}
	await closeDb();
});

installCi();

/* ══════════════════════════════════════════════════════════════════════════ */

describe.skipIf(!ready)("authorization", () => {
	test("guest 401 · regular member 403 · staff reads", async () => {
		expect((await get("/mobile-updates", null)).status).toBe(401);
		expect((await get("/mobile-updates", user)).status).toBe(403);
		expect((await get("/mobile-updates", staff)).status).toBe(200);
		expect((await get("/mobile-update-jobs", staff)).status).toBe(200);
	});

	test("staff can neither raise the rollout nor request a publish", async () => {
		const before = dispatched.length;
		const id = await register();
		const rollout = await post(`/mobile-updates/${id}/rollout`, staff, {
			percentage: 25,
		});
		expect(rollout.status).toBe(403);
		expect((await jsonOf<{ code: string }>(rollout)).code).toBe(
			"mobile_update_capability_required",
		);
		const publish = await post("/mobile-update-jobs", staff, {
			channel: "production",
			platform: "ios",
			source: { kind: "branch", branch: "main" },
			initialRollout: null,
			note: { kind: "none" },
			reason: "test:staff",
		});
		expect(publish.status).toBe(403);
		expect(dispatched).toHaveLength(before);
	});
});

describe.skipIf(!ready)("reading", () => {
	test("the list respects filters and carries no bodies or signatures", async () => {
		const ios = await register({ platform: "ios" });
		await register({ platform: "android" });
		const response = await get(
			`/mobile-updates?platform=ios&runtimeVersion=${runtime}`,
			staff,
		);
		const page = await jsonOf<{ items: Record<string, unknown>[] }>(response);
		expect(page.items.length).toBeGreaterThan(0);
		for (const item of page.items) {
			expect(item.platform).toBe("ios");
			/** Counts the whole key set so this assertion breaks first if the projection widens. */
			expect(Object.keys(item).sort()).toEqual(
				Object.keys(AdminMobileUpdateReleaseDto.shape).sort(),
			);
		}
		expect(page.items.map((item) => item.id)).toContain(ios);
	});

	test("the list pages — it never gives the same row twice", async () => {
		await register({ channel: "preview" }, 100);
		await register({ channel: "preview" }, 100);
		await register({ channel: "preview" }, 100);
		const first = await jsonOf<{ items: { id: string }[]; nextCursor: string }>(
			await get(
				`/mobile-updates?channel=preview&runtimeVersion=${runtime}&limit=2`,
				staff,
			),
		);
		expect(first.items).toHaveLength(2);
		expect(first.nextCursor).toBeTruthy();
		const second = await jsonOf<{ items: { id: string }[] }>(
			await get(
				`/mobile-updates?channel=preview&runtimeVersion=${runtime}&limit=2&cursor=${first.nextCursor}`,
				staff,
			),
		);
		const ids = [...first.items, ...second.items].map((item) => item.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test("the detail gives history oldest first, and assets only as count and size", async () => {
		const id = await register();
		const detail = await jsonOf<{
			events: { action: string }[];
			assets: Record<string, unknown>;
			release: Record<string, unknown>;
		}>(await get(`/mobile-updates/${id}`, staff));
		expect(detail.events.map((event) => event.action)).toEqual(["register"]);
		expect(Object.keys(detail.assets).sort()).toEqual(["bytes", "count"]);
		expect(detail.release).not.toHaveProperty("body");
		expect(detail.release).not.toHaveProperty("signatures");
	});
});

describe.skipIf(!ready)("direct transitions", () => {
	test("raising works, lowering is 409", async () => {
		const id = await register({}, 10);
		const up = await post(`/mobile-updates/${id}/rollout`, admin, {
			percentage: 50,
			reason: "canary looks fine",
		});
		expect(up.status).toBe(200);
		expect(
			(await jsonOf<{ release: { rolloutPercentage: number } }>(up)).release
				.rolloutPercentage,
		).toBe(50);
		const down = await post(`/mobile-updates/${id}/rollout`, admin, {
			percentage: 25,
		});
		expect(down.status).toBe(409);
		expect((await jsonOf<{ code: string }>(down)).code).toBe(
			"mobile_update_rollout_decrease",
		);
	});

	test("raising the rollout on a draft activates it as is", async () => {
		const id = await register({}, null);
		const response = await post(`/mobile-updates/${id}/rollout`, admin, {
			percentage: 5,
		});
		const body = await jsonOf<{
			release: { status: string; rolloutPercentage: number };
		}>(response);
		expect(body.release).toMatchObject({
			status: "active",
			rolloutPercentage: 5,
		});
	});

	test("pausing needs a reason, and resuming keeps the paused rollout", async () => {
		const id = await register({}, 25);
		expect(
			(await post(`/mobile-updates/${id}/pause`, admin, { reason: "" })).status,
		).toBe(400);
		const paused = await post(`/mobile-updates/${id}/pause`, admin, {
			reason: "the sign-in screen goes blank",
		});
		expect(paused.status).toBe(200);
		/** A paused release keeps its percentage; resume reopens it. */
		expect(
			(await post(`/mobile-updates/${id}/rollout`, admin, { percentage: 50 }))
				.status,
		).toBe(409);
		const resumed = await jsonOf<{
			release: { status: string; rolloutPercentage: number };
		}>(await post(`/mobile-updates/${id}/resume`, admin, {}));
		expect(resumed.release).toMatchObject({
			status: "active",
			rolloutPercentage: 25,
		});
	});

	test("the operator comes from the session, and history and audit each get one row — a repeat request for the same state leaves nothing", async () => {
		const id = await register({}, 10);
		const first = await jsonOf<{ changed: boolean }>(
			await post(`/mobile-updates/${id}/pause`, admin, {
				reason: "investigating",
				/** An operator in the body is rejected by the contract (`.strict()`). */
			}),
		);
		expect(first.changed).toBe(true);
		const again = await jsonOf<{ changed: boolean }>(
			await post(`/mobile-updates/${id}/pause`, admin, {
				reason: "investigating",
			}),
		);
		expect(again.changed).toBe(false);

		const events = await db
			.select()
			.from(mobile_update_release_event)
			.where(
				and(
					eq(mobile_update_release_event.release_id, id),
					eq(mobile_update_release_event.action, "pause"),
				),
			);
		expect(events).toHaveLength(1);
		expect(events[0]?.operator_id).toBe(admin.memberId);
		expect(events[0]?.reason).toBe("investigating");

		const audits = await db
			.select()
			.from(admin_audit_log)
			.where(
				and(
					eq(admin_audit_log.target_id, id),
					eq(admin_audit_log.action, "mobile_updates.release.pause"),
				),
			);
		expect(audits).toHaveLength(1);
		expect(audits[0]?.operator).toBe(admin.memberId);
		expect(audits[0]?.metadata).toMatchObject({ eventId: events[0]?.id });

		const forged = await post(`/mobile-updates/${id}/resume`, admin, {
			reason: "",
			operatorId: user.memberId,
		});
		expect(forged.status).toBe(400);
	});

	test("CI and CLI transitions work as is with no member", async () => {
		const id = await register({}, 10);
		await transitionRelease(id, {
			action: "rollout",
			rolloutPercentage: 20,
			actor: "ci:github-actions run 1",
			reason: "",
		});
		const detail = await jsonOf<{
			events: { action: string; operator: unknown; actor: string }[];
		}>(await get(`/mobile-updates/${id}`, staff));
		expect(detail.events.at(-1)).toMatchObject({
			action: "rollout",
			operator: null,
			actor: "ci:github-actions run 1",
		});
	});
});

describe.skipIf(!ready)("publish request", () => {
	const publishBody = (
		overrides: Record<string, unknown> = {},
		platform: MobileUpdatePlatform = "android",
	) => ({
		channel: "production",
		platform,
		source: { kind: "branch", branch: "main" },
		initialRollout: null,
		note: { kind: "note", id: "2026-10-03" },
		reason: "test:publish",
		...overrides,
	});

	test("the browser has no slot to choose the runtime, API origin or manifest", async () => {
		const before = dispatched.length;
		for (const extra of [
			{ runtimeVersion: "rowcat-native-9" },
			{ apiOrigin: "https://evil.example" },
			{ manifest: "{}" },
			{ signature: "x" },
		]) {
			const response = await post(
				"/mobile-update-jobs",
				admin,
				publishBody(extra),
			);
			expect(response.status).toBe(400);
		}
		expect(dispatched).toHaveLength(before);
	});

	test("production publishes are draft only — giving an initial rollout is a 400", async () => {
		expect(
			(
				await post(
					"/mobile-update-jobs",
					admin,
					publishBody({ initialRollout: 10 }),
				)
			).status,
		).toBe(400);
	});

	test("the source is only an allowed branch or a 40-character commit", async () => {
		for (const source of [
			{ kind: "branch", branch: "feature/x" },
			{ kind: "commit", sha: "abc123" },
			{ kind: "commit", sha: "main; rm -rf /" },
			{ kind: "path", path: "/tmp" },
		])
			expect(
				(await post("/mobile-update-jobs", admin, publishBody({ source })))
					.status,
			).toBe(400);
	});

	test("the request creates a job and starts CI — it does not create a release", async () => {
		const before = await db
			.select({ id: mobile_update_release.id })
			.from(mobile_update_release);
		const response = await post("/mobile-update-jobs", admin, publishBody());
		expect(response.status).toBe(202);
		const job = await jsonOf<{
			id: string;
			status: string;
			externalRunUrl: string;
			requestedBy: { id: string };
		}>(response);
		expect(job.status).toBe("queued");
		expect(job.requestedBy.id).toBe(admin.memberId);
		expect(job.externalRunUrl).toMatch(/^https:\/\/github\.com\//);
		/** Workflow inputs are closed values only; the operator's reason never reaches CI. */
		expect(dispatched.at(-1)).toEqual({
			jobId: job.id,
			kind: "publish",
			channel: "production",
			platform: "android",
			source: "main",
			rollout: "draft",
			note: "2026-10-03",
			targetReleaseId: "",
			toEmbedded: false,
		});
		const after = await db
			.select({ id: mobile_update_release.id })
			.from(mobile_update_release);
		expect(after.length).toBe(before.length);
		/** The response carries no CI token. */
		expect(JSON.stringify(job)).not.toMatch(/token|github_pat|Bearer/i);
	});

	test("409 when a live job exists on the same stream", async () => {
		expect(
			(await post("/mobile-update-jobs", admin, publishBody({}, "ios"))).status,
		).toBe(202);
		const second = await post(
			"/mobile-update-jobs",
			admin,
			publishBody({}, "ios"),
		);
		expect(second.status).toBe(409);
		expect((await jsonOf<{ code: string }>(second)).code).toBe(
			"mobile_update_job_in_progress",
		);
	});

	test("502 when CI can't be started, and the job remains as failed", async () => {
		dispatchFails = true;
		const response = await post("/mobile-update-jobs", admin, publishBody());
		expect(response.status).toBe(502);
		const [job] = await db
			.select()
			.from(mobile_update_job)
			.where(eq(mobile_update_job.reason, "test:publish"))
			.orderBy(mobile_update_job.created_at)
			.then((rows) => rows.slice(-1));
		expect(job).toMatchObject({
			status: "failed",
			failure_code: "ci_trigger_unavailable",
		});
	});

	test("503 for a deployment without CI · 400 when it isn't this deployment's channel", async () => {
		__setMobileUpdateCiForTest(null);
		expect(
			(await post("/mobile-update-jobs", admin, publishBody())).status,
		).toBe(503);
		installCi(["preview"]);
		const response = await post("/mobile-update-jobs", admin, publishBody());
		expect(response.status).toBe(400);
		expect((await jsonOf<{ code: string }>(response)).code).toBe(
			"mobile_update_channel_not_served",
		);
	});
});

describe.skipIf(!ready)("CI reports", () => {
	async function requestJob(platform: MobileUpdatePlatform = "android") {
		const response = await post("/mobile-update-jobs", admin, {
			channel: "preview",
			platform,
			source: { kind: "branch", branch: "main" },
			initialRollout: 100,
			note: { kind: "none" },
			reason: "test:report",
		});
		expect(response.status).toBe(202);
		const job = await jsonOf<{ id: string; externalRunUrl: string }>(response);
		const runId = job.externalRunUrl.split("/").at(-1) as string;
		return { id: job.id, runId };
	}

	const commit = "c".repeat(40);

	test("401 without a token · 403 for another channel's environment · 409 for another run", async () => {
		const job = await requestJob();
		const started = {
			event: "started",
			sourceCommit: commit,
			runtimeVersion: runtime,
		};
		expect((await report(job.id, null, started)).status).toBe(401);
		expect(
			(await report(job.id, `ota-production:${job.runId}`, started)).status,
		).toBe(403);
		expect((await report(job.id, "ota-preview:999999", started)).status).toBe(
			409,
		);
	});

	test("started → result: only releases confirmed in the registration table become results", async () => {
		const job = await requestJob();
		const token = `ota-preview:${job.runId}`;
		const started = await jsonOf<{ proceed: boolean; status: string }>(
			await report(job.id, token, {
				event: "started",
				sourceCommit: commit,
				runtimeVersion: runtime,
			}),
		);
		expect(started).toMatchObject({ proceed: true, status: "running" });

		/** A release that predates this job is not its result. */
		const unrelated = await register(
			{ channel: "preview", platform: "ios" },
			100,
		);
		const wrong = await jsonOf<{ status: string }>(
			await report(job.id, token, {
				event: "succeeded",
				releaseIds: [unrelated],
			}),
		);
		expect(wrong.status).toBe("failed");
		const [row] = await db
			.select()
			.from(mobile_update_job)
			.where(eq(mobile_update_job.id, job.id));
		expect(row?.failure_code).toBe("result_unverified");
	});

	test("a correct result is succeeded, and retrying the same report changes nothing", async () => {
		const job = await requestJob("ios");
		const token = `ota-preview:${job.runId}`;
		await report(job.id, token, {
			event: "started",
			sourceCommit: commit,
			runtimeVersion: runtime,
		});
		const bundle = testBundle({
			runtimeVersion: runtime,
			apiOrigin: env.API_ORIGIN,
			createdAt: nextTime(),
			channel: "preview",
			platform: "ios",
		});
		bundle.release.sourceCommit = commit;
		const validation = validateReleaseBundle(bundle, {
			deploymentApiOrigin: env.API_ORIGIN,
			certificates,
			now: new Date(),
		});
		if (!validation.ok) throw new Error(validation.problems.join("\n"));
		const registered = await registerRelease(validation.release, {
			rolloutPercentage: 100,
			actor: "ci:test",
			reason: "",
			allowDuplicateContent: true,
		});
		createdReleases.push(registered.id);

		const body = { event: "succeeded", releaseIds: [registered.id] };
		expect(
			(await jsonOf<{ status: string }>(await report(job.id, token, body)))
				.status,
		).toBe("succeeded");
		expect(
			(await jsonOf<{ status: string }>(await report(job.id, token, body)))
				.status,
		).toBe("succeeded");

		const detail = await jsonOf<{ jobs: { id: string }[] }>(
			await get(`/mobile-updates/${registered.id}`, staff),
		);
		expect(detail.jobs.map((related) => related.id)).toContain(job.id);
	});

	test("a cancelled job's start report is proceed: false — CI stops before signing", async () => {
		const job = await requestJob();
		const cancelled = await post(
			`/mobile-update-jobs/${job.id}/cancel`,
			admin,
			{
				reason: "pressed by mistake",
			},
		);
		expect(cancelled.status).toBe(200);
		const response = await jsonOf<{ proceed: boolean; status: string }>(
			await report(job.id, `ota-preview:${job.runId}`, {
				event: "started",
				sourceCommit: commit,
				runtimeVersion: runtime,
			}),
		);
		expect(response).toEqual({
			jobId: job.id,
			status: "cancelled",
			proceed: false,
		});
	});

	test("a failure report's stage becomes the close reason", async () => {
		const job = await requestJob();
		const token = `ota-preview:${job.runId}`;
		await report(job.id, token, {
			event: "started",
			sourceCommit: commit,
			runtimeVersion: runtime,
		});
		await report(job.id, token, { event: "failed", stage: "runtime" });
		const detail = await jsonOf<{ failure: { code: string; stage: string } }>(
			await get(`/mobile-update-jobs/${job.id}`, staff),
		);
		expect(detail.failure).toEqual({
			code: "runtime_fingerprint_mismatch",
			stage: "runtime",
		});
		/** A report has no slot for sentences beyond the step name. */
		expect(
			(
				await report(job.id, token, {
					event: "failed",
					stage: "runtime",
					message: "AWS_SECRET=…",
				})
			).status,
		).toBe(400);
	});
});

describe.skipIf(!ready)("rollback request", () => {
	test("409 when a newer active release exists, and no job is created", async () => {
		const older = await register({ platform: "android" }, 100);
		await register({ platform: "android" }, 100);
		const plan = await jsonOf<{ recovery: string }>(
			await get(`/mobile-updates/${older}/rollback-plan`, staff),
		);
		expect(plan.recovery).toBe("blocked");
		const response = await post(`/mobile-updates/${older}/rollback`, admin, {
			reason: "test:rollback",
		});
		expect(response.status).toBe(409);
		expect((await jsonOf<{ code: string }>(response)).code).toBe(
			"mobile_update_rollback_superseded",
		);
	});

	test("the request only starts CI — it does not change release state first", async () => {
		const runtimeOnly = `rowcat-native-${600000 + Math.floor(Math.random() * 99999)}`;
		const good = await register(
			{ platform: "ios", runtimeVersion: runtimeOnly },
			100,
		);
		const bad = await register(
			{ platform: "ios", runtimeVersion: runtimeOnly },
			25,
		);
		const plan = await jsonOf<{
			recovery: string;
			previousGood: { id: string };
		}>(await get(`/mobile-updates/${bad}/rollback-plan`, staff));
		expect(plan).toMatchObject({
			recovery: "republish",
			previousGood: { id: good },
		});

		const response = await post(`/mobile-updates/${bad}/rollback`, admin, {
			reason: "test:rollback",
		});
		expect(response.status).toBe(202);
		const job = await jsonOf<{ id: string; externalRunUrl: string }>(response);
		expect(dispatched.at(-1)).toMatchObject({
			kind: "rollback",
			targetReleaseId: bad,
			source: "",
			toEmbedded: false,
		});
		const [row] = await db
			.select({ status: mobile_update_release.status })
			.from(mobile_update_release)
			.where(eq(mobile_update_release.id, bad));
		expect(row?.status).toBe("active");

		/** Imitates what CI does through the publish tool: after rollback, register a republish at 100%. */
		const token = `ota-production:${job.externalRunUrl.split("/").at(-1)}`;
		await report(job.id, token, {
			event: "started",
			sourceCommit: "d".repeat(40),
			runtimeVersion: runtimeOnly,
		});
		await transitionRelease(bad, {
			action: "rollback",
			actor: "ci:test",
			reason: "rollback",
		});
		const recovery = await register(
			{ platform: "ios", runtimeVersion: runtimeOnly, republishOf: good },
			100,
		);
		const result = await jsonOf<{ status: string }>(
			await report(job.id, token, {
				event: "succeeded",
				releaseIds: [recovery],
			}),
		);
		expect(result.status).toBe("succeeded");
	});

	test("a rollback whose CI couldn't start says nothing was changed", async () => {
		const id = await register(
			{
				platform: "android",
				runtimeVersion: `rowcat-native-${500000 + Math.floor(Math.random() * 99999)}`,
			},
			10,
		);
		dispatchFails = true;
		const response = await post(`/mobile-updates/${id}/rollback`, admin, {
			reason: "test:rollback",
		});
		expect(response.status).toBe(502);
		const [row] = await db
			.select({ status: mobile_update_release.status })
			.from(mobile_update_release)
			.where(eq(mobile_update_release.id, id));
		expect(row?.status).toBe("active");
	});
});

describe.skipIf(!ready)("reconciliation", () => {
	test("ends jobs that never reported a start and runs that ended without a report — it does not invent results", async () => {
		const first = await jsonOf<{ id: string; externalRunUrl: string }>(
			await post("/mobile-update-jobs", admin, {
				channel: "preview",
				platform: "android",
				source: { kind: "branch", branch: "main" },
				initialRollout: null,
				note: { kind: "none" },
				reason: "test:reconcile",
			}),
		);
		const runId = first.externalRunUrl.split("/").at(-1) as string;
		runs.set(runId, { status: "in_progress", conclusion: null });
		const ciNow = {
			repository: "rowcat/test",
			channels: ["preview" as const],
			trigger: {
				dispatch: async () => ({ runId: null, runUrl: null }),
				run: async (id: string) => runs.get(id) ?? null,
			},
		};
		await reconcileMobileUpdateJobs(new Date(), ciNow);
		const [stillQueued] = await db
			.select()
			.from(mobile_update_job)
			.where(eq(mobile_update_job.id, first.id));
		expect(stillQueued?.status).toBe("queued");

		runs.set(runId, { status: "completed", conclusion: "success" });
		await reconcileMobileUpdateJobs(new Date(), ciNow);
		const [finished] = await db
			.select()
			.from(mobile_update_job)
			.where(eq(mobile_update_job.id, first.id));
		expect(finished).toMatchObject({
			status: "failed",
			failure_code: "ci_result_missing",
		});
		expect(finished?.result_release_ids).toEqual([]);
	});

	test("a job with no run id is treated as never started only once its deadline passes", async () => {
		const id = randomUUID().replaceAll("-", "");
		await db.insert(mobile_update_job).values({
			id,
			kind: "publish",
			channel: "testflight",
			platform: "ios",
			status: "queued",
			reason: "test:reconcile",
			created_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
		});
		await reconcileMobileUpdateJobs(new Date(), null);
		const [row] = await db
			.select()
			.from(mobile_update_job)
			.where(eq(mobile_update_job.id, id));
		expect(row).toMatchObject({
			status: "failed",
			failure_code: "ci_never_started",
		});
	});
});
