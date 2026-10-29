import { space } from "@rowcat/design";
import { Button, Dialog, DialogActions, Input, Text } from "@rowcat/ui-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { changeEmailCheckMessage, checkNewEmail } from "./email-change.ts";
import {
	EMAIL_CHANGE_DIALOG_DESCRIPTION,
	EMAIL_CHANGE_DIALOG_TITLE,
	EMAIL_CHANGE_SUBMIT_LABEL,
	EMAIL_CHANGE_SUBMITTING_LABEL,
	EMAIL_CURRENT_LABEL,
	EMAIL_NEW_LABEL,
	EMAIL_NEW_PLACEHOLDER,
} from "./security-copy.ts";

/**
 * Email change form; a one-field form, so a `Dialog`.
 *
 * Not a sheet: rising from the bottom earns nothing here, and it is better to keep the screen
 * behind (the current address) visible. The container table is in the "presentation" section of
 * `docs/design/ARCHITECTURE.md`.
 *
 * The input never leaves this component: the value lives in local state and goes out only as the
 * submit argument. A parent holding it would keep it after the dialog closes and across viewer
 * changes; unmounting is the surest way to discard it.
 *
 * Validation is the pure `checkNewEmail` (empty, format, same address); this file only draws its
 * answer, since conditions stacked in a component cannot be checked without rendering and this
 * app's tests do not render screens.
 */
export function EmailChangeDialog({
	currentEmail,
	open,
	pending,
	error,
	onClose,
	onSubmit,
}: {
	currentEmail: string;
	open: boolean;
	pending: boolean;
	/** Server or transport failure; validation failures are produced by the dialog itself. */
	error: string | null;
	onClose: () => void;
	onSubmit: (email: string) => void;
}) {
	const [value, setValue] = useState("");
	const [issue, setIssue] = useState<string | null>(null);

	const submit = (): void => {
		const check = checkNewEmail(value, currentEmail);
		if (!check.ok) {
			setIssue(changeEmailCheckMessage(check.reason));
			return;
		}
		setIssue(null);
		onSubmit(check.email);
	};

	return (
		<Dialog
			title={EMAIL_CHANGE_DIALOG_TITLE}
			description={EMAIL_CHANGE_DIALOG_DESCRIPTION}
			open={open}
			onOpenChange={(next) => {
				if (!next && !pending) onClose();
			}}
		>
			<View style={form.stack}>
				{/**
				 * The current address is shown read-only so the dialog itself says from what to
				 * what, instead of the user remembering the screen behind.
				 */}
				<View style={form.current}>
					<Text variant="caption" tone="muted-foreground">
						{EMAIL_CURRENT_LABEL}
					</Text>
					<Text variant="body">{currentEmail}</Text>
				</View>

				<Input
					label={EMAIL_NEW_LABEL}
					value={value}
					onChangeText={(next) => {
						setValue(next);
						setIssue(null);
					}}
					placeholder={EMAIL_NEW_PLACEHOLDER}
					keyboardType="email-address"
					autoCapitalize="none"
					autoCorrect={false}
					autoComplete="email"
					textContentType="emailAddress"
					returnKeyType="send"
					onSubmitEditing={submit}
					editable={!pending}
					invalid={issue !== null}
				/>

				{(issue ?? error) ? (
					<Text accessibilityRole="alert" variant="label" tone="destructive">
						{issue ?? error}
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
						label={
							pending
								? EMAIL_CHANGE_SUBMITTING_LABEL
								: EMAIL_CHANGE_SUBMIT_LABEL
						}
						size="sm"
						busy={pending}
						onPress={submit}
					/>
				</DialogActions>
			</View>
		</Dialog>
	);
}

const form = StyleSheet.create({
	stack: { gap: space.md },
	current: { gap: space.px },
});
