import { space } from "@rowcat/design";
import type { AccountPasskey } from "@rowcat/domain";
import {
	AlertDialog,
	Button,
	Dialog,
	DialogActions,
	Input,
	Text,
} from "@rowcat/ui-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import {
	checkPasskeyLabel,
	passkeyDisplayName,
	passkeyLabelMessage,
} from "./passkey-label.ts";
import {
	PASSKEY_DELETE_CONFIRM_LABEL,
	PASSKEY_DELETE_DESCRIPTION,
	PASSKEY_NAME_LABEL,
	PASSKEY_RENAME_DIALOG_TITLE,
	PASSKEY_RENAME_SUBMIT_LABEL,
	PASSKEY_RENAME_SUBMITTING_LABEL,
	passkeyDeleteTitle,
} from "./security-copy.ts";

/**
 * The two passkey dialogs: rename and delete.
 *
 * There is no registration dialog because this app has no such path (the rationale is in the
 * `passkeys-section.tsx` header), not because it was deferred. A dialog with no way to open it
 * would tell the next person that only wiring is missing.
 *
 * The container follows reversibility:
 *
 * ```text
 * rename   Dialog       one-field form; a mistake is fixed by renaming again
 * delete   AlertDialog  irreversible; title, description, cancel and destroy are fixed
 * ```
 */

export function RenamePasskeyDialog({
	passkey,
	open,
	pending,
	error,
	onClose,
	onSubmit,
}: {
	passkey: AccountPasskey;
	open: boolean;
	pending: boolean;
	error: string | null;
	onClose: () => void;
	onSubmit: (name: string) => void;
}) {
	/**
	 * Starts from the current name; an empty field would make the user retype without knowing what
	 * they are editing. No name is invented: for `null` the field is empty, since filling the display
	 * fallback `Passkey` would store that word as the real label.
	 */
	const [value, setValue] = useState(passkey.name ?? "");
	const [issue, setIssue] = useState<string | null>(null);

	const submit = (): void => {
		const check = checkPasskeyLabel(value);
		if (!check.ok) {
			setIssue(passkeyLabelMessage(check.reason));
			return;
		}
		setIssue(null);
		onSubmit(check.name);
	};

	return (
		<Dialog
			title={PASSKEY_RENAME_DIALOG_TITLE}
			open={open}
			onOpenChange={(next) => {
				if (!next && !pending) onClose();
			}}
		>
			<View style={form.stack}>
				<Input
					label={PASSKEY_NAME_LABEL}
					value={value}
					onChangeText={(next) => {
						setValue(next);
						setIssue(null);
					}}
					/**
					 * Must not look like a credential. With autofill on, a password manager reads this field as
					 * part of a login form and offers to save it; the value is a display name that tells rows
					 * apart, not a secret.
					 */
					autoComplete="off"
					textContentType="none"
					autoCorrect={false}
					returnKeyType="done"
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
								? PASSKEY_RENAME_SUBMITTING_LABEL
								: PASSKEY_RENAME_SUBMIT_LABEL
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

/**
 * Delete confirmation; names the target by its label.
 *
 * The opaque reference (`id`) is not drawn: the user can judge nothing from it, and it is only the
 * address the rename and delete requests point at.
 */
export function RemovePasskeyDialog({
	passkey,
	open,
	pending,
	error,
	onClose,
	onConfirm,
}: {
	passkey: AccountPasskey;
	open: boolean;
	pending: boolean;
	error: string | null;
	onClose: () => void;
	onConfirm: () => void;
}) {
	return (
		<AlertDialog
			open={open}
			title={passkeyDeleteTitle(passkeyDisplayName(passkey.name))}
			description={PASSKEY_DELETE_DESCRIPTION}
			confirmLabel={PASSKEY_DELETE_CONFIRM_LABEL}
			destructive
			busy={pending}
			error={error}
			onConfirm={onConfirm}
			onCancel={onClose}
		/>
	);
}

const form = StyleSheet.create({ stack: { gap: space.md } });
