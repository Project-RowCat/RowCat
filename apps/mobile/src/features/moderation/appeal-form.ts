import { REPORT_LIMITS } from "@rowcat/contracts";
import { APPEAL_MESSAGE_TOO_LONG } from "./moderation-copy.ts";

/**
 * Screen-level check of the appeal body. It is pure, so it can be verified without rendering.
 *
 * This check exists because of one fact that `maxLength` erased. If the input is cut at the limit,
 * the over-limit state is **never expressed**, so the guidance sentence never draws, and a person
 * who pasted a long text submits a body whose tail silently disappeared. An appeal is a moderation
 * letter, so that loss is especially costly (the bio field's `checkBio` and the persona form
 * reached the same conclusion first).
 *
 * ## No trimming: only emptiness is checked
 *
 * `trim()` is used in exactly one place: whether there is anything to send (the same rule as
 * `appeal-turn.ts`). Length is counted on the original text, which is never altered. If the screen
 * trimmed it in advance, the limit check would differ between the screen and the contract.
 *
 * ## Over-limit is a state, not a failure
 *
 * The over-limit body is neither deleted nor cut. When the user deletes text back under the limit,
 * it can be submitted again. The final guard is still the contract (`.max()` on
 * `AppealCreateRequest`).
 */
export interface AppealMessageCheck {
	/** Length of the original text; the screen's `count / limit` display draws this value. */
	count: number;
	limit: number;
	tooLong: boolean;
	/**
	 * Only whitespace, so there is nothing to send. A different fact from over-limit, with different
	 * copy; it only disables the button.
	 */
	empty: boolean;
	/** Whether the submit button may be enabled. `pending` is a screen-level axis and is not here. */
	submittable: boolean;
	/** Set only when over the limit; the guidance sentence the screen draws. */
	error: string | null;
}

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
		error: tooLong ? APPEAL_MESSAGE_TOO_LONG : null,
	};
}
