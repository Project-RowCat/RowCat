import type { ByoProvider } from "@rowcat/chat";
import { space } from "@rowcat/design";
import { Button, Dialog, DialogActions, Input, Text } from "@rowcat/ui-native";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import {
	PROVIDER_CANCEL_LABEL,
	PROVIDER_CONNECT_LABEL,
	PROVIDER_DISCLOSURE,
	PROVIDER_KEY_FIELD_LABEL,
	PROVIDER_KEY_PAGE,
	PROVIDER_KEY_PAGE_LABEL,
	PROVIDER_KEY_PLACEHOLDER,
	PROVIDER_REPLACE_LABEL,
	PROVIDER_REPLACE_NOTICE,
	providerDialogTitle,
} from "./provider-copy.ts";

/**
 * The API key form: **the narrowest place the secret lives.**
 *
 * ## The value does not leave this component
 *
 * The input lives in local state and is passed out only as an argument on submit. Lifting it to the
 * parent would leave the plaintext alive after the dialog closes, and the value would cross the
 * tree on every re-render. **Unmounting is the surest way to discard the plaintext**, so on success
 * the parent closes this dialog (`password-dialog.tsx` reached the same conclusion).
 *
 * ## The field always starts empty
 *
 * Whether connecting or replacing. The stored key is not read into the field, and neither a masked
 * value nor the last four digits are drawn: **the screen has no port that could read it**
 * (`ProviderConnectionStore` has no method that returns the secret). The replace dialog states in
 * one line that the field is empty, so users are not misled (`PROVIDER_REPLACE_NOTICE`).
 *
 * ## The container is a form that fills the screen
 *
 * `size="full"` because of what it holds: four lines of disclosure, a link to the key page, the
 * input, an error line, and two buttons. In a centred box, on a device with large accessibility
 * text the bottom part is pushed off, and tapping the input makes the keyboard cover the remaining
 * half (the report form reached the same conclusion).
 *
 * ## Paste is not blocked
 *
 * An API key is not a value typed by hand. A form that blocks paste adds no security and only makes
 * the user keep the key on screen and copy it character by character.
 *
 * Auto-capitalization and auto-correction are **off**. If left on, the platform changes the first
 * letter or corrects words, so a different value than the one pasted gets stored, and since the
 * field is masked **the change is not even visible.**
 */
export function ProviderConnectionDialog({
	provider,
	mode,
	open,
	pending,
	error,
	onClose,
	onSubmit,
}: {
	provider: ByoProvider;
	/** Connect or replace: the operation is the same, but what the user is trying to do differs. */
	mode: "connect" | "replace";
	open: boolean;
	pending: boolean;
	error: string | null;
	onClose: () => void;
	onSubmit: (secret: string) => void;
}) {
	const [secret, setSecret] = useState("");

	return (
		<Dialog
			title={providerDialogTitle(provider, mode)}
			open={open}
			onOpenChange={(next) => {
				if (!next && !pending) onClose();
			}}
			size="full"
			scroll
		>
			<View style={form.stack}>
				{mode === "replace" ? (
					<Text variant="label" tone="muted-foreground">
						{PROVIDER_REPLACE_NOTICE}
					</Text>
				) : null}

				{/**
				 * The disclosure sits **above the input**. Below it, someone who pastes the key and
				 * presses the button immediately never reads it. The sentences answer "where does this
				 * key go", which must be known **before** pasting.
				 */}
				<View style={form.disclosure}>
					{PROVIDER_DISCLOSURE.map((line) => (
						<Text key={line} variant="label" tone="muted-foreground">
							{line}
						</Text>
					))}
				</View>

				{/**
				 * One way to the provider's key page. We do not copy the console's instructions into our
				 * screen, because they would become wrong the moment the provider changes its UI.
				 */}
				<Button
					label={PROVIDER_KEY_PAGE_LABEL}
					variant="outline"
					size="sm"
					fullWidth
					onPress={() =>
						void WebBrowser.openBrowserAsync(PROVIDER_KEY_PAGE[provider])
					}
				/>

				<Input
					label={PROVIDER_KEY_FIELD_LABEL}
					placeholder={PROVIDER_KEY_PLACEHOLDER}
					value={secret}
					onChangeText={setSecret}
					secureTextEntry
					autoCapitalize="none"
					autoCorrect={false}
					autoComplete="off"
					editable={!pending}
				/>

				{error ? (
					<Text accessibilityRole="alert" variant="label" tone="destructive">
						{error}
					</Text>
				) : null}

				<DialogActions>
					<Button
						fullWidth
						label={PROVIDER_CANCEL_LABEL}
						variant="outline"
						size="sm"
						disabled={pending}
						onPress={onClose}
					/>
					<Button
						fullWidth
						label={
							mode === "connect"
								? PROVIDER_CONNECT_LABEL
								: PROVIDER_REPLACE_LABEL
						}
						size="sm"
						busy={pending}
						/**
						 * Do not attach a sentence to an empty field: it is not a mistake yet, just not yet filled
						 * in. Disabling the button is enough for that state.
						 */
						disabled={secret.trim() === ""}
						onPress={() => onSubmit(secret)}
					/>
				</DialogActions>
			</View>
		</Dialog>
	);
}

const form = StyleSheet.create({
	stack: { gap: space.md },
	disclosure: { gap: space.xs },
});
