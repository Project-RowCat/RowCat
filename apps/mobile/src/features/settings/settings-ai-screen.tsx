import { PageEnter } from "../../lib/motion/page-enter.tsx";
import { GenerationDefaultsSection } from "./generation-defaults-section.tsx";
import { ProviderConnectionsSection } from "./provider-connections-section.tsx";
import { SettingsCategoryBody } from "./settings-parts.tsx";

/**
 * AI: this device's **default generation settings** and **provider connections**.
 *
 * There are two sections, and their order is meaningful:
 *
 * ```text
 * default generation   values applied to new conversations   device SQLite   usable without a personal API key
 * AI providers         API keys this device holds            Keychain        connecting sends requests straight to that provider
 * ```
 *
 * Generation defaults come **first** because this product's default path is managed. Placing
 * connections above them would make the app look as if it requires a key from members who have
 * none, which is false: the RowCat-provided model runs without connecting anything.
 *
 * ## The two sections have different owners
 *
 * The top is a per-member SQLite preference row, and the bottom is the OS secret store. That is why
 * there is no single loading gate: one side can fail while the other keeps working, and their
 * failures are unrelated (the three sections of `Settings → General` reached the same
 * conclusion).
 *
 * ## What is not on this screen
 *
 * Arbitrary endpoints, custom headers, proxy modes, OpenAI and OpenRouter are not part of this
 * slice, and no placeholders for them exist. There is also no action that **shows** a stored key:
 * the screen has no port that could read it (`lib/local-provider/store.ts`).
 */
export function SettingsAiScreen() {
	return (
		/** The entrance wraps only the category body (same place as in `settings-general-screen.tsx`). */
		<PageEnter>
			<SettingsCategoryBody category="ai">
				<GenerationDefaultsSection />
				<ProviderConnectionsSection />
			</SettingsCategoryBody>
		</PageEnter>
	);
}
