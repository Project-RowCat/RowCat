import {
	type AdminMobileUpdateDetailDto,
	type AdminMobileUpdateEventDto,
	type AdminMobileUpdateJobDto,
	MOBILE_UPDATE_REASON_MAX_LENGTH,
} from "@rowcat/contracts";
import {
	adminMobileUpdateJobsConfigQueryOptions,
	adminMobileUpdateQueryOptions,
	adminMobileUpdateTransitionMutationOptions,
	type MobileUpdateTransitionInput,
	viewerQueryOptions,
} from "@rowcat/query";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Button, buttonVariants } from "@rowcat/ui-web/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@rowcat/ui-web/components/card";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { DataTable } from "#/components/data-table.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { QueryState } from "#/components/states.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { formatCount, formatDateTime, shortId } from "#/lib/format.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { useAdminQuery } from "#/lib/query/use-admin-query.ts";
import {
	CHANNEL_LABEL,
	EVENT_LABEL,
	JOB_KIND_LABEL,
	JOB_STATUS_LABEL,
	JOB_STATUS_TONE,
	PLATFORM_LABEL,
	releaseActions,
	STATUS_LABEL,
	STATUS_TONE,
} from "./mobile-update-view.ts";
import { RollbackDialog } from "./rollback-dialog.tsx";

/**
 * One release: identity, rollout, relations, history, and what can be pressed right now.
 *
 * Only actions the server's transition table allows are drawn (`releaseActions`). The percentage
 * input only raises; the operation that stops new installs is pause. Saying so is this card's job:
 * an operator who believes lowering the percentage brings people back escalates the incident on
 * that belief.
 *
 * History is append-only; the server has no edit or delete operation for it.
 */

function Fact({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex justify-between gap-3">
			<dt className="shrink-0 whitespace-nowrap text-muted-foreground">
				{label}
			</dt>
			<dd className="min-w-0 break-all text-right">{children}</dd>
		</div>
	);
}

const mono = (value: string) => (
	<span className="font-mono text-xs">{value}</span>
);

function Facts({ detail }: { detail: AdminMobileUpdateDetailDto }) {
	const { release } = detail;
	return (
		<div className="grid gap-4 lg:grid-cols-3">
			<Card>
				<CardHeader>
					<CardTitle className="text-sm">Identity</CardTitle>
				</CardHeader>
				<CardContent>
					<dl className="space-y-2 text-sm">
						<Fact label="Release">{mono(release.id)}</Fact>
						<Fact label="Kind">
							{release.kind === "update"
								? "Update"
								: "Rollback to store bundle"}
						</Fact>
						<Fact label="Channel">{CHANNEL_LABEL[release.channel]}</Fact>
						<Fact label="Platform">{PLATFORM_LABEL[release.platform]}</Fact>
						<Fact label="Runtime">{mono(release.runtimeVersion)}</Fact>
						<Fact label="Commit">{mono(release.sourceCommit)}</Fact>
					</dl>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle className="text-sm">Distribution</CardTitle>
				</CardHeader>
				<CardContent>
					<dl className="space-y-2 text-sm">
						<Fact label="Status">
							<Badge variant={STATUS_TONE[release.status]}>
								{STATUS_LABEL[release.status]}
							</Badge>
						</Fact>
						<Fact label="Percentage">
							<span className="tabular">{release.rolloutPercentage}%</span>
						</Fact>
						<Fact label="API origin">{mono(release.apiOrigin)}</Fact>
						<Fact label="Signed at">{formatDateTime(release.createdAt)}</Fact>
						<Fact label="Registered at">
							{formatDateTime(release.registeredAt)}
						</Fact>
						<Fact label="Signing keys">{mono(release.keyIds.join(", "))}</Fact>
						<Fact label="Assets">
							{formatCount(detail.assets.count)} ·{" "}
							{formatCount(detail.assets.bytes)} B
						</Fact>
					</dl>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle className="text-sm">Relations</CardTitle>
				</CardHeader>
				<CardContent>
					<dl className="space-y-2 text-sm">
						<Fact label="Republish source">
							{release.republishOf ? (
								<Link
									to="/mobile-updates/$releaseId"
									params={{ releaseId: release.republishOf }}
									className="font-mono text-xs underline"
								>
									{shortId(release.republishOf)}
								</Link>
							) : (
								"—"
							)}
						</Fact>
					</dl>
				</CardContent>
			</Card>
		</div>
	);
}

