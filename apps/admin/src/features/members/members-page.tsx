import {
	type AdminMemberSummaryDto,
	MemberRole,
	MemberStatus,
} from "@rowcat/contracts";
import { adminMembersQueryOptions } from "@rowcat/query";
import { Badge } from "@rowcat/ui-web/components/badge";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { DataTable } from "#/components/data-table.tsx";
import {
	FilterBar,
	FilterSearch,
	FilterSelect,
} from "#/components/filter-bar.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { QueryState } from "#/components/states.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { formatDateTime, formatRelative, shortId } from "#/lib/format.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { useAdminQuery } from "#/lib/query/use-admin-query.ts";

/**
 * Member search.
 *
 * - One search field, because the operator cannot know in advance what they hold (a member id
 *   from a report, an email from a support mail, a nickname from a screenshot).
 * - Email is searchable (exact match only) but not listed: confirming a known address is one
 *   thing; handing whoever opens this screen twenty addresses at once is another. Email shows on
 *   the audited detail lookup only.
 * - No sanction buttons: enforcement goes against a case (`POST /v2/moderation/actions`), or the
 *   target has nothing to appeal.
 */

const STATUS_OPTIONS = [
	{ value: "", label: "All statuses" },
	...MemberStatus.options.map((value) => ({ value, label: value })),
];

const ROLE_OPTIONS = [
	{ value: "", label: "All roles" },
	...MemberRole.options.map((value) => ({ value, label: value })),
];

const AGE_LABEL: Record<string, string> = {
	unknown: "Unconfirmed",
	child: "Under 14",
	standard: "14 or older",
};

export function MembersPage() {
	const navigate = useNavigate();
	const search = useSearch({ from: "/members" });

	const status = MemberStatus.safeParse(search.status);
	const role = MemberRole.safeParse(search.role);
	const input = {
		q: search.q ?? "",
		status: status.success ? status.data : ("" as const),
		role: role.success ? role.data : ("" as const),
	};

	const query = useAdminQuery(
		adminMembersQueryOptions(getRowCatClient(), input),
	);

	const setFilter = (patch: Record<string, string | undefined>) =>
		navigate({
			to: "/members",
			// A default axis is passed as an explicit `undefined`; omitting it keeps the previous value.
			search: (previous) => ({ ...previous, ...patch }),
			replace: true,
		});

	return (
		<PageEnter className="space-y-4">
			<PageHeader
				title="Members"
				description="Search by member ID, nickname or email. Email matches only exactly."
			/>

			<FilterBar>
				<FilterSearch
					label="Search"
					value={input.q}
					placeholder="Member ID · nickname · email"
					onSubmit={(value) => setFilter({ q: value || undefined })}
				/>
				<FilterSelect
					label="Status"
					value={input.status}
					options={STATUS_OPTIONS}
					onChange={(value) => setFilter({ status: value || undefined })}
				/>
				<FilterSelect
					label="Role"
					value={input.role}
					options={ROLE_OPTIONS}
					onChange={(value) => setFilter({ role: value || undefined })}
				/>
			</FilterBar>

			<QueryState
				query={query}
				empty={{
					title: "No members match",
					description:
						"Email must match exactly. Partial matches don't find it.",
					when: (data) => data.items.length === 0,
				}}
			>
				{(data) => (
					<DataTable<AdminMemberSummaryDto>
						caption="Members"
						rows={data.items}
						rowKey={(row) => row.id}
						onRowClick={(row) =>
							navigate({
								to: "/members/$memberId",
								params: { memberId: row.id },
							})
						}
						columns={[
							{
								key: "nickname",
								header: "Nickname",
								truncate: true,
								render: (row) => (
									<div className="min-w-0">
										<p className="truncate font-medium">{row.nickname}</p>
										<p
											className="font-mono text-muted-foreground text-xs"
											title={row.id}
										>
											{shortId(row.id)}
										</p>
									</div>
								),
							},
							{
								key: "status",
								header: "Status",
								render: (row) => (
									<Badge
										variant={
											row.status === "approved" ? "secondary" : "destructive"
										}
									>
										{row.status}
									</Badge>
								),
							},
							{
								key: "role",
								header: "Role",
								hideBelow: "sm",
								render: (row) =>
									row.role === "user" ? (
										<span className="text-muted-foreground">user</span>
									) : (
										<Badge>{row.role}</Badge>
									),
							},
							{
								key: "age",
								header: "Age",
								hideBelow: "md",
								render: (row) => (
									<span className="text-muted-foreground text-xs">
										{AGE_LABEL[row.ageStatus] ?? row.ageStatus}
									</span>
								),
							},
							{
								key: "restrictions",
								header: "Restrictions",
								numeric: true,
								hideBelow: "sm",
								render: (row) =>
									row.activeRestrictions > 0 ? (
										<Badge variant="destructive">
											{row.activeRestrictions}
										</Badge>
									) : (
										<span className="text-muted-foreground">—</span>
									),
							},
							{
								key: "createdAt",
								header: "Joined",
								hideBelow: "md",
								render: (row) => (
									<span title={formatDateTime(row.createdAt)}>
										{formatRelative(row.createdAt)}
									</span>
								),
							},
						]}
					/>
				)}
			</QueryState>
		</PageEnter>
	);
}
