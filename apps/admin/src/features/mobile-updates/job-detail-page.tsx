import {
	type AdminMobileUpdateJobDto,
	MOBILE_UPDATE_JOB_FAILURE_LABEL,
	MOBILE_UPDATE_REASON_MAX_LENGTH,
} from "@rowcat/contracts";
import { isMobileUpdateJobActive } from "@rowcat/domain";
import {
	adminMobileUpdateCancelJobMutationOptions,
	adminMobileUpdateJobQueryOptions,
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
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { QueryState } from "#/components/states.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { formatDateTime, shortId } from "#/lib/format.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { useAdminQuery } from "#/lib/query/use-admin-query.ts";
import {
	CHANNEL_LABEL,
	can,
	JOB_KIND_LABEL,
	JOB_STATUS_LABEL,
	JOB_STATUS_TONE,
	PLATFORM_LABEL,
	STAGE_LABEL,
} from "./mobile-update-view.ts";

/**
 * One OTA job: how far CI got and what it produced.
 *
 * - No progress percentage: CI reports coarse states and the failed stage, and an invented
 *   percent is the first lie believed during an incident. Details live on the CI run page (linked,
 *   no token).
 * - Result releases are ids the server confirmed against the registration table, not what CI
 *   claimed; if confirmation fails the job ends unconfirmed and the operator checks the list.
 * - A production publish ends as a draft; raising its rollout on the release is a separate step.
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

const ReleaseLink = ({ id }: { id: string }) => (
	<Link
		to="/mobile-updates/$releaseId"
		params={{ releaseId: id }}
		className="font-mono text-xs underline"
	>
		{shortId(id)}
	</Link>
);

function JobView({ job }: { job: AdminMobileUpdateJobDto }) {
	const client = getRowCatClient();
	const queryClient = useQueryClient();
	const viewerQuery = useAdminQuery(viewerQueryOptions(client));
	const [cancelOpen, setCancelOpen] = useState(false);
	const cancel = useMutation(
		adminMobileUpdateCancelJobMutationOptions(client, queryClient, job.id),
	);
	const canCancel = job.status === "queued" && can(viewerQuery.data, "publish");

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-sm">
						{JOB_KIND_LABEL[job.kind]} · {CHANNEL_LABEL[job.channel]} ·{" "}
						{PLATFORM_LABEL[job.platform]}
						<Badge variant={JOB_STATUS_TONE[job.status]}>
							{JOB_STATUS_LABEL[job.status]}
						</Badge>
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					{job.status === "failed" && job.failure ? (
						<div
							role="alert"
							className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
						>
							<p className="font-medium">
								{MOBILE_UPDATE_JOB_FAILURE_LABEL[job.failure.code]}
							</p>
							{job.failure.stage ? (
								<p className="mt-1 text-muted-foreground text-xs">
									Stopped at stage: {STAGE_LABEL[job.failure.stage]}
								</p>
							) : null}
						</div>
					) : null}

					{isMobileUpdateJobActive(job.status) ? (
						<output className="block text-muted-foreground text-sm">
							{job.status === "queued"
								? "Requested from CI. It becomes running once CI settles the source commit; nothing is signed yet."
								: "CI is running. The result is written here when it finishes."}
						</output>
					) : null}

					{job.status === "succeeded" ? (
						<div className="space-y-1 text-sm">
							{job.resultReleaseIds.length === 0 ? (
								<p>
									Rolled back a release that was a draft: no installs had it, so
									no recovery release was issued.
								</p>
							) : (
								<p>
									Result release:{" "}
									{job.resultReleaseIds.map((id) => (
										<ReleaseLink key={id} id={id} />
									))}
								</p>
							)}
							{job.kind === "publish" && job.initialRollout === null ? (
								<p className="text-muted-foreground">
									Registered as a draft: it goes to nobody. Check the release,
									then raise the percentage from there.
								</p>
							) : null}
						</div>
					) : null}

					<dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
						<Fact label="Job">
							<span className="font-mono text-xs">{job.id}</span>
						</Fact>
						<Fact label="Requested by">
							{job.requestedBy ? (
								<Link
									to="/members/$memberId"
									params={{ memberId: job.requestedBy.id }}
									className="underline"
								>
									{job.requestedBy.nickname ?? "Departed operator"}
								</Link>
							) : (
								"Departed operator"
							)}
						</Fact>
						{job.kind === "publish" ? (
							<>
								<Fact label="Requested source">
									<span className="font-mono text-xs">
										{job.source?.kind === "branch"
											? `${job.source.branch} branch`
											: job.source?.kind === "commit"
												? job.source.sha
												: "—"}
									</span>
								</Fact>
								<Fact label="Initial percentage">
									{job.initialRollout === null
										? "draft"
										: `${job.initialRollout}%`}
								</Fact>
								<Fact label="Update note">{job.noteId ?? "None"}</Fact>
							</>
						) : (
							<>
								<Fact label="Release to roll back">
									{job.targetReleaseId ? (
										<ReleaseLink id={job.targetReleaseId} />
									) : (
										"—"
									)}
								</Fact>
								<Fact label="Recovery direction">
									{job.toEmbedded
										? "To the store bundle"
										: "Previous good release (or the store bundle if none)"}
								</Fact>
							</>
						)}
						<Fact label="Settled commit">
							<span className="font-mono text-xs">
								{job.sourceCommit ?? "—"}
							</span>
						</Fact>
						<Fact label="Runtime">
							<span className="font-mono text-xs">
								{job.runtimeVersion ?? "—"}
							</span>
						</Fact>
						<Fact label="Requested">{formatDateTime(job.createdAt)}</Fact>
						<Fact label="Started">
							{job.startedAt ? formatDateTime(job.startedAt) : "—"}
						</Fact>
						<Fact label="Ended">
							{job.finishedAt ? formatDateTime(job.finishedAt) : "—"}
						</Fact>
						<Fact label="CI run">
							{job.externalRunUrl ? (
								<a
									href={job.externalRunUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1 underline"
								>
									Open <ExternalLink className="size-3" aria-hidden />
								</a>
							) : (
								"—"
							)}
						</Fact>
					</dl>
					<div className="text-sm">
						<p className="text-muted-foreground text-xs">Reason</p>
						<p className="whitespace-pre-wrap">{job.reason}</p>
					</div>
					{canCancel ? (
						<Button
							size="sm"
							variant="outline"
							onClick={() => setCancelOpen(true)}
						>
							Cancel job
						</Button>
					) : null}
				</CardContent>
			</Card>

			<ConfirmDialog
				open={cancelOpen}
				onOpenChange={(open) => {
					setCancelOpen(open);
					if (!open) cancel.reset();
				}}
				title="Cancel job"
				target={
					<>
						{job.id}
						<br />
						{JOB_KIND_LABEL[job.kind]} · {CHANNEL_LABEL[job.channel]} ·{" "}
						{PLATFORM_LABEL[job.platform]}
					</>
				}
				consequence={
					<p>
						CI hasn't reported starting this job yet. Cancelling makes it stop
						before signing even if CI starts: nothing is registered.
					</p>
				}
				confirmLabel="Cancel job"
				requireReason
				reasonMaxLength={MOBILE_UPDATE_REASON_MAX_LENGTH}
				pending={cancel.isPending}
				error={cancel.error}
				onConfirm={(reason) =>
					cancel.mutate(reason, { onSuccess: () => setCancelOpen(false) })
				}
			/>
		</div>
	);
}

export function JobDetailPage() {
	const { jobId } = useParams({ from: "/mobile-updates/jobs/$jobId" });
	const query = useAdminQuery(
		adminMobileUpdateJobQueryOptions(getRowCatClient(), jobId),
	);
	return (
		<PageEnter className="space-y-4">
			<Link
				to="/mobile-updates"
				className={buttonVariants({ variant: "ghost", size: "sm" })}
			>
				<ArrowLeft className="size-4" /> Mobile updates
			</Link>
			<PageHeader title={`OTA job ${shortId(jobId)}`} description={jobId} />
			<QueryState query={query}>{(job) => <JobView job={job} />}</QueryState>
		</PageEnter>
	);
}
