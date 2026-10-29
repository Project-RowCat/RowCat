import {
	type AdminMobileUpdateReleaseDto,
	MOBILE_UPDATE_REASON_MAX_LENGTH,
} from "@rowcat/contracts";
import {
	adminMobileUpdateRollbackMutationOptions,
	adminMobileUpdateRollbackPlanQueryOptions,
} from "@rowcat/query";
import { Checkbox } from "@rowcat/ui-web/components/checkbox";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { ErrorBlock, LoadingBlock } from "#/components/states.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { shortId } from "#/lib/format.ts";
import { useAdminQuery } from "#/lib/query/use-admin-query.ts";
import {
	CHANNEL_LABEL,
	PLATFORM_LABEL,
	RECOVERY_LABEL,
	STATUS_LABEL,
	shortCommit,
} from "./mobile-update-view.ts";

/**
 * Rollback: show the plan first; CI executes the request.
 *
 * This dialog only requests a rollback job. Marking the bad release `rolled_back` and signing and
 * registering the recovery release are done by CI's publisher, in that order — so if CI could not
 * be started, the dialog says the rollback did not start and no release has moved. Stopping the
 * spread right now is pause, which needs no signing key.
 *
 * The plan is re-fetched every time the dialog opens. If another release became active in between,
 * the server refuses the request and the dialog locks its confirm button.
 */
export function RollbackDialog({
	release,
	open,
	onOpenChange,
	onRequested,
}: {
	release: AdminMobileUpdateReleaseDto;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onRequested: (jobId: string) => void;
}) {
	const embeddedId = useId();
	const client = getRowCatClient();
	const queryClient = useQueryClient();
	const [toEmbedded, setToEmbedded] = useState(false);
	const plan = useAdminQuery({
		...adminMobileUpdateRollbackPlanQueryOptions(client, release.id),
		enabled: open,
	});
	const rollback = useMutation(
		adminMobileUpdateRollbackMutationOptions(client, queryClient, release.id),
	);

	useEffect(() => {
		if (!open) return;
		setToEmbedded(false);
		rollback.reset();
	}, [open, rollback.reset]);

	const data = plan.data;
	const blocked =
		!data || data.recovery === "blocked" || data.activeJob !== null;
	const recovery =
		data && data.recovery === "republish" && toEmbedded
			? "embedded"
			: data?.recovery;

	return (
		<ConfirmDialog
			open={open}
			onOpenChange={onOpenChange}
			title="Roll back"
			target={
				<>
					{release.id}
					<br />
					{CHANNEL_LABEL[release.channel]} · {PLATFORM_LABEL[release.platform]}{" "}
					· {release.runtimeVersion} · {STATUS_LABEL[release.status]}{" "}
					{release.rolloutPercentage}% · commit{" "}
					{shortCommit(release.sourceCommit)}
				</>
			}
			consequence={
				plan.isPending ? (
					<LoadingBlock rows={2} />
				) : plan.isError || !data ? (
					<ErrorBlock
						title="Couldn't read the rollback plan"
						error={plan.error}
						onRetry={plan.retry}
					/>
				) : (
					<div className="space-y-2">
						<p>
							<span className="text-muted-foreground">Recovery target </span>
							{data.previousGood && recovery === "republish" ? (
								<span className="font-mono text-xs">
									{shortId(data.previousGood.id)} · commit{" "}
									{shortCommit(data.previousGood.sourceCommit)}
								</span>
							) : recovery === "none" ? (
								"None"
							) : recovery === "blocked" ? (
								"—"
							) : (
								"The store binary's bundle"
							)}
						</p>
						{recovery ? <p>{RECOVERY_LABEL[recovery]}.</p> : null}
						{data.newerActive.length > 0 ? (
							<p className="text-destructive">
								A newer active release exists (
								{data.newerActive.map((r) => shortId(r.id)).join(", ")}) —
								clients already get it. Deal with that release first, or pausing
								this release is enough.
							</p>
						) : null}
						{data.activeJob ? (
							<p className="text-destructive">
								There is a job in progress for this channel and platform:{" "}
								<Link
									to="/mobile-updates/jobs/$jobId"
									params={{ jobId: data.activeJob.id }}
									className="underline"
								>
									View job
								</Link>
							</p>
						) : null}
						{data.recovery === "republish" ? (
							<label
								htmlFor={embeddedId}
								className="flex items-center gap-2 text-sm"
							>
								<Checkbox
									id={embeddedId}
									checked={toEmbedded}
									onCheckedChange={(next) => setToEmbedded(next === true)}
								/>
								Return to the store bundle instead of the previous OTA
							</label>
						) : null}
						<ul className="list-disc space-y-1 pl-5 text-muted-foreground">
							<li>This release no longer goes out to newly asking installs.</li>
							<li>
								Devices that already have it download the recovery release on
								the next cold start, and run it on the cold start after that; a
								running app doesn't change.
							</li>
							<li>
								CI does the signing. If CI fails to start, nothing changes.
							</li>
						</ul>
					</div>
				)
			}
			confirmLabel="Request rollback"
			requireReason
			reasonMaxLength={MOBILE_UPDATE_REASON_MAX_LENGTH}
			reasonPlaceholder="What went wrong"
			confirmDisabled={blocked}
			pending={rollback.isPending}
			error={rollback.error}
			onConfirm={(reason) =>
				rollback.mutate(
					{ reason, toEmbedded: recovery === "embedded" },
					{ onSuccess: (job) => onRequested(job.id) },
				)
			}
		/>
	);
}
