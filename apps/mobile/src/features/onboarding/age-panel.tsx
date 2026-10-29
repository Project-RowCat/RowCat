import { space } from "@rowcat/design";
import { declareAgeMutationOptions } from "@rowcat/query";
import { Button, Input, Notice, Text } from "@rowcat/ui-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { DeletionTerminal } from "../account/deletion-terminal.tsx";
import { useAccountDeletion } from "../account/use-account-deletion.ts";
import { formatBirthDateInput } from "./birth-date-input.ts";
import {
	AGE_DESCRIPTION,
	AGE_EMPTY_ERROR,
	AGE_EXIT_NOTE,
	AGE_FIELD_HINT,
	AGE_FIELD_LABEL,
	AGE_FIELD_PLACEHOLDER,
	AGE_SUBMIT_LABEL,
	AGE_SUBMITTING_LABEL,
	AGE_TITLE,
} from "./gate-copy.ts";
import { GateExit, GateSurface } from "./gate-shell.tsx";
import { ageDeclarationError } from "./membership-gate-state.ts";

/**
 * Age confirmation. Not a sign-up wall: it asks once and moves on. The native counterpart of the
 * web `age-panel.tsx`.
 *
 * ## Why a birth date
 *
 * PIPA article 22-2(1) requires guardian consent for processing the personal data of a child under
 * 14, and requires that the consent be verified. Doing that means first knowing whether the person
 * is under 14, and the only way to know is a birth date. An "I am 14 or older" checkbox does not
 * substitute: it declares that age is not asked, and without identifying a child there is no way to
 * protect one.
 *
 * ## This screen does not calculate age
 *
 * It checks only whether the field is empty. Age, future dates, leap years and the day someone
 * turns 14 are all decided by the server, in the product timezone (`PRODUCT_TIME_ZONE`). A device clock
 * would split decisions across devices in different timezones, and the split would show up only as
 * "under 14 but allowed through". `gate-boundaries.test.ts` pins the absence of date arithmetic.
 *
 * ## The value is never stored, on the server or on this device
 *
 * The server folds the date into "under 14" plus the date the person turns 14, then discards it
 * (there is no birth-date column). This app keeps it nowhere: not in SQLite, not in SecureStore,
 * not in the query cache. It lives in form state and disappears with the screen. Not building
 * "resume an unfinished entry" is what makes that structural.
 *
 * ## Being under 14 is not a failure
 *
 * This screen never says "you cannot sign up" when the answer is under 14. The next screen,
 * guardian consent, is a supported path.
 */
export function AgePanel() {
	const queryClient = useQueryClient();
	const [birthDate, setBirthDate] = useState("");
	const [localError, setLocalError] = useState<string | null>(null);
	const deletion = useAccountDeletion();

	const declare = useMutation(
		declareAgeMutationOptions(getRowCatClient(), queryClient),
	);
	const busy = declare.isPending || deletion.phase === "deleting";

	/**
	 * Once the account is gone, render **no** age content at all. The viewer cache is cleared only
	 * after the server deletion finishes, so renders in between would still ask an account that no
	 * longer exists for a birth date. A boundary crossed irreversibly must count as crossed from that
	 * moment on.
	 */
	if (deletion.terminal)
		return (
			<GateSurface>
				<DeletionTerminal deletion={deletion} />
			</GateSurface>
		);

	const submit = (): void => {
		const value = birthDate.trim();
		if (!value) {
			setLocalError(AGE_EMPTY_ERROR);
			return;
		}
		setLocalError(null);
		declare.mutate({ birthDate: value });
	};

	const error = localError ?? ageDeclarationError(declare.error);

	return (
		<GateSurface>
			<Text accessibilityRole="header" variant="heading">
				{AGE_TITLE}
			</Text>
			<Text variant="body" tone="muted-foreground">
				{AGE_DESCRIPTION}
			</Text>

			<View style={age.field}>
				<Input
					label={AGE_FIELD_LABEL}
					value={birthDate}
					/**
					 * Hyphens are separators only (`birth-date-input.ts`). The value is not altered, so the date
					 * the user typed goes to the server unchanged.
					 */
					onChangeText={(text) => setBirthDate(formatBirthDateInput(text))}
					placeholder={AGE_FIELD_PLACEHOLDER}
					keyboardType="number-pad"
					autoCapitalize="none"
					autoCorrect={false}
					editable={!busy}
					invalid={Boolean(error)}
					maxLength={10}
				/>
				<Text variant="caption" tone="muted-foreground">
					{AGE_FIELD_HINT}
				</Text>
			</View>

			{/** A failure interrupts what a screen reader was saying and reads itself out (`Notice` with `destructive`). */}
			{error ? <Notice tone="destructive" message={error} /> : null}

			<Button
				label={declare.isPending ? AGE_SUBMITTING_LABEL : AGE_SUBMIT_LABEL}
				fullWidth
				busy={declare.isPending}
				disabled={busy}
				onPress={submit}
			/>

			<GateExit note={AGE_EXIT_NOTE} deletion={deletion} busy={busy} />
		</GateSurface>
	);
}

const age = StyleSheet.create({ field: { gap: space.xs } });
