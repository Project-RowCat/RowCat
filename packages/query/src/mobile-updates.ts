import type {
	AdminMobileUpdateDetailDto,
	AdminMobileUpdateJobDto,
	AdminMobileUpdateJobPage,
	AdminMobileUpdateJobsConfigDto,
	AdminMobileUpdatePage,
	AdminMobileUpdatePublishRequest,
	AdminMobileUpdateQuery,
	AdminMobileUpdateRollbackPlanDto,
	AdminMobileUpdateRollbackRequest,
	AdminMobileUpdateTransitionResponse,
} from "@rowcat/contracts";
import { isMobileUpdateJobActive } from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import {
	type InfiniteData,
	infiniteQueryOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import { ADMIN_AUDIT_QUERY_KEY_PREFIX } from "./admin.ts";

/**
 * Ops-console mobile OTA server state. Everything lives under ["admin"]:
 * - ["admin","mobile-updates",…filters] release list (appended pages)
 * - ["admin","mobile-update",id] release detail, history and related jobs
 * - ["admin","mobile-update",id,"rollback-plan"] rollback plan
 * - ["admin","mobile-update-jobs",…] job list and CI links
 * - ["admin","mobile-update-job",id] one job Logout resets all of ["admin"] (`resetAdminState`).
 *   Values here, such as the source commit, operator nickname and CI run links, must not remain for
 *   the next person. Operations do not invalidate all of ["admin"]. Changing a rollout percentage
 *   gives no reason to refetch members, works or coupons, and that noise would shake other lists
 *   the operator is viewing. The audit cells do go stale, because these operations create audit
 *   rows. No optimistic updates. What would be falsely shown is `stopped` or `going out at 50%`
 *   (rolling out at 50%), and an operator who trusted it would take the next action on it. The
 *   server has real reasons to reject: another operator may have changed the release first, or a
 *   percentage cannot go back down.
 */

export const ADMIN_MOBILE_UPDATES_QUERY_KEY_PREFIX = [
	"admin",
	"mobile-updates",
] as const;

export const adminMobileUpdatesQueryKey = (
	input: Partial<AdminMobileUpdateQuery>,
) =>
	[
		...ADMIN_MOBILE_UPDATES_QUERY_KEY_PREFIX,
		input.channel ?? "",
		input.platform ?? "",
		input.runtimeVersion ?? "",
		input.status ?? "",
	] as const;

export type AdminMobileUpdatesInfiniteData = InfiniteData<
	AdminMobileUpdatePage,
	string
>;

/**
 * The cursor is not part of the key. The filters are the key, and the cursor lives only inside that
 * cell.
 */
export function adminMobileUpdatesInfiniteQueryOptions(
	client: RowCatClient,
	input: Partial<AdminMobileUpdateQuery>,
) {
	return infiniteQueryOptions<
		AdminMobileUpdatePage,
		Error,
		AdminMobileUpdatesInfiniteData,
		readonly unknown[],
		string
	>({
		queryKey: adminMobileUpdatesQueryKey(input),
		queryFn: ({ pageParam, signal }) =>
			client.admin.mobileUpdates.releases(
				{ ...input, cursor: pageParam },
				{ signal },
			),
		initialPageParam: "",
		getNextPageParam: (last) => last.nextCursor ?? undefined,
		staleTime: 15_000,
	});
}

export const adminMobileUpdateQueryKey = (id: string) =>
	["admin", "mobile-update", id] as const;

export const adminMobileUpdateQueryOptions = (
	client: RowCatClient,
	id: string,
) =>
	queryOptions<AdminMobileUpdateDetailDto>({
		queryKey: adminMobileUpdateQueryKey(id),
		queryFn: ({ signal }) => client.admin.mobileUpdates.release(id, { signal }),
		staleTime: 10_000,
	});

export const adminMobileUpdateRollbackPlanQueryOptions = (
	client: RowCatClient,
	id: string,
) =>
	queryOptions<AdminMobileUpdateRollbackPlanDto>({
		queryKey: [...adminMobileUpdateQueryKey(id), "rollback-plan"],
		queryFn: ({ signal }) =>
			client.admin.mobileUpdates.rollbackPlan(id, { signal }),
		/**
		 * Refetches each time the confirmation dialog opens, since another release may have become active
		 * in the meantime.
		 */
		staleTime: 0,
	});

export const ADMIN_MOBILE_UPDATE_JOBS_QUERY_KEY_PREFIX = [
	"admin",
	"mobile-update-jobs",
] as const;

export type AdminMobileUpdateJobsInfiniteData = InfiniteData<
	AdminMobileUpdateJobPage,
	string
>;

/** Refetch interval only while a job is running. Finished jobs are not polled. */
const ACTIVE_JOB_REFETCH_MS = 5_000;

export function adminMobileUpdateJobsInfiniteQueryOptions(
	client: RowCatClient,
) {
	return infiniteQueryOptions<
		AdminMobileUpdateJobPage,
		Error,
		AdminMobileUpdateJobsInfiniteData,
		readonly unknown[],
		string
	>({
		queryKey: [...ADMIN_MOBILE_UPDATE_JOBS_QUERY_KEY_PREFIX, "list"],
		queryFn: ({ pageParam, signal }) =>
			client.admin.mobileUpdates.jobs({ cursor: pageParam }, { signal }),
		initialPageParam: "",
		getNextPageParam: (last) => last.nextCursor ?? undefined,
		staleTime: 10_000,
		refetchInterval: (query) =>
			query.state.data?.pages[0]?.items.some((job) =>
				isMobileUpdateJobActive(job.status),
			)
				? ACTIVE_JOB_REFETCH_MS
				: false,
	});
}

export const adminMobileUpdateJobsConfigQueryOptions = (client: RowCatClient) =>
	queryOptions<AdminMobileUpdateJobsConfigDto>({
		queryKey: [...ADMIN_MOBILE_UPDATE_JOBS_QUERY_KEY_PREFIX, "config"],
		queryFn: ({ signal }) => client.admin.mobileUpdates.jobsConfig({ signal }),
		staleTime: 60_000,
	});

export const adminMobileUpdateJobQueryKey = (id: string) =>
	["admin", "mobile-update-job", id] as const;

/**
 * One job, polled every 5 seconds only while it runs. CI reports coarse state, so polling more
 * often gains nothing, and a finished job does not change. The interval runs only while a person is
 * watching (no observer once the dialog closes). The authority that ends a job is CI's report and
 * the server's reconciliation, not this interval.
 */
export const adminMobileUpdateJobQueryOptions = (
	client: RowCatClient,
	id: string,
) =>
	queryOptions<AdminMobileUpdateJobDto>({
		queryKey: adminMobileUpdateJobQueryKey(id),
		queryFn: ({ signal }) => client.admin.mobileUpdates.job(id, { signal }),
		staleTime: 5_000,
		refetchInterval: (query) =>
			query.state.data && isMobileUpdateJobActive(query.state.data.status)
				? ACTIVE_JOB_REFETCH_MS
				: false,
	});

export function invalidateMobileUpdateRelease(
	queryClient: QueryClient,
	id: string,
): Promise<unknown> {
	return Promise.all([
		queryClient.invalidateQueries({
			queryKey: ADMIN_MOBILE_UPDATES_QUERY_KEY_PREFIX,
		}),
		queryClient.invalidateQueries({ queryKey: adminMobileUpdateQueryKey(id) }),
		queryClient.invalidateQueries({ queryKey: ADMIN_AUDIT_QUERY_KEY_PREFIX }),
	]);
}

function invalidateMobileUpdateJobs(
	queryClient: QueryClient,
	job: AdminMobileUpdateJobDto,
): Promise<unknown> {
	queryClient.setQueryData(adminMobileUpdateJobQueryKey(job.id), job);
	return Promise.all([
		queryClient.invalidateQueries({
			queryKey: ADMIN_MOBILE_UPDATE_JOBS_QUERY_KEY_PREFIX,
		}),
		job.targetReleaseId
			? queryClient.invalidateQueries({
					queryKey: adminMobileUpdateQueryKey(job.targetReleaseId),
				})
			: Promise.resolve(),
		queryClient.invalidateQueries({ queryKey: ADMIN_AUDIT_QUERY_KEY_PREFIX }),
	]);
}

export type MobileUpdateTransitionInput =
	| { action: "rollout"; percentage: number; reason: string }
	| { action: "pause"; reason: string }
	| { action: "resume"; reason: string };

/**
 * For percentage, stop and resume: writes the server-confirmed release into the detail cell and
 * invalidates the rest. The response has no history rows, so the detail cell is also invalidated.
 * The action just taken must show up in the history.
 */
export function adminMobileUpdateTransitionMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
	id: string,
) {
	return {
		mutationKey: ["admin", "mobile-update", id, "transition"] as const,
		mutationFn: (
			input: MobileUpdateTransitionInput,
		): Promise<AdminMobileUpdateTransitionResponse> => {
			switch (input.action) {
				case "rollout":
					return client.admin.mobileUpdates.rollout(id, {
						percentage: input.percentage,
						reason: input.reason,
					});
				case "pause":
					return client.admin.mobileUpdates.pause(id, { reason: input.reason });
				case "resume":
					return client.admin.mobileUpdates.resume(id, {
						reason: input.reason,
					});
			}
		},
		onSuccess: async (result: AdminMobileUpdateTransitionResponse) => {
			queryClient.setQueryData<AdminMobileUpdateDetailDto>(
				adminMobileUpdateQueryKey(id),
				(previous) =>
					previous ? { ...previous, release: result.release } : previous,
			);
			await invalidateMobileUpdateRelease(queryClient, id);
		},
	};
}

