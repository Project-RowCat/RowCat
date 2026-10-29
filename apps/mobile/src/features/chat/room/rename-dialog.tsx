import { CHAT_ROOM_TITLE_MAX_LENGTH, chatTextLength } from "@rowcat/chat";
import { space } from "@rowcat/design";
import {
	Button,
	Dialog,
	DialogActions,
	Input,
	Notice,
	Text,
} from "@rowcat/ui-native";
import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { AnimatedCount } from "../../../lib/motion/animated-count.tsx";
import { planRename } from "../messages/actions.ts";
import { RENAME_FAILURE_MESSAGE } from "./actions.ts";

/**
 * Rename dialog, the same container and rules as web's `rename-room-dialog.tsx`. What to save is
 * decided by `planRoomRename` in `@rowcat/chat`.
 *
 * The initial value is the subscribed title, not a copy taken when the menu opened: a copy would
 * revert a rename that sync applied meanwhile if `Save` is pressed without editing.
 */

/** Margin below the limit at which the counter appears. */
const COUNTER_THRESHOLD = CHAT_ROOM_TITLE_MAX_LENGTH - 20;

export function RenameRoomDialog({
	title,
	onClose,
	onRename,
}: {
	title: string;
	onClose: () => void;
	onRename: (title: string) => Promise<unknown>;
}) {
	const [draft, setDraft] = useState(title);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const pendingRef = useRef(false);

	const length = chatTextLength(draft);

	const submit = () => {
		if (pendingRef.current) return;
		const plan = planRename(draft, title);
		if (plan.kind === "invalid") return setError(plan.message);
		// Nothing changed: close without writing, so no revision is wasted.
		if (plan.kind === "unchanged") return onClose();

		pendingRef.current = true;
		setPending(true);
		setError(null);
		void onRename(plan.title)
			.then(onClose)
			.catch(() => {
				pendingRef.current = false;
				setPending(false);
				setError(RENAME_FAILURE_MESSAGE);
			});
	};

	return (
		<Dialog
			title="Rename"
			open
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<View style={form.root}>
				<Input
					label="Conversation name"
					labelHidden
					value={draft}
					onChangeText={(next) => {
						setDraft(next);
						setError(null);
					}}
					autoFocus
					returnKeyType="done"
					onSubmitEditing={submit}
					/* No `maxLength`: over-limit input must stay visible so the limit message can show. */
					invalid={error !== null}
				/>

				{length >= COUNTER_THRESHOLD ? (
					/* Only the current length animates; `continuous` because it changes per keystroke. */
					<View style={form.counter}>
						<AnimatedCount
							value={String(length)}
							cadence="continuous"
							variant="caption"
							tone="muted-foreground"
						/>
						<Text variant="caption" tone="muted-foreground">
							{` / ${CHAT_ROOM_TITLE_MAX_LENGTH}`}
						</Text>
					</View>
				) : null}
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
	/** Stretches to fill the stacked action row, standing in for a horizontal row's `flex: 1`. */
	action: { alignSelf: "stretch" },
	counter: { alignItems: "center", flexDirection: "row" },
});
