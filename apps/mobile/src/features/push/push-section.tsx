import { space } from "@rowcat/design";
import { Button, Notice, Text } from "@rowcat/ui-native";
import { StyleSheet, View } from "react-native";
import { SettingsField, SettingsSection } from "../settings/settings-parts.tsx";
import {
	PUSH_BLOCKED_DESCRIPTION,
	PUSH_DISABLE_LABEL,
	PUSH_DISABLE_NOTE,
	PUSH_DISABLING_LABEL,
	PUSH_ENABLE_LABEL,
	PUSH_ENABLED_DESCRIPTION,
	PUSH_ENABLING_LABEL,
	PUSH_FAILURE_MESSAGE,
	PUSH_FIELD_LABEL,
	PUSH_INCOMPLETE_DESCRIPTION,
	PUSH_OFFER_DESCRIPTION,
	PUSH_OPEN_SETTINGS_LABEL,
	PUSH_RETRY_LABEL,
	PUSH_SECTION_DESCRIPTION,
	PUSH_SECTION_TITLE,
} from "./push-copy.ts";
import { useMobilePush } from "./push-provider.tsx";

/**
 * Push notifications: this device's receive setting, one value.
 *
 * ## Why `General`
 *
 * The value sits on the same axis as brightness and local data: how this app behaves on this
 * device. The account screen (`/account`) owns identity and security, and the notification
 * **history** belongs to the inbox. Putting all three in one place would leave the user unable to
 * learn the difference from the screen.
 *
 * ## No `Switch`
 *
 * The state has six values, and three of them need **different** user actions (enable, open system
 * settings, retry). A switch has two values and cannot express those three. Worse, it would show
 * "on" on a device the OS refused, and that screen would be a lie.
 *
 * ## This section holds no state
 *
 * The owner of permission and registration progress is the root wiring (`push-provider.tsx`). Local
 * state here would reset when the user leaves and returns (making "turning on" vanish
 * mid-operation), and it would disagree with auto-refresh.
 *
 * ## No placeholder controls
 *
 * No control is drawn while permission is being read. A disabled button holding that place would
 * read as "coming soon" for what is only an unknown state.
 */
export function PushNotificationSection() {
	const { state, enable, disable, retry, openSystemSettings } = useMobilePush();

	return (
		<SettingsSection
			title={PUSH_SECTION_TITLE}
			description={PUSH_SECTION_DESCRIPTION}
		>
			<SettingsField
				label={PUSH_FIELD_LABEL}
				description={describe(state.kind)}
			>
				<View style={parts.body}>
					{/**
					 * No control while reading; see the header.
					 */}
					{state.kind === "offer" || state.kind === "retry-permission" ? (
						<Button
							label={state.busy ? PUSH_ENABLING_LABEL : PUSH_ENABLE_LABEL}
							fullWidth
							busy={state.busy}
							onPress={() => void enable()}
						/>
					) : null}

					{state.kind === "blocked" ? (
						<Button
							label={PUSH_OPEN_SETTINGS_LABEL}
							variant="outline"
							fullWidth
							onPress={() => void openSystemSettings()}
						/>
					) : null}

					{/**
					 * Failures stay inside this section. A toast would vanish after the user leaves the screen,
					 * while their next step is still here (`docs/design/FAILURE-FEEDBACK.md`).
					 */}
					{state.kind === "incomplete" ? (
						<Notice
							tone="destructive"
							message={PUSH_FAILURE_MESSAGE[state.failure]}
							actionLabel={PUSH_RETRY_LABEL}
							busy={state.busy}
							onAction={() => void retry()}
						/>
					) : null}

					{state.kind === "enabled" ? (
						<>
							<Button
								label={state.busy ? PUSH_DISABLING_LABEL : PUSH_DISABLE_LABEL}
								variant="outline"
								fullWidth
								busy={state.busy}
								onPress={() => void disable()}
							/>
							<Text variant="label" tone="muted-foreground">
								{PUSH_DISABLE_NOTE}
							</Text>
						</>
					) : null}
				</View>
			</SettingsField>
		</SettingsSection>
	);
}

/** Maps state to one line of copy. The strings live in `push-copy.ts`. */
function describe(kind: string): string | undefined {
	switch (kind) {
		case "offer":
		case "retry-permission":
			return PUSH_OFFER_DESCRIPTION;
		case "blocked":
			return PUSH_BLOCKED_DESCRIPTION;
		case "enabled":
			return PUSH_ENABLED_DESCRIPTION;
		case "incomplete":
			return PUSH_INCOMPLETE_DESCRIPTION;
		default:
			return undefined;
	}
}

const parts = StyleSheet.create({ body: { gap: space.sm } });
