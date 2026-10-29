import {
	ADMIN_PAGE_SIZE,
	AdminAdultVerificationRequest,
	AdminAdultVerificationResponse,
	type AdminAppUpdateBroadcastRequest,
	AdminAppUpdateBroadcastResponse,
	AdminManagedGenerationRequest,
	AdminManagedGenerationResponse,
	AdminMemberDetailDto,
	AdminMemberPage,
	type AdminMemberQuery,
	AdminOverviewDto,
	AdminStoryDeleteRequest,
	AdminStoryDeleteResponse,
	AdminStoryDetailDto,
	AdminStoryPage,
	type AdminStoryQuery,
	type AppPlatform,
	AppUpdateBroadcastStatusesDto,
	AppVersionFloorDto,
	type AppVersionFloorSetRequest,
	AppVersionFloorsDto,
	AuditLogPage,
	type AuditLogQuery,
	FeatureFlagDto,
	type FeatureFlagKey,
	type FeatureFlagSetRequest,
	FeatureFlagsDto,
	toAdminMemberSearchParams,
	toAdminStorySearchParams,
	toAuditLogSearchParams,
} from "@rowcat/contracts";
import {
	type AdminMobileUpdatesApi,
	createAdminMobileUpdatesApi,
} from "./admin-mobile-updates.ts";
import type { RequestOptions, RowCatTransport } from "./client.ts";
import { invalidResponse } from "./errors.ts";

/**
 * The operator-console API, `/v2/admin/*`.
 * - Kept separate from moderation. The difference is the consumer, not the path. The moderation
 *   resource contains report intake, which anyone can call, and appeals, which a sanctioned member
 *   calls. Everything here is an operator-only query. Putting both in one resource would blur which
 *   function is called by whom.
 * - Authorization is not in this file. The package does not stop a regular member from calling
 *   these functions. The server returns 403, and the UI does not draw the link. If the client
 *   imitated authorization, the rules would exist in two copies, and the looser copy would become
 *   the effective policy, as the moderation resource header already notes.
 * - Existing moderation functions were not moved here. The operator console calls
 *   `client.moderation.queue()` directly, so there is no second moderation client.
 */
export interface AdminApi {
	overview(options?: RequestOptions): Promise<AdminOverviewDto>;

	/** Mobile OTA operations live in their own file, admin-mobile-updates.ts. */
	mobileUpdates: AdminMobileUpdatesApi;

	members(
		input?: Partial<AdminMemberQuery>,
		options?: RequestOptions,
	): Promise<AdminMemberPage>;
	member(
		memberId: string,
		options?: RequestOptions,
	): Promise<AdminMemberDetailDto>;
	/**
	 * Sets the adult-verification status by hand. It has no idempotency key. Grants and corrections
	 * are deltas, so a retry applies them twice. This request sets a target state, so sending it
	 * several times gives the same result. An idempotency argument would guard against a risk that
	 * does not exist and would force callers to produce a value from somewhere.
	 */
	setAdultVerification(
		memberId: string,
		input: AdminAdultVerificationRequest,
		options?: RequestOptions,
	): Promise<AdminAdultVerificationResponse>;
	/**
	 * Sets the managed-generation allowlist. It is a target state, so it has no idempotency key. Admin
	 * only; the server makes that decision.
	 */
	setManagedGeneration(
		memberId: string,
		input: AdminManagedGenerationRequest,
		options?: RequestOptions,
	): Promise<AdminManagedGenerationResponse>;

	stories(
		input?: Partial<AdminStoryQuery>,
		options?: RequestOptions,
	): Promise<AdminStoryPage>;
	story(
		storyId: string,
		options?: RequestOptions,
	): Promise<AdminStoryDetailDto>;
	/**
	 * Deletes a published work. Admin only, and irreversible. The result is `deleted` (the row was
	 * removed) or `detached` (the row stays for the owner who holds it, and the work is removed from
	 * the creator and the catalog). The server decides which. The body is the reason only.
	 */
	deleteStory(
		storyId: string,
		input: AdminStoryDeleteRequest,
		options?: RequestOptions,
	): Promise<AdminStoryDeleteResponse>;

	featureFlags(options?: RequestOptions): Promise<FeatureFlagsDto>;
	setFeatureFlag(
		key: FeatureFlagKey,
		input: FeatureFlagSetRequest,
		options?: RequestOptions,
	): Promise<FeatureFlagDto>;

