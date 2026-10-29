import {
	AppealCreateRequest,
	type AppealStatus,
	ModerationActionDto,
	type ModerationActionRequest,
	type ModerationAppealResolveRequest,
	ModerationAppealsPage,
	ModerationQueuePage,
	type ModerationQueueQuery,
	ModerationReportDetailDto,
	type ModerationResolveRequest,
	MY_REPORTS_PAGE_SIZE,
	MyAppealDto,
	MyModerationStatusDto,
	MyReportsPage,
	type MyReportsQuery,
	ReportCreateRequest,
	ReportCreateResponse,
	toModerationQueueSearchParams,
	toMyReportsSearchParams,
} from "@rowcat/contracts";
import type { RequestOptions, RowCatTransport } from "./client.ts";
import { invalidResponse } from "./errors.ts";

/**
 * Moderation covers three groups of different nature in one resource:
 * - report(): any logged-in member files a report (`POST /v2/reports`).
 * - myStatus, myReports, and appeal(): the member reads and appeals their own items
 *   (`/v2/me/moderation/*`).
 * - queue() and the other operator calls: operators only (`/v2/moderation/*`). They share a file
 *   because the domain is the same, not the path. Authorization is not here: this package does not
 *   block a regular member from calling operator functions. The server answers 403, and the screen
 *   does not render those links. Re-implementing authorization on the client would create two rule
 *   sets, and the looser one would become the real policy.
 */
export interface ModerationApi {
	/**
	 * Submits one report. The target is a discriminated union, so the value each kind requires is
	 * fixed in the type. Free-form `targetType` and `targetId` cannot be built. There is also no slot
	 * for choosing a penalty: the request has no such field, so a client demanding enforcement cannot
	 * be expressed.
	 */
	report(
		input: ReportCreateRequest,
		options?: RequestOptions,
	): Promise<ReportCreateResponse>;

	/**
	 * Sanctions, restrictions, and appeals placed on me. With no restrictions, the arrays are empty,
	 * not an error.
	 */
	myStatus(options?: RequestOptions): Promise<MyModerationStatusDto>;

	/**
	 * My submitted reports, newest first, paged with a cursor. No argument names a member.
	 * `reporterId` and `memberId` are absent from both the signature and the contract, so code that
	 * requests someone else's report history cannot be written. This is the same axis as the
	 * notification resource. The returned statuses are only `reviewing` and `reviewed`. The server's
	 * projection already folds internal dispositions (`resolved`, `dismissed`), and this package has
	 * no field to look them back up.
	 */
	myReports(
		input?: Partial<MyReportsQuery>,
		options?: RequestOptions,
	): Promise<MyReportsPage>;

	/** Appeals one action. Which member is appealing is decided by the session. */
	appeal(
		input: AppealCreateRequest,
		options?: RequestOptions,
	): Promise<MyAppealDto>;

	queue(
		input?: Partial<ModerationQueueQuery>,
		options?: RequestOptions,
	): Promise<ModerationQueuePage>;
	reportDetail(
		reportId: string,
		options?: RequestOptions,
	): Promise<ModerationReportDetailDto>;
	resolveReport(
		reportId: string,
		input: ModerationResolveRequest,
		options?: RequestOptions,
	): Promise<void>;
	act(
		input: ModerationActionRequest,
		options?: RequestOptions,
	): Promise<ModerationActionDto>;
	appeals(
		input?: { status?: AppealStatus; cursor?: string },
		options?: RequestOptions,
	): Promise<ModerationAppealsPage>;
	resolveAppeal(
		appealId: string,
		input: ModerationAppealResolveRequest,
		options?: RequestOptions,
	): Promise<void>;
}

export function createModerationApi({
	requestJson,
	requestVoid,
}: RowCatTransport): ModerationApi {
	return {
		async report(input, options) {
			const json = await requestJson({
				method: "POST",
				path: "/reports",
				/**
				 * Builds the body with the same schema the server reads; any normalization belongs to the
				 * contract.
				 */
				body: ReportCreateRequest.parse(input),
				signal: options?.signal,
			});
			const parsed = ReportCreateResponse.safeParse(json);
			if (!parsed.success) throw invalidResponse("POST /reports");
			return parsed.data;
		},

		async myStatus(options) {
			const json = await requestJson({
				method: "GET",
				path: "/me/moderation",
				signal: options?.signal,
			});
			const parsed = MyModerationStatusDto.safeParse(json);
			if (!parsed.success) throw invalidResponse("/me/moderation");
			return parsed.data;
		},

		async myReports(input = {}, options) {
			const json = await requestJson({
				method: "GET",
				path: "/me/moderation/reports",
				search: toMyReportsSearchParams({
					cursor: input.cursor ?? "",
					limit: input.limit ?? MY_REPORTS_PAGE_SIZE,
				}),
				signal: options?.signal,
			});
			const parsed = MyReportsPage.safeParse(json);
			if (!parsed.success) throw invalidResponse("/me/moderation/reports");
			return parsed.data;
		},

		async appeal(input, options) {
			const json = await requestJson({
				method: "POST",
				path: "/me/moderation/appeals",
				body: AppealCreateRequest.parse(input),
				signal: options?.signal,
			});
			const parsed = MyAppealDto.safeParse(json);
			if (!parsed.success) throw invalidResponse("POST /me/moderation/appeals");
			return parsed.data;
		},

		async queue(input = {}, options) {
			const json = await requestJson({
				method: "GET",
				path: "/moderation/reports",
				search: toModerationQueueSearchParams({
					status: input.status ?? "open",
					targetType: input.targetType ?? "",
					cursor: input.cursor ?? "",
					limit: input.limit ?? 25,
				}),
				signal: options?.signal,
			});
			const parsed = ModerationQueuePage.safeParse(json);
			if (!parsed.success) throw invalidResponse("/moderation/reports");
			return parsed.data;
		},

		async reportDetail(reportId, options) {
			const json = await requestJson({
				method: "GET",
				path: `/moderation/reports/${encodeURIComponent(reportId)}`,
				signal: options?.signal,
			});
			const parsed = ModerationReportDetailDto.safeParse(json);
			if (!parsed.success) throw invalidResponse("/moderation/reports/:id");
			return parsed.data;
		},

		async resolveReport(reportId, input, options) {
			await requestVoid({
				method: "POST",
				path: `/moderation/reports/${encodeURIComponent(reportId)}/resolve`,
				body: input,
				signal: options?.signal,
			});
		},

		async act(input, options) {
			const json = await requestJson({
				method: "POST",
				path: "/moderation/actions",
				body: input,
				signal: options?.signal,
			});
			const parsed = ModerationActionDto.safeParse(json);
			if (!parsed.success) throw invalidResponse("POST /moderation/actions");
			return parsed.data;
		},

		async appeals(input = {}, options) {
			const search = new URLSearchParams();
			if (input.status && input.status !== "open")
				search.set("status", input.status);
			if (input.cursor) search.set("cursor", input.cursor);
			const json = await requestJson({
				method: "GET",
				path: "/moderation/appeals",
				search,
				signal: options?.signal,
			});
			const parsed = ModerationAppealsPage.safeParse(json);
			if (!parsed.success) throw invalidResponse("/moderation/appeals");
			return parsed.data;
		},

		async resolveAppeal(appealId, input, options) {
			await requestVoid({
				method: "POST",
				path: `/moderation/appeals/${encodeURIComponent(appealId)}/resolve`,
				body: input,
				signal: options?.signal,
			});
		},
	};
}
