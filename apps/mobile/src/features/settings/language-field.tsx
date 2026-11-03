import { Select, SelectOption } from "@rowcat/ui-native";
import { useTranslation } from "react-i18next";
import {
	LOCALE_ENDONYM,
	LOCALE_PREFERENCES,
	type LocalePreference,
} from "../../lib/i18n/locale.ts";
import { useDeviceLocale } from "../../lib/i18n/provider.tsx";
import { SettingsField } from "./settings-parts.tsx";

/**
 * The language row in `Display`.
 *
 * **This row does not own the value** — `lib/i18n/provider.tsx` does, exactly as the brightness row
 * does not own the brightness. The guest header's shortcut calls the same `setPreference`; a second
 * state would let the two draw different languages until a relaunch.
 *
 * The choice applies at once and there is no save button: each of the three values is a complete
 * choice, and the screen redraws in the new language as the sheet closes.
 */
export function LanguageField() {
	const { preference, setPreference } = useDeviceLocale();
	const { t } = useTranslation("settings");

	return (
		<SettingsField
			label={t("language.fieldLabel")}
			description={t("language.fieldDescription")}
		>
			<Select
				label={t("language.fieldLabel")}
				value={localePreferenceLabel(preference, t("language.system"))}
			>
				{LOCALE_PREFERENCES.map((value) => (
					<SelectOption
						key={value}
						label={localePreferenceLabel(value, t("language.system"))}
						selected={preference === value}
						onSelect={() => setPreference(value)}
					/>
				))}
			</Select>
		</SettingsField>
	);
}

/**
 * A language is named in itself (`English`, `한국어`) whatever the app is drawn in, so someone who
 * landed in a language they cannot read still finds theirs. Only "follow the phone" is translated.
 */
export function localePreferenceLabel(
	preference: LocalePreference,
	systemLabel: string,
): string {
	return preference === "system" ? systemLabel : LOCALE_ENDONYM[preference];
}
