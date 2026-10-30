import type {
	AdminAdultVerificationRequest,
	AdminAdultVerificationResponse,
	AdminAppUpdateBroadcastRequest,
	AdminManagedGenerationRequest,
	AdminManagedGenerationResponse,
	AdminMemberDetailDto,
	AdminMemberPage,
	AdminMemberQuery,
	AdminOverviewDto,
	AdminStoryDeleteRequest,
	AdminStoryDeleteResponse,
	AdminStoryDetailDto,
	AdminStoryPage,
	AdminStoryQuery,
	AppPlatform,
	AppUpdateBroadcastStatusesDto,
	AppVersionFloorSetRequest,
	AppVersionFloorsDto,
	AuditLogPage,
	AuditLogQuery,
	DeploymentReadinessDto,
	FeatureFlagKey,
	FeatureFlagSetRequest,
	FeatureFlagsDto,
} from "@rowcat/contracts";
import type { RowCatClient } from "@rowcat/sdk";
import { type QueryClient, queryOptions } from "@tanstack/react-query";

/**
 * The operator console's server state uses one prefix, ["admin"]. A single prefix keeps logout
 * cleanup in one place: the whole prefix must be reset, not invalidated, and splitting it would
 * risk missing one. The cells hold member emails and sanctions history, the full catalog including
 * private and hidden works, and who enforced what. Invalidation alone would leave those values in
 * memory, and the next operator on a shared browser would see them until refetch. The key does not
 * include the operator id; otherwise the previous operator's cell would survive under a different
 * key. Freshness windows are short (10-30s) because operators are judging the current state, and
 * other operators change these values on the server.
 */
export const ADMIN_QUERY_KEY_PREFIX = ["admin"] as const;

export const ADMIN_OVERVIEW_QUERY_KEY = ["admin", "overview"] as const;

export const adminOverviewQueryOptions = (client: RowCatClient) =>
	queryOptions<AdminOverviewDto>({
		queryKey: ADMIN_OVERVIEW_QUERY_KEY,
		queryFn: ({ signal }) => client.admin.overview({ signal }),
		/**
		 * 10 seconds. An operator watching this screen during an incident must not see 30-second-old
		 * numbers and conclude that the count has not dropped yet.
		 */
		staleTime: 10_000,
	});

/**
 * The list key includes the filter but not the cursor. A different filter is a different list;
 * putting both in one cell would briefly show previous results after each filter change. A cursor
 * is a position to append to, not a request identity, so including it would create a new cache cell
 * per page (same rule as the moderation queue).
 */
export const adminMembersQueryKey = (input: Partial<AdminMemberQuery>) =>
	[
		"admin",
		"members",
		input.q ?? "",
		input.status ?? "",
		input.role ?? "",
	] as const;

export const adminMembersQueryOptions = (
	client: RowCatClient,
	input: Partial<AdminMemberQuery>,
) =>
	queryOptions<AdminMemberPage>({
		queryKey: adminMembersQueryKey(input),
		queryFn: ({ signal }) => client.admin.members(input, { signal }),
		staleTime: 15_000,
	});

export const adminMemberQueryKey = (memberId: string) =>
	["admin", "member", memberId] as const;

export const adminMemberQueryOptions = (
	client: RowCatClient,
	memberId: string,
) =>
	queryOptions<AdminMemberDetailDto>({
		queryKey: adminMemberQueryKey(memberId),
		queryFn: ({ signal }) => client.admin.member(memberId, { signal }),
		staleTime: 15_000,
	});

/**
 * Writes the three axes the server confirmed, as-is. The screen does not write the value it sent:
 * the server may not follow the request (child accounts are rejected), and showAdult is not changed
 * by this action, so the server returns it. Does not invalidate the whole ["admin"] prefix: only
 * this member's detail and the audit list move. Invalidating everything would refetch the member
 * list, work list, overview, and switches on every toggle, which is costly during an incident.
 */
export function adminSetAdultVerificationMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
	memberId: string,
) {
	return {
		mutationKey: ["admin", "member", "adult-verification", memberId] as const,
		mutationFn: (request: AdminAdultVerificationRequest) =>
			client.admin.setAdultVerification(memberId, request),
		onSuccess: async (result: AdminAdultVerificationResponse) => {
			queryClient.setQueryData<AdminMemberDetailDto>(
				adminMemberQueryKey(memberId),
				(previous) =>
					previous
						? {
								...previous,
								operator: {
									...previous.operator,
									verified: result.verified,
									adult: result.adult,
									showAdult: result.showAdult,
								},
							}
						: previous,
			);
			await queryClient.invalidateQueries({
				queryKey: ADMIN_AUDIT_QUERY_KEY_PREFIX,
			});
		},
	};
}

/**
 * Same policy as the adult-verification toggle: the confirmed value goes into the detail cell and
 * only the audit list is marked stale. No optimistic update: if a failed request briefly showed
 * "allowed", the operator would tell the member it is allowed.
 */
