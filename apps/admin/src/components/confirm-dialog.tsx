import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Input } from "@rowcat/ui-web/components/input";
import { Label } from "@rowcat/ui-web/components/label";
import { Textarea } from "@rowcat/ui-web/components/textarea";
import { AlertTriangle } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { ErrorBlock } from "./states.tsx";

/**
 * Every destructive operation in this app goes through this dialog. Not `window.confirm()`: it
 * cannot take a reason, show the target or a failure, and it freezes the page while waiting — a
 * 30-second request reads as a dead browser.
 *
 * ```text
 * what          title
 * where         target        shown verbatim, id included
 * what result   consequence   what will happen, never "are you sure"
 * why           reason        recorded in the audit, so it cannot be empty (requireReason)
 * on failure    error         shown in the same window, not by closing and reopening
 * ```
 *
 * `consequence` is required because "Are you sure?" carries no information and gets pressed unread
 * — friction, not confirmation.
 *
 * - `secondary` is only for text going to a different audience (today: moderation's public
 *   reason, drawn on the sanctioned member's account screen). Merged with `reason`, an operator
 *   note would one day go out as a sanction notice, irreversibly, so labels differ and nothing is
 *   copied across. This is not a form container — widening to `fields: Field[]` loses the
 *   "confirmation" character.
 * - `acknowledgement` is only for irreversible destruction (today: operator story deletion).
 *   Retyping the phrase is the one way to block pressing without reading, so it is a narrow API:
 *   the caller supplies a constant phrase and only a match/no-match comes out. It is not
 *   enforcement — the server's authorization and reason checks are (`curl` skips this window).
 * - While `pending` the confirm button is disabled and the dialog will not close, since double
 *   pressing while waiting is normal and some operations are not idempotent. The close X is shown
 *   disabled (`closeButtonDisabled`) rather than hidden — it used to look active while
 *   `onOpenChange` swallowed it, and hiding it would shift the layout. The lock itself is still the
 *   `if (pending) return` below.
 */
export interface ConfirmDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	/** Verbatim, id included, so a wrong target is visible here. */
	target: ReactNode;
	/** What will happen — never replaced by "are you sure". */
	consequence: ReactNode;
	confirmLabel: string;
	/** True for operations recorded in the audit. */
	requireReason?: boolean;
	reasonLabel?: string;
	reasonPlaceholder?: string;
	/**
	 * The contract's cap. Without it the server rejects with 400 after the operator has written the
	 * whole reason.
	 */
	reasonMaxLength?: number;
	/**
	 * Text for a different audience (see header); not drawn when absent. Always optional — empty is
	 * normal and arrives as an empty string.
	 */
	secondary?: {
		label: string;
		placeholder?: string;
		/** Where this text will be shown — the sentence that tells the two fields apart. */
		hint: string;
		maxLength?: number;
	};
	/**
	 * Retype-to-confirm for irreversible destruction; not drawn when absent. `phrase` must be a
	 * contract constant — a screen-built sentence diverges from what the server checks, and the
	 * operator who copied it exactly gets a 400.
	 */
	acknowledgement?: {
		phrase: string;
		/** Why this is required: state the result, do not repeat the phrase. */
		hint: string;
	};
	pending: boolean;
	error: unknown;
	/**
	 * The phrase is not passed: this is only called on a match, and the caller already holds the
	 * constant.
	 */
	onConfirm: (reason: string, secondary: string) => void;
	destructive?: boolean;
	/**
	 * The target's verdict has not arrived or forbids the operation. Only consumer: the rollback
	 * confirmation, whose button would get a 409 before the server's plan arrives or while a newer
	 * active release exists. `consequence` must already say why; this only locks the button.
	 */
	confirmDisabled?: boolean;
}

