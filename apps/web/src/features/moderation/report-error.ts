import { APPEAL_ERROR_CODE, REPORT_ERROR_CODE } from "@rowcat/contracts";
import { isRowCatApiError } from "@rowcat/sdk";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Maps a moderation failure to one human-readable line. Branches on the error `code`, not the HTTP
 * status (repo convention). The server message is not shown as-is, since it is written for
 * developers. The line must say what the user can do now.
 *
 * Do not reinterpret a 404. The server deliberately folds 'deleted', 'made private' and 'never
 * existed' into one response (§45). If the screen guessed and split them, the response would become
 * an existence oracle.
 */
export function reportErrorMessage(error: unknown): string {
	const apiError = isRowCatApiError(error) ? error : null;
	if (!apiError) return translator("moderation")("reportError.failed");

	switch (apiError.code) {
		case REPORT_ERROR_CODE.duplicate:
			return translator("moderation")("reportError.duplicate");
		case REPORT_ERROR_CODE.rateLimited:
			return translator("moderation")("reportError.rateLimited");
		case REPORT_ERROR_CODE.selfTarget:
			return translator("moderation")("reportError.self");
		case "account_restricted":
			return translator("moderation")("reportError.restricted");
		case "login_required":
			return translator("moderation")("reportError.loginRequired");
		case "invalid_input":
			return translator("moderation")("reportError.invalid");
		default:
			return apiError.status === 404
				? translator("moderation")("reportError.notReportable")
				: translator("moderation")("reportError.failed");
	}
}

/**
 * Kept separate from report failures because the options open to the user differ. A report failure
 * can usually be fixed by trying again. An appeal failure usually means an appeal already exists or
 * the sanction is lifted, so retrying returns the same answer. The message must say so, so the user
 * knows whether to wait or move on.
 */
export function appealErrorMessage(error: unknown): string {
	const apiError = isRowCatApiError(error) ? error : null;
	if (!apiError) return translator("moderation")("appealError.failed");

	switch (apiError.code) {
		case APPEAL_ERROR_CODE.duplicate:
			return translator("moderation")("appealError.duplicate");
		case APPEAL_ERROR_CODE.notAppealable:
			return translator("moderation")("appealError.notAppealable");
		case APPEAL_ERROR_CODE.alreadyReversed:
			return translator("moderation")("appealError.alreadyLifted");
		case "login_required":
			return translator("moderation")("appealError.loginRequired");
		default:
			return apiError.status === 404
				? translator("moderation")("appealError.notFound")
				: translator("moderation")("appealError.failed");
	}
}
