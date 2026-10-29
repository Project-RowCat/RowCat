import { APPEAL_ERROR_CODE, REPORT_ERROR_CODE } from "@rowcat/contracts";
import { isRowCatApiError } from "@rowcat/sdk";

/**
 * Report failure → one human-readable line.
 *
 * **Moving this table out of `features/chat` was the first commit of this slice.** While the only
 * consumer was the AI-reply report, that location was right. Now works, comments and profiles read
 * the same table, and keeping it in the chat folder would make fixing a work report's failure text
 * a change to chat code. The mismatch shows up later as one side getting fixed alone: the same
 * server code gets different sentences per screen, and users read those as different failures.
 *
 * This is the same table as the web's `features/moderation/report-error.ts`, and keeping it a copy
 * is still intended: the table is **copy**, so it does not go into the pure package (Korean in the
 * pure package would tie the rules to one locale). Splitting is safe because the authority of the
 * vocabulary is the contract. When `REPORT_ERROR_CODE` gains a value, both apps fall to `default`,
 * which only makes the sentence worse and never wrong.
 *
 * The appeal table (`appealErrorMessage`) lives alongside it: a neighbour reading the same contract
 * vocabulary. The web keeps both in the same file too.
 *
 * Not reading 404 back matters especially. Whether the target was removed, made private, hidden, or
 * never existed is a distinction the server deliberately folds into one. If the screen guesses and
 * splits it into sentences, the response becomes an existence detector. With four targets now, the
 * rule weighs more: works, comments and profiles are all other people's content, and a sentence
 * that splits the reasons would tell someone "that work is still there".
 */
export function reportErrorMessage(error: unknown): string {
	const apiError = isRowCatApiError(error) ? error : null;
	if (!apiError)
		return "Couldn't file the report. Please try again in a moment.";

	switch (apiError.code) {
		case REPORT_ERROR_CODE.duplicate:
			return "You already reported this, and it's still under review.";
		case REPORT_ERROR_CODE.rateLimited:
			return "You've filed too many reports. Please try again in a moment.";
		case REPORT_ERROR_CODE.selfTarget:
			return "You can't report yourself.";
		case "account_restricted":
			return "A restricted account can't file reports.";
		case "login_required":
			return "You need to sign in.";
		case "invalid_input":
			return "Please check the report details.";
		default:
			return apiError.status === 404
				? "This can't be reported."
				: "Couldn't file the report. Please try again in a moment.";
	}
}

/**
 * Appeal failure → one line. Same rule as the web's `appealErrorMessage`.
 *
 * Kept apart from reports because what the user can do differs. A report failure is usually fixed
 * by pressing again, but an appeal failure is usually **an appeal already pending or a sanction
 * already lifted**, and pressing again gets the same answer. The user has to be told that, so they
 * know whether to wait or do something else.
 *
 * The source of the codes is the contract constant (`APPEAL_ERROR_CODE`). Retyping the strings
 * would mean that when the vocabulary changes, only this table falls to `default`, and that
 * mismatch is not a compile error. 404 is not read back: the non-existent action and someone else's
 * action give the same response, and the screen does not split them either.
 */
export function appealErrorMessage(error: unknown): string {
	const apiError = isRowCatApiError(error) ? error : null;
	if (!apiError)
		return "Couldn't file the appeal. Check your connection and try again.";

	switch (apiError.code) {
		case APPEAL_ERROR_CODE.duplicate:
			return "An appeal for this action is already under review.";
		case APPEAL_ERROR_CODE.notAppealable:
			return "This action can't be appealed.";
		case APPEAL_ERROR_CODE.alreadyReversed:
			return "This action was already lifted.";
		case "login_required":
			return "You need to sign in.";
		case "invalid_input":
			return "Please check your appeal.";
		default:
			if (apiError.status === 429)
				return "Too many requests. Please try again in a moment.";
			return apiError.status === 404
				? "Couldn't find the action to appeal."
				: "Couldn't file the appeal. Please try again in a moment.";
	}
}
