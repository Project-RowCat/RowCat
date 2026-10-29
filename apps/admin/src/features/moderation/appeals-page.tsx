import {
	AppealStatus,
	CAPABILITY_LABEL,
	MODERATION_ACTION_LABEL,
	type ModerationAppealDto,
} from "@rowcat/contracts";
import {
	invalidateAfterModeration,
	moderationAppealsInfiniteQueryOptions,
	moderationPageRows,
} from "@rowcat/query";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Button } from "@rowcat/ui-web/components/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { FilterBar, FilterSelect } from "#/components/filter-bar.tsx";
import { LoadMore } from "#/components/load-more.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { QueryState } from "#/components/states.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { formatDateTime, formatRelative, shortId } from "#/lib/format.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { useAdminInfiniteQuery } from "#/lib/query/use-admin-infinite-query.ts";

/**
 * Appeals queue. There is no separate detail screen: an appeal carries its body and the action it
 * targets (`ModerationAppealDto.action`), both fit in one card, and a detail screen would cost the
 * operator one more press to see what they need.
 *
 * Accepting really executes the reversal — changing only the status while the sanction stays is not
 * acceptance (§64). The server does it, and the confirm dialog says so precisely so nobody presses
 * it thinking it only changes a label. Only the appealed action is reversed; if the member has
 * other active actions, the account status stays (§65), and the dialog says that too.
 */

const STATUS_OPTIONS = [
	{ value: "open", label: "Open" },
	{ value: "accepted", label: "Accepted" },
	{ value: "rejected", label: "Rejected" },
];

function AppealCard({
	appeal,
	onResolve,
}: {
	appeal: ModerationAppealDto;
	onResolve: (status: "accepted" | "rejected") => void;
}) {
	const action = appeal.action;
	return (
		<article className="space-y-3 rounded-lg border border-border p-4">
			<div className="flex flex-wrap items-center gap-2">
				<Badge variant={action.reversedByActionId ? "secondary" : "default"}>
					{MODERATION_ACTION_LABEL[action.kind]}
				</Badge>
				{action.capability ? (
					<Badge variant="outline">{CAPABILITY_LABEL[action.capability]}</Badge>
				) : null}
				{action.reversedByActionId ? (
					<Badge variant="secondary">Action already reversed</Badge>
				) : null}
				<Link
					to="/members/$memberId"
					params={{ memberId: appeal.memberId }}
					className="font-mono text-muted-foreground text-xs underline-offset-4 hover:underline"
					title={appeal.memberId}
				>
					{shortId(appeal.memberId)}
				</Link>
				<span
					className="ml-auto text-muted-foreground text-xs"
					title={formatDateTime(appeal.createdAt)}
				>
					{formatRelative(appeal.createdAt)}
				</span>
			</div>

			<div className="rounded-md border border-border bg-muted/30 p-3">
				<p className="mb-1 text-muted-foreground text-xs">Appeal</p>
				<p className="whitespace-pre-wrap break-words text-sm">
					{appeal.message}
				</p>
			</div>

			<div className="space-y-1 text-sm">
				<p className="text-muted-foreground text-xs">
					Internal reason at enforcement
				</p>
				<p className="break-words">{action.reason}</p>
				{action.publicReason ? (
					<>
						<p className="pt-1 text-muted-foreground text-xs">Public reason</p>
						<p className="break-words">{action.publicReason}</p>
					</>
				) : null}
			</div>

			{appeal.status === "open" ? (
				<div className="flex gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => onResolve("rejected")}
					>
						Reject
					</Button>
					<Button size="sm" onClick={() => onResolve("accepted")}>
						Accept and reverse
					</Button>
				</div>
			) : (
				<div className="space-y-1">
					<Badge variant="secondary">
						{STATUS_OPTIONS.find((o) => o.value === appeal.status)?.label}
					</Badge>
					{appeal.resolutionNote ? (
						<p className="text-muted-foreground text-sm">
							Resolution note: {appeal.resolutionNote}
						</p>
					) : null}
				</div>
			)}
		</article>
	);
}

export function AppealsPage() {
	const navigate = useNavigate();
	const search = useSearch({ from: "/moderation/appeals" });
	const client = getRowCatClient();
	const queryClient = useQueryClient();

	const parsed = AppealStatus.safeParse(search.status ?? "open");
	const status = parsed.success ? parsed.data : "open";

	/** The status is part of the key, so a cursor from one status cannot leave its cache cell. */
	const query = useAdminInfiniteQuery(
		moderationAppealsInfiniteQueryOptions(client, status),
	);

	const [pending, setPending] = useState<{
		appeal: ModerationAppealDto;
		status: "accepted" | "rejected";
	} | null>(null);

	const resolve = useMutation({
		mutationFn: (input: {
			appealId: string;
			status: "accepted" | "rejected";
			note: string;
		}) =>
			client.moderation.resolveAppeal(input.appealId, {
				status: input.status,
				note: input.note,
			}),
		onSuccess: async () => {
			await invalidateAfterModeration(queryClient);
			setPending(null);
		},
	});

	return (
		<PageEnter className="space-y-4">
			<PageHeader
				title="Appeals"
				description="Rebuttals from members who were enforced against. Accepting really reverses that action."
			/>

			<FilterBar>
				<FilterSelect
					label="Status"
					value={status}
					options={STATUS_OPTIONS}
					onChange={(value) =>
						navigate({
							to: "/moderation/appeals",
							search: { status: value === "open" ? undefined : value },
							replace: true,
						})
					}
				/>
			</FilterBar>

			<QueryState
				query={query}
				empty={{
					title: "No appeals here",
					when: (data) => moderationPageRows(data).length === 0,
				}}
			>
				{(data) => (
					<div className="space-y-3">
						{moderationPageRows(data).map((appeal) => (
							<AppealCard
								key={appeal.id}
								appeal={appeal}
								onResolve={(next) => setPending({ appeal, status: next })}
							/>
						))}
						<LoadMore nextPage={query.nextPage} noun="appeals" />
					</div>
				)}
			</QueryState>

			<ConfirmDialog
				open={pending !== null}
				onOpenChange={(open) => {
					if (!open) {
						setPending(null);
						resolve.reset();
					}
				}}
				title={
					pending?.status === "accepted" ? "Accept appeal" : "Reject appeal"
				}
				target={
					pending ? (
						<>
							Appeal {pending.appeal.id}
							<br />
							Member {pending.appeal.memberId}
							<br />
							Action {MODERATION_ACTION_LABEL[pending.appeal.action.kind]} (
							{pending.appeal.action.id})
						</>
					) : null
				}
				consequence={
					pending?.status === "accepted"
						? "This action really reverses: it is not just a display change. If active sanctions from other cases remain on the same member, the account status stays as is. The member gets one notification that the appeal was handled."
						: "Rejects the appeal. The sanction stays, and the member is notified that it was handled. The same action can't be appealed again."
				}
				confirmLabel={pending?.status === "accepted" ? "Accept" : "Reject"}
				requireReason
				reasonLabel="Resolution note"
				reasonPlaceholder="The basis for this decision. The member doesn't see it."
				destructive={pending?.status === "rejected"}
				pending={resolve.isPending}
				error={resolve.error}
				onConfirm={(note) => {
					if (!pending) return;
					resolve.mutate({
						appealId: pending.appeal.id,
						status: pending.status,
						note,
					});
				}}
			/>
		</PageEnter>
	);
}