	appVersionFloors(options?: RequestOptions): Promise<AppVersionFloorsDto>;
	setAppVersionFloor(
		platform: AppPlatform,
		input: AppVersionFloorSetRequest,
		options?: RequestOptions,
	): Promise<AppVersionFloorDto>;

	/**
	 * Status of the app-update broadcast for both platforms. Operators can read it. No version is
	 * passed in. The server reads the version to announce from the minimum-version row, and that value
	 * is the response's `minVersion`. A platform with no minimum returns `null` and cannot be
	 * broadcast.
	 */
	appUpdateBroadcastStatuses(
		options?: RequestOptions,
	): Promise<AppUpdateBroadcastStatusesDto>;

	/**
	 * Announces a platform's minimum version to all members. Admin only. There is no version argument.
	 * A version argument would eventually let the
	 * screen pass the value it rendered, and that value would be stale if the minimum changed in the
	 * meantime. Idempotent. A rerun creates no row and returns the current status.
	 */
	broadcastAppUpdate(
		platform: AppPlatform,
		input: AdminAppUpdateBroadcastRequest,
		options?: RequestOptions,
	): Promise<AdminAppUpdateBroadcastResponse>;

	audit(
		input?: Partial<AuditLogQuery>,
		options?: RequestOptions,
	): Promise<AuditLogPage>;
}

/**
 * Completes a partial member query. Defaults come from this one place, so the contract is their
 * only source.
 */
const memberQuery = (input: Partial<AdminMemberQuery>): AdminMemberQuery => ({
	q: input.q ?? "",
	status: input.status ?? "",
	role: input.role ?? "",
	cursor: input.cursor ?? "",
	limit: input.limit ?? ADMIN_PAGE_SIZE,
});

const storyQuery = (input: Partial<AdminStoryQuery>): AdminStoryQuery => ({
	q: input.q ?? "",
	ownerId: input.ownerId ?? "",
	visibility: input.visibility ?? "",
	hidden: input.hidden ?? "",
	adult: input.adult ?? "",
	cursor: input.cursor ?? "",
	limit: input.limit ?? ADMIN_PAGE_SIZE,
});

const auditQuery = (input: Partial<AuditLogQuery>): AuditLogQuery => ({
	operatorId: input.operatorId ?? "",
	action: input.action ?? "",
	targetId: input.targetId ?? "",
	cursor: input.cursor ?? "",
	limit: input.limit ?? ADMIN_PAGE_SIZE,
});

