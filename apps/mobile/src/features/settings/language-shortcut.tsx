import {
	ChoiceSheet,
	controlHeight,
	Icon,
	targetSlop,
} from "@rowcat/ui-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet } from "react-native";
import { LOCALE_PREFERENCES } from "../../lib/i18n/locale.ts";
import { useDeviceLocale } from "../../lib/i18n/provider.tsx";
import { useMobileIdentity } from "../../lib/identity.tsx";
import { localePreferenceLabel } from "./language-field.tsx";

/**
 * Language shortcut for guests, who have no settings screen — the twin of `AppearanceShortcut`, with
 * the same conditions and the same reasons.
 *
 * Settings is reachable only for signed-in members, so without this a guest whose phone language is
 * not the one they read could not change it inside the app. The web's guest header carries a
 * language button for the same reason. Members get the row in `General` instead; showing both would
 * give two places to edit one value.
 */
export function LanguageShortcut() {
	const { session } = useMobileIdentity();
	if (session.phase === "authenticated") return null;
	return <LanguagePicker />;
}

function LanguagePicker() {
	const { preference, setPreference } = useDeviceLocale();
	const { t } = useTranslation("settings");
	const [open, setOpen] = useState(false);
	const label = (value: (typeof LOCALE_PREFERENCES)[number]) =>
		localePreferenceLabel(value, t("language.system"));

	return (
		<>
			<Pressable
				accessibilityRole="button"
				/** The label includes the current value; the icon alone does not show what is selected. */
				accessibilityLabel={`${t("language.fieldLabel")}: ${label(preference)}`}
				onPress={() => setOpen(true)}
				hitSlop={targetSlop(controlHeight.lg)}
				style={shortcut.root}
			>
				<Icon name="language" size="lg" tone="muted-foreground" />
			</Pressable>
			<ChoiceSheet
				title={t("language.fieldLabel")}
				open={open}
				value={preference}
				options={LOCALE_PREFERENCES.map((value) => ({
					value,
					label: label(value),
				}))}
				onValueChange={(next) => {
					setPreference(next);
					setOpen(false);
				}}
				onOpenChange={setOpen}
			/>
		</>
	);
}

/** The same 40pt box and 44pt target as the brightness shortcut beside it. */
const shortcut = StyleSheet.create({
	root: {
		alignItems: "center",
		justifyContent: "center",
		minHeight: controlHeight.lg,
		minWidth: controlHeight.lg,
	},
});
