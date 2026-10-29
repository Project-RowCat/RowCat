import {
	type ModerationReportSummaryDto,
	REPORT_REASON_LABEL,
	REPORT_TARGET_LABEL,
	ReportStatus,
	ReportTargetType,
} from "@rowcat/contracts";
import {
	moderationPageRows,
	moderationQueueInfiniteQueryOptions,
} from "@rowcat/query";
import { Badge } from "@rowcat/ui-web/components/badge";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { DataTable } from "#/components/data-table.tsx";
import { FilterBar, FilterSelect } from "#/components/filter-bar.tsx";
import { LoadMore } from "#/components/load-more.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { QueryState } from "#/components/states.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { formatDateTime, formatRelative, shortId } from "#/lib/format.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { useAdminInfiniteQuery } from "#/lib/query/use-admin-infinite-query.ts";

/**
 * Report queue, the most-used screen in this app.
 *
 * - It uses the existing moderation API as-is (`/v2/moderation/reports`) with the same
 *   `moderationQueueInfiniteQueryOptions` key; a second moderation system or a divergent cache key
 *   would leave a report handled in one place standing in the other's list.
 * - Filters live in the address: in React state, refresh, back and link sharing each need
 *   handling, operators cannot hand each other a queue by link, and returning from a detail loses
 *   the filter.
 * - Pages append with `Show more`. The screen never holds a cursor; it lives only in the cache cell of
 *   the filters that produced it, so asking for the next page of one filter with another's cursor
 *   is not expressible. Returning from a detail keeps the loaded pages because the filters travel
 *   through the address.
 * - There is no sort control. The server orders oldest first because the longest-waiting report
 *   belongs on top; allowing newest-first would leave old reports at the bottom forever.
 */

const STATUS_OPTIONS = [
	{ value: "open", label: "Open" },
	{ value: "resolved", label: "Resolved" },
	{ value: "dismissed", label: "Dismissed" },
];

const TARGET_OPTIONS = [
	{ value: "", label: "All targets" },
	...ReportTargetType.options.map((value) => ({
		value,
		label: REPORT_TARGET_LABEL[value],
	})),
];

export function QueuePage() {
	const navigate = useNavigate();
	const search = useSearch({ from: "/moderation" });

	/**
	 * Search values are filtered through the contract. If one hand-edited character turned the screen
	 * into an error, the operator would read the queue as dead; the parser is lenient here as in the
	 * creation workspace.
	 */
	const status = ReportStatus.safeParse(search.status ?? "open");
	const targetType = ReportTargetType.safeParse(search.targetType);
	const resolvedStatus = status.success ? status.data : "open";
	const resolvedTarget = targetType.success ? targetType.data : "";

	const query = useAdminInfiniteQuery(
		moderationQueueInfiniteQueryOptions(
			getRowCatClient(),
			resolvedStatus,
			resolvedTarget,
		),
	);

	const setFilter = (patch: Record<string, string | undefined>) => {
		navigate({
			to: "/moderation",
			/**
			 * Default axes are set to `undefined` explicitly. Search updates merge, so omitting the key
			 * keeps its previous value and someone who picked a target cannot go back to "all" (the same
			 * rule as mobile's `router.setParams`).
			 */
			search: (previous) => ({ ...previous, ...patch }),
			replace: true,
		});
	};

	return (
		<PageEnter className="space-y-4">
			<PageHeader
				title="Report queue"
				description="Reports that have waited longest are at the top."
			/>

			<FilterBar>
				<FilterSelect
					label="Status"
					value={resolvedStatus}
					options={STATUS_OPTIONS}
					onChange={(value) =>
						setFilter({ status: value === "open" ? undefined : value })
					}
				/>
				<FilterSelect
					label="Target"
					value={resolvedTarget}
					options={TARGET_OPTIONS}
					onChange={(value) => setFilter({ targetType: value || undefined })}
				/>
			</FilterBar>

			<QueryState
				query={query}
				empty={{
					title: "No reports here",
					description: "Change the filters to see reports in other states.",
					when: (data) => moderationPageRows(data).length === 0,
				}}
			>
				{(data) => (
					<>
						<DataTable<ModerationReportSummaryDto>
							caption="Report queue"
							rows={moderationPageRows(data)}
							rowKey={(row) => row.id}
							onRowClick={(row) =>
								navigate({
									to: "/moderation/reports/$reportId",
									params: { reportId: row.id },
									/**
									 * Carry the current filters into the detail address so `To queue` restores the filters and
									 * loaded pages.
									 */
									search: {
										status: search.status,
										targetType: search.targetType,
									},
								})
							}
							columns={[
								{
									key: "target",
									header: "Target",
									render: (row) => (
										<div className="flex items-center gap-2">
											<Badge variant="outline">
												{REPORT_TARGET_LABEL[row.targetType]}
											</Badge>
											<span
												className="font-mono text-muted-foreground text-xs"
												title={row.targetId ?? undefined}
											>
												{row.targetId ? shortId(row.targetId) : "—"}
											</span>
										</div>
									),
								},
								{
									key: "reason",
									header: "Reason",
									render: (row) => REPORT_REASON_LABEL[row.reason],
								},
								{
									key: "count",
									header: "Reports",
									numeric: true,
									hideBelow: "sm",
									/**
									 * Volume is itself a decision input (§24): ten reports on one target is a different
									 * situation from one, and the list has to show it for the operator to triage.
									 */
									render: (row) => row.caseReportCount,
								},
								{
									key: "status",
									header: "Status",
									hideBelow: "md",
									render: (row) => (
										<Badge
											variant={row.status === "open" ? "default" : "secondary"}
										>
											{STATUS_OPTIONS.find((o) => o.value === row.status)
												?.label ?? row.status}
										</Badge>
									),
								},
								{
									key: "createdAt",
									header: "Received",
									render: (row) => (
										<span title={formatDateTime(row.createdAt)}>
											{formatRelative(row.createdAt)}
										</span>
									),
								},
							]}
						/>
						<LoadMore nextPage={query.nextPage} noun="reports" />
					</>
				)}
			</QueryState>
		</PageEnter>
	);
}
