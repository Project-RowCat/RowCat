import type { AuditLogEntryDto } from "@rowcat/contracts";
import { adminAuditQueryOptions } from "@rowcat/query";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
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
 * Audit log; read-only because the operations to edit or delete do not exist: the service has no
 * UPDATE or DELETE statement and the route has no such method.
 *
 * It differs from a moderation action. `moderation_action` is the enforcement itself (deleting it
 * lifts the sanction); this is an observation, so deleting it changes no product behavior, and even
 * reads can be recorded (`admin.member.view`, the only lookup that exposes email). Enforcement
 * history lives on the member and report details.
 *
 * The action vocabulary is open. The filter is a prefix match and unknown actions are drawn as-is,
 * unlike feature-switch keys, which are closed because they only matter with a route that reads
 * them. Here, forgetting to widen the vocabulary for a new privileged operation and letting it pass
 * unrecorded is worse.
 */

/**
 * Common prefixes: shortcuts, not the vocabulary. Actions not listed can still be searched and are
 * still recorded, so "all" is first and the default.
 */
const ACTION_PREFIXES = [
	{ value: "", label: "All actions" },
	{ value: "ops.", label: "Operations settings" },
	{ value: "admin.member.", label: "Member views" },
];

function MetadataCell({ metadata }: { metadata: Record<string, unknown> }) {
	const [open, setOpen] = useState(false);
	const keys = Object.keys(metadata);
	if (keys.length === 0)
		return <span className="text-muted-foreground text-xs">—</span>;

	if (!open)
		return (
			<button
				type="button"
				className="text-muted-foreground text-xs underline-offset-4 hover:underline"
				onClick={() => setOpen(true)}
			>
				Show {keys.length} entries
			</button>
		);

	return (
		<div className="space-y-1">
			<dl className="space-y-0.5">
				{keys.map((key) => (
					<div key={key} className="flex gap-2">
						<dt className="shrink-0 font-mono text-muted-foreground text-xs">
							{key}
						</dt>
						<dd className="break-all font-mono text-xs">
							{typeof metadata[key] === "string"
								? String(metadata[key])
								: JSON.stringify(metadata[key])}
						</dd>
					</div>
				))}
			</dl>
			<button
				type="button"
				className="text-muted-foreground text-xs underline-offset-4 hover:underline"
				onClick={() => setOpen(false)}
			>
				Collapse
			</button>
		</div>
	);
}

export function AuditPage() {
	const navigate = useNavigate();
	const search = useSearch({ from: "/audit" });

	const input = {
		operatorId: search.operatorId ?? "",
		action: search.action ?? "",
		targetId: search.targetId ?? "",
	};

	const query = useAdminQuery(adminAuditQueryOptions(getRowCatClient(), input));

	const setFilter = (patch: Record<string, string | undefined>) =>
		navigate({
			to: "/audit",
			search: (previous) => ({ ...previous, ...patch }),
			replace: true,
		});

	/** A listed prefix shows in the select; otherwise it reads "All actions" but the value is kept. */
	const knownPrefix = ACTION_PREFIXES.some((p) => p.value === input.action)
		? input.action
		: "";

	return (
		<PageEnter className="space-y-4">
			<PageHeader
				title="Audit"
				description="A record of privileged operations. Newest first; it can't be edited or deleted."
			/>

			<FilterBar>
				<FilterSelect
					label="Action"
					value={knownPrefix}
					options={ACTION_PREFIXES}
					onChange={(value) => setFilter({ action: value || undefined })}
				/>
				<FilterSearch
					label="Operator ID"
					value={input.operatorId}
					placeholder="Member ID"
					onSubmit={(value) => setFilter({ operatorId: value || undefined })}
				/>
				<FilterSearch
					label="Target ID"
					value={input.targetId}
					placeholder="Member, story or switch key"
					onSubmit={(value) => setFilter({ targetId: value || undefined })}
				/>
			</FilterBar>

			<QueryState
				query={query}
				empty={{
					title: "No records match",
					description:
						"The action filter matches by prefix: `ops.` alone shows every operations settings change.",
					when: (data) => data.items.length === 0,
				}}
			>
				{(data) => (
					<DataTable<AuditLogEntryDto>
						caption="Audit records"
						rows={data.items}
						rowKey={(row) => row.id}
						columns={[
							{
								key: "createdAt",
								header: "Time",
								render: (row) => (
									<span
										className="whitespace-nowrap"
										title={formatDateTime(row.createdAt)}
									>
										{formatRelative(row.createdAt)}
									</span>
								),
							},
							{
								key: "operator",
								header: "Operator",
								render: (row) =>
									row.operatorMemberId ? (
										<Link
											to="/members/$memberId"
											params={{ memberId: row.operatorMemberId }}
											className="underline-offset-4 hover:underline"
											title={row.operatorMemberId}
										>
											{row.operatorNickname ?? shortId(row.operatorMemberId)}
										</Link>
									) : (
										/**
										 * A departed operator: the record stays and only the identity is gone; not hiding that
										 * row is what an audit record means.
										 */
										<span className="text-muted-foreground text-xs">
											Departed operator
										</span>
									),
							},
							{
								key: "action",
								header: "Action",
								render: (row) => (
									<Badge variant="outline" className="font-mono text-xs">
										{row.action}
									</Badge>
								),
							},
							{
								key: "target",
								header: "Target",
								hideBelow: "sm",
								render: (row) => (
									<button
										type="button"
										className="text-left font-mono text-xs underline-offset-4 hover:underline"
										title={row.targetId}
										onClick={() => setFilter({ targetId: row.targetId })}
									>
										{row.targetType}/{shortId(row.targetId)}
									</button>
								),
							},
							{
								key: "metadata",
								header: "Details",
								hideBelow: "md",
								render: (row) => <MetadataCell metadata={row.metadata} />,
							},
						]}
					/>
				)}
			</QueryState>
		</PageEnter>
	);
}
