import {
	REPORT_LIMITS,
	REPORT_REASON_LABEL,
	type ReportReason,
	type ReportTarget,
} from "@rowcat/contracts";
import { space } from "@rowcat/design";
import { invalidateMyReports } from "@rowcat/query";
import {
	Button,
	Dialog,
	DialogActions,
	Notice,
	Select,
	SelectOption,
	Text,
	Textarea,
} from "@rowcat/ui-native";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { AnimatedCount } from "../../lib/motion/animated-count.tsx";
import { createReportTurn } from "./report-turn.ts";

/**
 * The report window. **All four targets share this window.**
 *
 * It is not one window per target because what gets asked is always the same: why are you
 * reporting, and is there anything to add. What differs is **what gets sent**, and that difference
 * shows up only for AI-reply reports. Only then does this window get a preview and a disclosure.
 * The web's `features/moderation/report-dialog.tsx` made the same call.
 *
 * ## Public targets do not express a preview
 *
 * This is the most important spot in this file. If `evidence` were one optional `ReactNode`, code
 * that attaches a chat fragment to a work report would compile, and the mistake shows **no
 * symptom**. The server snapshots its own row, so the attached node is drawn but never sent, until
 * the next person actually sends it.
 *
 * So the props are a discriminated union. For targets other than `ai_response`, `evidence` is
 * `never` and cannot be attached. For `ai_response`, it is **required**, so a window that sends a
 * conversation without the disclosure cannot be built.
 *
 * ## There is no place to choose a punishment
 *
 * The list has no `Block` or `Hide`. The reporter says what the problem is, and the operator decides
 * what to do. It matters that this rule is the **shape of the contract** and not a choice on this
 * screen: the request schema has no punishment field, so there is no button to put here.
 *
 * ## Why it fills the screen
 *
 * There are **eleven** reasons. Eleven 44pt rows alone come to 484pt, and below them come the
 * description field, the character count, an error and two buttons. Inside a box floating in the
 * middle, on devices with large accessibility text, the bottom of the reason list is pushed out of
 * scroll, and the moment the description is tapped the keyboard covers the rest again. That is the
 * same reason the AI report was once a bottom sheet before it moved here.
 *
 * ## Why the confirmation is minimal
 *
 * On success it is one line. No case number, and no count of how many other reports the same target
 * has. That is useless to the reporter, and the count is information that could be used to
 * coordinate targeted reporting. The server does not put that value in its response, so the screen
 * has nothing to draw even if it wanted to.
 *
 * ## Failures are not logged
 *
 * The body of this request holds the description the user wrote and, for AI reports, the
 * conversation content. The product-wide rule against `console` calls on product paths
 * (`lib/boundaries.test.ts`) prevents that.
 */

/** The three targets the server snapshots. The client carries only ids. */
export type PublicReportTarget = Exclude<ReportTarget, { type: "ai_response" }>;

export type ReportDialogProps = {
	/** Target name shown in the window title (`Story`, `Comment`, `Profile`, `AI response`). */
	targetLabel: string;
	onClose: () => void;
} & (
	| { target: PublicReportTarget; evidence?: never }
	/**
	 * Only AI replies carry evidence, and then the **preview is required**. Its node is built by
	 * `features/chat`. What goes up is the chat's rule, not the report's, and if this file started
	 * knowing `@rowcat/chat`, public reports would be bound to the chat contract.
	 */
	| {
			target: Extract<ReportTarget, { type: "ai_response" }>;
			evidence: ReactNode;
	  }
);

const REPORT_REASON_PLACEHOLDER = "Choose a reason";

const REASONS = Object.keys(REPORT_REASON_LABEL) as ReportReason[];

