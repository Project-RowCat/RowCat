import {
	ADMIN_MOBILE_UPDATE_JOB_PAGE_SIZE,
	ADMIN_MOBILE_UPDATE_PAGE_SIZE,
	AdminMobileUpdateDetailDto,
	AdminMobileUpdateJobCancelRequest,
	AdminMobileUpdateJobDto,
	AdminMobileUpdateJobPage,
	type AdminMobileUpdateJobQuery,
	AdminMobileUpdateJobsConfigDto,
	AdminMobileUpdatePage,
	AdminMobileUpdatePauseRequest,
	AdminMobileUpdatePublishRequest,
	type AdminMobileUpdateQuery,
	AdminMobileUpdateResumeRequest,
	AdminMobileUpdateRollbackPlanDto,
	AdminMobileUpdateRollbackRequest,
	AdminMobileUpdateRolloutRequest,
	AdminMobileUpdateTransitionResponse,
	toAdminMobileUpdateSearchParams,
} from "@rowcat/contracts";
import type { RequestOptions, RowCatTransport } from "./client.ts";
import { invalidResponse } from "./errors.ts";

/**
 * Operator-console mobile OTA endpoints. This resource has no upload. Publishing sends intent
 * (channel, platform, source, initial rollout percentage, notes, reason), and CI builds the code
 * from the repository. The body is built with the same schema the server reads (`.strict()`). A key
 * a caller passes by mistake (runtimeVersion, apiOrigin, manifest) throws here first, and the
 * server would return 400 anyway. CI's reports endpoint is not here. It is called only with CI's
 * OIDC token, so a browser never calls it.
 */
export interface AdminMobileUpdatesApi {
	releases(
		input?: Partial<AdminMobileUpdateQuery>,
		options?: RequestOptions,
	): Promise<AdminMobileUpdatePage>;
	release(
		id: string,
		options?: RequestOptions,
	): Promise<AdminMobileUpdateDetailDto>;
	rollbackPlan(
		id: string,
		options?: RequestOptions,
	): Promise<AdminMobileUpdateRollbackPlanDto>;
	rollout(
		id: string,
		input: AdminMobileUpdateRolloutRequest,
		options?: RequestOptions,
	): Promise<AdminMobileUpdateTransitionResponse>;
	pause(
		id: string,
		input: AdminMobileUpdatePauseRequest,
		options?: RequestOptions,
	): Promise<AdminMobileUpdateTransitionResponse>;
	resume(
		id: string,
		input: AdminMobileUpdateResumeRequest,
		options?: RequestOptions,
	): Promise<AdminMobileUpdateTransitionResponse>;
	requestRollback(
		id: string,
		input: AdminMobileUpdateRollbackRequest,
		options?: RequestOptions,
	): Promise<AdminMobileUpdateJobDto>;

	jobs(
		input?: Partial<AdminMobileUpdateJobQuery>,
		options?: RequestOptions,
	): Promise<AdminMobileUpdateJobPage>;
	job(id: string, options?: RequestOptions): Promise<AdminMobileUpdateJobDto>;
	jobsConfig(options?: RequestOptions): Promise<AdminMobileUpdateJobsConfigDto>;
	requestPublish(
		input: AdminMobileUpdatePublishRequest,
		options?: RequestOptions,
	): Promise<AdminMobileUpdateJobDto>;
	cancelJob(
		id: string,
		input: AdminMobileUpdateJobCancelRequest,
		options?: RequestOptions,
	): Promise<AdminMobileUpdateJobDto>;
}

const releaseQuery = (
	input: Partial<AdminMobileUpdateQuery>,
): AdminMobileUpdateQuery => ({
	channel: input.channel ?? "",
	platform: input.platform ?? "",
	runtimeVersion: input.runtimeVersion ?? "",
	status: input.status ?? "",
	cursor: input.cursor ?? "",
	limit: input.limit ?? ADMIN_MOBILE_UPDATE_PAGE_SIZE,
});

const releasePath = (id: string, suffix = "") =>
	`/admin/mobile-updates/${encodeURIComponent(id)}${suffix}`;

