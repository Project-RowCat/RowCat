import { CHAT_ERROR_CODE } from "@rowcat/contracts";
import type { NativeRuntimeGenerationResult } from "../../lib/runtime-native/protocol.ts";
import {
	ChatGenerationBlockedError,
	failureCode,
} from "../chat/generation/error.ts";

/**
 * The safe public vocabulary for generation failures: one boundary between the trusted stack and
 * the WebView.
 *
 * ```text
 * provider / transport / SDK / internal service exceptions
 *      ↓  here                        ← where the original sentence ends
 * NativeRuntimeGenerationResult       one reason + one sentence owned by RowCat
 *      ↓  bridge
 * WebView → RuntimeGenerationPort → host → QuickJS RuntimeError
 * ```
 *
 * ## ⚠️ A named reason is not a passport for the original sentence
 *
 * This is the same leak Phase 6C closed on the web. The host's general sanitizer folds only
 * exceptions that state no reason. If a trusted adapter attaches the name `failed` to an unknown
 * exception and also carries `error.message`, that sentence bypasses the sanitizer and reaches
 * creator code. One line such as `401 … Authorization: Bearer sk-live-…` takes that path. So the
 * sentence is replaced with ours at the exact place the reason is attached.
 *
 * The sentences match the web on purpose. If the two apps drew different sentences for the same
 * failure, the same creator code would read different reasons per platform, and the difference
 * would reproduce on only one of them.
 */
export const NATIVE_GENERATION_FAILURE: Readonly<
	Record<
		Extract<NativeRuntimeGenerationResult, { ok: false }>["reason"],
		string
	>
> = Object.freeze({
	unavailable: "AI isn't available in this story.",
	// The provider name is not written here: that word is this device's setting, and would tell
	// creator code about someone else's device. Concrete guidance belongs to the trusted settings
	// screen.
	"not-authorized":
		"AI isn't available with the current settings. Check your AI provider connection in settings.",
	// Reserved reason: no host emits it now. The payment layer was removed, but the reason is part of
	// the runtime public contract vocabulary, so deleting it would be a narrowing change. The sentence
	// states the fact without naming a currency, and it is the same value as the web preview
	// (`runtime-preview-generation-failure.ts`).
	"insufficient-balance":
		"Couldn't make a response because the AI usage limit was reached.",
	cancelled: "Generation was interrupted.",
	failed: "No AI response was received.",
});

export const nativeGenerationFailure = (
	reason: Extract<NativeRuntimeGenerationResult, { ok: false }>["reason"],
): NativeRuntimeGenerationResult => ({
	ok: false,
	reason,
	message: NATIVE_GENERATION_FAILURE[reason],
});

// Folds any exception into one named reason; the original sentence is used on no branch.
//
// Outside the managed allowlist (`chat_managed_not_allowed`) maps to `not-authorized` because the
// remedy is the same as having no connection: connect your own key in settings (the same judgment
// as the web preview). Folding it into `failed` would make the creator's screen read it as
// something that a retry resolves.
export function toNativeGenerationFailure(
	error: unknown,
): NativeRuntimeGenerationResult {
	if (error instanceof ChatGenerationBlockedError)
		return nativeGenerationFailure("not-authorized");
	if (
		error instanceof Error &&
		failureCode(error) === CHAT_ERROR_CODE.managedNotAllowed
	)
		return nativeGenerationFailure("not-authorized");
	if (
		typeof error === "object" &&
		error !== null &&
		(error as { name?: unknown }).name === "AbortError"
	)
		return nativeGenerationFailure("cancelled");
	return nativeGenerationFailure("failed");
}
