import { space } from "@rowcat/design";
import { Button, Notice, Text } from "@rowcat/ui-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { SettingsField, SettingsSection } from "../settings/settings-parts.tsx";
import { PUSH_COPY } from "./push-copy.ts";
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
	useTranslation("notifications");
	const { state, enable, disable, retry, openSystemSettings } = useMobilePush();

	return (
		<SettingsSection
			title={PUSH_COPY.sectionTitle}
			description={PUSH_COPY.sectionDescription}
		>
			<SettingsField
				label={PUSH_COPY.fieldLabel}
				description={describe(state.kind)}
			>
				<View style={parts.body}>
					{/**
					 * No control while reading; see the header.
					 */}
					{state.kind === "offer" || state.kind === "retry-permission" ? (
						<Button
							label={state.busy ? PUSH_COPY.enabling : PUSH_COPY.enable}
							fullWidth
							busy={state.busy}
							onPress={() => void enable()}
						/>
					) : null}

					{state.kind === "blocked" ? (
						<Button
							label={PUSH_COPY.openSettings}
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
							message={PUSH_COPY.failure[state.failure]}
							actionLabel={PUSH_COPY.retry}
							busy={state.busy}
							onAction={() => void retry()}
						/>
					) : null}

					{state.kind === "enabled" ? (
						<>
							<Button
								label={state.busy ? PUSH_COPY.disabling : PUSH_COPY.disable}
								variant="outline"
								fullWidth
								busy={state.busy}
								onPress={() => void disable()}
							/>
							<Text variant="label" tone="muted-foreground">
								{PUSH_COPY.disableNote}
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
			return PUSH_COPY.offer;
		case "blocked":
			return PUSH_COPY.blocked;
		case "enabled":
			return PUSH_COPY.enabled;
		case "incomplete":
			return PUSH_COPY.incomplete;
		default:
			return undefined;
	}
}

const parts = StyleSheet.create({ body: { gap: space.sm } });
