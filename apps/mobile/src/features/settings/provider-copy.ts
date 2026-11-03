import { type ByoProvider, OPENAI_COMPATIBLE_LABEL } from "@rowcat/chat";
import { membershipAges } from "../../lib/membership-ages.ts";

/**
 * Copy for AI provider connections. What this file guards is that each sentence states a fact.
 *
 * The web version was not copied across. It talks about browser storage, tabs, CORS and shared
 * browsers, and all of that is false in this app. Copying it would make users read guidance about
 * things their device does not have:
 * - Browser storage: this app has no tabs and no IndexedDB; it uses Keychain and Keystore.
 * - Shared browsers: the device belongs to one person, and the lock screen is the boundary.
 * - CORS and extensions: failure causes that do not exist in this runtime
 *   (`lib/generation/errors.ts`).
 *
 * Sentences that cannot be kept are not written. These four are false or not something we can
 * guarantee, so none appears in any copy:
 * - `RowCat can never access this key`: code in the same process
 *   does access it.
 * - `Zero-access encryption`: this value is not ciphertext under our protocol.
 * - `Hardware-protected on every device`: it depends on device and OS
 *   version.
 * - `The provider doesn't log prompts`: not something we know.
 *
 * Instead, write what is true: where it is stored, where it goes, and who is billed.
 */

export const PROVIDER_SECTION_TITLE = "AI providers";
export const PROVIDER_SECTION_DESCRIPTION =
	"Connect a personal API key to generate conversations directly with that provider. Without connecting, you can still chat with RowCat-provided models.";

/** The human-readable provider name. Same words as the table in the conversation screen. */
export const PROVIDER_TITLE: Record<ByoProvider, string> = {
	"anthropic-byo": "Anthropic",
	"gemini-byo": "Google Gemini",
	"openrouter-byo": "OpenRouter",
	"openai-compatible-byo": OPENAI_COMPATIBLE_LABEL,
};

/**
 * The provider's API key issuing page.
 *
 * We do not copy the console instructions into our screen. They would become a wrong explanation
 * the moment the provider changes its UI, and **a wrong explanation is worse than none.** One link
 * is enough.
 *
 * `null` for the server the user names: we do not know it, and a guessed page is a wrong one.
 */
export const PROVIDER_KEY_PAGE: Record<ByoProvider, string | null> = {
	"anthropic-byo": "https://platform.claude.com/settings/keys",
	"gemini-byo": "https://aistudio.google.com/apikey",
	"openrouter-byo": "https://openrouter.ai/settings/keys",
	"openai-compatible-byo": null,
};

export const PROVIDER_KEY_PAGE_LABEL = "Open the API key page";

/** Row status: the words say it, not colour. */
export const PROVIDER_CONNECTED = "Linked";
export const PROVIDER_DISCONNECTED = "Not connected";

/** "Since when is this connected" — the screen formats the time in the product timezone. */
export const providerConnectedSince = (when: string): string =>
	`Connected ${when}`;

export const PROVIDER_CONNECT_LABEL = "Link";
export const PROVIDER_REPLACE_LABEL = "Replace key";
export const PROVIDER_DISCONNECT_LABEL = "Disconnect";
export const PROVIDER_CANCEL_LABEL = "Cancel";

/**
 * Could not read the list: **do not say there are no connections.**
 *
 * If the two were folded together, a person whose Keychain briefly could not be read would see "not
 * connected", and would paste an intact key again.
 */
export const PROVIDER_LIST_FAILURE =
	"Couldn't read the connection status. Please try again.";
export const PROVIDER_RETRY_LABEL = "Try again";

/** Title of the connect/replace dialog. Same operation, but the user is trying to do something different. */
export const providerDialogTitle = (
	provider: ByoProvider,
	mode: "connect" | "replace",
): string =>
	mode === "connect"
		? `Connect ${PROVIDER_TITLE[provider]}`
		: `Replace ${PROVIDER_TITLE[provider]} key`;

export const PROVIDER_KEY_FIELD_LABEL = "API key";

/**
 * The two fields only the user-named server has (`openai-compatible-byo`). The address rule and its
 * reasons are the shared one (`checkOpenAiCompatibleEndpoint`); these are only its words, the same as
 * the web's.
 */
export const PROVIDER_SERVER_FIELD_LABEL = "Server address";
export const PROVIDER_SERVER_PLACEHOLDER = "https://api.example.com/v1";
export const PROVIDER_SERVER_HINT =
	"The address before /chat/completions. Plain http works only for a server on this device; on a phone, localhost is the phone itself.";
