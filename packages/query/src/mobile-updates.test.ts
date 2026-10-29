import type {
	AdminMobileUpdateDetailDto,
	AdminMobileUpdateJobDto,
	AdminMobileUpdateReleaseDto,
} from "@rowcat/contracts";
import type { RowCatClient } from "@rowcat/sdk";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
	ADMIN_AUDIT_QUERY_KEY_PREFIX,
	adminMembersQueryKey,
	resetAdminState,
} from "./admin.ts";
import {
	ADMIN_MOBILE_UPDATE_JOBS_QUERY_KEY_PREFIX,
	adminMobileUpdatePublishMutationOptions,
	adminMobileUpdateQueryKey,
	adminMobileUpdatesQueryKey,
	adminMobileUpdateTransitionMutationOptions,
} from "./mobile-updates.ts";

/**
 * Ops-console OTA cache: after an operation, only the OTA cells and the audit log go stale. Logout
 * clears everything.
 */

const newClient = () =>
	new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});

const clientOf = (client: Partial<RowCatClient>): RowCatClient =>
	client as RowCatClient;

async function run<T>(queryClient: QueryClient, options: object, variables: T) {
	const observer = new MutationObserver(
		queryClient,
		options as ConstructorParameters<typeof MutationObserver>[1],
	);
	try {
		await observer.mutate(variables);
		return "success";
	} catch {
		return "error";
	}
}

const release = (overrides: Partial<AdminMobileUpdateReleaseDto> = {}) =>
	({
		id: "r1",
		kind: "update",
		platform: "ios",
		channel: "production",
		runtimeVersion: "rowcat-native-1",
		createdAt: "2026-10-03T00:00:00.000Z",
		registeredAt: "2026-10-03T00:00:00.000Z",
		status: "active",
		statusChangedAt: "2026-10-03T00:00:00.000Z",
		rolloutPercentage: 10,
		keyIds: ["rowcat-production-1"],
		republishOf: null,
		sourceCommit: "a".repeat(40),
		apiOrigin: "https://api.example.test",
		...overrides,
	}) satisfies AdminMobileUpdateReleaseDto;

const seedStale = (queryClient: QueryClient) => {
	queryClient.setQueryData(adminMobileUpdatesQueryKey({}), { pages: [] });
	queryClient.setQueryData(adminMobileUpdateQueryKey("r1"), {
		release: release(),
		assets: { count: 0, bytes: 0 },
		events: [],
		jobs: [],
	} satisfies AdminMobileUpdateDetailDto);
	queryClient.setQueryData(ADMIN_AUDIT_QUERY_KEY_PREFIX, { items: [] });
	queryClient.setQueryData(adminMembersQueryKey({}), { items: [] });
};

const invalidated = (queryClient: QueryClient, key: readonly unknown[]) =>
	queryClient.getQueryState(key)?.isInvalidated ?? false;

describe("cache after OTA operations", () => {
	it("raising the rollout seats the confirmed release in the detail and marks only OTA and audit stale", async () => {
		const queryClient = newClient();
		seedStale(queryClient);
		const client = clientOf({
			admin: {
				mobileUpdates: {
					rollout: async () => ({
						release: release({ rolloutPercentage: 50 }),
						changed: true,
					}),
				},
			} as unknown as RowCatClient["admin"],
		});
		expect(
			await run(
				queryClient,
				adminMobileUpdateTransitionMutationOptions(client, queryClient, "r1"),
				{ action: "rollout", percentage: 50, reason: "" },
			),
		).toBe("success");
		const detail = queryClient.getQueryData<AdminMobileUpdateDetailDto>(
			adminMobileUpdateQueryKey("r1"),
		);
		expect(detail?.release.rolloutPercentage).toBe(50);
		expect(invalidated(queryClient, adminMobileUpdatesQueryKey({}))).toBe(true);
		expect(invalidated(queryClient, ADMIN_AUDIT_QUERY_KEY_PREFIX)).toBe(true);
		expect(invalidated(queryClient, adminMembersQueryKey({}))).toBe(false);
	});

	it("a failed transition does not change the detail; there is no optimistic update", async () => {
		const queryClient = newClient();
		seedStale(queryClient);
		const client = clientOf({
			admin: {
				mobileUpdates: {
					pause: async () => {
						throw new Error("409");
					},
				},
			} as unknown as RowCatClient["admin"],
		});
		expect(
			await run(
				queryClient,
				adminMobileUpdateTransitionMutationOptions(client, queryClient, "r1"),
				{ action: "pause", reason: "x" },
			),
		).toBe("error");
		expect(
			queryClient.getQueryData<AdminMobileUpdateDetailDto>(
				adminMobileUpdateQueryKey("r1"),
			)?.release.status,
		).toBe("active");
	});

	it("a publish request marks only the jobs cell stale; the release list stays", async () => {
		const queryClient = newClient();
		seedStale(queryClient);
		queryClient.setQueryData(
			[...ADMIN_MOBILE_UPDATE_JOBS_QUERY_KEY_PREFIX, "list"],
			{
				pages: [],
			},
		);
		const job = {
			id: "j1",
			kind: "publish",
			channel: "production",
			platform: "ios",
			status: "queued",
			requestedBy: null,
			source: { kind: "branch", branch: "main" },
			sourceCommit: null,
			runtimeVersion: null,
			targetReleaseId: null,
			toEmbedded: false,
			initialRollout: null,
			noteId: null,
			reason: "r",
			externalRunUrl: null,
			resultReleaseIds: [],
			failure: null,
			createdAt: "2026-10-03T00:00:00.000Z",
			startedAt: null,
			finishedAt: null,
		} satisfies AdminMobileUpdateJobDto;
		const client = clientOf({
			admin: {
				mobileUpdates: { requestPublish: async () => job },
			} as unknown as RowCatClient["admin"],
		});
		await run(
			queryClient,
			adminMobileUpdatePublishMutationOptions(client, queryClient),
			{},
		);
		expect(
			invalidated(queryClient, [
				...ADMIN_MOBILE_UPDATE_JOBS_QUERY_KEY_PREFIX,
				"list",
			]),
		).toBe(true);
		expect(invalidated(queryClient, adminMobileUpdatesQueryKey({}))).toBe(
			false,
		);
	});

	it("signing out clears the OTA cells too", async () => {
		const queryClient = newClient();
		seedStale(queryClient);
		await resetAdminState(queryClient);
		expect(
			queryClient.getQueryData(adminMobileUpdateQueryKey("r1")),
		).toBeUndefined();
		expect(
			queryClient.getQueryData(adminMobileUpdatesQueryKey({})),
		).toBeUndefined();
	});
});
