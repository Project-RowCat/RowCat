import { SettingsAiScreen } from "../../features/settings/settings-ai-screen.tsx";

/**
 * AI: this device's default generation settings. The route file is only a route (see the
 * `settings/index.tsx` header); queries and store reads belong to the section.
 */
export default function SettingsAiRoute() {
	return <SettingsAiScreen />;
}
