import { space } from "@rowcat/design";
import { Button, Dialog, DialogActions, Input, Text } from "@rowcat/ui-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import {
	checkPasswordForm,
	type PasswordFormMode,
	passwordFormMessage,
} from "./password-form.ts";
import {
	PASSWORD_CONFIRM_LABEL,
	PASSWORD_CURRENT_LABEL,
	PASSWORD_DIALOG_TITLE,
	PASSWORD_NEW_LABEL,
	PASSWORD_SUBMIT_LABEL,
	PASSWORD_SUBMITTING_LABEL,
} from "./security-copy.ts";

/**
 * Password form: the narrowest place plaintext lives.
 *
 * The three fields stay in this component's state and leave only as arguments on submit. Lifted to
 * the parent (`PasswordSection`), plaintext would outlive the dialog and pass through the tree on
 * every render. Unmounting is the surest way to drop it, so the parent closes this dialog on
 * success.
 *
 * The mode decides the fields:
 *
 * ```text
 * set      new password · confirm            no current-password field
 * change   current · new password · confirm
 * ```
 *
 * `set` does not hide a current password in state: that account has no such value, and a form that
 * demands a missing value never submits.
 *
 * No `trim` on any field. A password is an opaque string; different rules at store and verify time
 * would make the new password fail to sign in.
 *
 * `secureTextEntry` comes with auto-capitalize and auto-correct off. Left on, the platform changes
 * the first letter or fixes words, so a value other than the typed one is stored, and it is masked,
 * so invisible.
 */
export function PasswordDialog({
	mode,
	open,
	pending,
	error,
	onClose,
	onSubmit,
}: {
	mode: PasswordFormMode;
	open: boolean;
	pending: boolean;
	error: string | null;
	onClose: () => void;
	onSubmit: (values: { currentPassword: string; newPassword: string }) => void;
}) {
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");

	const issue = checkPasswordForm(mode, {
		currentPassword,
		newPassword,
		confirmPassword,
	});
	/**
	 * An empty field gets no sentence: it is not yet a mistake, just not finished, and a disabled
	 * button is enough for that (`passwordFormMessage`).
	 */
	const issueMessage = issue ? passwordFormMessage(issue) : null;

	return (
		<Dialog
			title={PASSWORD_DIALOG_TITLE[mode]}
			open={open}
			onOpenChange={(next) => {
				if (!next && !pending) onClose();
			}}
			scroll
		>
			<View style={form.stack}>
				{mode === "change" ? (
					<Input
						label={PASSWORD_CURRENT_LABEL}
						value={currentPassword}
						onChangeText={setCurrentPassword}
						secureTextEntry
						autoCapitalize="none"
						autoCorrect={false}
						autoComplete="current-password"
						textContentType="password"
						editable={!pending}
					/>
				) : null}

				<Input
					label={PASSWORD_NEW_LABEL}
					value={newPassword}
					onChangeText={setNewPassword}
					secureTextEntry
					autoCapitalize="none"
					autoCorrect={false}
					autoComplete="new-password"
					textContentType="newPassword"
					editable={!pending}
					invalid={issue === "too_short" || issue === "too_long"}
				/>

				<Input
					label={PASSWORD_CONFIRM_LABEL}
					value={confirmPassword}
					onChangeText={setConfirmPassword}
					secureTextEntry
					autoCapitalize="none"
					autoCorrect={false}
					autoComplete="new-password"
					textContentType="newPassword"
					editable={!pending}
					invalid={issue === "mismatch"}
				/>

				{(issueMessage ?? error) ? (
					<Text accessibilityRole="alert" variant="label" tone="destructive">
						{issueMessage ?? error}
					</Text>
				) : null}

				<DialogActions>
					<Button
						fullWidth
						label="Cancel"
						variant="outline"
						size="sm"
						disabled={pending}
						onPress={onClose}
					/>
					<Button
						fullWidth
						label={pending ? PASSWORD_SUBMITTING_LABEL : PASSWORD_SUBMIT_LABEL}
						size="sm"
						busy={pending}
						disabled={issue !== null}
						onPress={() => onSubmit({ currentPassword, newPassword })}
					/>
				</DialogActions>
			</View>
		</Dialog>
	);
}

const form = StyleSheet.create({ stack: { gap: space.md } });
