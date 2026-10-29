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
import {
	DELETE_CANCEL_LABEL,
	DELETE_CONFIRM_LABEL,
	DELETE_CONFIRMING_LABEL,
	DELETE_DIALOG_DESCRIPTION,
	DELETE_DIALOG_TITLE,
	DELETE_FRESH_SESSION_NOTE,
	DELETE_PASSWORD_LABEL,
	DELETE_REMAINS_ITEMS,
	DELETE_REMAINS_TITLE,
	DELETE_REMOVED_ITEMS,
	DELETE_REMOVED_TITLE,
} from "./account-copy.ts";

/**
 * Account deletion confirmation; states what disappears and what stays first (native counterpart of
 * web `delete-account-dialog.tsx`).
 *
 * It is a `Dialog size="full"` because two lists (ten rows), a password field and two buttons do
 * not fit a centred box at accessibility font sizes, and the keyboard covers the rest. Not an
 * `AlertDialog`, which cannot hold a form; irreversibility is carried by the title, copy and
 * destructive button.
 *
 * It does not make the user type a confirmation phrase, which verifies no identity. Safety comes
 * from the password (credential accounts) or a recent login (social-only), which the auth layer
 * actually checks.
 *
 * The plaintext password lives only in this component's state and is cleared the moment confirm is
 * pressed; on failure the user types it again, a cheap cost before an irreversible action. It is
 * not trimmed.
 */
export function DeleteAccountDialog({
	hasPassword,
	pending,
	error,
	onClose,
	onConfirm,
}: {
	/**
	 * Whether the account has a credential method, which decides if the password field is drawn.
	 * Social-only accounts get a recent-login check instead of an unfillable field.
	 */
	hasPassword: boolean;
	pending: boolean;
	error: string | null;
	onClose: () => void;
	onConfirm: (password?: string) => void;
}) {
	const [password, setPassword] = useState("");

	/**
	 * Blocks a second confirm in the same tick. The pure turn's lock (`deletion-turn.ts`) is the final
	 * authority; this keeps the duplicate request from being created at all.
	 */
	const submitting = useRef(false);

	const submit = (): void => {
		if (submitting.current || pending) return;
		if (hasPassword && !password) return;
		submitting.current = true;
		onConfirm(hasPassword ? password : undefined);
		/** Not kept in screen state; on failure the user types it again. */
		setPassword("");
		submitting.current = false;
	};

	return (
		<Dialog
			title={DELETE_DIALOG_TITLE}
			description={DELETE_DIALOG_DESCRIPTION}
			size="full"
			open
			onOpenChange={(next) => {
				/**
				 * Stays open while the irreversible request runs, so the user keeps a place to see the outcome.
				 */
				if (!next && !pending) onClose();
			}}
		>
			<View style={styles.root}>
				<View style={styles.section}>
					<Text accessibilityRole="header" variant="body">
						{DELETE_REMOVED_TITLE}
					</Text>
					{DELETE_REMOVED_ITEMS.map((item) => (
						<Text key={item} variant="label" tone="muted-foreground">
							{`• ${item}`}
						</Text>
					))}
				</View>

				<View style={styles.section}>
					<Text accessibilityRole="header" variant="body">
						{DELETE_REMAINS_TITLE}
					</Text>
					{DELETE_REMAINS_ITEMS.map((item) => (
						<Text key={item} variant="label" tone="muted-foreground">
							{`• ${item}`}
						</Text>
					))}
				</View>

				{hasPassword ? (
					<Input
						label={DELETE_PASSWORD_LABEL}
						value={password}
						onChangeText={setPassword}
						secureTextEntry
						autoComplete="current-password"
						autoCapitalize="none"
						autoCorrect={false}
						editable={!pending}
						invalid={error !== null}
						onSubmitEditing={submit}
					/>
				) : (
					<Text variant="label" tone="muted-foreground">
						{DELETE_FRESH_SESSION_NOTE}
					</Text>
				)}

				{error ? <Notice tone="destructive" message={error} /> : null}

				<DialogActions>
					<Button
						label={DELETE_CANCEL_LABEL}
						variant="outline"
						fullWidth
						disabled={pending}
						onPress={onClose}
						style={styles.action}
					/>
					<Button
						label={pending ? DELETE_CONFIRMING_LABEL : DELETE_CONFIRM_LABEL}
						variant="destructive"
						fullWidth
						busy={pending}
						/** With a required password empty there is nothing to submit; a 400 is not worth fetching. */
						disabled={pending || (hasPassword && !password)}
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
	section: { gap: space.xs },
	/** Fills the row in a vertical stack, replacing the `flex: 1` of a horizontal row. */
	action: { alignSelf: "stretch" },
});
