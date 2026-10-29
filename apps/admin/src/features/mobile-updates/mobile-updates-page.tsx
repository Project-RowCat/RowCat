import {
	type AdminMobileUpdateJobDto,
	type AdminMobileUpdateReleaseDto,
	MobileUpdateChannel,
	MobileUpdatePlatform,
	MobileUpdateStatus,
} from "@rowcat/contracts";
import {
	adminMobileUpdateJobsConfigQueryOptions,
	adminMobileUpdateJobsInfiniteQueryOptions,
	adminMobileUpdatesInfiniteQueryOptions,
	moderationPageRows,
	viewerQueryOptions,
} from "@rowcat/query";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Button } from "@rowcat/ui-web/components/button";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { DataTable } from "#/components/data-table.tsx";
import {
	FilterBar,
	FilterSearch,
	FilterSelect,
} from "#/components/filter-bar.tsx";
import { LoadMore } from "#/components/load-more.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { QueryState } from "#/components/states.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { formatDateTime, formatRelative, shortId } from "#/lib/format.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { useAdminInfiniteQuery } from "#/lib/query/use-admin-infinite-query.ts";
import { useAdminQuery } from "#/lib/query/use-admin-query.ts";
import {
	CHANNEL_LABEL,
	can,
	JOB_KIND_LABEL,
	JOB_STATUS_LABEL,
	JOB_STATUS_TONE,
	PLATFORM_LABEL,
	STATUS_LABEL,
	STATUS_TONE,
	shortCommit,
} from "./mobile-update-view.ts";
import { PublishDialog } from "./publish-dialog.tsx";

/**
 * Mobile updates: what mobile code is out, how far it has spread, and what can safely be done now.
 *
 * - Not a JS uploader, manifest editor, CDN browser or signing-key manager. A new publish is a
 *   request naming a commit; CI builds and signs, so there is no file picker here.
 * - Jobs (is CI running — minutes) sit above releases (what is out — days), since the requester
 *   wants the job first.
 * - Not a section of `/operations`: this deploys remote code, not something someone flipping a
 *   feature switch should scroll into.
 */

const ALL = { value: "", label: "All" };

const CHANNEL_OPTIONS = [
	ALL,
	...MobileUpdateChannel.options.map((value) => ({
		value,
		label: CHANNEL_LABEL[value],
	})),
];
const PLATFORM_OPTIONS = [
	ALL,
	...MobileUpdatePlatform.options.map((value) => ({
		value,
		label: PLATFORM_LABEL[value],
	})),
];
const STATUS_OPTIONS = [
	ALL,
	...MobileUpdateStatus.options.map((value) => ({
		value,
		label: STATUS_LABEL[value],
	})),
];

function JobsSection() {
	const navigate = useNavigate();
	const query = useAdminInfiniteQuery(
		adminMobileUpdateJobsInfiniteQueryOptions(getRowCatClient()),
	);
	return (
		<section aria-labelledby="ota-jobs" className="space-y-2">
			<h2 id="ota-jobs" className="font-medium text-sm">
				OTA jobs
			</h2>
			<QueryState
				query={query}
				empty={{
					title: "No jobs requested",
					description:
						"Request a new OTA release or a rollback and the CI run's state shows here.",
					when: (data) => moderationPageRows(data).length === 0,
				}}
			>
				{(data) => (
					<>
						<DataTable<AdminMobileUpdateJobDto>
							caption="OTA jobs"
							rows={moderationPageRows(data)}
							rowKey={(row) => row.id}
							onRowClick={(row) =>
								navigate({
									to: "/mobile-updates/jobs/$jobId",
									params: { jobId: row.id },
								})
							}
							columns={[
								{
									key: "kind",
									header: "Job",
									render: (row) => (
										<span>
											{JOB_KIND_LABEL[row.kind]}{" "}
											<span className="text-muted-foreground text-xs">
												{CHANNEL_LABEL[row.channel]} ·{" "}
												{PLATFORM_LABEL[row.platform]}
											</span>
										</span>
									),
								},
								{
									key: "source",
									header: "Source",
									hideBelow: "sm",
									render: (row) => (
										<span className="font-mono text-xs">
											{row.sourceCommit
												? shortCommit(row.sourceCommit)
												: row.source?.kind === "branch"
													? row.source.branch
													: row.source?.kind === "commit"
														? shortCommit(row.source.sha)
														: row.targetReleaseId
															? `← ${shortId(row.targetReleaseId)}`
															: "—"}
										</span>
									),
								},
								{
									key: "status",
									header: "Status",
									render: (row) => (
										<Badge variant={JOB_STATUS_TONE[row.status]}>
											{JOB_STATUS_LABEL[row.status]}
										</Badge>
									),
								},
								{
									key: "createdAt",
									header: "Requested",
									hideBelow: "md",
									render: (row) => (
										<span title={formatDateTime(row.createdAt)}>
											{formatRelative(row.createdAt)}
										</span>
									),
								},
							]}
						/>
						<LoadMore nextPage={query.nextPage} noun="jobs" />
					</>
				)}
			</QueryState>
		</section>
	);
}