export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	target,
	consequence,
	confirmLabel,
	requireReason = false,
	reasonLabel = "Reason",
	reasonPlaceholder,
	reasonMaxLength,
	secondary,
	acknowledgement,
	pending,
	error,
	onConfirm,
	destructive = true,
	confirmDisabled = false,
}: ConfirmDialogProps) {
	const reasonId = useId();
	const secondaryId = useId();
	const acknowledgementId = useId();
	const [reason, setReason] = useState("");
	const [secondaryValue, setSecondaryValue] = useState("");
	const [acknowledgementValue, setAcknowledgementValue] = useState("");

	/**
	 * Cleared on every open: a leftover reason would attach to the next operation's audit record —
	 * wrong but plausible, misleading whoever reads the log later.
	 */
	useEffect(() => {
		if (!open) return;
		setReason("");
		setSecondaryValue("");
		setAcknowledgementValue("");
	}, [open]);

	const reasonMissing = requireReason && reason.trim().length === 0;
	/**
	 * Exact match, no case or whitespace folding: the point is to make the operator read, and leniency
	 * works against that. Only the ends are trimmed (pasting often brings a newline).
	 */
	const acknowledgementMissing =
		acknowledgement !== undefined &&
		acknowledgementValue.trim() !== acknowledgement.phrase;

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				// Never close mid-operation, before the result is seen.
				if (pending) return;
				onOpenChange(next);
			}}
		>
			<DialogContent closeButtonDisabled={pending} className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						{destructive ? (
							<AlertTriangle className="size-4 text-destructive" aria-hidden />
						) : null}
						{title}
					</DialogTitle>
					<DialogDescription>
						This operation is hard to undo. Check the target and the result.
					</DialogDescription>
				</DialogHeader>

				{/**
				 * Target and consequence sit outside `DialogDescription`: that element is linked by
				 * `aria-describedby`, and block layout inside it is read as one paragraph.
				 */}
				<div className="space-y-3">
					<div className="rounded-md border border-border bg-muted/40 p-3">
						<p className="mb-1 font-medium text-foreground text-xs uppercase tracking-wide">
							Target
						</p>
						<div className="break-all font-mono text-foreground text-xs">
							{target}
						</div>
					</div>
					<div className="text-sm">{consequence}</div>
				</div>

				{requireReason ? (
					<div className="space-y-1.5">
						<Label htmlFor={reasonId}>{reasonLabel}</Label>
						<Textarea
							id={reasonId}
							value={reason}
							onChange={(event) => setReason(event.target.value)}
							placeholder={reasonPlaceholder}
							maxLength={reasonMaxLength}
							rows={3}
							disabled={pending}
						/>
						<p className="text-muted-foreground text-xs">
							Recorded in the audit log. Whoever investigates this operation
							later will read it.
						</p>
					</div>
				) : null}

				{secondary ? (
					<div className="space-y-1.5">
						<Label htmlFor={secondaryId}>{secondary.label}</Label>
						<Textarea
							id={secondaryId}
							value={secondaryValue}
							onChange={(event) => setSecondaryValue(event.target.value)}
							placeholder={secondary.placeholder}
							maxLength={secondary.maxLength}
							rows={2}
							disabled={pending}
						/>
						<p className="text-muted-foreground text-xs">{secondary.hint}</p>
					</div>
				) : null}

				{acknowledgement ? (
					<div className="space-y-1.5">
						<Label htmlFor={acknowledgementId}>
							Type the confirmation phrase exactly
						</Label>
						{/**
						 * Selectable text but no copy button — one press would remove the act of
						 * retyping, leaving only friction.
						 */}
						<p className="select-all rounded-md border border-border bg-muted/40 px-2.5 py-1.5 font-mono text-xs">
							{acknowledgement.phrase}
						</p>
						<Input
							id={acknowledgementId}
							value={acknowledgementValue}
							onChange={(event) => setAcknowledgementValue(event.target.value)}
							disabled={pending}
							autoComplete="off"
							aria-invalid={
								acknowledgementValue.length > 0 && acknowledgementMissing
							}
						/>
						<p className="text-destructive text-xs">{acknowledgement.hint}</p>
					</div>
				) : null}

				{/**
				 * Failure stays in this window; closing it for a toast would lose the reason just
				 * written.
				 */}
				{error ? <ErrorBlock error={error} /> : null}

				<DialogFooter>
					<Button
						variant="ghost"
						onClick={() => onOpenChange(false)}
						disabled={pending}
					>
						Cancel
					</Button>
					<Button
						variant={destructive ? "destructive" : "default"}
						onClick={() => onConfirm(reason.trim(), secondaryValue.trim())}
						/** Some operations are not idempotent, so no resubmission while pending. */
						disabled={
							pending ||
							reasonMissing ||
							acknowledgementMissing ||
							confirmDisabled
						}
					>
						{pending ? "Working…" : confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
