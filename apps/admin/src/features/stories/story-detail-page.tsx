import type { AdminStoryDetailDto } from "@rowcat/contracts";
import {
	adminDeleteStoryMutationOptions,
	adminStoryQueryOptions,
	viewerQueryOptions,
} from "@rowcat/query";
import { isRowCatApiError } from "@rowcat/sdk";
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
import { ArrowLeft, Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { QueryState } from "#/components/states.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { formatCount, formatDateTime } from "#/lib/format.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { canAdminister } from "#/lib/operator.ts";
import { useAdminQuery } from "#/lib/query/use-admin-query.ts";
import {
	STORY_DELETE_ACKNOWLEDGEMENT,
	storyDeletionView,
} from "./story-deletion.ts";

/**
 * Story detail. It skips the viewing gate, so private, archived, operator-hidden and adult works
 * all open — an operator arriving from the moderation queue cannot judge what they cannot see.
 *
 * - No authored content (scenario, lore, start scenes). The one case an operator must read a
 *   manuscript is a reported story, and moderation evidence already covers it, bound to a case. The
 *   server does not send the payload, so this boundary is structural, not a promise.
 * - No hide toggle. Hiding is an enforcement that leaves a `moderation_action`; with an open case
 *   this links there, otherwise it draws no operation at all.
 */

export function StoryDetailPage() {
	const { storyId } = useParams({ from: "/stories/$storyId" });
	const client = getRowCatClient();
	const query = useAdminQuery(adminStoryQueryOptions(client, storyId));
	const viewerQuery = useAdminQuery(viewerQueryOptions(client));
	const canDelete = canAdminister(viewerQuery.data);

	return (
		<PageEnter className="space-y-4">
			<Link
				to="/stories"
				className={buttonVariants({ variant: "ghost", size: "sm" })}
			>
				<ArrowLeft className="size-4" /> Stories
			</Link>

			<QueryState query={query} loadingRows={4}>
				{(detail) => (
					<div className="space-y-4">
						<PageHeader title={detail.story.title} description={storyId} />

						<div className="flex flex-wrap gap-2">
							<Badge variant="outline">{detail.story.visibility}</Badge>
							{detail.story.hidden ? (
								<Badge variant="destructive">Operator hidden</Badge>
							) : null}
							{detail.story.adult ? (
								<Badge variant="secondary">Adult</Badge>
							) : null}
						</div>

						<div className="grid gap-4 lg:grid-cols-2">
							<Card>
								<CardHeader>
									<CardTitle className="text-sm">Public metadata</CardTitle>
								</CardHeader>
								<CardContent className="space-y-3">
									<div>
										<p className="mb-1 text-muted-foreground text-xs">
											Description
										</p>
										<p className="whitespace-pre-wrap break-words text-sm">
											{detail.description || "—"}
										</p>
									</div>
									{detail.tags.length > 0 ? (
										<div>
											<p className="mb-1 text-muted-foreground text-xs">Tags</p>
											<div className="flex flex-wrap gap-1">
												{detail.tags.map((tag) => (
													<Badge key={tag} variant="outline">
														{tag}
													</Badge>
												))}
											</div>
										</div>
									) : null}
									<div>
										<p className="mb-1 text-muted-foreground text-xs">
											Creator
										</p>
										{detail.story.ownerId ? (
											<Link
												to="/members/$memberId"
												params={{ memberId: detail.story.ownerId }}
												className="text-sm underline-offset-4 hover:underline"
											>
												{detail.story.ownerNickname ?? detail.story.ownerId}
											</Link>
										) : (
											<p className="text-muted-foreground text-sm">
												A story whose identity was erased by account deletion.
											</p>
										)}
									</div>
									<p className="text-muted-foreground text-xs">
										Created {formatDateTime(detail.story.createdAt)} · Edited{" "}
										{formatDateTime(detail.story.updatedAt)}
									</p>
									{/**
									 * Say why authored content is absent; silently omitting it makes the
									 * operator think the lookup failed and refresh.
									 */}
									<p className="rounded-md border border-border border-dashed p-2 text-muted-foreground text-xs">
										Authored content (scenario, lore, opening scenes) does not
										appear on this screen. A reported story's manuscript can be
										seen only in that report's evidence.
									</p>
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<CardTitle className="text-sm">
										Metrics and moderation
									</CardTitle>
								</CardHeader>
								<CardContent className="space-y-4">
									<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
										<div className="rounded-lg border border-border p-3">
											<p className="text-muted-foreground text-xs">Views</p>
											<p className="tabular font-semibold text-lg">
												{formatCount(detail.story.views)}
											</p>
										</div>
										<div className="rounded-lg border border-border p-3">
											<p className="text-muted-foreground text-xs">Favorites</p>
											<p className="tabular font-semibold text-lg">
												{formatCount(detail.story.favorites)}
											</p>
										</div>
										<div className="rounded-lg border border-border p-3">
											<p className="text-muted-foreground text-xs">Comments</p>
											<p className="tabular font-semibold text-lg">
												{formatCount(detail.commentCount)}
											</p>
										</div>
										<div className="rounded-lg border border-border p-3">
											<p className="text-muted-foreground text-xs">
												Open reports
											</p>
											<p
												className={`tabular font-semibold text-lg ${
													detail.openReportCount > 0 ? "text-destructive" : ""
												}`}
											>
												{formatCount(detail.openReportCount)}
											</p>
										</div>
									</div>

									<div className="space-y-2">
										<p className="text-muted-foreground text-sm">
											Actions taken against this story so far:{" "}
											<span className="tabular">{detail.actionCount}</span>
										</p>
										{detail.openCaseId ? (
											<div className="space-y-1">
												<p className="text-sm">
													There is an open case. Enforcement happens in that
													case.
												</p>
												<Link
													to="/moderation"
													search={{ status: "open" }}
													className={buttonVariants({
														variant: "outline",
														size: "sm",
													})}
												>
													To report queue
												</Link>
											</div>
										) : (
											/**
											 * Enforcement acts on a case; a button pressable without one would be a sanction path
											 * with no basis.
											 */
											<p className="text-muted-foreground text-sm">
												There are no open cases. Enforcement is possible only on
												cases created from reports.
											</p>
										)}
									</div>
								</CardContent>
							</Card>
						</div>

						<StoryDeletionSection
							storyId={storyId}
							title={detail.story.title}
							detail={detail}
							canDelete={canDelete}
						/>
					</div>
				)}
			</QueryState>
		</PageEnter>
	);
}

/**
 * Admin-only, irreversible deletion — the operator's hand for a deletion request that reaches them.
 * What to draw is decided by `story-deletion.ts`.
 *
 * After deleting it returns to the list, since the detail is now 404. A 404 after confirming means
 * another operator already deleted it, so it goes to the same place; drawing that as a failure
 * invites a second press.
 */
function StoryDeletionSection({
	storyId,
	title,
	detail,
	canDelete,
}: {
	storyId: string;
	title: string;
	detail: AdminStoryDetailDto;
	canDelete: boolean;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const options = adminDeleteStoryMutationOptions(
		getRowCatClient(),
		queryClient,
		storyId,
	);
	const remove = useMutation({
		...options,
		onSuccess: async (result) => {
			setOpen(false);
			/**
			 * Leave first, so that when the cache policy drops the detail cell this screen does not refetch
			 * it and draw a 404.
			 */
			await navigate({ to: "/stories", replace: true });
			await options.onSuccess(result);
		},
		onError: (error) => {
			if (isRowCatApiError(error) && error.status === 404) {
				setOpen(false);
				void navigate({ to: "/stories", replace: true });
			}
		},
	});

	const view = storyDeletionView(detail, canDelete);
	if (view.state === "hidden") return null;

	return (
		<section className="space-y-2 rounded-lg border border-destructive/30 p-4">
			<h2 className="font-semibold text-sm">Delete story</h2>
			{view.state === "blocked" ? (
				<p className="text-muted-foreground text-sm">{view.message}</p>
			) : (
				<>
					<p className="text-muted-foreground text-sm">
						Handles a creator's deletion request. Unlike archiving, it can't be
						undone.
					</p>
					<Button
						variant="destructive"
						size="sm"
						onClick={() => {
							remove.reset();
							setOpen(true);
						}}
					>
						<Trash2 aria-hidden="true" />
						{view.confirmLabel}
					</Button>
					<ConfirmDialog
						open={open}
						onOpenChange={setOpen}
						title={view.confirmLabel}
						target={title}
						consequence={view.consequence}
						confirmLabel={view.confirmLabel}
						requireReason
						reasonLabel="Reason"
						reasonPlaceholder="e.g. creator request (ticket number)"
						reasonMaxLength={200}
						acknowledgement={{
							phrase: STORY_DELETE_ACKNOWLEDGEMENT,
							hint: "It can't be undone, so type it once more.",
						}}
						pending={remove.isPending}
						error={remove.error}
						onConfirm={(reason) => remove.mutate({ reason })}
						destructive
					/>
				</>
			)}
		</section>
	);
}
