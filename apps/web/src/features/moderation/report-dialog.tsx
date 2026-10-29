import {
	REPORT_LIMITS,
	REPORT_REASON_LABEL,
	type ReportReason,
	type ReportTarget,
} from "@rowcat/contracts";
import { invalidateMyReports } from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import { Checkbox } from "@rowcat/ui-web/components/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Label } from "@rowcat/ui-web/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@rowcat/ui-web/components/select";
import { Textarea } from "@rowcat/ui-web/components/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { type ReactNode, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { AnimatedCount } from "#/lib/motion/animated-count.tsx";
import { useExitGuard } from "#/lib/motion/exit-guard.ts";
import { feedbackEnter, feedbackExit } from "#/lib/motion/feedback.ts";
import { enterTransition, exitTransition } from "#/lib/motion/transitions.ts";
import type { AiEvidencePreviewItem } from "./ai-evidence.ts";
import { aiEvidenceDisclosure } from "./ai-evidence.ts";
import { reportErrorMessage } from "./report-error.ts";

/**
 * The report dialog. Four targets share it, because the question is always the same: why is this
 * being reported, and is there anything to add. What differs is what gets sent, and that shows only
 * for AI-response reports, where the dialog adds a preview and disclosure.
 * - No punishment choice. The list has no block or hide option: the reporter says what is wrong,
 *   and the operator decides what happens (§13). The request schema has no punishment field, so no
 *   button could be added for it.
 * - Minimal confirmation. Success shows one line, `received`. No case number and no
 *   count of other reports against the same target (§49): it is useless to the reporter, and such a
 *   count could help coordinate targeted reports. The server does not return those values, so the
 *   screen has nothing to draw.
 */

export interface ReportDialogProps {
	/** Which target is being reported, matching the contract's discriminated union exactly. */
	target: ReportTarget;
	/**
	 * Target name shown in the dialog title: `Story`, `Comment`, `Profile` or `AI response`
	 * (AI response).
	 */
	targetLabel: string;
	/**
	 * Exactly what will be sent for AI-response reports; empty for other targets. It is derived from
	 * target.evidence (ai-evidence.ts). A separately built preview could diverge from what is sent,
	 * and the mismatch would surface only as the user uploading content they did not agree to.
	 */
	evidencePreview?: AiEvidencePreviewItem[];
	/**
	 * Whether the user's immediately preceding message is sent along. Used only for AI-response
	 * reports.
	 */
	includePreceding?: boolean;
	onIncludePrecedingChange?: (next: boolean) => void;
	onClose: () => void;
}

const REASONS = Object.keys(REPORT_REASON_LABEL) as ReportReason[];

/**
 * Splits the dialog into two faces: the form, then the receipt. Without a transition the content
 * would switch abruptly, with nothing linking the second face to the action just taken. mode="wait"
 * fits because the faces differ greatly in height; overlapping them would make the dialog grow and
 * shrink. The exit guard is tied to presence state rather than the exit target, because some tabs
 * never send the frames an exit target needs (lib/motion/exit-guard.ts), which is exactly when a
 * leaving face lingers longest.
 */
function ReportPanel({ children }: { children: ReactNode }) {
	const exiting = useExitGuard();
	return (
		<m.div
			className="grid gap-6"
			style={exiting}
			/*
			 * The entering face rises from below and the leaving face moves up. The opposite directions
			 * matter with mode="wait": nothing overlaps, so no sibling is flowing to fill the space, and
			 * only the sense of a procedure advancing remains. The 3px and 2px shifts are the shortest in
			 * this repo's motion scale; this is a report screen, not a celebration.
			 */
			initial={{ opacity: 0, y: 3 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0, y: -2, transition: exitTransition }}
			transition={enterTransition}
		>
			{children}
		</m.div>
	);
}

