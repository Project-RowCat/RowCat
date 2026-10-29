import type {
	ByoProvider,
	GenerationExecution,
	GenerationProvider,
} from "@rowcat/chat";
import { APP_NAME } from "@rowcat/domain";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Translates 'this target cannot be used on this device' into the user's words. The decision itself
 * is the pure function resolveGenerationExecution in @rowcat/chat. This file only maps its result
 * to on-screen sentences and next actions.
 *
 * Keeping decision and copy apart means the priority rules are not tied to Korean strings in the
 * app, so a later Expo app can reuse them.
 *
 * There is no fallback path here, and none should be added. If the user picked Anthropic in this
 * conversation, the request goes to Anthropic or it does not go.
 */

/**
 * The catalog also has providerLabel, but this label is needed when generation is blocked, and the
 * catalog may not have been read at that point. Error guidance that waits for the server response
 * is not error handling.
 *
 * The two names may diverge. The cost is accepted, since both show the same company's name.
 */
const PROVIDER_LABEL: Record<GenerationProvider, string> = {
	rowcat: APP_NAME,
	"anthropic-byo": "Anthropic",
	"gemini-byo": "Google Gemini",
};

export const providerLabel = (provider: GenerationProvider): string =>
	PROVIDER_LABEL[provider];

/**
 * Kept separate from ProviderError because the screen acts differently. A ProviderError means the
 * provider refused, so the screen offers a retry or a key fix. This error means no request has left
 * yet and the user should go to settings. Folding both into one would remove the basis for the
 * settings link.
 */
export class GenerationBlockedError extends Error {
	readonly reason: Extract<
		GenerationExecution,
		{ status: "blocked" }
	>["reason"];
	readonly provider: GenerationProvider;
	/**
	 * True when the block is due to a missing connection. It decides whether the settings link is
	 * shown.
	 */
	readonly needsConnection: boolean;

	constructor(execution: Extract<GenerationExecution, { status: "blocked" }>) {
		super(blockedMessage(execution));
		this.name = "GenerationBlockedError";
		this.reason = execution.reason;
		this.provider = execution.target.provider;
		/**
		 * Child restriction must make this false. If true, the screen shows the `AI provider settings` link, but a
		 * restricted user can do nothing there because the connection itself is blocked. Pointing to a
		 * path that does not exist is worse than offering no path.
		 */
		this.needsConnection = execution.reason === "provider_not_connected";
	}
}

/**
 * Maps the blocked reason to the sentence the user reads. Both sentences say what to choose. A
 * sentence ending in `can't generate` leaves no next step. The action the user actually takes is
 * pressing the same button again.
 */
function blockedMessage(
	execution: Extract<GenerationExecution, { status: "blocked" }>,
): string {
	const t = translator("generation");
	const label = providerLabel(execution.target.provider);
	/**
	 * The child restriction is checked first. If the connection guidance came first, a user under 14
	 * would obtain a key, get blocked again, and by then the app would have lost its chance to say
	 * why.
	 *
	 * The sentence must also not end with `can't be used`. It must state what IS available now (the
	 * RowCat-provided model); otherwise the screen reads as if the whole conversation is blocked.
	 */
	if (execution.reason === "managed_only")
		return t("blocked.managedOnly", { app: APP_NAME });
	if (execution.reason === "byo_not_permitted")
		return t("blocked.byoNotPermitted", { app: APP_NAME, provider: label });
	if (execution.reason === "provider_not_connected")
		return t("blocked.providerNotConnected", { provider: label });
	return t("blocked.modelUnavailable");
}

/**
 * The providers that can hold credentials. Its order is also the order of the provider connection
 * rows in settings.
 *
 * The array is not read from the catalog, because connecting comes before choosing a model. The
 * settings screen must still appear when the catalog request fails.
 */
export const BYO_PROVIDERS: readonly ByoProvider[] = [
	"anthropic-byo",
	"gemini-byo",
];

/**
 * Links to each provider's API key page.
 *
 * Console steps are not copied into this app. They become wrong when the provider changes its UI,
 * and a wrong explanation is worse than none. A link is enough.
 */
export const PROVIDER_KEY_PAGE: Record<ByoProvider, string> = {
	"anthropic-byo": "https://platform.claude.com/settings/keys",
	"gemini-byo": "https://aistudio.google.com/apikey",
};
