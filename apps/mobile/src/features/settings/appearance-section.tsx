import { Select, SelectOption } from "@rowcat/ui-native";
import { useTranslation } from "react-i18next";
import { useDeviceAppearance } from "../../lib/appearance/provider.tsx";
import {
	APPEARANCE_COPY,
	APPEARANCE_LABEL,
	APPEARANCE_ORDER,
} from "./appearance-copy.ts";
import { LanguageField } from "./language-field.tsx";
import { SettingsField, SettingsSection } from "./settings-parts.tsx";

/**
 * Display: brightness and language — the two ways this device draws the app.
 *
 * **This section does not own the value.** The source of truth is `lib/appearance/` (it writes to
 * device storage and hands the value to `ThemeProvider`). What this section does is call the same
 * `setPreference`. A second state would let the guest header's trigger and this screen draw
 * different values, and that mismatch would disappear only after the app is quit and reopened.
 *
 * ## Ownership differs from the section below (account colors)
 *
 * This is a device value, so guests have it too, and sign-in, account switching and local data
 * reset do not touch it. The section below is an account value: it follows to other signed-in
 * devices, and arbitrary colors follow the account's entitlement. Merging them into one section
 * would hide that difference from the screen. Above all, when the entitlement ended, the brightness
 * choice would look locked as well. The web splits the two sections for the same reason.
 *
 * ## There is no save button
 *
 * The value is one of three, and each is a complete choice, so there is no "choosing" state. A save
 * button would make the action two steps, and someone who forgot the second press would find out
 * the next time the app opened that the brightness they chose was never saved. The account preset
 * reached the same decision.
 *
 * ## The container is `Select`, the same container as the web's row
 *
 * ⚠️ **It was a `ChoiceGroup` for a while, and the reason for that choice was written without
 * looking at the web.** The sentence "three values, so it is better to keep them expanded" is
 * plausible on its face, but the web draws the same three as **one closed trigger** (`apps/web`'s
 * `appearance-section.tsx`). So the same screen was a different control in each product, and the
 * app's first settings screen ran nearly a full screen longer than the web's because three 110pt
 * rows stood vertically.
 *
 * That there are only three values is still true, so opening this trigger costs little. It is not a
 * reason to diverge.
 */
export function AppearanceSection() {
	const { preference, setPreference } = useDeviceAppearance();
	/** Subscribes the section to the language; the copy tables are read as it draws. */
	useTranslation("settings");

	return (
		<SettingsSection title={APPEARANCE_COPY.sectionTitle} first>
			<SettingsField
				label={APPEARANCE_COPY.fieldLabel}
				description={APPEARANCE_COPY.fieldDescription}
			>
				<Select
					label={APPEARANCE_COPY.fieldLabel}
					value={APPEARANCE_LABEL[preference]}
				>
					{APPEARANCE_ORDER.map((value) => (
						<SelectOption
							key={value}
							label={APPEARANCE_LABEL[value]}
							selected={preference === value}
							onSelect={() => setPreference(value)}
						/>
					))}
				</Select>
			</SettingsField>
			{/**
			 * The language sits in this section because it is the same kind of value: this device's, not
			 * the account's, so guests have it and sign-in does not change it. The web keeps the two side by
			 * side in its settings for the same reason.
			 */}
			<LanguageField />
		</SettingsSection>
	);
}
