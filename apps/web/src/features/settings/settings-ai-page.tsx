import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { GenerationDefaultsGroup } from "./generation-defaults.tsx";
import { ProviderConnectionsGroup } from "./provider-connections.tsx";
import { SettingsPageHeader } from "./settings-parts.tsx";

/**
 * AI: default generation settings and this device's provider connections.
 *
 * The two sections share one screen for a recovery path, not for convenience. When the chosen model
 * is waiting for a connection, the user needs to reach the provider section. If that path left the
 * screen (another route), returning would also become the user's job. So this page composes both
 * sections and passes the landing point (the provider section's heading) from top to bottom.
 * Neither section knows the other's markup.
 *
 * The two stores stay separate to the end. Default generation writes to GenerationPreferenceStore
 * (member plus device preference), and AI providers write to ProviderConnectionStore (member plus
 * device credentials). That is why there is no `Save settings` button here either. No transaction spans two
 * stores, and such a button would report partial success as success.
 */
export function SettingsAiPage() {
	const { t } = useTranslation(["settings", "common"]);
	/**
	 * The destination of the recovery button is the provider section's heading. This does not use the
	 * router. All that is needed is a point within this page, so per-section addresses should not be
	 * introduced before something requires them.
	 */
	const providerHeading = useRef<HTMLHeadingElement>(null);

	return (
		<PageEnter>
			<SettingsPageHeader
				title="AI"
				description={t(
					"settingsAiPage.manageConversationGenerationDefaultsAnd",
				)}
			/>
			<div className="mt-6">
				<GenerationDefaultsGroup providerHeadingRef={providerHeading} />
				<ProviderConnectionsGroup headingRef={providerHeading} />
			</div>
		</PageEnter>
	);
}
