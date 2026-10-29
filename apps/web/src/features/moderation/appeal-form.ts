import { REPORT_LIMITS } from "@rowcat/contracts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Screen-side judgment for an appeal body. It is pure, so it can be checked without rendering.
 * - Why it exists: maxLength erased the over-limit fact. Cutting the input at the limit means the
 *   hint never renders and the user submits a silently shortened appeal, a costly loss for
 *   moderation correspondence. This repo's web tests have no React render, so the judgment must be
 *   a plain function to be tested at all.
 * - Trim is used only for the emptiness check. The count is taken on the raw text (it must match
 *   the `count / limit` display), and the text is never modified.
 * - Over-limit is a state, not a failure. Text is not deleted or cut; once it drops below the
 *   limit, submission works again. The final guard stays in the contract (AppealCreateRequest's
 *   .max()).
 * - Submission failure is not on this axis. A server rejection is a form failure; mixing it into
 *   the value check would read a dropped connection as an invalid value.
 * - Why it is not yet shared: the same judgment lives in
 *   apps/mobile/src/features/moderation/appeal-form.ts, and two copies can drift (one side might
 *   close the boundary differently). It stays duplicated because @rowcat/domain does not depend on
 *   @rowcat/contracts, which holds the limit, and no shared moderation-rules package exists yet.
 *   Identical file and function names across the apps are the guard until then, and both test
 *   suites run the same matrix.
 */
export interface AppealMessageCheck {
	/** The raw length, unmodified. The screen's `count / limit` display draws this value. */
	count: number;
	limit: number;
	tooLong: boolean;
	/**
	 * Empty after trimming: nothing to send. This is a different fact from over-limit, with different
	 * copy, and it only disables submission.
	 */
	empty: boolean;
	/**
	 * Whether the submit button may stay enabled. `pending` is a screen concern and is not part of
	 * this check.
	 */
	submittable: boolean;
	/** Set only when over the limit: the guidance sentence the screen draws. */
	error: string | null;
}

/**
 * Over the limit, the message says so instead of cutting. A silent maxLength cut would submit text
 * with a missing tail, unknown to the user. Once the user deletes back under the limit, the text
 * can be submitted unchanged. The sentence matches mobile: if the two apps worded the rule
 * differently, users would read them as two products. `The appeal is too long. Please shorten it.`
 */
export const appealMessageTooLong = (): string =>
	translator("moderation")("appealError.tooLong");

export function checkAppealMessage(message: string): AppealMessageCheck {
	const limit = REPORT_LIMITS.appealMessage;
	const tooLong = message.length > limit;
	const empty = !message.trim();
	return {
		count: message.length,
		limit,
		tooLong,
		empty,
		submittable: !tooLong && !empty,
		error: tooLong ? appealMessageTooLong() : null,
	};
}