/** Publish request. The response is a job, not a release, so the release list is not touched. */
export function adminMobileUpdatePublishMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
) {
	return {
		mutationKey: ["admin", "mobile-update-jobs", "publish"] as const,
		mutationFn: (input: AdminMobileUpdatePublishRequest) =>
			client.admin.mobileUpdates.requestPublish(input),
		onSuccess: (job: AdminMobileUpdateJobDto) =>
			invalidateMobileUpdateJobs(queryClient, job),
		/**
		 * Even a request that fails to start CI is stored on the server as a failed job. The job list
		 * must show it, so the operator does not read it as `pressed, nothing happened`.
		 */
		onError: () =>
			queryClient.invalidateQueries({
				queryKey: ADMIN_MOBILE_UPDATE_JOBS_QUERY_KEY_PREFIX,
			}),
	};
}

/**
 * Rollback request. CI changes the release state, so what is invalidated here is the job and the
 * detail of its target.
 */
export function adminMobileUpdateRollbackMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
	id: string,
) {
	return {
		mutationKey: ["admin", "mobile-update", id, "rollback"] as const,
		mutationFn: (input: AdminMobileUpdateRollbackRequest) =>
			client.admin.mobileUpdates.requestRollback(id, input),
		onSuccess: (job: AdminMobileUpdateJobDto) =>
			invalidateMobileUpdateJobs(queryClient, job),
		onError: () =>
			queryClient.invalidateQueries({
				queryKey: ADMIN_MOBILE_UPDATE_JOBS_QUERY_KEY_PREFIX,
			}),
	};
}

export function adminMobileUpdateCancelJobMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
	id: string,
) {
	return {
		mutationKey: ["admin", "mobile-update-job", id, "cancel"] as const,
		mutationFn: (reason: string) =>
			client.admin.mobileUpdates.cancelJob(id, { reason }),
		onSuccess: (job: AdminMobileUpdateJobDto) =>
			invalidateMobileUpdateJobs(queryClient, job),
	};
}
