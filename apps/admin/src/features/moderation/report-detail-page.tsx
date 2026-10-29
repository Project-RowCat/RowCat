import {
	CAPABILITY_LABEL,
	MODERATION_ACTION_LABEL,
	type ModerationActionKind,
	type ModerationActionRequest,
	type ModerationCapability,
	type ModerationReportDetailDto,
	REPORT_LIMITS,
	REPORT_REASON_LABEL,
	REPORT_TARGET_LABEL,
} from "@rowcat/contracts";
import {
	invalidateAfterModeration,
	moderationReportQueryOptions,
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
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { QueryState } from "#/components/states.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { formatDateTime, shortId } from "#/lib/format.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { useAdminQuery } from "#/lib/query/use-admin-query.ts";
import { availableActions } from "./actions.ts";

/**
 * Report detail: where enforcement happens.
 *
 * It uses the existing API as-is — reads from `/v2/moderation/reports/:id`, enforcement through the
 * single `POST /v2/moderation/actions`. Not building a second enforcement path is this screen's
 * most important property: an action taken through one would be absent from the audit ledger and
 * leave the sanctioned person nothing to appeal.
 *
 * Three things are drawn apart:
 *
 * ```text
 * evidence  the snapshot at report time (private conversation evidence lives here too)
 * current   the present state — it may already be edited or gone
 * actions   every action taken in this case so far
 * ```
 *
 * A null `current` is information (the comment was deleted or the story is gone), and the operator
 * needs it beside the snapshot, so the absence is stated rather than hidden.
 *
 * `ai_response` evidence is a private conversation the user explicitly submitted; the server holds
 * three things and this screen draws exactly those. There is no button to fetch more room history —
 * no such API exists, and none should.
 */

function EvidenceBlock({
	evidence,
}: {
	evidence: ModerationReportDetailDto["evidence"];
}) {
	if (evidence.type === "ai_response") {
		/**
		 * The evidence is exactly three things: the reported reply, the preceding message the reporter
		 * chose to include, and the model alias. History, memories, seed, lore and system prompt have no
		 * slot in the schema, hence no "more" button.
		 *
		 * The preceding message is optional and its absence is normal (the reporter left it out), so it
		 * is stated rather than hidden — hidden, the operator reads it as a truncated lookup.
		 */
		const { snapshot } = evidence;
		return (
			<div className="space-y-2">
				<p className="text-muted-foreground text-xs">
					Conversation excerpts the reporter submitted themself. The server has
					no conversation content beyond what this screen shows.
				</p>
				{snapshot.precedingUserMessage ? (
					<div className="rounded-md border border-border bg-muted/30 p-2">
						<p className="mb-1 font-medium text-muted-foreground text-xs">
							Preceding user message ·{" "}
							{formatDateTime(snapshot.precedingUserMessage.createdAt)}
						</p>
						<p className="whitespace-pre-wrap break-words text-sm">
							{snapshot.precedingUserMessage.content}
						</p>
					</div>
				) : (
					<p className="text-muted-foreground text-xs">
						The preceding user message was not submitted with it.
					</p>
				)}
				<div className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
					<p className="mb-1 font-medium text-muted-foreground text-xs">
						Reported AI response · {formatDateTime(snapshot.response.createdAt)}
					</p>
					<p className="whitespace-pre-wrap break-words text-sm">
						{snapshot.response.content}
					</p>
				</div>
				<p className="font-mono text-muted-foreground text-xs">
					Model: {snapshot.model ?? "Unknown"}
				</p>
			</div>
		);
	}

	if (evidence.type === "comment")
		return (
			<div className="rounded-md border border-border bg-muted/30 p-2">
				<p className="whitespace-pre-wrap break-words text-sm">
					{evidence.snapshot.body}
				</p>
			</div>
		);

	if (evidence.type === "story")
		return (
			<div className="space-y-1">
				<p className="font-medium text-sm">{evidence.snapshot.title}</p>
				<p className="whitespace-pre-wrap break-words text-muted-foreground text-sm">
					{evidence.snapshot.description}
				</p>
			</div>
		);

	return (
		<div className="space-y-1">
			<p className="font-medium text-sm">{evidence.snapshot.displayName}</p>
			<p className="whitespace-pre-wrap break-words text-muted-foreground text-sm">
				{evidence.snapshot.bio}
			</p>
		</div>
	);
}

function CurrentBlock({
	current,
}: {
	current: ModerationReportDetailDto["current"];
}) {
	if (!current)
		return (
			<p className="text-muted-foreground text-sm">
				This target can't be found now: it was already deleted or is gone.
			</p>
		);

	if (current.type === "story")
		return (
			<div className="space-y-2">
				<div className="flex flex-wrap items-center gap-2">
					<Link
						to="/stories/$storyId"
						params={{ storyId: current.id }}
						className="font-medium text-sm underline-offset-4 hover:underline"
					>
						{current.title}
					</Link>
					<Badge variant="outline">{current.visibility}</Badge>
					{current.hidden ? <Badge variant="destructive">Hidden</Badge> : null}
					{current.adult ? <Badge variant="secondary">Adult</Badge> : null}
				</div>
				<p className="whitespace-pre-wrap break-words text-muted-foreground text-sm">
					{current.description}
				</p>
				{current.ownerId ? (
					<Link
						to="/members/$memberId"
						params={{ memberId: current.ownerId }}
						className="font-mono text-muted-foreground text-xs underline-offset-4 hover:underline"
					>
						Owner {shortId(current.ownerId)}
					</Link>
				) : (
					<p className="text-muted-foreground text-xs">
						No owner: a story whose identity was erased by account deletion.
					</p>
				)}
			</div>
		);

	if (current.type === "comment")
		return (
			<div className="space-y-2">
				<p className="whitespace-pre-wrap break-words text-sm">
					{current.body}
				</p>
				<Link
					to="/members/$memberId"
					params={{ memberId: current.authorId }}
					className="font-mono text-muted-foreground text-xs underline-offset-4 hover:underline"
				>
					Author {shortId(current.authorId)}
				</Link>
			</div>
		);

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<Link
					to="/members/$memberId"
					params={{ memberId: current.id }}
					className="font-medium text-sm underline-offset-4 hover:underline"
				>
					{current.displayName}
				</Link>
				<Badge
					variant={current.status === "approved" ? "secondary" : "destructive"}
				>
					{current.status}
				</Badge>
			</div>
			<p className="whitespace-pre-wrap break-words text-muted-foreground text-sm">
				{current.bio}
			</p>
		</div>
	);
}

