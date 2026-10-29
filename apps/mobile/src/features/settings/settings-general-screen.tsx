import { PageEnter } from "../../lib/motion/page-enter.tsx";
import { PushNotificationSection } from "../push/push-section.tsx";
import { AppearanceSection } from "./appearance-section.tsx";
import { LocalDataSection } from "./local-data-section.tsx";
import { SettingsCategoryBody } from "./settings-parts.tsx";
import { ThemeCustomizationSection } from "./theme-customization-section.tsx";

/**
 * General: how RowCat runs **on this device**.
 *
 * There are three sections, and their order carries meaning:
 *
 * ```text
 * Display             this device's brightness    device storage     independent of sign-in
 * Theme               the color the account chose  server             follows the account to other devices
 * This device's data  what this device holds       member SQLite      clearing it empties only this device
 * ```
 *
 * The first two are adjacent because of layers: the first sets brightness and the second sets the
 * color layered on top of it. The sections are still separate **because their owners differ**. One
 * is a device value and one is an account value. Merging them would hide that difference on screen,
 * and when the subscription ends it would look as if the brightness choice were locked too.
 *
 * ## No single loading gate
 *
 * The three sections have three owners (device storage, a server query, member SQLite). Gating them
 * on one condition would make changing brightness fail on a device whose server is down. **Failures
 * end in their own place**: if the theme query fails, the display and local-data sections still
 * work.
 *
 * ## Everything here is a **value you change**
 *
 * There was once a fourth section (`Updates`). It was reading material with nothing to change, which
 * did not fit this screen's character. Its placement was justified only by elimination in the
 * navigation IA: there was no fourth slot, so it went into settings. That argument did not count
 * the **notifications screen** as a place: update notes belong to a surface the user opens on
 * purpose to read news, and that surface already exists. Its entry point is assembled by
 * `features/notifications/notifications-screen.tsx` (`docs/updates/ARCHITECTURE.md`).
 *
 * ## Settings are not invented to fill the screen
 *
 * Language, text size, sound, start screen and notification settings are not added as placeholders.
 * This screen being short is a state, not a defect. The case for the navigation list rests on
 * structure, not on placeholders.
 */
export function SettingsGeneralScreen() {
	return (
		/**
		 * The entrance wraps **only the category body**. The header and the navigation row belong to the
		 * shell and must stay in place when the category changes, so that only the newly arrived content
		 * moves (the web's `settings-general-page.tsx` draws the same boundary in the same place).
		 */
		<PageEnter>
			<SettingsCategoryBody category="general">
				<AppearanceSection />
				<ThemeCustomizationSection />
				{/**
				 * Push is the **receiving setting of this device**, so it shares an axis with brightness and local
				 * data. Notification history is still owned by the inbox; this section does not draw that history.
				 */}
				<PushNotificationSection />
				<LocalDataSection />
			</SettingsCategoryBody>
		</PageEnter>
	);
}
