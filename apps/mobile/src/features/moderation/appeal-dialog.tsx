import { REPORT_LIMITS } from "@rowcat/contracts";
import { space } from "@rowcat/design";
import { MY_MODERATION_QUERY_KEY } from "@rowcat/query";
import {
	Button,
	Dialog,
	DialogActions,
	Notice,
	Text,
	Textarea,
} from "@rowcat/ui-native";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { AnimatedCount } from "../../lib/motion/animated-count.tsx";
import { checkAppealMessage } from "./appeal-form.ts";
import { createAppealTurn } from "./appeal-turn.ts";
import {
	APPEAL_CANCEL_LABEL,
	APPEAL_DIALOG_DESCRIPTION,
	APPEAL_MESSAGE_LABEL,
	APPEAL_SUBMIT_LABEL,
	APPEAL_SUBMITTING_LABEL,
	appealDialogTitle,
} from "./moderation-copy.ts";

/**
 * The appeal dialog. Native counterpart of the web's `appeal-dialog.tsx`.
 *
 * **It opens even for suspended or blocked accounts.** That gate belongs to the server
 * (`requireViewer`), and the screen does not imitate it. Adding a check such as
 * `canInteract(viewer)` here would stop a sanctioned person from contesting the decision, which
 * erases the reason this screen exists.
 *
 * ## Why the container is `Dialog` (compact)
 *
 * It is a single-field form. Unlike the report dialog (a reason list of eleven items plus a
 * description), this one holds only a body, a character count, an error and two buttons, so there
 * is no reason to fill a surface, and a rising bottom-sheet gesture would not add value here (see
 * the presentation table in `docs/design/ARCHITECTURE.md`: a single-field form is
 * `Dialog(compact)`).
 *
 * ## The title names the subject; the reference is not spoken
 *
 * The title carries the restriction's name, such as `Appeal account suspension`. `actionId` is only an argument
 * to the request and never appears in on-screen text, so a screen reader does not read an internal
 * identifier.
 *
 * ## Success is not shown by this dialog
 *
 * Once the server confirms and the restriction-status invalidation finishes, the dialog closes
 * immediately, and the refreshed parent restriction row ("under review") is the result. No separate
 * success banner is drawn. The ordering, lock and invalidation are owned by a pure module
 * (`appeal-turn.ts`).
 *
 * ## The body's lifetime is the dialog's lifetime
 *
 * Plaintext lives only in this component's state, and when the dialog closes (cancel, success, or
 * unmount on a viewer change) it disappears with it. It is not saved to the device and not included
 * in logs (the same rule as the unfinished report).
 */
export function AppealDialog({
	actionId,
	/** Which restriction is being appealed; it appears in the title (for example `Account suspended` or `Writing comments restricted`). */
	subject,
	onClose,
}: {
	actionId: string;
	subject: string;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const [message, setMessage] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const check = checkAppealMessage(message);

	/**
	 * Created once and held: creating it on every render would reset the lock inside it each time, so
	 * a second check in the same tick would not be folded. (Same wiring as the report dialog.)
	 */
	const turn = useMemo(
		() =>
			createAppealTurn({
				submit: (request) => getRowCatClient().moderation.appeal(request),
				/**
				 * Invalidates **only** the restriction status. Not `["viewer"]` and not `My reports`: an
				 * appeal does not change the viewer and has nothing to do with the report list.
				 */
				invalidate: () =>
					queryClient.invalidateQueries({ queryKey: MY_MODERATION_QUERY_KEY }),
			}),
		[queryClient],
	);

	const submit = () => {
		setPending(true);
		setError(null);
		void turn.run({ actionId, message }).then((result) => {
			/** A folded second check leaves the state alone; the run in progress owns it. */
			if (result.kind === "skipped" && result.why === "pending") return;
			setPending(false);
			/**
			 * On success, close: by this point the invalidation has finished, so the parent's restriction
			 * row already shows "under review". On failure, **the body is not cleared**: a network blip must
			 * not wipe a sentence the user has written.
			 */
			if (result.kind === "submitted") onClose();
			else if (result.kind === "failed") setError(result.message);
		});
	};

	return (
		<Dialog
			title={appealDialogTitle(subject)}
			description={APPEAL_DIALOG_DESCRIPTION}
			open
			onOpenChange={(next) => {
				/** Does not close while a submission is running; the same rule as the form dialogs in the security section. */
				if (!next && !pending) onClose();
			}}
		>
			<View style={form.root}>
				<View style={form.field}>
					<Textarea
						label={APPEAL_MESSAGE_LABEL}
						value={message}
						onChangeText={setMessage}
						/**
						 * No `maxLength`. With one, the over-limit state is **never expressed**, so the guidance
						 * sentence would never draw, and the tail of a pasted sentence would be silently dropped on
						 * submission. The check is a pure function (`appeal-form.ts`).
						 */
						invalid={check.tooLong}
						editable={!pending}
					/>
					<View style={form.counter}>
						{/**
						 * Only the running character count moves. The limit's source is one contract (the screen
						 * holds no number of its own), and that value does not change. Because the count changes on
						 * every keystroke, its cadence is `continuous`.
						 */}
						<AnimatedCount
							value={String(message.length)}
							cadence="continuous"
							variant="caption"
							tone={check.tooLong ? "destructive" : "muted-foreground"}
						/>
						<Text
							variant="caption"
							tone={check.tooLong ? "destructive" : "muted-foreground"}
						>
							{` / ${REPORT_LIMITS.appealMessage}`}
						</Text>
					</View>
					{check.error ? (
						<Text accessibilityRole="alert" variant="label" tone="destructive">
							{check.error}
						</Text>
					) : null}
				</View>

				{error ? <Notice tone="destructive" message={error} /> : null}

				<DialogActions>
					<Button
						label={APPEAL_CANCEL_LABEL}
						variant="outline"
						fullWidth
						disabled={pending}
						onPress={onClose}
						style={form.action}
					/>
					<Button
						label={pending ? APPEAL_SUBMITTING_LABEL : APPEAL_SUBMIT_LABEL}
						fullWidth
						busy={pending}
						/**
						 * Neither an empty nor an over-limit body is sent. The final guard for the empty side is the
						 * turn's check (disabled is guidance); the over-limit side is rejected by the contract. Once
						 * the body is cut back under the limit, the button comes back to life.
						 */
						disabled={pending || !check.submittable}
						onPress={submit}
						style={form.action}
					/>
				</DialogActions>
			</View>
		</Dialog>
	);
}

const form = StyleSheet.create({
	root: { gap: space.md },
	field: { gap: space.xs },
	/** The running count and the fixed limit sit on one line; the box sets the position, not the glyphs. */
	counter: {
		alignItems: "center",
		alignSelf: "flex-end",
		flexDirection: "row",
	},
	/** Fills the row in a vertically stacked action row, in place of `flex: 1` on a horizontal one. */
	action: { alignSelf: "stretch" },
});