export function ReportDialog({
	target,
	targetLabel,
	evidencePreview,
	includePreceding,
	onIncludePrecedingChange,
	onClose,
}: ReportDialogProps) {
	const { t } = useTranslation(["moderation", "common"]);
	const reasonId = useId();
	const detailsId = useId();
	const precedingId = useId();
	const [reason, setReason] = useState<ReportReason | null>(null);
	const [details, setDetails] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [done, setDone] = useState(false);
	/** One confirmation is one submission. Running twice would create duplicate reports. */
	const pendingRef = useRef(false);
	const queryClient = useQueryClient();

	const isAi = target.type === "ai_response";

	const submit = async (): Promise<void> => {
		if (pendingRef.current || !reason) return;
		pendingRef.current = true;
		setPending(true);
		setError(null);
		try {
			await getRowCatClient().moderation.report({ target, reason, details });
			setDone(true);
			/**
			 * Marks only the account screen's `My reports` cache entry as stale; the query package defines the
			 * scope. This happens here because that section may not be mounted: with no active observer no
			 * request goes out, and the stale mark keeps the old value from being drawn when the account
			 * screen opens later. Not awaited, since the report was already accepted and cache cleanup
			 * should not delay the receipt.
			 */
			void invalidateMyReports(queryClient);
		} catch (failure) {
			/**
			 * Failure details are not logged to the console. The request body contains the user's
			 * description and, for AI reports, conversation content. The console is where extensions read
			 * and error reporters collect breadcrumbs (§54, §72).
			 */
			setError(reportErrorMessage(failure));
		} finally {
			pendingRef.current = false;
			setPending(false);
		}
	};

	return (
		<Dialog
			open
			onOpenChange={(next, dialogDetails) => {
				if (!next && shouldCloseDialog(dialogDetails.reason, pending))
					onClose();
			}}
		>
			<DialogContent
				closeButtonDisabled={pending}
				className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-lg`}
			>
				{/*
				 * The state changes first. Neither `done` nor cache invalidation waits for this transition: the
				 * state settled
				 * when submit received the response, and this only connects that fact to the frame that shows it
				 * (docs/motion/ARCHITECTURE.md). initial={false} keeps the form from animating in on first open,
				 * since that is
				 * the answer to the user opening the dialog rather than a step in the procedure.
				 */}
				<AnimatePresence initial={false} mode="wait">
					{done ? (
						<ReportPanel key="done">
							<DialogHeader>
								<DialogTitle>{t("dialog.receivedTitle")}</DialogTitle>
								{/*
								 * The text once said individual outcomes are not announced, which became false when the my-reports
								 * list and
								 * review-complete notifications were added. The dialog now promises exactly those two things: a
								 * notice when
								 * review ends, and the status on the account screen. It states no processing deadline, because the
								 * product has
								 * no such promise, and says nothing about the action to be taken,
								 * which is
								 * decided only after review.
								 */}
								<DialogDescription>
									{t("dialog.receivedBody")}
								</DialogDescription>
							</DialogHeader>
							<DialogFooter>
								<Button onClick={onClose}>{t("dialog.close")}</Button>
							</DialogFooter>
						</ReportPanel>
					) : (
						<ReportPanel key="form">
							<DialogHeader>
								<DialogTitle>
									{t("dialog.title", { target: targetLabel })}
								</DialogTitle>
								<DialogDescription>{t("dialog.description")}</DialogDescription>
							</DialogHeader>

							{/*
							 * A real form, because the reason, description and evidence consent are one form state sent by one
							 * action.
							 * Separate submit paths (a button onClick plus a form onSubmit) would each get different guards,
							 * and pendingRef
							 * only blocks a second submit in the same tick. The receipt face sits outside the form since it has
							 * nothing to
							 * send. noValidate matches the repo's other dialogs: the missing reason is already stated by the
							 * disabled
							 * button, and a browser bubble would point at a visually hidden native select.
							 */}
							<form
								noValidate
								className="grid gap-6"
								onSubmit={(event) => {
									event.preventDefault();
									void submit();
								}}
							>
								<div className="flex flex-col gap-4">
									<div className="flex flex-col gap-1.5">
										<Label htmlFor={reasonId}>{t("dialog.reason")}</Label>
										{/*
										 * `required` belongs to the primitive: Base UI exposes it as aria-required on the trigger
										 * (SelectTrigger). On
										 * the wrapping div it would not reach the focused element, and a screen reader user would hear a
										 * choice that
										 * could be skipped. An empty reason is not drawn as an error: nothing is chosen yet on open, and a
										 * red sentence
										 * there would stop being read as a warning. The inability to submit is stated by the button, and
										 * the absence of
										 * aria-invalid reflects that.
										 */}
										<Select
											required
											items={REASONS.map((value) => ({
												value,
												label: t(`reason.${value}`),
											}))}
											value={reason}
											onValueChange={(next) => {
												if (next === null) return;
												setReason(next as ReportReason);
											}}
										>
											<SelectTrigger id={reasonId} className="w-full">
												<SelectValue
													placeholder={t("dialog.reasonPlaceholder")}
												/>
											</SelectTrigger>
											<SelectContent>
												{REASONS.map((value) => (
													<SelectItem key={value} value={value}>
														{t(`reason.${value}`)}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>

									<div className="flex flex-col gap-1.5">
										<Label htmlFor={detailsId}>{t("dialog.details")}</Label>
										<Textarea
											id={detailsId}
											value={details}
											maxLength={REPORT_LIMITS.details}
											rows={3}
											placeholder={t("dialog.detailsPlaceholder")}
											onChange={(event) => setDetails(event.target.value)}
										/>
										<p className="text-right text-xs text-muted-foreground">
											{/* Only the count is live. The limit never changes, so it is not announced. */}
											<AnimatedCount
												value={String(details.length)}
												cadence="continuous"
											/>{" "}
											/ {REPORT_LIMITS.details}
										</p>
									</div>

									{isAi && (
										/*
										 * Shows the content exactly as it will be sent (§48). Without this block the user presses
										 * the button without knowing which parts of their conversation reach the server.
										 */
										<section className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
											<h3 className="text-sm font-medium">
												{t("dialog.evidence")}
											</h3>
											{onIncludePrecedingChange && (
												/*
												 * The Checkbox is button-based, so wrapping the label is not enough to associate them.
												 * id and htmlFor are required, so a user who cannot see the screen hears what the
												 * toggle controls.
												 */
												<div className="flex items-center gap-2 text-sm">
													<Checkbox
														id={precedingId}
														checked={includePreceding ?? false}
														onCheckedChange={(next) =>
															onIncludePrecedingChange(next === true)
														}
													/>
													<Label htmlFor={precedingId} className="font-normal">
														{t("dialog.includePrevious")}
													</Label>
												</div>
											)}
											<ul className="flex flex-col gap-2">
												{(evidencePreview ?? []).map((item) => (
													<li
														key={item.label}
														className="rounded border bg-background/60 p-2"
													>
														<p className="text-xs font-medium text-muted-foreground">
															{item.label}
														</p>
														{/*
														 * Plain text only: no markdown renderer and no dangerouslySetInnerHTML. As with comments, and more
														 * so here, the
														 * content being reported is the least trustworthy input on the screen.
														 */}
														<p className="mt-1 max-h-32 overflow-y-auto text-sm break-words whitespace-pre-wrap">
															{item.content}
														</p>
													</li>
												))}
											</ul>
											<p className="text-xs text-muted-foreground">
												{aiEvidenceDisclosure()}
											</p>
										</section>
									)}
								</div>

								{/*
								 * Submission failure uses the same one-line rhythm as failures elsewhere (lib/motion/feedback.ts),
								 * so the same
								 * kind of event arrives at the same distance everywhere. The copy is not reworded here. No
								 * mode="wait": the
								 * footer sits directly below, and serialized exits would delay the buttons. The key is the slot
								 * rather than the
								 * reason, because setError(null) runs before any resubmission.
								 */}
								<AnimatePresence initial={false}>
									{error && (
										<m.p
											key="report-error"
											role="alert"
											initial={feedbackEnter.initial}
											animate={feedbackEnter.animate}
											exit={feedbackExit}
											transition={feedbackEnter.transition}
											className="text-sm text-destructive"
										>
											{error}
										</m.p>
									)}
								</AnimatePresence>

								<DialogFooter>
									{/* Buttons inside a form default to submit. This pins `Cancel` so it does not send the report. */}
									<Button
										type="button"
										variant="outline"
										onClick={onClose}
										disabled={pending}
									>
										{t("common:actions.cancel")}
									</Button>
									<Button
										type="submit"
										/* Does not submit without a reason: a report with no reason cannot be reviewed. */
										disabled={pending || !reason}
									>
										{pending ? t("dialog.submitting") : t("dialog.submit")}
									</Button>
								</DialogFooter>
							</form>
						</ReportPanel>
					)}
				</AnimatePresence>
			</DialogContent>
		</Dialog>
	);
}