export function adminSetManagedGenerationMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
	memberId: string,
) {
	return {
		mutationKey: ["admin", "member", "managed-generation", memberId] as const,
		mutationFn: (request: AdminManagedGenerationRequest) =>
			client.admin.setManagedGeneration(memberId, request),
		onSuccess: async (result: AdminManagedGenerationResponse) => {
			queryClient.setQueryData<AdminMemberDetailDto>(
				adminMemberQueryKey(memberId),
				(previous) =>
					previous
						? {
								...previous,
								operator: {
									...previous.operator,
									managedGenerationAllowed: result.allowed,
								},
							}
						: previous,
			);
			await queryClient.invalidateQueries({
				queryKey: ADMIN_AUDIT_QUERY_KEY_PREFIX,
			});
		},
	};
}

export const adminStoriesQueryKey = (input: Partial<AdminStoryQuery>) =>
	[
		"admin",
		"stories",
		input.q ?? "",
		input.ownerId ?? "",
		input.visibility ?? "",
		input.hidden ?? "",
		input.adult ?? "",
	] as const;

export const adminStoriesQueryOptions = (
	client: RowCatClient,
	input: Partial<AdminStoryQuery>,
) =>
	queryOptions<AdminStoryPage>({
		queryKey: adminStoriesQueryKey(input),
		queryFn: ({ signal }) => client.admin.stories(input, { signal }),
		staleTime: 15_000,
	});

export const adminStoryQueryKey = (storyId: string) =>
	["admin", "story", storyId] as const;

export const adminStoryQueryOptions = (client: RowCatClient, storyId: string) =>
	queryOptions<AdminStoryDetailDto>({
		queryKey: adminStoryQueryKey(storyId),
		queryFn: ({ signal }) => client.admin.story(storyId, { signal }),
		staleTime: 15_000,
	});

/**
 * Deleting a published work clears its detail cell (the work is now a 404, so it is removed rather
 * than re-fetched) and marks the admin works list and audit list stale. Public cells (gallery, work
 * detail) are not invalidated: that cache lives in the web app, not in this console (the two apps
 * do not share module instances), so invalidating here cannot reach it. The web side re-asks on its
 * own freshness, and the server's guest gallery cache expires within 30 seconds. No optimistic
 * update: the action is irreversible, so a briefly shown removal serves no purpose.
 */
export function adminDeleteStoryMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
	storyId: string,
) {
	return {
		mutationKey: ["admin", "story", "delete", storyId] as const,
		mutationFn: (request: AdminStoryDeleteRequest) =>
			client.admin.deleteStory(storyId, request),
		onSuccess: async (_result: AdminStoryDeleteResponse) => {
			queryClient.removeQueries({
				queryKey: adminStoryQueryKey(storyId),
				exact: true,
			});
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["admin", "stories"] }),
				queryClient.invalidateQueries({
					queryKey: ADMIN_AUDIT_QUERY_KEY_PREFIX,
				}),
			]);
		},
	};
}

export const ADMIN_DEPLOYMENT_READINESS_QUERY_KEY = [
	"admin",
	"deployment",
	"readiness",
] as const;

/**
 * Deployment readiness. Config does not change while the API runs, so the value is good until the
 * next deploy; a long `staleTime` only saves the request, and the screen still refetches on mount.
 */
export const adminDeploymentReadinessQueryOptions = (client: RowCatClient) =>
	queryOptions<DeploymentReadinessDto>({
		queryKey: ADMIN_DEPLOYMENT_READINESS_QUERY_KEY,
		queryFn: ({ signal }) => client.admin.deploymentReadiness({ signal }),
		staleTime: 60_000,
	});

export const ADMIN_FEATURES_QUERY_KEY = ["admin", "ops", "features"] as const;
export const ADMIN_APP_VERSIONS_QUERY_KEY = [
	"admin",
	"ops",
	"app-versions",
] as const;

export const adminFeatureFlagsQueryOptions = (client: RowCatClient) =>
	queryOptions<FeatureFlagsDto>({
		queryKey: ADMIN_FEATURES_QUERY_KEY,
		queryFn: ({ signal }) => client.admin.featureFlags({ signal }),
		/**
		 * 5 seconds. This screen is where operators go to turn off a breaker. If one cannot see what
		 * another operator just switched off, two people overwrite each other's changes.
		 */
		staleTime: 5_000,
	});

export const adminAppVersionFloorsQueryOptions = (client: RowCatClient) =>
	queryOptions<AppVersionFloorsDto>({
		queryKey: ADMIN_APP_VERSIONS_QUERY_KEY,
		queryFn: ({ signal }) => client.admin.appVersionFloors({ signal }),
		staleTime: 5_000,
	});

