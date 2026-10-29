import { SettingsGeneralScreen } from "../../features/settings/settings-general-screen.tsx";

/**
 * General: `/settings` is this screen. There is no `/settings/general` because one screen would get
 * two addresses, the same rule as the create workspace omitting its default tab (web's same route
 * made the same call), so `/settings` lives without a redirect.
 *
 * The route file is only a route; the screen belongs to the feature. No parameters: categories are
 * different route files (not `?tab=`), so deep links, back and restoration come free. Guests are
 * not bounced to login; they first read why settings are unavailable (same as `/account` and
 * `/chats`).
 */
export default function SettingsRoute() {
	return <SettingsGeneralScreen />;
}
