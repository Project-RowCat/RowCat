import { space } from "@rowcat/design";
import { Button, Dialog, DialogActions, Input, Text } from "@rowcat/ui-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { unlockFailureMessage } from "./sync-failure.ts";

/**
 * Unlocks with a recovery code. Native counterpart of web `unlock-dialog.tsx`.
 *
 * Case, hyphens and spaces are normalized by the input side (the code grammar is owned by
 * `@rowcat/sync`'s `normalizeRecoveryCode` family). The user should not have to match them, so this
 * dialog does not build a second parser and passes input through as typed.
 *
 * The two-branch failure copy is the point of this screen (`sync-failure.ts`): a mistyped code and
 * a different code entirely call for different next steps.
 */
export function UnlockDialog({
	open,
	onClose,
	onUnlock,
}: {
	open: boolean;
	onClose: () => void;
	/** Resolves on success, rejects on failure. The dialog picks the message. */
	onUnlock: (code: string) => Promise<void>;
}) {
	const [code, setCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const close = (): void => {
		setCode("");
		setError(null);
		onClose();
	};

	const submit = (): void => {
		if (busy || !code) return;
		setBusy(true);
		setError(null);
		void onUnlock(code)
			.then(() => close())
			.catch((failure: unknown) => setError(unlockFailureMessage(failure)))
			.finally(() => setBusy(false));
	};

	return (
		<Dialog
			title="Unlock"
			description="Enter the recovery code you received when you set up sync."
			open={open}
			onOpenChange={(next) => {
				if (!next && !busy) close();
			}}
		>
			<View style={styles.root}>
				<Input
					label="Recovery code"
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
					<Text accessibilityRole="alert" variant="label" tone="destructive">
						{error}
					</Text>
				) : null}

				<DialogActions>
					<Button
						label="Cancel"
						variant="outline"
						fullWidth
						disabled={busy}
						onPress={close}
						style={styles.action}
					/>
					<Button
						label={busy ? "Checking…" : "Unlock"}
						fullWidth
						busy={busy}
						disabled={busy || code.length === 0}
						onPress={submit}
						style={styles.action}
					/>
				</DialogActions>
			</View>
		</Dialog>
	);
}

const styles = StyleSheet.create({
	root: { gap: space.md },
	/** Fills the row in the stacked action column; stands in for `flex: 1` in a horizontal row. */
	action: { alignSelf: "stretch" },
});