/**
 * Invalidates only; no optimistic update. The server can reject this (permissions, vocabulary), and
 * a briefly shown "off" after a failure is the most dangerous lie on this screen: the operator
 * believes the incident stopped and moves on. Reversibility does not justify the window.
 */
export function adminSetFeatureFlagMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
) {
	return {
		mutationKey: ["admin", "ops", "features", "set"] as const,
		mutationFn: (input: {
			key: FeatureFlagKey;
			request: FeatureFlagSetRequest;
		}) => client.admin.setFeatureFlag(input.key, input.request),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ADMIN_FEATURES_QUERY_KEY }),
				queryClient.invalidateQueries({
					queryKey: ADMIN_AUDIT_QUERY_KEY_PREFIX,
				}),
			]);
		},
	};
}

export function adminSetAppVersionFloorMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
) {
	return {
		mutationKey: ["admin", "ops", "app-versions", "set"] as const,
		mutationFn: (input: {
			platform: AppPlatform;
			request: AppVersionFloorSetRequest;
		}) => client.admin.setAppVersionFloor(input.platform, input.request),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: ADMIN_APP_VERSIONS_QUERY_KEY,
				}),
				/**
				 * The notice status is invalidated too. Skipping this fails silently: changing the lower bound
				 * changes who should be notified and resets the send count to 0. If the screen kept the old
				 * count, the operator would read "everyone already received it" and not send the new notice,
				 * with no error to flag it.
				 */
				queryClient.invalidateQueries({
					queryKey: ADMIN_APP_UPDATE_NOTICE_QUERY_KEY,
				}),
				queryClient.invalidateQueries({
					queryKey: ADMIN_AUDIT_QUERY_KEY_PREFIX,
				}),
			]);
		},
	};
}

export const ADMIN_APP_UPDATE_NOTICE_QUERY_KEY = [
	"admin",
	"ops",
	"app-update-notice",
] as const;

/**
 * A separate cell from the lower-bound query, though the same screen draws both: the axes differ.
 * The lower bound is a value an operator may change right now, so it is short (5 seconds) to keep
 * two people from overwriting each other. The send count moves slowly with member signups. Merging
 * them would run a count over all members every 5 seconds while the screen stays open.
 */
export const adminAppUpdateBroadcastStatusesQueryOptions = (
	client: RowCatClient,
) =>
	queryOptions<AppUpdateBroadcastStatusesDto>({
		queryKey: ADMIN_APP_UPDATE_NOTICE_QUERY_KEY,
		queryFn: ({ signal }) =>
			client.admin.appUpdateBroadcastStatuses({ signal }),
		staleTime: 30_000,
	});

/**
 * Only three invalidation scopes, and no optimistic update. Invalidating ["admin"] would refetch
 * member lists, the work catalog and the moderation queue, none of which this action
 * changed. No optimistic update: the server can reject it (permissions,
 * missing lower bound), and a briefly shown "sent" after a failure is the most dangerous lie here.
 * Member-side caches (["viewer", ...]) are not touched: those belong to other browsers, whose
 * inboxes refresh on their own schedule.
 */
export function adminBroadcastAppUpdateMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
) {
	return {
		mutationKey: ["admin", "ops", "app-update-notice", "broadcast"] as const,
		mutationFn: (input: {
			platform: AppPlatform;
			request: AdminAppUpdateBroadcastRequest;
		}) => client.admin.broadcastAppUpdate(input.platform, input.request),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: ADMIN_APP_UPDATE_NOTICE_QUERY_KEY,
				}),
				queryClient.invalidateQueries({
					queryKey: ADMIN_AUDIT_QUERY_KEY_PREFIX,
				}),
			]);
		},
	};
}

export const ADMIN_AUDIT_QUERY_KEY_PREFIX = ["admin", "audit"] as const;

export const adminAuditQueryKey = (input: Partial<AuditLogQuery>) =>
	[
		"admin",
		"audit",
		input.operatorId ?? "",
		input.action ?? "",
		input.targetId ?? "",
	] as const;

export const adminAuditQueryOptions = (
	client: RowCatClient,
	input: Partial<AuditLogQuery>,
) =>
	queryOptions<AuditLogPage>({
		queryKey: adminAuditQueryKey(input),
		queryFn: ({ signal }) => client.admin.audit(input, { signal }),
		staleTime: 10_000,
	});

/**
 * Cleanup on operator logout must be a reset, not an invalidation. Invalidation only marks values
 * stale and leaves them in memory. This prefix holds member emails, sanctions history, payment
 * identifiers, and private work titles; with no observer, they would sit in the next person's
 * browser memory without any refetch. ["viewer"] is not touched here: that cleanup already lives in
 * resetViewerState (@rowcat/query), which the operator console also calls. Two copies would drift,
 * with only one of them fixed.
 */
export async function resetAdminState(queryClient: QueryClient): Promise<void> {
	await queryClient.resetQueries({ queryKey: ADMIN_QUERY_KEY_PREFIX });
}