type Pending =
	| { action: "rollout"; percentage: number }
	| { action: "pause" }
	| { action: "resume" }
	| null;

function Operations({ detail }: { detail: AdminMobileUpdateDetailDto }) {
	const { release } = detail;
	const navigate = useNavigate();
	const client = getRowCatClient();
	const queryClient = useQueryClient();
	const viewerQuery = useAdminQuery(viewerQueryOptions(client));
	const configQuery = useAdminQuery(
		adminMobileUpdateJobsConfigQueryOptions(client),
	);
	/**
	 * Rollback is signed by CI, so when this deployment cannot reach that channel's CI we point at the
	 * CLI instead of drawing a button that would get a 503. This is not authorization; the server
	 * makes the same decision.
	 */
	const ciServes =
		configQuery.data?.available === true &&
		configQuery.data.channels.includes(release.channel);
	const base = releaseActions(release, viewerQuery.data);
	const actions = { ...base, rollback: base.rollback && ciServes };
	const rollbackByCli =
		base.rollback && configQuery.data !== undefined && !ciServes;
	const [pending, setPending] = useState<Pending>(null);
	const [rollbackOpen, setRollbackOpen] = useState(false);
	const transition = useMutation(
		adminMobileUpdateTransitionMutationOptions(client, queryClient, release.id),
	);

	const none =
		actions.rolloutSteps.length === 0 &&
		!actions.pause &&
		!actions.resume &&
		!actions.rollback &&
		!rollbackByCli;

	const confirm = (reason: string) => {
		if (!pending) return;
		const input: MobileUpdateTransitionInput =
			pending.action === "rollout"
				? { action: "rollout", percentage: pending.percentage, reason }
				: { action: pending.action, reason };
		transition.mutate(input, { onSuccess: () => setPending(null) });
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-sm">Operations</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				{none ? (
					<p className="text-muted-foreground text-sm">
						{viewerQuery.data &&
						!actions.rollback &&
						release.status !== "rolled_back"
							? "Changing the percentage requires the admin role."
							: "There are no operations available for this release now."}
					</p>
				) : null}
				{actions.rolloutSteps.length > 0 ? (
					<div className="flex flex-wrap items-center gap-2">
						{actions.rolloutSteps.map((step) => (
							<Button
								key={step}
								size="sm"
								variant="outline"
								onClick={() =>
									setPending({ action: "rollout", percentage: step })
								}
							>
								Expand to {step}%
							</Button>
						))}
						<span className="text-muted-foreground text-xs">
							The percentage never shrinks: to stop new installs, pause.
						</span>
					</div>
				) : null}
				<div className="flex flex-wrap gap-2">
					{actions.pause ? (
						<Button
							size="sm"
							variant="destructive"
							onClick={() => setPending({ action: "pause" })}
						>
							Pause
						</Button>
					) : null}
					{actions.resume ? (
						<Button size="sm" onClick={() => setPending({ action: "resume" })}>
							Resume at {release.rolloutPercentage}%
						</Button>
					) : null}
					{actions.rollback ? (
						<Button
							size="sm"
							variant="outline"
							className="ml-auto"
							onClick={() => setRollbackOpen(true)}
						>
							Roll back
						</Button>
					) : null}
				</div>
				{rollbackByCli ? (
					<p className="text-muted-foreground text-xs">
						This deployment isn't connected to the publishing CI for the{" "}
						{CHANNEL_LABEL[release.channel]} channel. To roll back devices that
						already have it, run this where the signing key is:{" "}
						<code className="font-mono">
							pnpm mobile:update rollback {release.id} --reason "…"
						</code>
						. Stopping the spread right now is a pause.
					</p>
				) : null}
			</CardContent>

			<ConfirmDialog
				open={pending !== null}
				onOpenChange={(open) => {
					if (!open) {
						setPending(null);
						transition.reset();
					}
				}}
				title={
					pending?.action === "rollout"
						? `Expand to ${pending.percentage}%`
						: pending?.action === "pause"
							? "Pause release"
							: "Resume release"
				}
				target={
					<>
						{release.id}
						<br />
						{CHANNEL_LABEL[release.channel]} ·{" "}
						{PLATFORM_LABEL[release.platform]} · {release.runtimeVersion} · now{" "}
						{STATUS_LABEL[release.status]} {release.rolloutPercentage}%
					</>
				}
				consequence={
					pending?.action === "rollout" ? (
						<p>
							{release.rolloutPercentage}% → {pending.percentage}%. Installs
							that already have it keep it, and newly asking installs are added.
							Installs that receive it run it on the next cold start.{" "}
							<strong>This percentage can't be lowered again.</strong>
						</p>
					) : pending?.action === "pause" ? (
						<p>
							Newly asking installs won't receive this release.{" "}
							<strong>Devices that already downloaded it don't go back.</strong>{" "}
							To return those devices too, a rollback is needed.
						</p>
					) : (
						<p>
							It goes out again at the paused percentage (
							{release.rolloutPercentage}%). The same install gets the same
							answer.
						</p>
					)
				}
				confirmLabel={
					pending?.action === "rollout"
						? "Expand"
						: pending?.action === "pause"
							? "Pause"
							: "Resume"
				}
				destructive={pending?.action === "pause"}
				requireReason={pending?.action === "pause"}
				reasonMaxLength={MOBILE_UPDATE_REASON_MAX_LENGTH}
				reasonPlaceholder="What went wrong"
				pending={transition.isPending}
				error={transition.error}
				onConfirm={confirm}
			/>

			<RollbackDialog
				release={release}
				open={rollbackOpen}
				onOpenChange={setRollbackOpen}
				onRequested={(jobId) =>
					navigate({ to: "/mobile-updates/jobs/$jobId", params: { jobId } })
				}
			/>
		</Card>
	);
}