export function ReportDialog({
	target,
	targetLabel,
	evidence,
	onClose,
}: ReportDialogProps) {
	const [reason, setReason] = useState<ReportReason | null>(null);
	const [details, setDetails] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [done, setDone] = useState(false);
	const queryClient = useQueryClient();

	/**
	 * Ordering, locking and failure handling belong to a pure module (`report-turn.ts`). What remains
	 * here is form state and the container, so this component has no `pendingRef` and no `try/catch`.
	 *
	 * Create it once and hold it. If it were rebuilt on every render, the lock inside would reset each
	 * time, and **a second confirmation in the same tick could not be blocked**. That lock is exactly
	 * the point of this hook.
	 */
	const turn = useMemo(
		() =>
			createReportTurn({
				submit: (request) => getRowCatClient().moderation.report(request),
				/**
				 * Invalidates **only** the `My reports` cell of the account screen (`@rowcat/query` owns that scope).
				 * It is attached even though this app has no such screen yet, because the truth of the cache
				 * must not depend on whether the screen exists. Do not make the commit that creates the screen
				 * go hunting for this line.
				 */
				invalidate: () => void invalidateMyReports(queryClient),
			}),
		[queryClient],
	);

	const submit = () => {
		setPending(true);
		setError(null);
		void turn.run({ target, reason, details }).then((result) => {
			/**
			 * **The folded second confirmation does not touch state.** Reaching this branch means the first
			 * run is still in flight, and that run owns `pending`. Calling `setPending(false)` here would
			 * return the button to its normal look while the request is out, and the user would read that
			 * what they pressed did nothing.
			 */
			if (result.kind === "skipped" && result.why === "pending") return;
			setPending(false);
			/**
			 * The remaining `skipped` (no reason) is **not a failure** either, so draw nothing. Showing
			 * "could not file" to someone who pressed twice would make the user read the first, normally
			 * running request as a failure.
			 *
			 * On failure **the form values are not cleared.** The reason and description stay, so retrying
			 * is one tap, and a network hiccup does not erase the sentence the user had written.
			 */
			if (result.kind === "submitted") setDone(true);
			else if (result.kind === "failed") setError(result.message);
		});
	};

	return (
		<Dialog
			title={`Report ${targetLabel}`}
			open
			size="full"
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			{done ? (
				<View style={form.root}>
					{/**
					 * We do not state a processing deadline. A promise to look within days does not exist in this
					 * product (there is no voluntary SLA), and inventing it on screen would make a promise we
					 * cannot keep. Nor do we say what action will be taken: that is decided after review.
					 */}
					<Notice message="Your report was received. We'll take any needed action after review." />
					<Button label="Close" fullWidth onPress={onClose} />
				</View>
			) : (
				<View style={form.root}>
					<Text variant="body" tone="muted-foreground">
						Tell us what the problem is. What action to take is decided after
						review.
					</Text>

					<Text variant="label" tone="muted-foreground">
						Report reason
					</Text>
					{/**
					 * **Choosing a value tied to a trigger**, so this is a `Select`. The web's same form uses the same
					 * container (`apps/web`'s `report-dialog.tsx`).
					 *
					 * ⚠️ This was once an open radio group, so opening the window showed **eleven rows** first, pushing
					 * the description field and the actions out of scroll. That choosing is not the end of the procedure
					 * (the description is written after the reason) is itself the reason to collapse the list. The screen
					 * that remains after choosing should be the form.
					 *
					 * Not a `ChoiceSheet`, for the same reason as before: its qualification is "a short single choice",
					 * and eleven rows are not short.
					 */}
					<Select
						label="Report reason"
						value={
							reason === null
								? REPORT_REASON_PLACEHOLDER
								: REPORT_REASON_LABEL[reason]
						}
					>
						{REASONS.map((value) => (
							<SelectOption
								key={value}
								label={REPORT_REASON_LABEL[value]}
								selected={reason === value}
								onSelect={() => {
									setReason(value);
									setError(null);
								}}
							/>
						))}
					</Select>

					<View style={form.details}>
						<Textarea
							label="Additional details (optional)"
							value={details}
							onChangeText={setDetails}
							maxLength={REPORT_LIMITS.details}
						/>
						{/**
						 * The limit is owned by one contract. If the screen wrote its own number, a report that passed the
						 * screen would bounce with a 400, and the user would not see the cause.
						 */}
						<View style={form.counter}>
							{/**
							 * Only the current character count rolls: the limit is an unchanging fact. It is a value that
							 * ticks with each keystroke, so its rhythm is `continuous` (`@rowcat/design`).
							 */}
							<AnimatedCount
								value={String(details.length)}
								cadence="continuous"
								variant="caption"
								tone="muted-foreground"
							/>
							<Text variant="caption" tone="muted-foreground">
								{` / ${REPORT_LIMITS.details}`}
							</Text>
						</View>
					</View>

					{/**
					 * Nodes only come from AI-reply reports. For public targets the type is `never`, so there **cannot
					 * be** anything to draw here. The server snapshots its own row, so the client has no "content being
					 * sent" to show.
					 */}
					{evidence}

					{error ? <Notice tone="destructive" message={error} /> : null}

					<DialogActions>
						<Button
							label="Cancel"
							variant="outline"
							fullWidth
							disabled={pending}
							onPress={onClose}
							style={form.action}
						/>
						<Button
							label="Submit report"
							fullWidth
							onPress={submit}
							busy={pending}
							/** Do not file without a reason: a report without one cannot be reviewed. */
							disabled={reason === null}
							style={form.action}
						/>
					</DialogActions>
				</View>
			)}
		</Dialog>
	);
}

const form = StyleSheet.create({
	root: { gap: space.md },
	details: { gap: space.xs },
	/**
	 * The rolling count and the fixed limit sit on one line. The two are different kinds of value.
	 *
	 * `alignSelf` rather than `textAlign: "right"` is the point. Right alignment is a text rule, and
	 * this cell is now a row holding two boxes, so text properties cannot place it.
	 */
	counter: {
		alignItems: "center",
		alignSelf: "flex-end",
		flexDirection: "row",
	},
	/** Fills the row in the action row stacked vertically. It takes the place of `flex: 1` in a horizontal row. */
	action: { alignSelf: "stretch" },
});