export const PROVIDER_MODELS_FIELD_LABEL = "Models";
export const PROVIDER_MODELS_PLACEHOLDER = "llama3.1:8b";
export const PROVIDER_MODELS_HINT =
	"The model names this server accepts, one per line. They appear in the model picker.";
export const PROVIDER_KEY_ANY_VALUE =
	"If the server doesn't use a key, enter any value.";
export const PROVIDER_SERVER_NOTICE =
	"Conversations and this key go only to the server you enter here. Check that it's one you trust.";
export const PROVIDER_SERVER_FAILURE = {
	endpointEmpty: "Enter the server address.",
	endpointInsecure:
		"Plain http is accepted only for a server on this device (localhost). Use an https address.",
	endpointInvalid:
		"This isn't an address that can be used. Enter something like https://example.com/v1.",
	modelsEmpty: "Enter at least one model name.",
	modelsInvalid:
		"A model name can't contain spaces or be longer than 200 characters.",
	modelsTooMany: "Enter up to 20 model names.",
	unreachable:
		"Couldn't reach a server at this address. Check the address and that the server is running.",
} as const;
export const PROVIDER_KEY_PLACEHOLDER = "Paste your API key";

/**
 * One line in the replace dialog: states **up front that the currently stored key is not shown**.
 *
 * Without this sentence, the user sees an empty field and reads that the connection was removed. We
 * do not draw a masked value or the last four digits, because that display is information usable
 * for offline matching, and above all because it would require a path by which the screen reads the
 * stored secret (no such path exists in this slice).
 */
export const PROVIDER_REPLACE_NOTICE =
	"For security, the saved key isn't shown. Pasting a new key replaces the existing one.";

/**
 * Pre-connection disclosure: **each of the four sentences states a different fact.**
 *
 * They are not merged into one paragraph because users skim. Where the key is stored, where
 * requests go, and who is billed are separate grounds for decisions, and even if someone reads only
 * one of them, that sentence must be true.
 */
export const PROVIDER_DISCLOSURE: readonly string[] = [
	"The API key is stored in this device's secure storage (Keychain · Keystore).",
	"The saved API key isn't sent to the RowCat server.",
	"In conversations that choose this provider, prompts and conversation content are sent directly from this device to that provider.",
	"The provider bills generation charges to your provider account.",
];

/** Save failed — do not draw the raw store message. Say only the one thing the user can do. */
export const PROVIDER_SAVE_FAILURE =
	"Couldn't save the connection. Please try again.";

/** Submitted an empty value — it ends here, before asking the provider. */
export const PROVIDER_EMPTY_KEY = "Please enter an API key.";

/**
 * The account changed during the operation.
 *
 * Not folded into failure because the fact is different: the key is neither wrong nor is the
 * network down. **This operation no longer belongs to this session.** Pressing again gets the same
 * answer, so `Try again` (retry) is not suggested.
 */
export const PROVIDER_FOREIGN_SESSION =
	"The account changed, so the connection wasn't saved.";

/**
 * Member under 14 — **only connecting is locked.**
 *
 * The sentence is identical, character for character, to the web's. Without the second sentence
 * this screen reads as if conversation itself were blocked. Its job is to tell this person **what
 * still works**.
 */
export const providerByoLocked = (): string =>
	`Members under ${membershipAges().guardianConsent} can't connect a personal API key. Conversations are available with RowCat-provided models.`;

/** Disconnect confirmation — **what happens and what does not.** */
export const providerDisconnectTitle = (provider: ByoProvider): string =>
	`Disconnect ${PROVIDER_TITLE[provider]}?`;

/**
 * Four lines, and the last three are **what does not happen**.
 *
 * Without those three, the user reads this button as revoking the key on their provider account,
 * disconnecting every device, or resetting conversation settings. All three are false, and anyone
 * who pressed believing one of them thinks they did something irreversible.
 */
export const providerDisconnectDescription = (provider: ByoProvider): string =>
	[
		`The ${PROVIDER_TITLE[provider]} API key stored on this device is deleted.`,
		"Conversations and settings that chose this provider stay, and those conversations can't generate replies until the key is connected again.",
		"The API key on your provider account itself isn't revoked.",
		"Connections on other devices aren't affected.",
	].join("\n\n");

/** Disconnect failed — say only the one thing the user can do. */
export const PROVIDER_DISCONNECT_FAILURE =
	"Couldn't disconnect. Please try again.";
