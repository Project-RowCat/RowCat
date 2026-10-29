import { space } from "@rowcat/design";
import {
	Button,
	Dialog,
	DialogActions,
	Input,
	Notice,
	Text,
} from "@rowcat/ui-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { approveFailureMessage } from "./sync-failure.ts";

/**
 * Trusted-device side: approves the code a new device is showing (counterpart of web
 * `approve-pairing-dialog.tsx`).
 *
 * Irreversible. Approval gives the device the current key, and deleting the server's relay row
 * later does not take back what that device already knows, so the copy states this before the
 * button is pressed. There is no auto-approve path: a person copying the code and pressing the
 * button is the only place "trust this device" is expressed in this protocol.
 *
 * The pairing code is neither stored nor logged; it lives in dialog state and disappears on close.
 */
export function ApprovePairingDialog({
	open,
	onClose,
	onApprove,
}: {
	open: boolean;
	onClose: () => void;
	/** Resolves on success, rejects on failure. The dialog picks the message. */
	onApprove: (code: string) => Promise<void>;
}) {
	const [code, setCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [done, setDone] = useState(false);

	const close = (): void => {
		setCode("");
		setError(null);
		setDone(false);
		onClose();
	};

	const submit = (): void => {
		if (busy || !code) return;
		setBusy(true);
		setError(null);
		void onApprove(code)
			.then(() => setDone(true))
			.catch((failure: unknown) => setError(approveFailureMessage(failure)))
			.finally(() => setBusy(false));
	};

	return (
		<Dialog
			title="Connect a new device"
			description="Enter the code shown on the new device's screen."
			open={open}
			onOpenChange={(next) => {
				if (!next && !busy) close();
			}}
		>
			<View style={styles.root}>
				{done ? (
					<View style={styles.result}>
						<Text variant="body">Approved.</Text>
						<Text variant="label" tone="muted-foreground">
							Sync will open on the new device shortly.
						</Text>
					</View>
				) : (
					<>
						<Input
							label="Connection code"
							value={code}
							onChangeText={(next) => {
								setCode(next);
								setError(null);
							}}
							autoCapitalize="characters"
							autoCorrect={false}
							editable={!busy}
							invalid={error !== null}
							onSubmitEditing={submit}
						/>
						{error ? (
							<Text
								accessibilityRole="alert"
								variant="label"
								tone="destructive"
							>
								{error}
							</Text>
						) : null}
						{/** States what approval hands over, before the button is pressed. */}
						<Notice message="Approving lets that device read this account's conversations and drafts. It can't be undone remotely after approval." />
					</>
				)}

				<DialogActions>
					<Button
						label={done ? "Close" : "Cancel"}
						variant="outline"
						fullWidth
						disabled={busy}
						onPress={close}
						style={styles.action}
					/>
					{done ? null : (
						<Button
							label={busy ? "Approving…" : "Approve"}
							fullWidth
							busy={busy}
							disabled={busy || code.length === 0}
							onPress={submit}
							style={styles.action}
						/>
					)}
				</DialogActions>
			</View>
		</Dialog>
	);
}

const styles = StyleSheet.create({
	root: { gap: space.md },
	result: { gap: space.xs },
	/** Fills the row in the stacked action column; stands in for `flex: 1` in a horizontal row. */
	action: { alignSelf: "stretch" },
});
