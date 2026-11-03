/**
 * Copy for personal moderation (account restriction · my reports · reports · appeals). The sentences
 * live in the dictionaries (`moderation`, English and Korean); this module names them, so the pure
 * state functions and the screens read one place.
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
 *   `MY_REPORT_STATE_LABEL`, keyed by the same codes (`moderation.reportState`). Nothing else is added:
 *   once a word exists, someone "for accuracy" imports the operator-side wording.
 * - **No invented public reasons.** An empty `publicReason` means the operator wrote none.
 *   Filling that slot with a sentence like `Policy violation` would put words the operator never wrote on
 *   screen.
 */
import type {
	AppealStatus,
	ModerationCapability,
	MyReportState,
	ReportReason,
	ReportTargetType,
} from "@rowcat/contracts";
import { deferredGroup, translator } from "../../lib/i18n/instance.ts";

const t = () => translator("moderation");

/**
 * The account section: title, the two descriptions (an active restriction · only past appeals), a
 * restriction with no expiry (`untilLifted` — dates are not invented: a null `expiresAt` means until
 * an operator lifts it), the appeal states and the three restriction subjects.
 */
export const ACCOUNT_MODERATION_COPY = deferredGroup("moderation", "account");

export const APPEAL_RESULT_LABEL: Record<
	Exclude<AppealStatus, "open">,
	string
> = ACCOUNT_MODERATION_COPY.appealResult;

export const restrictionExpiryNote = (date: string): string =>
	t()("account.until", { date });
export const restrictionAppliedNote = (date: string): string =>
	t()("account.applied", { date });

export const APPEAL_DIALOG_COPY = deferredGroup("moderation", "appealDialog");

export const appealDialogTitle = (subject: string): string =>
	t()("appealDialog.title", { subject });

export const MY_REPORTS_COPY = deferredGroup("moderation", "myReports");

export const reportSubmittedNote = (date: string): string =>
	t()("myReports.filed", { date });
export const reportReviewedNote = (date: string): string =>
	t()("myReports.reviewed", { date });

export const REPORT_DIALOG_COPY = deferredGroup("moderation", "dialog");

/** The contract's codes, named in the drawn language. The contract's English tables are not drawn. */
export const REPORT_TARGET_NAME: Record<ReportTargetType, string> =
	deferredGroup("moderation", "target");
export const REPORT_REASON_NAME: Record<ReportReason, string> = deferredGroup(
	"moderation",
	"reason",
);
export const reportReasonLabel = (reason: ReportReason): string =>
	t()(`reason.${reason}`);
export const reportTargetLabel = (target: ReportTargetType): string =>
	t()(`target.${target}`);
export const capabilityLabel = (capability: ModerationCapability): string =>
	t()(`capability.${capability}`);
export const reportStateLabel = (state: MyReportState): string =>
	t()(`reportState.${state}`);
