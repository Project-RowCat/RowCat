import type {
	AppealStatus,
	ModerationAppealsPage,
	ModerationQueuePage,
	ModerationReportDetailDto,
	MyModerationStatusDto,
	MyReportsPage,
	ReportStatus,
	ReportTargetType,
} from "@rowcat/contracts";
import type { RowCatClient } from "@rowcat/sdk";
import {
	type InfiniteData,
	infiniteQueryOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import { GALLERY_QUERY_KEY_PREFIX } from "./gallery.ts";
import { STORY_DETAIL_QUERY_KEY_PREFIX } from "./story.ts";

/**
 * Moderation server state. The cache key splits into two branches:
 * ["moderation","me"...]      the viewer's own sanctions and reports. Depends on the viewer.
 * ["moderation","queue"...]   operator queue. Only operators may receive it.
 * ["moderation","report"...]  operator report detail.
 * ["moderation","appeals"...] operator appeal queue.
 *
 * The split at `me` is the key rule of this file. The branches share the prefix because they share
 * a domain, so one logout cleanup clears both. They do not share an authorization. A reporter-only
 * slot must not sit beside the operator names (such as `["moderation","reports"]`). The names would
 * no longer tell the two authorizations apart, and a queue loaded by an operator could show up as
 * another user's report list.
 *
 * Both branches are viewer-scoped, so they never sit in the shared cache (the server also answers
 * `private, no-cache`). Logout clears the whole prefix, because leaving it would paint the previous
 * user's sanctions for a few frames (§85).
 *
 * Public caches (`["gallery"]`, `["stories"]`, `["creators","profile"]`) hold no moderation values.
 * The DTOs enforce that, not this file: public response types have no sanction fields at all.
 */
export const MODERATION_QUERY_KEY_PREFIX = ["moderation"] as const;

/**
 * Own sanction status. Read by the account screen alone. Not placed under `["viewer"]` (§58).
 */
export const MY_MODERATION_QUERY_KEY = ["moderation", "me"] as const;

/**
 * Reports I have submitted. Lives under `me`, not beside the operator names. Naming it
 * `["moderation","reports"]` would create a third report slot next to the operator queue and
 * operator detail, indistinguishable by name. The values here are which reports this viewer filed,
 * a different authorization from the queue.
 *
 * No cleanup of its own. Logout already resets the `["moderation"]` prefix (`viewer.ts`), and this
 * slot matches that prefix. Invalidation alone would leave the stored values in place, so the next
 * user's account screen would show the previous user's reports until refetch finishes.
 *
 * It sits below MY_MODERATION_QUERY_KEY on purpose. Re-asking for sanction status also marks this
 * list stale through prefix matching. Both are drawn by the same screen at the same moment, so
 * refreshing them together is correct (as with account info and session list).
 *
 * The cursor is not in the key. The next page is another slice of the same query.
 */
export const MY_REPORTS_QUERY_KEY = ["moderation", "me", "reports"] as const;

export type MyReportsInfiniteData = InfiniteData<MyReportsPage, string>;

/**
 * Cursor-paged query for my reports. staleTime is short (15 seconds), like sanction status.
 * Operators change this list from elsewhere and this browser gets no signal. This screen is where
 * users check whether a report has been resolved, so a stale value would keep showing a finished
 * review as `In review`.
 *
 * No polling or SSE. Notifying the user promptly is already done by the notification inbox
 * (`report_reviewed`), and that badge's 60-second refresh is the only periodic cycle.
 */
export function myReportsInfiniteQueryOptions(client: RowCatClient) {
	return infiniteQueryOptions<
		MyReportsPage,
		Error,
		MyReportsInfiniteData,
		readonly unknown[],
		string
	>({
		queryKey: MY_REPORTS_QUERY_KEY,
		queryFn: ({ pageParam, signal }) =>
			client.moderation.myReports({ cursor: pageParam }, { signal }),
		initialPageParam: "",
		getNextPageParam: (last) => last.nextCursor ?? undefined,
		staleTime: 15_000,
	});
}

/**
 * After a report is submitted, invalidate only this slot. The submit response carries just reportId
 * and createdAt, so the row cannot be built by hand. Building it would require the screen to
 * reassemble the target type and reason, which can differ from what the server stored (especially
 * on a 409 duplicate). The user would then see a report they did not file.
 *
 * Gallery, work detail, operator queue and viewer slots are left alone. A report changes no public
 * state (§12: reports are not enforcement), and the operator queue is a cache in another browser.
 */
export function invalidateMyReports(queryClient: QueryClient): Promise<void> {
	return queryClient.invalidateQueries({ queryKey: MY_REPORTS_QUERY_KEY });
}

export const moderationStatusQueryOptions = (client: RowCatClient) =>
	queryOptions<MyModerationStatusDto>({
		queryKey: MY_MODERATION_QUERY_KEY,
		queryFn: ({ signal }) => client.moderation.myStatus({ signal }),
		/**
		 * Do not set a long staleTime. Sanctions change on the server regardless of this browser, and
		 * this screen is where users check why something is blocked. Stale values would keep showing a
		 * sanction that has already been lifted.
		 */
		staleTime: 15_000,
	});

/**
 * Operator queue, paged by cursor (`Show more`).
 *
 * The filters are part of the key. A different status or target type is a different list. In one
 * shared slot, previous results would flash in place after each filter change.
 *
 * The cursor is not in the key. It marks a position in the list, not the request identity, so
 * including it would create a new slot for every page.
 *
 * A cursor cannot leave the filter that produced it. Cursors accumulate in `pageParams` only inside
 * that key's slot. A cursor received from `open` cannot be used to request the next page of
 * `resolved`. If the screen held the cursor as state, it would have to clear both together on every
 * filter change, and a screen that forgot would read the middle of a different list. That request
 * is not rejected with a 400; it is silently the wrong list.
 *
 * Returning to a previous filter restores its accumulated pages (kept for `gcTime`). When queried
 * again, TanStack Query re-attaches cursors from the first page, so later pages also get current
 * values.
 */
export const moderationQueueQueryKey = (
	status: ReportStatus,
	targetType: ReportTargetType | "",
) => ["moderation", "queue", status, targetType] as const;

export type ModerationQueueInfiniteData = InfiniteData<
	ModerationQueuePage,
	string
>;

export const moderationQueueInfiniteQueryOptions = (
	client: RowCatClient,
	status: ReportStatus,
	targetType: ReportTargetType | "",
) =>
	infiniteQueryOptions<
		ModerationQueuePage,
		Error,
		ModerationQueueInfiniteData,
		readonly unknown[],
		string
	>({
		queryKey: moderationQueueQueryKey(status, targetType),
		queryFn: ({ pageParam, signal }) =>
			client.moderation.queue(
				{ status, targetType, cursor: pageParam },
				{ signal },
			),
		initialPageParam: "",
		/** `undefined` marks the end. The server's cursor is passed through unchanged. */
		getNextPageParam: (last) => last.nextCursor ?? undefined,
		staleTime: 10_000,
	});

/**
 * Turns accumulated pages into table rows, with the same id appearing only once. The cursor is
 * (created_at, id), so duplicates do not occur on the normal path. The filter is still needed
 * because the table uses the id as its row key. When processing and refetch race, the same report
 * can briefly sit on two pages. That overlap must collapse into one row silently, not cause a key
 * collision. The first occurrence is kept: the queue is oldest-first, so the earlier page's
 * position is the correct one.
 */
export const moderationPageRows = <T extends { id: string }>(data: {
	pages: readonly { items: readonly T[] }[];
}): T[] => {
	const seen = new Set<string>();
	const rows: T[] = [];
	for (const page of data.pages)
		for (const row of page.items) {
			if (seen.has(row.id)) continue;
			seen.add(row.id);
			rows.push(row);
		}
	return rows;
};

export const moderationReportQueryKey = (reportId: string) =>
	["moderation", "report", reportId] as const;

export const moderationReportQueryOptions = (
	client: RowCatClient,
	reportId: string,
) =>
	queryOptions<ModerationReportDetailDto>({
		queryKey: moderationReportQueryKey(reportId),
		queryFn: ({ signal }) =>
			client.moderation.reportDetail(reportId, { signal }),
		staleTime: 10_000,
	});

/** Appeal list. Paged like the queue. The single status filter is part of the key. */
export const moderationAppealsQueryKey = (status: AppealStatus) =>
	["moderation", "appeals", status] as const;

export type ModerationAppealsInfiniteData = InfiniteData<
	ModerationAppealsPage,
	string
>;

export const moderationAppealsInfiniteQueryOptions = (
	client: RowCatClient,
	status: AppealStatus,
) =>
	infiniteQueryOptions<
		ModerationAppealsPage,
		Error,
		ModerationAppealsInfiniteData,
		readonly unknown[],
		string
	>({
		queryKey: moderationAppealsQueryKey(status),
		queryFn: ({ pageParam, signal }) =>
			client.moderation.appeals({ status, cursor: pageParam }, { signal }),
		initialPageParam: "",
		getNextPageParam: (last) => last.nextCursor ?? undefined,
		staleTime: 10_000,
	});

/**
 * Cache policy after an enforcement action: invalidate broadly. Narrowing each action type to its
 * exact slots (hide: gallery and detail; comment delete: that work's comments; account action: that
 * member's profile) would need a table that is easy to miss an entry in as the action vocabulary
 * grows. Operator screens are used one decision at a time, not dozens of operations per second, so
 * correctness is cheaper here than bandwidth.
 *
 * Clearing the gallery and detail is the point. After a work is hidden, it must disappear from the
 * screen of the operator who hid it, and those lists sit outside the moderation prefix.
 */
export async function invalidateAfterModeration(
	queryClient: QueryClient,
): Promise<void> {
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: MODERATION_QUERY_KEY_PREFIX }),
		queryClient.invalidateQueries({ queryKey: GALLERY_QUERY_KEY_PREFIX }),
		queryClient.invalidateQueries({ queryKey: STORY_DETAIL_QUERY_KEY_PREFIX }),
	]);
}