export function createAdminMobileUpdatesApi({
	requestJson,
}: RowCatTransport): AdminMobileUpdatesApi {
	const transition = async (
		id: string,
		action: "rollout" | "pause" | "resume",
		body: unknown,
		options?: RequestOptions,
	) => {
		const json = await requestJson({
			method: "POST",
			path: releasePath(id, `/${action}`),
			body,
			signal: options?.signal,
		});
		const parsed = AdminMobileUpdateTransitionResponse.safeParse(json);
		if (!parsed.success)
			throw invalidResponse(`POST /admin/mobile-updates/:id/${action}`);
		return parsed.data;
	};

	return {
		async releases(input = {}, options) {
			const json = await requestJson({
				method: "GET",
				path: "/admin/mobile-updates",
				search: toAdminMobileUpdateSearchParams(releaseQuery(input)),
				signal: options?.signal,
			});
			const parsed = AdminMobileUpdatePage.safeParse(json);
			if (!parsed.success) throw invalidResponse("/admin/mobile-updates");
			return parsed.data;
		},

		async release(id, options) {
			const json = await requestJson({
				method: "GET",
				path: releasePath(id),
				signal: options?.signal,
			});
			const parsed = AdminMobileUpdateDetailDto.safeParse(json);
			if (!parsed.success) throw invalidResponse("/admin/mobile-updates/:id");
			return parsed.data;
		},

		async rollbackPlan(id, options) {
			const json = await requestJson({
				method: "GET",
				path: releasePath(id, "/rollback-plan"),
				signal: options?.signal,
			});
			const parsed = AdminMobileUpdateRollbackPlanDto.safeParse(json);
			if (!parsed.success)
				throw invalidResponse("/admin/mobile-updates/:id/rollback-plan");
			return parsed.data;
		},

		rollout: (id, input, options) =>
			transition(
				id,
				"rollout",
				AdminMobileUpdateRolloutRequest.parse(input),
				options,
			),
		pause: (id, input, options) =>
			transition(
				id,
				"pause",
				AdminMobileUpdatePauseRequest.parse(input),
				options,
			),
		resume: (id, input, options) =>
			transition(
				id,
				"resume",
				AdminMobileUpdateResumeRequest.parse(input),
				options,
			),

		async requestRollback(id, input, options) {
			const json = await requestJson({
				method: "POST",
				path: releasePath(id, "/rollback"),
				body: AdminMobileUpdateRollbackRequest.parse(input),
				signal: options?.signal,
			});
			const parsed = AdminMobileUpdateJobDto.safeParse(json);
			if (!parsed.success)
				throw invalidResponse("POST /admin/mobile-updates/:id/rollback");
			return parsed.data;
		},

		async jobs(input = {}, options) {
			const search = new URLSearchParams();
			if (input.cursor) search.set("cursor", input.cursor);
			const limit = input.limit ?? ADMIN_MOBILE_UPDATE_JOB_PAGE_SIZE;
			if (limit !== ADMIN_MOBILE_UPDATE_JOB_PAGE_SIZE)
				search.set("limit", String(limit));
			const json = await requestJson({
				method: "GET",
				path: "/admin/mobile-update-jobs",
				search,
				signal: options?.signal,
			});
			const parsed = AdminMobileUpdateJobPage.safeParse(json);
			if (!parsed.success) throw invalidResponse("/admin/mobile-update-jobs");
			return parsed.data;
		},

		async job(id, options) {
			const json = await requestJson({
				method: "GET",
				path: `/admin/mobile-update-jobs/${encodeURIComponent(id)}`,
				signal: options?.signal,
			});
			const parsed = AdminMobileUpdateJobDto.safeParse(json);
			if (!parsed.success)
				throw invalidResponse("/admin/mobile-update-jobs/:id");
			return parsed.data;
		},

		async jobsConfig(options) {
			const json = await requestJson({
				method: "GET",
				path: "/admin/mobile-update-jobs/config",
				signal: options?.signal,
			});
			const parsed = AdminMobileUpdateJobsConfigDto.safeParse(json);
			if (!parsed.success)
				throw invalidResponse("/admin/mobile-update-jobs/config");
			return parsed.data;
		},

		async requestPublish(input, options) {
			const json = await requestJson({
				method: "POST",
				path: "/admin/mobile-update-jobs",
				body: AdminMobileUpdatePublishRequest.parse(input),
				signal: options?.signal,
			});
			const parsed = AdminMobileUpdateJobDto.safeParse(json);
			if (!parsed.success)
				throw invalidResponse("POST /admin/mobile-update-jobs");
			return parsed.data;
		},

		async cancelJob(id, input, options) {
			const json = await requestJson({
				method: "POST",
				path: `/admin/mobile-update-jobs/${encodeURIComponent(id)}/cancel`,
				body: AdminMobileUpdateJobCancelRequest.parse(input),
				signal: options?.signal,
			});
			const parsed = AdminMobileUpdateJobDto.safeParse(json);
			if (!parsed.success)
				throw invalidResponse("POST /admin/mobile-update-jobs/:id/cancel");
			return parsed.data;
		},
	};
}