export function ReportDetailPage() {
	const { reportId } = useParams({ from: "/moderation/reports/$reportId" });
	/**
	 * Filters carried from the queue; `To queue` hands them back untouched (this screen does not read them).
	 */
	const queueSearch = useSearch({ from: "/moderation/reports/$reportId" });
	const client = getRowCatClient();
	const queryClient = useQueryClient();
	const query = useAdminQuery(moderationReportQueryOptions(client, reportId));

	const [pendingAction, setPendingAction] = useState<{
		kind: ModerationActionKind;
		capability?: ModerationCapability;
	} | null>(null);
	const [resolving, setResolving] = useState<"resolved" | "dismissed" | null>(
		null,
	);

	const act = useMutation({
		mutationFn: (request: ModerationActionRequest) =>
			client.moderation.act(request),
		onSuccess: async () => {
			await invalidateAfterModeration(queryClient);
			setPendingAction(null);
		},
	});

	const resolve = useMutation({
		mutationFn: (input: { status: "resolved" | "dismissed"; note: string }) =>
			client.moderation.resolveReport(reportId, input),
		onSuccess: async () => {
			await invalidateAfterModeration(queryClient);
			setResolving(null);
		},
	});

	return (
		<PageEnter className="space-y-4">
			<Link
				to="/moderation"
				search={{
					status: queueSearch.status,
					targetType: queueSearch.targetType,
				}}
				className={buttonVariants({ variant: "ghost", size: "sm" })}
			>
				<ArrowLeft className="size-4" /> To queue
			</Link>

			<QueryState query={query} loadingRows={5}>
				{(report) => {
					const actions = availableActions(report);
					return (
						<div className="space-y-4">
							<PageHeader
								title={`${REPORT_TARGET_LABEL[report.targetType]} report`}
								description={`${REPORT_REASON_LABEL[report.reason]} · ${formatDateTime(report.createdAt)}`}
								actions={
									report.status === "open" ? (
										<>
											<Button
												variant="outline"
												size="sm"
												onClick={() => setResolving("dismissed")}
											>
												Dismiss
											</Button>
											<Button
												variant="outline"
												size="sm"
												onClick={() => setResolving("resolved")}
											>
												Resolve
											</Button>
										</>
									) : (
										<Badge variant="secondary">{report.status}</Badge>
									)
								}
							/>

							<div className="grid gap-4 lg:grid-cols-2">
								<Card>
									<CardHeader>
										<CardTitle className="text-sm">
											Evidence at report time
										</CardTitle>
									</CardHeader>
									<CardContent className="space-y-3">
										<EvidenceBlock evidence={report.evidence} />
										{report.details ? (
											<div>
												<p className="mb-1 text-muted-foreground text-xs">
													Reporter's description
												</p>
												<p className="whitespace-pre-wrap break-words text-sm">
													{report.details}
												</p>
											</div>
										) : null}
										<p className="font-mono text-muted-foreground text-xs">
											Reporter{" "}
											{report.reporterId
												? shortId(report.reporterId)
												: "— identity erased by account deletion"}
										</p>
									</CardContent>
								</Card>

								<Card>
									<CardHeader>
										<CardTitle className="text-sm">Current state</CardTitle>
									</CardHeader>
									<CardContent>
										<CurrentBlock current={report.current} />
									</CardContent>
								</Card>
							</div>

							{/**
							 * Enforcement targets the case. The request has no target; the server
							 * derives it from the case, so the screen has nowhere to assemble a
							 * target id.
							 */}
							<Card>
								<CardHeader>
									<CardTitle className="text-sm">Enforcement</CardTitle>
								</CardHeader>
								<CardContent>
									{actions.length === 0 ? (
										<p className="text-muted-foreground text-sm">
											No actions apply to this case.
										</p>
									) : (
										<div className="flex flex-wrap gap-2">
											{actions.map((action) => (
												<Button
													key={`${action.kind}:${action.capability ?? ""}`}
													variant={
														action.destructive ? "destructive" : "outline"
													}
													size="sm"
													onClick={() =>
														setPendingAction({
															kind: action.kind,
															capability: action.capability,
														})
													}
												>
													{action.label}
												</Button>
											))}
										</div>
									)}
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<CardTitle className="text-sm">
										Action history for this case ({report.caseActions.length})
									</CardTitle>
								</CardHeader>
								<CardContent>
									{report.caseActions.length === 0 ? (
										<p className="text-muted-foreground text-sm">
											No actions enforced yet.
										</p>
									) : (
										<ul className="space-y-2">
											{report.caseActions.map((action) => (
												<li
													key={action.id}
													className="rounded-md border border-border p-2 text-sm"
												>
													<div className="flex flex-wrap items-center gap-2">
														<Badge
															variant={
																action.reversedByActionId
																	? "secondary"
																	: "default"
															}
														>
															{MODERATION_ACTION_LABEL[action.kind]}
														</Badge>
														{action.capability ? (
															<Badge variant="outline">
																{CAPABILITY_LABEL[action.capability]}
															</Badge>
														) : null}
														{action.reversedByActionId ? (
															<span className="text-muted-foreground text-xs">
																Reversed
															</span>
														) : null}
														<span className="ml-auto text-muted-foreground text-xs">
															{formatDateTime(action.createdAt)}
														</span>
													</div>
													<p className="mt-1 text-muted-foreground text-xs">
														Internal reason: {action.reason}
													</p>
													{action.publicReason ? (
														<p className="text-muted-foreground text-xs">
															Public reason: {action.publicReason}
														</p>
													) : null}
												</li>
											))}
										</ul>
									)}
								</CardContent>
							</Card>

							{/* A reason is required; the contract enforces it. */}
							<ConfirmDialog
								open={pendingAction !== null}
								onOpenChange={(open) => {
									if (!open) {
										setPendingAction(null);
										act.reset();
									}
								}}
								title={
									pendingAction
										? MODERATION_ACTION_LABEL[pendingAction.kind]
										: ""
								}
								target={
									<>
										{REPORT_TARGET_LABEL[report.targetType]} ·{" "}
										{report.targetId ?? "No server target"}
										<br />
										Case {report.caseId}
									</>
								}
								consequence={
									pendingAction
										? actions.find(
												(a) =>
													a.kind === pendingAction.kind &&
													a.capability === pendingAction.capability,
											)?.consequence
										: null
								}
								confirmLabel="Enforce"
								requireReason
								reasonLabel="Internal reason (required)"
								reasonPlaceholder="The basis for this action. The target doesn't see it."
								reasonMaxLength={REPORT_LIMITS.operatorReason}
								/**
								 * The public reason is written for a different audience (§57). It exists because a screen
								 * reads it: the sanctioned member's `/account` draws `publicReason` from `GET
								 * /v2/me/moderation` verbatim, and without this field every sanction would arrive with no
								 * reason, leaving appeal as the only way to ask.
								 *
								 * Leaving it empty is normal and the server stores the empty value. The internal reason is
								 * never copied here — auto-filling would send an operator's note out as a notice,
								 * irreversibly.
								 */
								secondary={{
									label: "Reason shown to the user (optional)",
									placeholder:
										"Shown as is on the account screen of the person enforced against.",
									hint: "Drawn as is on the target's account screen. A different text from the internal reason.",
									maxLength: REPORT_LIMITS.publicReason,
								}}
								destructive={
									pendingAction
										? (actions.find((a) => a.kind === pendingAction.kind)
												?.destructive ?? true)
										: true
								}
								pending={act.isPending}
								error={act.error}
								onConfirm={(reason, publicReason) => {
									if (!pendingAction) return;
									act.mutate({
										caseId: report.caseId,
										kind: pendingAction.kind,
										reason,
										/**
										 * Only what the operator wrote goes out (an empty string if nothing); never copy the
										 * internal reason here (§57).
										 */
										publicReason,
										...(pendingAction.capability
											? { capability: pendingAction.capability }
											: {}),
									});
								}}
							/>

							{/**
							 * Resolving is not enforcement; it only takes the report off the queue.
							 */}
							<ConfirmDialog
								open={resolving !== null}
								onOpenChange={(open) => {
									if (!open) {
										setResolving(null);
										resolve.reset();
									}
								}}
								title={resolving === "resolved" ? "Resolve" : "Dismiss"}
								target={`Report ${report.id}`}
								consequence={
									resolving === "resolved"
										? "Closes this report as resolved. Actions already taken stay."
										: "Closes this report without action. Nothing happens to the target."
								}
								confirmLabel={resolving === "resolved" ? "Resolve" : "Dismiss"}
								requireReason={false}
								destructive={false}
								pending={resolve.isPending}
								error={resolve.error}
								onConfirm={() => {
									if (!resolving) return;
									resolve.mutate({ status: resolving, note: "" });
								}}
							/>
						</div>
					);
				}}
			</QueryState>
		</PageEnter>
	);
}