export function createAdminApi(transport: RowCatTransport): AdminApi {
	const { requestJson } = transport;
	return {
		mobileUpdates: createAdminMobileUpdatesApi(transport),

		async overview(options) {
			const json = await requestJson({
				method: "GET",
				path: "/admin/overview",
				signal: options?.signal,
			});
			const parsed = AdminOverviewDto.safeParse(json);
			if (!parsed.success) throw invalidResponse("/admin/overview");
			return parsed.data;
		},

		async members(input = {}, options) {
			const json = await requestJson({
				method: "GET",
				path: "/admin/members",
				search: toAdminMemberSearchParams(memberQuery(input)),
				signal: options?.signal,
			});
			const parsed = AdminMemberPage.safeParse(json);
			if (!parsed.success) throw invalidResponse("/admin/members");
			return parsed.data;
		},

		async member(memberId, options) {
			const json = await requestJson({
				method: "GET",
				path: `/admin/members/${encodeURIComponent(memberId)}`,
				signal: options?.signal,
			});
			const parsed = AdminMemberDetailDto.safeParse(json);
			if (!parsed.success) throw invalidResponse("/admin/members/:id");
			return parsed.data;
		},

		async setAdultVerification(memberId, input, options) {
			const json = await requestJson({
				method: "POST",
				path: `/admin/members/${encodeURIComponent(memberId)}/adult-verification`,
				/**
				 * Builds the body with the same schema the server parses
				 * (`AdminAdultVerificationRequest.parse`), so the contract owns any normalization.
				 */
				body: AdminAdultVerificationRequest.parse(input),
				signal: options?.signal,
			});
			const parsed = AdminAdultVerificationResponse.safeParse(json);
			if (!parsed.success)
				throw invalidResponse("POST /admin/members/:id/adult-verification");
			return parsed.data;
		},

		async setManagedGeneration(memberId, input, options) {
			const json = await requestJson({
				method: "POST",
				path: `/admin/members/${encodeURIComponent(memberId)}/managed-generation`,
				body: AdminManagedGenerationRequest.parse(input),
				signal: options?.signal,
			});
			const parsed = AdminManagedGenerationResponse.safeParse(json);
			if (!parsed.success)
				throw invalidResponse("POST /admin/members/:id/managed-generation");
			return parsed.data;
		},

		async stories(input = {}, options) {
			const json = await requestJson({
				method: "GET",
				path: "/admin/stories",
				search: toAdminStorySearchParams(storyQuery(input)),
				signal: options?.signal,
			});
			const parsed = AdminStoryPage.safeParse(json);
			if (!parsed.success) throw invalidResponse("/admin/stories");
			return parsed.data;
		},

		async story(storyId, options) {
			const json = await requestJson({
				method: "GET",
				path: `/admin/stories/${encodeURIComponent(storyId)}`,
				signal: options?.signal,
			});
			const parsed = AdminStoryDetailDto.safeParse(json);
			if (!parsed.success) throw invalidResponse("/admin/stories/:id");
			return parsed.data;
		},

		async deleteStory(storyId, input, options) {
			const json = await requestJson({
				method: "POST",
				path: `/admin/stories/${encodeURIComponent(storyId)}/delete`,
				/**
				 * Uses the same schema as the server. Because it is `.strict()`, no field that selects the
				 * outcome can be sent.
				 */
				body: AdminStoryDeleteRequest.parse(input),
				signal: options?.signal,
			});
			const parsed = AdminStoryDeleteResponse.safeParse(json);
			if (!parsed.success) throw invalidResponse("/admin/stories/:id/delete");
			return parsed.data;
		},

		async featureFlags(options) {
			const json = await requestJson({
				method: "GET",
				path: "/admin/operations/features",
				signal: options?.signal,
			});
			const parsed = FeatureFlagsDto.safeParse(json);
			if (!parsed.success) throw invalidResponse("/admin/operations/features");
			return parsed.data;
		},

		async setFeatureFlag(key, input, options) {
			const json = await requestJson({
				method: "PUT",
				path: `/admin/operations/features/${encodeURIComponent(key)}`,
				body: input,
				signal: options?.signal,
			});
			const parsed = FeatureFlagDto.safeParse(json);
			if (!parsed.success)
				throw invalidResponse("PUT /admin/operations/features/:key");
			return parsed.data;
		},

		async appVersionFloors(options) {
			const json = await requestJson({
				method: "GET",
				path: "/admin/operations/app-versions",
				signal: options?.signal,
			});
			const parsed = AppVersionFloorsDto.safeParse(json);
			if (!parsed.success)
				throw invalidResponse("/admin/operations/app-versions");
			return parsed.data;
		},

		async setAppVersionFloor(platform, input, options) {
			const json = await requestJson({
				method: "PUT",
				path: `/admin/operations/app-versions/${encodeURIComponent(platform)}`,
				body: input,
				signal: options?.signal,
			});
			const parsed = AppVersionFloorDto.safeParse(json);
			if (!parsed.success)
				throw invalidResponse("PUT /admin/operations/app-versions/:platform");
			return parsed.data;
		},

		async appUpdateBroadcastStatuses(options) {
			const json = await requestJson({
				method: "GET",
				path: "/admin/operations/app-versions/notice",
				signal: options?.signal,
			});
			const parsed = AppUpdateBroadcastStatusesDto.safeParse(json);
			if (!parsed.success)
				throw invalidResponse("/admin/operations/app-versions/notice");
			return parsed.data;
		},

		async broadcastAppUpdate(platform, input, options) {
			const json = await requestJson({
				method: "POST",
				path: `/admin/operations/app-versions/${encodeURIComponent(platform)}/notice`,
				/**
				 * Sends only the reason, not the whole input. A key the caller passed by mistake would fail the
				 * server's `.strict()` check with a 400, which the operator sees only as 'sending does not
				 * work'.
				 */
				body: { reason: input.reason },
				signal: options?.signal,
			});
			const parsed = AdminAppUpdateBroadcastResponse.safeParse(json);
			if (!parsed.success)
				throw invalidResponse(
					"POST /admin/operations/app-versions/:platform/notice",
				);
			return parsed.data;
		},

		async audit(input = {}, options) {
			const json = await requestJson({
				method: "GET",
				path: "/admin/audit",
				search: toAuditLogSearchParams(auditQuery(input)),
				signal: options?.signal,
			});
			const parsed = AuditLogPage.safeParse(json);
			if (!parsed.success) throw invalidResponse("/admin/audit");
			return parsed.data;
		},
	};
}
