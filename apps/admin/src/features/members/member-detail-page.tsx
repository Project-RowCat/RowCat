import {
	CAPABILITY_LABEL,
	MODERATION_ACTION_LABEL,
	type ModerationActionKind,
} from "@rowcat/contracts";
import { adminMemberQueryOptions, viewerQueryOptions } from "@rowcat/query";
import { Badge } from "@rowcat/ui-web/components/badge";
import { buttonVariants } from "@rowcat/ui-web/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@rowcat/ui-web/components/card";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { PageHeader } from "#/components/page-header.tsx";
import { QueryState } from "#/components/states.tsx";
import { AdultVerificationCard } from "#/features/members/adult-verification-card.tsx";
import { ManagedGenerationCard } from "#/features/members/managed-generation-card.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { formatCount, formatDateTime } from "#/lib/format.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { canAdminister } from "#/lib/operator.ts";
import { useAdminQuery } from "#/lib/query/use-admin-query.ts";

/**
 * Where an operator investigates one person.
 *
 * - Public and operator values sit in separate cards: an operator who cannot tell which values
 *   others see ends up reading private values to the member during support.
 * - This lookup is the only one carrying email, so the server audits it (`admin.member.view`);
 *   the screen does not say so because the record exists either way.
 * - No sanction buttons: suspension, blocking and restrictions are enforced against a case, and
 *   enforcing without one leaves the target nothing to appeal. Action history links to the case.
 */

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex items-start justify-between gap-3 py-1">
			<dt className="shrink-0 text-muted-foreground text-sm">{label}</dt>
			<dd className="min-w-0 break-words text-right text-sm">{children}</dd>
		</div>
	);
}

const AGE_LABEL: Record<string, string> = {
	unknown: "Unconfirmed",
	child: "Under 14",
	standard: "14 or older",
};

export function MemberDetailPage() {
	const { memberId } = useParams({ from: "/members/$memberId" });
	const client = getRowCatClient();
	const query = useAdminQuery(adminMemberQueryOptions(client, memberId));
	const viewerQuery = useAdminQuery(viewerQueryOptions(client));
	const isAdmin = canAdminister(viewerQuery.data);

	return (
		<PageEnter className="space-y-4">
			<Link
				to="/members"
				className={buttonVariants({ variant: "ghost", size: "sm" })}
			>
				<ArrowLeft className="size-4" /> Members
			</Link>

			<QueryState query={query} loadingRows={5}>
				{(detail) => (
					<div className="space-y-4">
						<PageHeader
							title={detail.profile.nickname || "(no nickname)"}
							description={memberId}
						/>

						<div className="grid gap-4 lg:grid-cols-2">
							<Card>
								<CardHeader>
									<CardTitle className="text-sm">
										Public profile
										<span className="ml-2 font-normal text-muted-foreground text-xs">
											Values others see
										</span>
									</CardTitle>
								</CardHeader>
								<CardContent>
									<dl className="divide-y divide-border">
										<Field label="Nickname">
											{detail.profile.nickname || "—"}
										</Field>
										<Field label="Bio">{detail.profile.bio || "—"}</Field>
										<Field label="Followers">
											<span className="tabular">
												{formatCount(detail.profile.followers)}
											</span>
										</Field>
										<Field label="Stories">
											<Link
												to="/stories"
												search={{ ownerId: memberId }}
												className="tabular underline-offset-4 hover:underline"
											>
												{formatCount(detail.profile.stories)}
											</Link>
										</Field>
									</dl>
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<CardTitle className="text-sm">
										Operator information
										<span className="ml-2 font-normal text-muted-foreground text-xs">
											Values only operators see
										</span>
									</CardTitle>
								</CardHeader>
								<CardContent>
									<dl className="divide-y divide-border">
										<Field label="Email">
											<span className="font-mono text-xs">
												{detail.operator.email || "—"}
											</span>
										</Field>
										<Field label="Status">
											<Badge
												variant={
													detail.operator.status === "approved"
														? "secondary"
														: "destructive"
												}
											>
												{detail.operator.status}
											</Badge>
										</Field>
										<Field label="Role">
											<Badge
												variant={
													detail.operator.role === "user"
														? "outline"
														: "default"
												}
											>
												{detail.operator.role}
											</Badge>
										</Field>
										<Field label="Age band">
											{AGE_LABEL[detail.operator.ageStatus] ??
												detail.operator.ageStatus}
										</Field>
										{/*
										 * The adult axes live in the card below, beside their switches; drawn here too, a
										 * just-changed value would show its old state in this card.
										 */}
										<Field label="Joined">
											{formatDateTime(detail.operator.createdAt)}
										</Field>
									</dl>
								</CardContent>
							</Card>
						</div>

						<AdultVerificationCard
							memberId={memberId}
							operator={detail.operator}
							canEdit={isAdmin}
						/>

						<ManagedGenerationCard
							memberId={memberId}
							operator={detail.operator}
							canEdit={isAdmin}
						/>

						<Card>
							<CardHeader>
								<CardTitle className="text-sm">
									Active restrictions ({detail.restrictions.length})
								</CardTitle>
							</CardHeader>
							<CardContent>
								{detail.restrictions.length === 0 ? (
									<p className="text-muted-foreground text-sm">
										No capability restrictions are in effect. (For account
										suspension, see the status above: it is a different axis.)
									</p>
								) : (
									<ul className="space-y-2">
										{detail.restrictions.map((restriction) => (
											<li
												key={restriction.id}
												className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm"
											>
												<Badge variant="destructive">
													{CAPABILITY_LABEL[restriction.capability]}
												</Badge>
												<span className="text-muted-foreground text-xs">
													From {formatDateTime(restriction.createdAt)}
												</span>
												<span className="ml-auto text-muted-foreground text-xs">
													{restriction.expiresAt
														? `Until ${formatDateTime(restriction.expiresAt)}`
														: "Indefinite"}
												</span>
											</li>
										))}
									</ul>
								)}
							</CardContent>
						</Card>

						<Card>
							<CardHeader>
								<CardTitle className="text-sm">
									Recent actions ({detail.recentActions.length})
								</CardTitle>
							</CardHeader>
							<CardContent>
								{detail.recentActions.length === 0 ? (
									<p className="text-muted-foreground text-sm">
										No actions have been taken against this member.
									</p>
								) : (
									<ul className="space-y-2">
										{detail.recentActions.map((action) => (
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
														{MODERATION_ACTION_LABEL[
															action.kind as ModerationActionKind
														] ?? action.kind}
													</Badge>
													{action.reversedByActionId ? (
														<span className="text-muted-foreground text-xs">
															Reversed
														</span>
													) : null}
													<span className="ml-auto text-muted-foreground text-xs">
														{formatDateTime(action.createdAt)}
													</span>
												</div>
												<p className="mt-1 break-words text-muted-foreground text-xs">
													{action.reason}
												</p>
												<p className="mt-1 font-mono text-muted-foreground text-xs">
													Case {action.caseId}
												</p>
											</li>
										))}
									</ul>
								)}
							</CardContent>
						</Card>
					</div>
				)}
			</QueryState>
		</PageEnter>
	);
}
