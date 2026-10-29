import { useTranslation } from "react-i18next";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { AppearanceGroup } from "./appearance-section.tsx";
import { LocalDataGroup } from "./local-data-section.tsx";
import { SettingsPageHeader } from "./settings-parts.tsx";
import { ThemeCustomizationGroup } from "./theme-customization-section.tsx";

/**
 * Settings general: the app's appearance and what this browser holds.
 *
 * The page has three sections, and they do not share an owner:
 * - Display (brightness): this device, in localStorage. Available to guests and independent of
 *   sign-in.
 * - Theme color: the account, on the server. It follows the same account onto other devices.
 * - Device data: this device, in a per-member IndexedDB. Clearing it leaves the account and other
 *   devices intact.
 *
 * The page intro once called all three this browser's values. That is false for the middle one. Do
 * not move the theme to another screen to make the sentence true. The order carries meaning: the
 * top sets this browser's brightness, and the middle sets the account color layered on top. Each
 * section's own copy states its ownership. The page intro says only what holds for all three.
 *
 * Only editable values belong here. A fourth section, `Updates`, once existed with nothing to edit,
 * and it was removed. Update notices belong to the notifications surface (features/notifications,
 * docs/updates/ARCHITECTURE.md). Short content is a state of this screen, not a defect. Do not pad
 * it with language, font size, start screen or similar placeholders. The navigation list is
 * justified by structure, not by filler (settings-nav.ts).
 *
 * /settings is this screen. There is no /settings/general, because a second address would make the
 * same page have two. Saved /settings links (the gear in the header, links in conversation
 * settings, bookmarks) keep working without a redirect.
 */
export function SettingsGeneralPage() {
	const { t } = useTranslation(["settings", "common"]);
	return (
		/*
		 * The enter animation wraps only the category body. The navigation list and width belong to the
		 * app shell, so they stay in place when the category changes. Only what has just arrived moves.
		 */
		<PageEnter>
			<SettingsPageHeader
				title={t("settingsGeneralPage.general")}
				description={t("settingsGeneralPage.manageHowTheAppLooks")}
			/>
			<div className="mt-6">
				{/* Device-scoped values. Available to guests and independent of sign-in. */}
				<AppearanceGroup />
				{/*
				 * Theme color sits directly after the display section. The display section above sets this
				 * browser's
				 * brightness, and the theme section sets the account's color layered on top. The order states that
				 * layering.
				 *
				 * The sections are split because the owners differ. Display is device-level and available to
				 * guests.
				 * Theme colors are account-level: they follow the same account to other devices, and custom colors
				 * follow subscription entitlement. Merging them would hide that difference, and when a subscription
				 * ended, brightness would look locked too. The copy that states this belongs in this section, not
				 * in
				 * the page intro.
				 */}
				<ThemeCustomizationGroup />
				{/*
				 * The divider between sections comes from SettingsGroup itself (first:border-t-0). That rule works
				 * only because the sections are siblings in the same container.
				 */}
				<LocalDataGroup />
			</div>
		</PageEnter>
	);
}
