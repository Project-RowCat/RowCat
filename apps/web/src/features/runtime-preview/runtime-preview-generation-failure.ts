import { CHAT_ERROR_CODE } from "@rowcat/contracts";
import { GenerationBlockedError } from "#/lib/generation/availability.ts";
import type { PreviewGenerationResult } from "./protocol.ts";

/**
 * Safe public vocabulary for generation failures: the single boundary between the trusted stack and
 * the worker. Provider, transport, SDK, billing and internal-service exceptions end here; what
 * leaves is one named reason and one sentence owned by RowCat.
 * - A named reason is not a pass for the original sentence. Before this file, unknown errors
 *   reached the host as failed with error.message. The host's sanitizer folds only exceptions that
 *   carry no reason (generation.ts), so naming them made the raw text trusted, and an authorization
 *   header could reach creator code. The sentence is replaced at the same place the reason is
 *   attached.
 * - Two layers, on purpose: this file folds before the worker, and the host folds again at
 *   RuntimeGenerationPort (generation.ts). Neither is relaxed because the other exists.
 * - The judgement is called from two places: the adapter's catch and the router's rejection path.
 *   Both must use this function, or one could be safe while the other is not, with no error raised.
 * - No SDK, query layer or React import, so it can be checked by value without a renderer.
 */

/**
 * One sentence per reason, all static. The table has no slot for inserting values, so no exception
 * message, provider name, model id or HTTP status can get in.
 */
export const PREVIEW_GENERATION_FAILURE: Readonly<
	Record<Extract<PreviewGenerationResult, { ok: false }>["reason"], string>
> = Object.freeze({
	unavailable: "AI isn't available in this preview.",
	/**
	 * Does not name the provider. The reader now is the creator in the studio, but if this contract
	 * later runs on a player's device, a provider name would expose that device's settings to creator
	 * code. Concrete guidance, such as which provider to connect, belongs to the trusted settings
	 * screen. This sentence only says the AI cannot be used.
	 */
	"not-authorized":
		"AI isn't available with the current settings. Check the AI provider connection in Settings.",
	/**
	 * Reserved reason; no host emits it now. Billing has been removed, so this app does not create it
	 * (toPreviewGenerationFailure folds the old balance code into failed). It stays because it is part
	 * of the runtime's public contract, and deleting it would be a narrowing change. The sentence
	 * states only the fact, with no currency, so it remains true if a fork attaches a usage limit to
	 * this reason.
	 */
	"insufficient-balance":
		"The AI usage limit was reached, so no response was made.",
	cancelled: "Generation was cancelled.",
	failed: "No AI response was received.",
});

export const previewGenerationFailure = (
	reason: Extract<PreviewGenerationResult, { ok: false }>["reason"],
): PreviewGenerationResult => ({
	ok: false,
	reason,
	message: PREVIEW_GENERATION_FAILURE[reason],
});

/**
 * Folds any exception into one named reason. There are three branches, each a fact the code already
 * knows: generation was blocked before it started (GenerationBlockedError), the request is outside
 * this deployment's managed allowlist (signalled by our API's code), or it was cancelled.
 * Everything else is failed. The original sentence is used in none of these branches. Outside the
 * allowlist maps to not-authorized because the remedy matches having no connection: connect your
 * own key in settings. Folding it into failed would make the screen suggest that retrying might fix
 * it.
 */
export function toPreviewGenerationFailure(
	error: unknown,
): PreviewGenerationResult {
	if (error instanceof GenerationBlockedError)
		return previewGenerationFailure("not-authorized");
	const code =
		typeof error === "object" && error !== null && "code" in error
			? String((error as { code: unknown }).code)
			: null;
	if (code === CHAT_ERROR_CODE.managedNotAllowed)
		return previewGenerationFailure("not-authorized");
	if (
		typeof error === "object" &&
		error !== null &&
		(error as { name?: unknown }).name === "AbortError"
	)
		return previewGenerationFailure("cancelled");
	return previewGenerationFailure("failed");
}
