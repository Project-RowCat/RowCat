import { SettingsToolsScreen } from "../../features/settings/settings-tools-screen.tsx";

/**
 * Tool library: like `personas.tsx`, the address takes no room id, because the library is an
 * account asset and the same list from any room. A tool is edited in a window on this screen, so
 * there is no per-tool address. Same address as web (`/settings/tools`).
 */
export default function SettingsToolsRoute() {
	return <SettingsToolsScreen />;
}
