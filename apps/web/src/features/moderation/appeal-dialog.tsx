import { MY_MODERATION_QUERY_KEY } from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Label } from "@rowcat/ui-web/components/label";
import { Textarea } from "@rowcat/ui-web/components/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { AnimatedCount } from "#/lib/motion/animated-count.tsx";
import { feedbackEnter, feedbackExit } from "#/lib/motion/feedback.ts";
import { checkAppealMessage } from "./appeal-form.ts";
import { appealErrorMessage } from "./report-error.ts";

/**
 * The appeal dialog. It also opens for suspended or banned accounts. The server's gate
 * (requireViewer) governs that, and this screen must not mimic it. A canInteract-style check here
 * would stop sanctioned users from contesting, which §33 and §60 exist to prevent.
 * - One open appeal per action (§63). The database's unique index enforces it, and here it
 *   appears only as a failure message. Pre-checking would duplicate the rule. Whether the button is
 *   shown is still decided by appealableActionIds.
 * - Two failures, two places. An over-limit body is a field problem: the Textarea gets
 *   aria-invalid and the hint points at it. A failed submission is a form problem: a line above the
 *   footer, with the field value still valid. The two are not one axis, because a dropped
 *   connection would otherwise read the user's text back as an invalid value. The sources differ as
 *   well: checkAppealMessage is pure, appealErrorMessage reads the server response.
 */
export function AppealDialog({
	actionId,
	/** The subject of the appeal, shown in the title (for example `Account suspended` or `Commenting restricted`). */
	subject,
	onClose,
}: {
	actionId: string;
	subject: string;
	onClose: () => void;
}) {
	const { t } = useTranslation(["moderation", "common"]);
	const messageId = useId();
	/**
	 * One id per dialog instance. A module constant breaks when a closing and a newly opened dialog
	 * mount together during the exit animation. The same id would appear twice, and aria-describedby
	 * would read the first one.
	 */
	const overflowId = useId();
	const queryClient = useQueryClient();
	const [message, setMessage] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const pendingRef = useRef(false);

	/** Whether the current value meets the rule. The server's answer does not feed into this check. */
	const check = checkAppealMessage(message);

	const submit = async (): Promise<void> => {
		if (pendingRef.current || !check.submittable) return;
		pendingRef.current = true;
		setPending(true);
		setError(null);
		try {
			await getRowCatClient().moderation.appeal({ actionId, message });
			/**
			 * No optimistic insert. A confirmed appeal carries a timestamp and status, which a temporary row
			 * would have to invent. On failure the user would see an appeal they never filed. One
			 * invalidation returns exact values.
			 */
			await queryClient.invalidateQueries({
				queryKey: MY_MODERATION_QUERY_KEY,
			});
			onClose();
		} catch (failure) {
			/** The appeal body is not logged either. It is text the user wrote (§72). */
			setError(appealErrorMessage(failure));
		} finally {
			pendingRef.current = false;
			setPending(false);
		}
	};

	return (
		<Dialog
			open
			onOpenChange={(next, details) => {
				if (!next && shouldCloseDialog(details.reason, pending)) onClose();
			}}
		>
			<DialogContent
				closeButtonDisabled={pending}
				className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-lg`}
			>
				<DialogHeader>
					<DialogTitle>{t("appealDialog.title", { subject })}</DialogTitle>
					<DialogDescription>{t("appealDialog.description")}</DialogDescription>
				</DialogHeader>

				{/*
				 * A real form, and the submit path must be single for a reason beyond duplication: a button onClick
				 * beside a form onSubmit would put the next guard on only one of them. noValidate matches the
				 * repo's
				 * other dialogs, since the rules come from a pure function and a browser bubble would repeat the
				 * message
				 * in another voice. There is no method attribute on purpose: this dialog cannot open without
				 * JavaScript,
				 * and that axis belongs to forms that can submit before hydration. grid gap-6 re-creates
				 * DialogContent's
				 * grid, since the form is now one grid child.
				 */}
				<form
					noValidate
					className="grid gap-6"
					onSubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={messageId}>{t("appealDialog.label")}</Label>
						{/*
						 * No maxLength. It would hide the over-limit state, so the hint would never render, and a user
						 * pasting
						 * long text would submit a body with a silently cut tail. `required` says the field is needed; a
						 * disabled button alone does not tell someone focused in the field. Enter stays a line break, since
						 * appeal bodies are multi-paragraph.
						 */}
						<Textarea
							id={messageId}
							value={message}
							required
							rows={6}
							aria-invalid={check.tooLong}
							aria-describedby={check.error ? overflowId : undefined}
							onChange={(event) => setMessage(event.target.value)}
						/>
						<div className="flex items-start justify-between gap-3">
							{/*
							 * Field problems sit next to the field, not in a toast (docs/design/FAILURE-FEEDBACK.md): when the
							 * interactive surface stays on screen, failures are shown inline. Focus does not move, because the
							 * user
							 * is still typing when the limit is exceeded and a focus jump would send the next character to the
							 * wrong place.
							 */}
							{check.error ? (
								<p
									id={overflowId}
									role="alert"
									className="text-sm text-destructive"
								>
									{check.error}
								</p>
							) : (
								<span />
							)}
							{/*
							 * Above the limit, the count itself conveys it (rename-room-dialog does the same). No aria-live:
							 * announcing every character would make the field unusable, and the line above already states what
							 * needs saying.
							 */}
							<span
								className={`shrink-0 text-right text-xs tabular-nums ${
									check.tooLong ? "text-destructive" : "text-muted-foreground"
								}`}
							>
								{/* Only the count is live. The limit never changes, so it is not announced. */}
								<AnimatedCount
									value={String(check.count)}
									cadence="continuous"
								/>{" "}
								/ {check.limit}
							</span>
						</div>
					</div>

					{/*
					 * Submission failure uses the same one-line rhythm as the report dialog (lib/motion/feedback.ts),
					 * so the
					 * same kind of event arrives at the same distance in both. It does not change the field:
					 * aria-invalid
					 * reflects only the value breaking the rule, and a server rejection is a form failure. No
					 * mode="wait",
					 * since the footer sits right below and serialized exits would delay the buttons; the key is the
					 * slot,
					 * not the reason, because setError(null) runs first on resubmit. No success slot: the dialog closes
					 * right
					 * after invalidation and the refreshed parent state is the result.
					 */}
					<AnimatePresence initial={false}>
						{error && (
							<m.p
								key="appeal-error"
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
						{/* Buttons inside a form default to submit. This pins `Cancel` so it does not send the appeal. */}
						<Button
							type="button"
							variant="outline"
							onClick={onClose}
							disabled={pending}
						>
							{t("common:actions.cancel")}
						</Button>
						<Button type="submit" disabled={pending || !check.submittable}>
							{pending
								? t("appealDialog.submitting")
								: t("appealDialog.submit")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
