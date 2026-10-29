import type {
	AdminManagedGenerationResponse,
	AdminMemberDetailDto,
} from "@rowcat/contracts";
import { adminSetManagedGenerationMutationOptions } from "@rowcat/query";
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

/**
 * Managed generation access: **who uses this server's default AI.**
 *
 * In the open-source release, without metering, managed generation runs on the operator's provider key. Rate limits bound
 * how much one person uses; this switch bounds **who** uses it. A blocked member's generation does not stop;
 * they are guided to their own API key (BYO). So lowering this value is a cost boundary, not a sanction,
 * and it lands in the audit log, not the action ledger (the same judgment as the adult eligibility switch).
 *
 * ## This value is not the whole decision
 *
 * ```text
 * staff and admin roles                 always allowed regardless of this value (server decision)
 * MANAGED_GENERATION_ACCESS=everyone   the list itself is not used
 * ```
 *
 * The screen does not know the deployment mode (the operations response has no such cell). So it does not
 * assert the real result and states the two exceptions **in sentences**: if the screen guessed the mode and drew
 * "no effect", on the day that guess was wrong, a member the operator believes blocked would keep using it.
 *
 * ## Make a draft and send after confirming
 *
 * The same shape as the adult eligibility card. Flipping the switch does not request immediately; it goes
 * through a confirmation that takes a reason: opening someone's generation on the operator's key must record why. When the
 * server value changes the draft is discarded (my unapplied draft does not overwrite what another operator just changed).
 */
export function ManagedGenerationCard({
	memberId,
	operator,
	/** Only admins can change it: **a kindness, not enforcement** (the server refuses). */
	canEdit,
}: {
	memberId: string;
	operator: AdminMemberDetailDto["operator"];
	canEdit: boolean;
}) {
	const switchId = useId();
	const queryClient = useQueryClient();

	const current = operator.managedGenerationAllowed;
	const [draft, setDraft] = useState(current);
	const [open, setOpen] = useState(false);

	/** Discards the draft when the server value changes: the server value itself is the reset signal. */
	useEffect(() => {
		setDraft(operator.managedGenerationAllowed);
	}, [operator.managedGenerationAllowed]);

	const setAllowed = useMutation(
		adminSetManagedGenerationMutationOptions(
			getRowCatClient(),
			queryClient,
			memberId,
		),
	);

	const dirty = draft !== current;
	const roleAlwaysAllowed = operator.role !== "user";

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-sm">
					Managed generation
					<span className="ml-2 font-normal text-muted-foreground text-xs">
						The operator's provider key
					</span>
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex items-start justify-between gap-4">
					<div className="min-w-0 space-y-0.5">
						<p className="font-medium text-sm" id={`${switchId}-label`}>
							Managed generation access
						</p>
						<p
							className="text-muted-foreground text-xs"
							id={`${switchId}-desc`}
						>
							Now{" "}
							<span className={current ? "font-medium text-foreground" : ""}>
								{current ? "Allowed" : "None"}
							</span>{" "}
							· In allowlist mode, decides whether this member can use this
							server's default AI on the operator's key. In allow-everyone mode
							(everyone) this list is not used.
						</p>
					</div>
					<Switch
						checked={draft}
						disabled={!canEdit || setAllowed.isPending}
						aria-labelledby={`${switchId}-label`}
						aria-describedby={`${switchId}-desc`}
						onCheckedChange={setDraft}
					/>
				</div>

				{roleAlwaysAllowed ? (
					<p className="text-muted-foreground text-xs">
						This account has the {operator.role} role, so it is always allowed
						regardless of this value.
					</p>
				) : null}

				{canEdit ? (
					<div className="flex flex-wrap items-center gap-2">
						<Button
							size="sm"
							disabled={!dirty || setAllowed.isPending}
							onClick={() => setOpen(true)}
						>
							Apply changes
						</Button>
						{dirty ? (
							<Button
								size="sm"
								variant="ghost"
								disabled={setAllowed.isPending}
								onClick={() => setDraft(current)}
							>
								Revert
							</Button>
						) : null}
						{setAllowed.isSuccess && !setAllowed.data.changed ? (
							<span className="text-muted-foreground text-xs">
								It was already the same state. The member row didn't change.
							</span>
						) : null}
					</div>
				) : (
					<p className="text-muted-foreground text-xs">
						Changing managed generation access requires the admin role.
					</p>
				)}

				<ConfirmDialog
					open={open}
					onOpenChange={(next) => {
						if (!next) {
							setOpen(false);
							setAllowed.reset();
						}
					}}
					title="Change managed generation access"
					target={
						<>
							Member {memberId}
							<br />
							Managed generation {allowedWord(current)} → {allowedWord(draft)}
						</>
					}
					consequence={
						draft
							? "In allowlist mode this member can immediately use this server's default AI on the operator's provider key. Costs are billed to the operator's account, and only the rate limits (per minute and per day) bound usage. The staff and admin roles are always allowed regardless of this value, and in allow-everyone mode this list is not used."
							: "In allowlist mode this member's managed generation requests are refused immediately, and they are guided to connect a personal API key in AI settings. Generation with a personal key is not blocked. The staff and admin roles are always allowed regardless of this value, and in allow-everyone mode this list is not used."
					}
					confirmLabel="Apply"
					destructive={!draft}
					requireReason
					reasonLabel="Reason for the change"
					reasonPlaceholder="e.g. inviting a beta tester · revoked for excessive use"
					reasonMaxLength={200}
					pending={setAllowed.isPending}
					error={setAllowed.error}
					onConfirm={(reason) => {
						setAllowed.mutate(
							{ allowed: draft, reason },
							{
								onSuccess: (result: AdminManagedGenerationResponse) => {
									setOpen(false);
									setDraft(result.allowed);
								},
							},
						);
					}}
				/>
			</CardContent>
		</Card>
	);
}

const allowedWord = (allowed: boolean): string =>
	allowed ? "Allowed" : "None";
