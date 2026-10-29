import { space } from "@rowcat/design";
import {
	Button,
	Dialog,
	DialogActions,
	Notice,
	Switch,
	Text,
} from "@rowcat/ui-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

/**
 * Shows the recovery code **once** — native counterpart of web `recovery-code-dialog.tsx`.
 *
 * There is no way to show it again, and that is the whole point of this screen. The server does not
 * store the code (storing it would let the server read the data), and we do not know it either. So
 * the dialog stays open until the user confirms they wrote it down. Android back, screen-reader
 * escape and the close button all pass through `onOpenChange`, which makes that the single gate.
 *
 * ## The code's lifetime is the dialog's lifetime
 *
 * The plaintext lives only in the parent's state and is cleared to `null` when the user confirms.
 * It is never stored on the device (SQLite, SecureStore, AsyncStorage), never put in navigation
 * params, and the product path has no logging at all.
 *
 * ## No copy button — a reversed decision
 *
 * A copy button using `expo-clipboard` existed for a while and was removed. The system clipboard is
 * read by other apps, and two paths sit beyond this app's control: Android 13+ previews copied text
 * on screen, and iOS Universal Clipboard spreads it to the account's other devices. This code is
 * the last key the server cannot restore, so none of those paths may receive it. What remains is
 * `selectable` text: only the range the user selects leaves the screen, and only when they act.
 */
export function RecoveryCodeDialog({
	code,
	title,
	onAcknowledge,
}: {
	/** null means closed. */
	code: string | null;
	title: string;
	onAcknowledge: () => void;
}) {
	const [confirmed, setConfirmed] = useState(false);
	const close = (): void => {
		setConfirmed(false);
		onAcknowledge();
	};

	return (
		<Dialog
			title={title}
			description="This code is shown only this once. You'll need it to open sync on another device."
			open={code !== null}
			onOpenChange={(next) => {
				/** Stays open until confirmed; closing by mistake leaves no way to undo. */
				if (!next && confirmed) close();
			}}
		>
			<View style={styles.root}>
				<Text selectable variant="body" style={styles.code}>
					{code ?? ""}
				</Text>

				<Notice message="The server doesn't know this code. If you lose it and no trusted device remains, the sync data stored on the server can never be read again. We can't recover it for you either. Conversations and drafts on this device stay as they are." />

				<View style={styles.ackRow}>
					<Text variant="body" style={styles.ackLabel}>
						I've written the code down somewhere safe.
					</Text>
					<Switch
						label="I've written the code down somewhere safe"
						value={confirmed}
						onValueChange={setConfirmed}
					/>
				</View>

				<DialogActions>
					<Button
						label="I've saved it"
						fullWidth
						disabled={!confirmed}
						onPress={close}
						style={styles.action}
					/>
				</DialogActions>
			</View>
		</Dialog>
	);
}

const styles = StyleSheet.create({
	root: { gap: space.md },
	/** The value the user copies by eye or in full; selectability is what this box is for. */
	code: { textAlign: "center" },
	ackRow: {
		alignItems: "center",
		flexDirection: "row",
		gap: space.sm,
		justifyContent: "space-between",
	},
	ackLabel: { flex: 1 },
	/** Fills the row in the stacked action column; stands in for `flex: 1` in a horizontal row. */
	action: { alignSelf: "stretch" },
});
