import { CHAT_MAX_MESSAGE_CHARS } from "@rowcat/contracts";
import { space } from "@rowcat/design";
import {
	Button,
	Dialog,
	DialogActions,
	Notice,
	Textarea,
} from "@rowcat/ui-native";
import { useRef, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import {
	EDIT_FAILURE_MESSAGE,
	editWarningCopy,
	planMessageEdit,
} from "./actions.ts";
import { messageEditPresentation } from "./edit-presentation.ts";

/**
 * Message edit; it states first that saving deletes what follows. Same rules and same-named
 * container as web's `edit-message-dialog.tsx`; only render code and keyboard handling differ, and
 * `planMessageEdit` (`@rowcat/chat`) decides what is saved.
 *
 * - The container depends on device height: `Dialog(compact)` on roomy devices, `Dialog(full)` on
 *   short ones so the keyboard does not clip the form. The decision is the pure
 *   `messageEditPresentation`; it does not fall back to a bottom sheet, because a short screen
 *   needs a bigger form surface, not a rising gesture.
 * - It edits the stored original, not the drawn text, so users fix what they wrote even once
 *   markdown rendering applies.
 * - The warning count is recomputed by the parent every render (`countLaterMessages`); a count
 *   taken at open would drift from the real range after a sync or another tab's write.
 * - Failure is reported inside the dialog, and closing happens after the commit; closing first
 *   lets users read an unsaved edit as saved.
 */
export function EditMessageDialog({
	content,
	later,
	onClose,
	onSave,
}: {
	/** The stored original. */
	content: string;
	/** Messages after this one; saving deletes them. */
	later: number;
	onClose: () => void;
	onSave: (content: string) => Promise<unknown>;
}) {
	const { height } = useWindowDimensions();
	const [draft, setDraft] = useState(content);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	/** One confirmation is one save: blocks a second press in the same tick. */
	const pendingRef = useRef(false);

	const warning = editWarningCopy(later);

	const submit = () => {
		if (pendingRef.current) return;
		const plan = planMessageEdit(draft, content, later);
		if (plan.kind === "invalid") return setError(plan.message);
		// With nothing changed or deleted, close without writing (avoids wasting a revision).
		if (plan.kind === "unchanged") return onClose();

		pendingRef.current = true;
		setPending(true);
		setError(null);
		void onSave(plan.content)
			.then(onClose)
			.catch(() => {
				pendingRef.current = false;
				setPending(false);
				setError(EDIT_FAILURE_MESSAGE);
			});
	};

	return (
		<Dialog
			title="Edit message"
			open
			scroll
			size={messageEditPresentation(height) === "full" ? "full" : "compact"}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<View style={form.root}>
				<Textarea
					label="Message"
					labelHidden
					value={draft}
					onChangeText={(next) => {
						setDraft(next);
						setError(null);
					}}
					autoFocus
					maxLength={CHAT_MAX_MESSAGE_CHARS}
					invalid={error !== null}
					style={form.input}
				/>

				{/**
				 * The warning sits above the save button; below it, a raised keyboard would show the
				 * button while the reason stays off screen.
				 */}
				{warning ? <Notice message={warning} /> : null}
				{error ? <Notice tone="destructive" message={error} /> : null}

				<DialogActions>
					<Button
						label="Cancel"
						variant="outline"
						fullWidth
						onPress={onClose}
						style={form.action}
					/>
					<Button
						label="Save"
						fullWidth
						onPress={submit}
						busy={pending}
						style={form.action}
					/>
				</DialogActions>
			</View>
		</Dialog>
	);
}

const form = StyleSheet.create({
	root: { gap: space.md },
	/** Grows over several lines without the box taking the whole screen; the dialog owns the cap. */
	input: { minHeight: 120 },
	/** Fills the row in a vertically stacked action row, standing in for a horizontal row's `flex: 1`. */
	action: { alignSelf: "stretch" },
});