export function MobileUpdatesPage() {
	const navigate = useNavigate();
	const search = useSearch({ from: "/mobile-updates" });
	const [publishOpen, setPublishOpen] = useState(false);

	const client = getRowCatClient();
	const viewerQuery = useAdminQuery(viewerQueryOptions(client));
	const configQuery = useAdminQuery(
		adminMobileUpdateJobsConfigQueryOptions(client),
	);
	const canPublish = can(viewerQuery.data, "publish");
	const ciAvailable = configQuery.data?.available === true;

	const channel = MobileUpdateChannel.safeParse(search.channel);
	const platform = MobileUpdatePlatform.safeParse(search.platform);
	const status = MobileUpdateStatus.safeParse(search.status);
	const input = {
		channel: channel.success ? channel.data : ("" as const),
		platform: platform.success ? platform.data : ("" as const),
		status: status.success ? status.data : ("" as const),
		runtimeVersion: search.runtime ?? "",
	};

	const releases = useAdminInfiniteQuery(
		adminMobileUpdatesInfiniteQueryOptions(client, input),
	);

	const setFilter = (patch: Record<string, string | undefined>) =>
		navigate({
			to: "/mobile-updates",
			// A default axis is passed as an explicit `undefined`; omitting it keeps the previous value.
			search: (previous) => ({ ...previous, ...patch }),
			replace: true,
		});

	return (
		<PageEnter className="space-y-6">
			<PageHeader
				title="Mobile updates"
				description="Signed OTA releases and their rollout. CI builds and signs the code from a repository commit; this screen only requests intent."
				actions={
					canPublish && ciAvailable ? (
						<Button size="sm" onClick={() => setPublishOpen(true)}>
							New OTA release
						</Button>
					) : null
				}
			/>

			{configQuery.data && !configQuery.data.available ? (
				<p className="rounded-lg border border-border border-dashed p-3 text-muted-foreground text-sm">
					This deployment has no publishing CI connected. Reading releases,
					rollout, pause and resume work here; publishing and rollback go
					through the CLI (<code className="font-mono">pnpm mobile:update</code>
					).
				</p>
			) : !canPublish && viewerQuery.data ? (
				<p className="rounded-lg border border-border border-dashed p-3 text-muted-foreground text-sm">
					Changing percentages and requesting publishes requires the admin role.
					You can read the current state and history.
				</p>
			) : null}

			<JobsSection />

			<section aria-labelledby="ota-releases" className="space-y-2">
				<h2 id="ota-releases" className="font-medium text-sm">
					Releases
				</h2>
				<FilterBar>
					<FilterSelect
						label="Channel"
						value={input.channel}
						options={CHANNEL_OPTIONS}
						onChange={(value) => setFilter({ channel: value || undefined })}
					/>
					<FilterSelect
						label="Platform"
						value={input.platform}
						options={PLATFORM_OPTIONS}
						onChange={(value) => setFilter({ platform: value || undefined })}
					/>
					<FilterSelect
						label="Status"
						value={input.status}
						options={STATUS_OPTIONS}
						onChange={(value) => setFilter({ status: value || undefined })}
					/>
					<FilterSearch
						label="Runtime"
						value={input.runtimeVersion}
						placeholder="rowcat-native-7"
						onSubmit={(value) => setFilter({ runtime: value || undefined })}
					/>
				</FilterBar>

				<QueryState
					query={releases}
					empty={{
						title: "No releases match",
						description:
							"Only releases on channels registered with this deployment show: TestFlight releases are in the Sandbox deployment.",
						when: (data) => moderationPageRows(data).length === 0,
					}}
				>
					{(data) => (
						<>
							<DataTable<AdminMobileUpdateReleaseDto>
								caption="OTA releases"
								rows={moderationPageRows(data)}
								rowKey={(row) => row.id}
								onRowClick={(row) =>
									navigate({
										to: "/mobile-updates/$releaseId",
										params: { releaseId: row.id },
									})
								}
								columns={[
									{
										key: "release",
										header: "Release",
										render: (row) => (
											<div className="flex items-center gap-2">
												<span className="font-mono text-xs" title={row.id}>
													{shortId(row.id)}
												</span>
												{row.kind === "rollback_to_embedded" ? (
													<Badge variant="outline">To store bundle</Badge>
												) : row.republishOf ? (
													<Badge variant="outline">Republish</Badge>
												) : null}
											</div>
										),
									},
									{
										key: "stream",
										header: "Channel · platform",
										render: (row) =>
											`${CHANNEL_LABEL[row.channel]} · ${PLATFORM_LABEL[row.platform]}`,
									},
									{
										key: "runtime",
										header: "Runtime",
										hideBelow: "md",
										render: (row) => (
											<span className="font-mono text-xs">
												{row.runtimeVersion}
											</span>
										),
									},
									{
										key: "commit",
										header: "Commit",
										hideBelow: "sm",
										render: (row) => (
											<span
												className="font-mono text-xs"
												title={row.sourceCommit}
											>
												{shortCommit(row.sourceCommit)}
											</span>
										),
									},
									{
										key: "createdAt",
										header: "Signed at",
										hideBelow: "md",
										render: (row) => formatDateTime(row.createdAt),
									},
									{
										key: "status",
										header: "Status",
										render: (row) => (
											<Badge variant={STATUS_TONE[row.status]}>
												{STATUS_LABEL[row.status]}
											</Badge>
										),
									},
									{
										key: "rollout",
										header: "Percentage",
										numeric: true,
										render: (row) => (
											<span className="tabular">{row.rolloutPercentage}%</span>
										),
									},
								]}
							/>
							<LoadMore nextPage={releases.nextPage} noun="releases" />
						</>
					)}
				</QueryState>
			</section>

			{configQuery.data && canPublish && ciAvailable ? (
				<PublishDialog
					open={publishOpen}
					onOpenChange={setPublishOpen}
					config={configQuery.data}
					onRequested={(jobId) =>
						navigate({
							to: "/mobile-updates/jobs/$jobId",
							params: { jobId },
						})
					}
				/>
			) : null}
		</PageEnter>
	);
}