function History({ events }: { events: AdminMobileUpdateEventDto[] }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-sm">History</CardTitle>
			</CardHeader>
			<CardContent>
				<DataTable<AdminMobileUpdateEventDto>
					caption="Release history"
					rows={events}
					rowKey={(row) => row.id}
					columns={[
						{
							key: "at",
							header: "Time",
							render: (row) => formatDateTime(row.createdAt),
						},
						{
							key: "action",
							header: "Operation",
							render: (row) => EVENT_LABEL[row.action],
						},
						{
							key: "change",
							header: "Change",
							render: (row) => (
								<span className="tabular">
									{row.fromStatus ? STATUS_LABEL[row.fromStatus] : "∅"}{" "}
									{row.fromRollout ?? "∅"}% → {STATUS_LABEL[row.toStatus]}{" "}
									{row.toRollout}%
								</span>
							),
						},
						{
							key: "who",
							header: "Who",
							render: (row) =>
								row.operator ? (
									<Link
										to="/members/$memberId"
										params={{ memberId: row.operator.id }}
										className="underline"
									>
										{row.operator.nickname ?? "Departed operator"}
									</Link>
								) : (
									<span className="font-mono text-xs">{row.actor}</span>
								),
						},
						{
							key: "reason",
							header: "Reason",
							truncate: true,
							render: (row) => (
								<span className="truncate" title={row.reason}>
									{row.reason || "—"}
								</span>
							),
						},
					]}
				/>
			</CardContent>
		</Card>
	);
}

function RelatedJobs({ jobs }: { jobs: AdminMobileUpdateJobDto[] }) {
	if (jobs.length === 0) return null;
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-sm">Related jobs</CardTitle>
			</CardHeader>
			<CardContent>
				<ul className="space-y-1 text-sm">
					{jobs.map((job) => (
						<li key={job.id} className="flex items-center gap-2">
							<Link
								to="/mobile-updates/jobs/$jobId"
								params={{ jobId: job.id }}
								className="underline"
							>
								{JOB_KIND_LABEL[job.kind]} · {formatDateTime(job.createdAt)}
							</Link>
							<Badge variant={JOB_STATUS_TONE[job.status]}>
								{JOB_STATUS_LABEL[job.status]}
							</Badge>
						</li>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}

export function ReleaseDetailPage() {
	const { releaseId } = useParams({ from: "/mobile-updates/$releaseId" });
	const query = useAdminQuery(
		adminMobileUpdateQueryOptions(getRowCatClient(), releaseId),
	);
	return (
		<PageEnter className="space-y-4">
			<Link
				to="/mobile-updates"
				className={buttonVariants({ variant: "ghost", size: "sm" })}
			>
				<ArrowLeft className="size-4" /> Mobile updates
			</Link>
			<PageHeader
				title={`Release ${shortId(releaseId)}`}
				description={releaseId}
			/>
			<QueryState query={query}>
				{(detail) => (
					<div className="space-y-4">
						<Facts detail={detail} />
						<Operations detail={detail} />
						<RelatedJobs jobs={detail.jobs} />
						<History events={detail.events} />
					</div>
				)}
			</QueryState>
		</PageEnter>
	);
}
