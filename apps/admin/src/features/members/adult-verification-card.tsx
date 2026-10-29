import type {
	AdminAdultVerificationResponse,
	AdminMemberDetailDto,
} from "@rowcat/contracts";
import { adminSetAdultVerificationMutationOptions } from "@rowcat/query";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@rowcat/ui-web/components/card";
import { Switch } from "@rowcat/ui-web/components/switch";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import {
	type AdultAxes,
	adultAxesDirty,
	adultGrantBlockedForChild,
	applyAdultAxis,
} from "./adult-axes.ts";

/**
 * Adult entitlement — one of the two operations on this screen that change the member row directly
 * (the other is the managed-generation allowlist).
 *
 * - Suspension, blocking and capability restrictions are absent because they are enforcement and
 *   need a case to appeal. Entitlement is a state, not a sanction, so it lands in the audit log,
 *   not the action ledger, and is undone by flipping the switch back.
 * - Only `verified` and `adult` move. The display opt-in (`showAdult`) is the member's own choice
 *   and is read-only here: flipping it shows them a screen they never chose, and clearing it with a
 *   revocation erases their choice for a later legitimate re-verification.
 * - Edits form a draft sent once: the axes move together, so per-axis requests could briefly
 *   commit adult-without-verification and leave it there if the second failed. The contract takes
 *   the target state for the same reason.
 */

function AxisBadge({ on, onLabel }: { on: boolean; onLabel: string }) {
	return (
		<Badge variant={on ? "default" : "outline"}>{on ? onLabel : "None"}</Badge>
	);
}

