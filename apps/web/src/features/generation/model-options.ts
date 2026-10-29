import type {
	ModelOptionLabels,
	ModelOptions,
	ModelOptionsInput as SharedModelOptionsInput,
	TargetUnavailability,
} from "@rowcat/chat";
import { buildModelOptions as buildShared } from "@rowcat/chat";
import { providerLabel } from "#/lib/generation/availability.ts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * The list the model selection control draws. The rules are shared; the copy lives here.
 *
 * The list itself is built by `buildModelOptions` in `@rowcat/chat`. The rules used to live in this
 * file, and when a mobile screen gained the same two columns it meant writing the same rules twice.
 * What is visible, what can be selected, and whether a saved value stays in the list are questions
 * both apps must answer identically. A mismatch only shows when the two screens are compared side
 * by side.
 *
 * What remains here is Korean copy. If copy entered the pure package, the rules would be tied to
 * one locale, and later apps would have to accept our sentences too. `generation-availability.ts`
 * already works this way: it returns only the reason for blocking, and the app writes the sentence.
 *
 * The call signature is unchanged on purpose. This file fills in the copy and passes it on, so
 * `ModelTargetField` and this module's tests stay as they were.
 */

/**
 * The suffix appended to item names. The shared module decides where it goes.
 *
 * The leading middle dot (·) is there because these values follow the provider or model name. If
 * the way names and suffixes are joined changes here, both columns change shape together.
 */
const labels = (): ModelOptionLabels => {
	const t = translator("generation");
	return {
		inherit: (providerName) => t("inherit", { value: providerName }),
		/**
		 * Account restriction comes before connection. The shared module enforces that order; this file
		 * only ensures the two messages state different facts. Showing `Connect the provider first` to a child sends them
		 * to get a key and then blocks them again.
		 */
		byoNotPermitted: t("target.byoNotPermitted"),
		providerNotConnected: t("target.providerNotConnected"),
		missingFromCatalog: t("target.missingFromCatalog"),
	};
};

/**
 * Callers do not need the copy. This module fills in the app's label table before passing the input
 * to the shared module.
 */
export type ModelOptionsInput = Omit<
	SharedModelOptionsInput,
	"providerLabel" | "labels"
>;

export function buildModelOptions(input: ModelOptionsInput): ModelOptions {
	return buildShared({ ...input, providerLabel, labels: labels() });
}

export {
	INHERIT_VALUE,
	type ModelOptionEntry,
	type ModelOptionGroup,
	type ModelOptions,
	type ProviderOptionEntry,
	type TargetUnavailability,
	targetForKey,
} from "@rowcat/chat";

/**
 * The three sentences state different facts. Writing 'connect' when the provider is already
 * connected makes the user redo what they did, and when that does not fix it, the guidance is worse
 * than none.
 *
 * Account restriction comes before connection. Telling a child to connect sends them to get a key
 * and then blocks them again, and by then the chance to explain why we block is lost.
 *
 * The sentence must not end with 'cannot be used'. It states what still works (RowCat provided
 * models); otherwise the screen reads as if the whole conversation is blocked. The generation
 * failure message made the same call (`blockedMessage` in `lib/generation/availability.ts`).
 */
export function unavailableMessage(unavailable: TargetUnavailability): string {
	const t = translator("generation");
	const label = providerLabel(unavailable.provider);
	if (unavailable.reason === "managed_only")
		return t("target.managedOnly", { app: "RowCat" });
	if (unavailable.reason === "byo_not_permitted")
		return t("target.byoNotPermittedMessage", {
			app: "RowCat",
			provider: label,
		});
	if (unavailable.reason === "provider_not_connected")
		return t("target.providerNotConnectedMessage", { provider: label });
	return t("target.missingMessage");
}
