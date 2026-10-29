import type {
	ModelOptionLabels,
	ModelOptions,
	ModelOptionsInput as SharedModelOptionsInput,
	TargetUnavailability,
} from "@rowcat/chat";
import { buildModelOptions as buildShared } from "@rowcat/chat";
import { providerLabel } from "./labels.ts";

/**
 * The list the model picker draws: rules are shared, wording is here.
 *
 * `@rowcat/chat`'s `buildModelOptions` builds the list, and web's screen calls the same function
 * (`apps/web/src/features/generation/model-options.ts`), so both apps answer what is visible, what
 * is selectable and whether a stored value stays in the list identically. What remains is Korean,
 * identical to web's table. Two copies is unfortunate but better than putting wording into the pure
 * package.
 */

/** Suffixes appended to an item name; which position they take is decided by the shared module. */
const LABELS: ModelOptionLabels = {
	inherit: (providerName) => `Use default (${providerName})`,
	/**
	 * The child restriction outranks the missing connection; the shared module keeps that order, and
	 * here the two texts only need to say different facts (showing a child `Connect the provider first` sends them to
	 * get a key and be blocked again).
	 *
	 * The connection wording now matches web. For a while this app only stated the fact (`Not usable on this
	 * device`) because it had no connect screen; `/settings/ai`'s `AI providers` section now takes keys
	 * (generation failure wording reached the same judgement first, see `blockedMessage` in
	 * `error.ts`).
	 */
	byoNotPermitted: " · Not available under 14",
	providerNotConnected: " · Connect the provider first",
	missingFromCatalog: " · Not in the list",
};

/** Callers need not know the wording; this app's table is filled in for them. */
export type ModelOptionsInput = Omit<
	SharedModelOptionsInput,
	"providerLabel" | "labels"
>;

export function buildModelOptions(input: ModelOptionsInput): ModelOptions {
	return buildShared({ ...input, providerLabel, labels: LABELS });
}

/**
 * Unusable reason -> the line under the control. The three sentences state different facts; one
 * shared wording would make one of them a dead end (telling a connected user to connect makes them
 * redo what they already did).
 *
 * The child restriction comes first, for the same reason as above. Sentences do not end at "cannot
 * use": they say what works now (RowCat-provided models), or the screen reads as if the
 * conversation itself were blocked.
 */
export function unavailableMessage(
	unavailable: TargetUnavailability,
	/**
	 * What owns the override; the subject of the sentence. Defaults to the conversation because two of
	 * three callers are conversation surfaces (room settings, playtest). It is overridable for runtime
	 * playback: that screen has no room, and calling it `This conversation` would break the boundary that a runtime
	 * playthrough is not a conversation.
	 *
	 * ⚠️ The global defaults screen (`features/settings/generation-defaults-section.tsx`) also
	 * receives this default, but its subject is the device, not a conversation. Leaving that wording
	 * alone was a scope decision, not a statement that it is right.
	 */
	subject = "This conversation",
): string {
	const label = providerLabel(unavailable.provider);
	if (unavailable.reason === "managed_only")
		return `This story can only be chatted with using RowCat-provided models. Choose RowCat as the provider.`;
	if (unavailable.reason === "byo_not_permitted")
		return `Members under 14 can't use a personal API key (${label}). Choose RowCat as the provider.`;
	/**
	 * A connect screen exists, so this names the next step. It once ended at `Choose RowCat under the provider`
	 * because the app had no connect screen. The user can now do two things, connect a key or pick a
	 * RowCat-provided model, and both are stated.
	 */
	if (unavailable.reason === "provider_not_connected")
		return `The personal API key (${label}) set for ${subject} isn't connected on this device. Connect it in Settings → AI or choose a RowCat-provided model.`;
	return "This model isn't available in the current list.";
}
