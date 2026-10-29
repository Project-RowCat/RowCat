import type { AdminOverviewDto } from "@rowcat/contracts";
import { adminOverviewQueryOptions } from "@rowcat/query";
import { Badge } from "@rowcat/ui-web/components/badge";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@rowcat/ui-web/components/card";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PageHeader } from "#/components/page-header.tsx";
import { QueryState } from "#/components/states.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { formatCount, formatDuration } from "#/lib/format.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { useAdminQuery } from "#/lib/query/use-admin-query.ts";

/**
 * Overview: draws measured values only.
 *
 * - No composite score, health or engagement cards — such numbers answer no question while
 *   operators judge by them without knowing what they are a function of.
 * - No charts: these values are a current snapshot and the server has no time series, so a trend
 *   graph would be decoration (the same call as creator analytics).
 * - Failure is never drawn as zero; `QueryState` owns that ordering. "0 open reports" is a claim
 *   we cannot make when the lookup failed, and an operator would read the queue as empty.
 * - Numbers are not abbreviated: `12.4K` makes 12,400 and 12,449 identical, and "1.2K open"
 *   cannot be compared day to day.
 */

function MetricCard({
	label,
	value,
	tone,
	hint,
	to,
}: {
	label: string;
	value: ReactNode;
	/** Whether the value itself demands attention; the color is severity, not decoration. */
	tone?: "default" | "warn" | "danger";
	hint?: string;
	to?: string;
}) {
	const body = (
		<div className="space-y-0.5">
			<p className="text-muted-foreground text-xs">{label}</p>
			<p
				className={`tabular font-semibold text-2xl ${
					tone === "danger"
						? "text-destructive"
						: tone === "warn"
							? "text-amber-600 dark:text-amber-500"
							: ""
				}`}
			>
				{value}
			</p>
			{hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
		</div>
	);

	if (!to)
		return <div className="rounded-lg border border-border p-3">{body}</div>;
	return (
		<Link
			to={to}
			className="block rounded-lg border border-border p-3 transition-colors hover:bg-muted/40"
		>
			{body}
		</Link>
	);
}

function ServiceRow({
	health,
}: {
	health: AdminOverviewDto["service"]["health"];
}) {
	return (
		<div className="flex flex-wrap gap-2">
			{health.map((item) => (
				<Badge
					key={item.name}
					variant={item.status === "ok" ? "secondary" : "destructive"}
					className="gap-1.5 font-mono"
				>
					<span
						className={`size-1.5 rounded-full ${
							item.status === "ok" ? "bg-emerald-500" : "bg-destructive"
						}`}
						aria-hidden
					/>
					{item.name}
					{item.latencyMs !== null ? (
						<span className="text-muted-foreground">{item.latencyMs}ms</span>
					) : null}
				</Badge>
			))}
		</div>
	);
}

export function OverviewPage() {
	const query = useAdminQuery(adminOverviewQueryOptions(getRowCatClient()));

	return (
		<PageEnter className="space-y-5">
			<PageHeader
				title="Overview"
				description="What state the service is in now, and what is piling up."
			/>

			<QueryState query={query} loadingRows={4}>
				{(data) => (
					<div className="space-y-5">
						<Card>
							<CardHeader>
								<CardTitle className="text-sm">Service</CardTitle>
							</CardHeader>
							<CardContent className="space-y-3">
								<ServiceRow health={data.service.health} />
								{/**
								 * Labels sit next to their values. `justify-between` per cell would
								 * push them to opposite edges on wide screens, leaving a wide gap
								 * the eye has to jump to pair `Environment` with `development`; the three
								 * values are short, so they just flow.
								 */}
								<dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
									<div className="flex gap-2">
										<dt className="text-muted-foreground">Environment</dt>
										<dd className="font-mono">{data.service.environment}</dd>
									</div>
									<div className="flex gap-2">
										<dt className="text-muted-foreground">API</dt>
										<dd className="font-mono">{data.service.apiVersion}</dd>
									</div>
									<div className="flex gap-2">
										<dt className="text-muted-foreground">Uptime</dt>
										<dd className="tabular">
											{formatDuration(data.service.uptimeSeconds)}
										</dd>
									</div>
								</dl>
							</CardContent>
						</Card>

						<Card>
							<CardHeader>
								<CardTitle className="text-sm">Moderation</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
									<MetricCard
										label="Open reports"
										value={formatCount(data.moderation.openReports)}
										tone={data.moderation.openReports > 0 ? "warn" : "default"}
										to="/moderation"
									/>
									<MetricCard
										label="Open cases"
										value={formatCount(data.moderation.openCases)}
									/>
									<MetricCard
										label="Open appeals"
										value={formatCount(data.moderation.openAppeals)}
										tone={data.moderation.openAppeals > 0 ? "warn" : "default"}
										to="/moderation/appeals"
									/>
									{/**
									 * This value comes before the count: twenty reports that just
									 * arrived and three open for four days are different situations
									 * the count alone cannot tell apart.
									 */}
									<MetricCard
										label="Oldest report"
										value={
											data.moderation.oldestOpenReportAgeHours === null
												? "—"
												: `${formatCount(data.moderation.oldestOpenReportAgeHours)} hours`
										}
										tone={
											(data.moderation.oldestOpenReportAgeHours ?? 0) > 48
												? "danger"
												: "default"
										}
										hint={
											data.moderation.oldestOpenReportAgeHours === null
												? "No open reports"
												: undefined
										}
									/>
								</div>
							</CardContent>
						</Card>

						<Card>
							<CardHeader>
								<CardTitle className="text-sm">Product</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
									<MetricCard
										label="Members"
										value={formatCount(data.product.members)}
										to="/members"
									/>
									<MetricCard
										label="Sanctioned accounts"
										value={formatCount(data.product.suspendedMembers)}
									/>
									<MetricCard
										label="New in 7 days"
										value={formatCount(data.product.newMembersLast7Days)}
									/>
									<MetricCard
										label="Stories"
										value={formatCount(data.product.stories)}
										to="/stories"
									/>
									<MetricCard
										label="Hidden stories"
										value={formatCount(data.product.hiddenStories)}
									/>
								</div>
							</CardContent>
						</Card>
					</div>
				)}
			</QueryState>
		</PageEnter>
	);
}