export function AdultVerificationCard({
	memberId,
	operator,
	/** Admin only — a courtesy, not enforcement (the server refuses). */
	canEdit,
}: {
	memberId: string;
	operator: AdminMemberDetailDto["operator"];
	canEdit: boolean;
}) {
	const verifiedId = useId();
	const adultId = useId();
	const queryClient = useQueryClient();

	const current: AdultAxes = {
		verified: operator.verified,
		adult: operator.adult,
	};
	const [draft, setDraft] = useState<AdultAxes>(current);
	const [open, setOpen] = useState(false);

	/**
	 * A server change discards the draft. Kept, an unapplied draft would silently revive an
	 * entitlement another operator just revoked, and neither would know. The server values
	 * themselves are the reset signal.
	 */
	useEffect(() => {
		setDraft({ verified: operator.verified, adult: operator.adult });
	}, [operator.verified, operator.adult]);

	const setAxes = useMutation(
		adminSetAdultVerificationMutationOptions(
			getRowCatClient(),
			queryClient,
			memberId,
		),
	);

	const dirty = adultAxesDirty(current, draft);
	const blocked = adultGrantBlockedForChild(operator.ageStatus, draft);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-sm">
					Adult eligibility
					<span className="ml-2 font-normal text-muted-foreground text-xs">
						Identity verification + age 19
					</span>
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-3">
					<div className="flex items-start justify-between gap-4">
						<div className="min-w-0 space-y-0.5">
							<p className="font-medium text-sm" id={`${verifiedId}-label`}>
								Identity verification
							</p>
							<p
								className="text-muted-foreground text-xs"
								id={`${verifiedId}-desc`}
							>
								Now <AxisBadgeText on={operator.verified} onLabel="Verified" />{" "}
								· A value the verification provider settles. Turning it off
								lowers adult eligibility too.
							</p>
						</div>
						<Switch
							checked={draft.verified}
							disabled={!canEdit || setAxes.isPending}
							aria-labelledby={`${verifiedId}-label`}
							aria-describedby={`${verifiedId}-desc`}
							onCheckedChange={(checked) =>
								setDraft((previous) =>
									applyAdultAxis(previous, "verified", checked),
								)
							}
						/>
					</div>

					<div className="flex items-start justify-between gap-4">
						<div className="min-w-0 space-y-0.5">
							<p className="font-medium text-sm" id={`${adultId}-label`}>
								Adult eligibility
							</p>
							<p
								className="text-muted-foreground text-xs"
								id={`${adultId}-desc`}
							>
								Now <AxisBadgeText on={operator.adult} onLabel="Yes" /> ·
								Publishing and viewing adult stories depend on this value.
								Turning it on raises identity verification too.
							</p>
						</div>
						<Switch
							checked={draft.adult}
							disabled={!canEdit || setAxes.isPending}
							aria-labelledby={`${adultId}-label`}
							aria-describedby={`${adultId}-desc`}
							onCheckedChange={(checked) =>
								setDraft((previous) =>
									applyAdultAxis(previous, "adult", checked),
								)
							}
						/>
					</div>

					{/* Not a switch: the member's own choice, and it opens nothing without entitlement. */}
					<div className="flex items-start justify-between gap-4 border-border border-t pt-3">
						<div className="min-w-0 space-y-0.5">
							<p className="font-medium text-sm">Show adult content</p>
							<p className="text-muted-foreground text-xs">
								A value the member turns on in their own settings. Operators
								don't change it.
							</p>
						</div>
						<AxisBadge on={operator.showAdult} onLabel="On" />
					</div>
				</div>

				{operator.ageStatus === "child" ? (
					<p className="text-destructive text-xs">
						This account is under 14. The age decision governs all three adult
						axes, so eligibility can't be granted (revoking is possible).
					</p>
				) : null}

				{canEdit ? (
					<div className="flex flex-wrap items-center gap-2">
						<Button
							size="sm"
							disabled={!dirty || blocked || setAxes.isPending}
							onClick={() => setOpen(true)}
						>
							Apply changes
						</Button>
						{dirty ? (
							<Button
								size="sm"
								variant="ghost"
								disabled={setAxes.isPending}
								onClick={() => setDraft(current)}
							>
								Revert
							</Button>
						) : null}
						{setAxes.isSuccess && !setAxes.data.changed ? (
							<span className="text-muted-foreground text-xs">
								It was already the same state. The member row didn't change.
							</span>
						) : null}
					</div>
				) : (
					<p className="text-muted-foreground text-xs">
						Changing adult eligibility requires the admin role.
					</p>
				)}

				<ConfirmDialog
					open={open}
					onOpenChange={(next) => {
						if (!next) {
							setOpen(false);
							setAxes.reset();
						}
					}}
					title="Change adult eligibility"
					target={
						<>
							Member {memberId}
							<br />
							Identity verification {axisWord(current.verified)} →{" "}
							{axisWord(draft.verified)}
							<br />
							Adult eligibility {axisWord(current.adult)} →{" "}
							{axisWord(draft.adult)}
						</>
					}
					consequence={
						draft.adult
							? "This member can publish and view adult stories immediately. It is granted without the identity verification procedure, and that fact remains only in the audit log."
							: "This member's viewing and publishing of adult stories is blocked immediately. Raising already published adult stories to public is blocked too (taking them down stays possible)."
					}
					confirmLabel="Apply"
					destructive={!draft.adult}
					requireReason
					reasonLabel="Reason for the change"
					reasonPlaceholder="e.g. manual check during a verification provider outage · revoked after an identity theft report"
					reasonMaxLength={200}
					pending={setAxes.isPending}
					error={setAxes.error}
					onConfirm={(reason) => {
						setAxes.mutate(
							{ verified: draft.verified, adult: draft.adult, reason },
							{
								onSuccess: (result: AdminAdultVerificationResponse) => {
									setOpen(false);
									setDraft({
										verified: result.verified,
										adult: result.adult,
									});
								},
							},
						);
					}}
				/>
			</CardContent>
		</Card>
	);
}

function AxisBadgeText({ on, onLabel }: { on: boolean; onLabel: string }) {
	return (
		<span className={on ? "font-medium text-foreground" : ""}>
			{on ? onLabel : "None"}
		</span>
	);
}

const axisWord = (on: boolean): string => (on ? "Yes" : "No");
