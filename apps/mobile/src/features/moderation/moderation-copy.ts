/**
 * Copy for personal moderation (account restriction · my reports), all kept here.
 *
 * This app's tests do not render screens, so copy has to be values for pure tests to check, and a
 * static scan gets one place to catch promise words (processing deadlines, dispositions, review
 * outcomes).
 *
 * ## What is absent from this file is its substance
 *
 * - **No processing deadlines.** `Within 7 days`, `expected completion` and `Delayed` are promises this product does not
 *   make (no voluntary SLA exists). Inventing them on screen makes promises we cannot keep.
 * - **No dispositions.** The reporter sees only the two states in the contract's
 *   `MY_REPORT_STATE_LABEL` (`Under review`, `Reviewed`). They are not re-typed here: once a copy exists,
 *   someone "for accuracy" imports the operator-side wording.
 * - **No invented public reasons.** An empty `publicReason` means the operator wrote none.
 *   Filling that slot with a sentence like `Policy violation` would put words the operator never wrote on
 *   screen.
 */
import type { AppealStatus } from "@rowcat/contracts";

export const MODERATION_SECTION_TITLE = "Restrictions";
/** Shown when an active restriction exists. */
export const MODERATION_SECTION_DESCRIPTION_ACTIVE =
	"Restrictions applied to this account and their reasons.";
/** Shown when only past appeals remain: the section stays because of an appeal's outcome. */
export const MODERATION_SECTION_DESCRIPTION_HISTORY =
	"No restrictions are applied right now.";

/**
 * A restriction with no expiry. Dates are not invented: `expiresAt` being null means "until
 * revoked", not "eventually lifted". Figures like `3 days left` or `Lifting soon` would be values the server
 * never answered.
 */
export const RESTRICTION_UNTIL_REVOKED = "Until lifted";
export const restrictionExpiryNote = (date: string): string => `Until ${date}`;
export const restrictionAppliedNote = (date: string): string =>
	`Applied ${date}`;

/**
 * The line for a restriction with an open appeal. The result of filing is this sentence: the only
 * thing that changes on screen after the window closes is this line, where the button used to be
 * and now the fact of the filing stands. So there is no separate success banner: the same fact in
 * two places makes users think they are different things.
 */
export const APPEAL_OPEN_NOTE = "Your appeal was received and is under review.";
export const APPEAL_ACTION_LABEL = "Appeal";
/**
 * An action that cannot be appealed: **a sentence, not a disabled button.** Which actions are
 * appealable is said by the server's list (`appealableActionIds`). A button that would only produce
 * a 400 is not drawn.
 */
export const APPEAL_UNAVAILABLE_NOTE = "This action can't be appealed.";

export const RESOLVED_APPEALS_TITLE = "Past appeals";
/**
 * Results of finished appeals, turning the authoritative state vocabulary into human words. `open`
 * is deliberately absent: an in-progress appeal is said by `APPEAL_OPEN_NOTE` beside its
 * restriction line and does not enter the past-appeals list.
 */
export const APPEAL_RESULT_LABEL: Record<
	Exclude<AppealStatus, "open">,
	string
> = {
	accepted: "Accepted",
	rejected: "Not accepted",
};

export const appealDialogTitle = (subject: string): string =>
	`Appeal: ${subject}`;
export const APPEAL_DIALOG_DESCRIPTION =
	"Tell us why you think this action was wrong. After review, the action is kept or lifted.";
export const APPEAL_MESSAGE_LABEL = "Appeal";
/**
 * Over the limit: **say it, do not cut.** Silently deleting through `maxLength` submits the pasted
 * sentence with its tail gone, and the user cannot know. Deleting characters to get back under the
 * limit allows submitting as is (the body is never altered).
 */
export const APPEAL_MESSAGE_TOO_LONG =
	"The appeal is too long. Please shorten it.";
export const APPEAL_SUBMIT_LABEL = "Appeal";
export const APPEAL_SUBMITTING_LABEL = "Submitting…";
export const APPEAL_CANCEL_LABEL = "Cancel";

export const MY_REPORTS_TITLE = "My reports";
export const MY_REPORTS_DESCRIPTION =
	"Reports you filed and their review status.";
/**
 * Shown **only for an empty list the server has confirmed.** Drawing a load failure or a stall with
 * this sentence makes someone who just filed a report read that their report disappeared. The order
 * lives in `my-reports-state.ts`.
 */
export const MY_REPORTS_EMPTY = "You haven't filed any reports.";
export const MY_REPORTS_OFFLINE =
	"You're not connected right now. The report list reloads once you're back online.";
export const MY_REPORTS_FAILED = "Couldn't load the report list.";
/** Keeps the held data and only says it is stale, the same sentence rule as the security and notifications sections. */
export const MY_REPORTS_STALE = "Couldn't refresh the list.";
export const MY_REPORTS_RETRY_LABEL = "Try again";
export const MY_REPORTS_MORE_LABEL = "Show more";
export const MY_REPORTS_LOADING_LABEL = "Loading…";

/** Time has two axes: when it was filed, and (if finished) when it finished. */
export const reportSubmittedNote = (date: string): string => `Filed ${date}`;
export const reportReviewedNote = (date: string): string => `Reviewed ${date}`;
