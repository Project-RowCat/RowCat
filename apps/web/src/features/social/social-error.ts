import { CAPABILITY_ERROR_CODE, SOCIAL_ERROR_CODE } from "@rowcat/contracts";
import { isRowCatApiError } from "@rowcat/sdk";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Branches on the error `code`, not the HTTP status (repo convention). The server message is not
 * shown because it speaks to developers; the screen must say what the user can do now.
 *
 * Only the rejection for a blocked counterpart has a next action. Self-follow and missing-member
 * errors cannot be reached through normal UI, so they end short. If a user gets there anyway, the
 * screen is stale or the request was hand-made, and the user has nothing to do.
 */
function socialErrorMessage(
	error: unknown,
	action: "follow" | "block",
): string {
	const t = translator("social");
	const failed =
		action === "follow" ? t("error.followFailed") : t("error.blockFailed");
	const apiError = isRowCatApiError(error) ? error : null;
	if (!apiError) return failed;

	switch (apiError.code) {
		case SOCIAL_ERROR_CODE.blockedTarget:
			return t("error.blockedTarget");
		case SOCIAL_ERROR_CODE.selfFollow:
			return t("error.selfFollow");
		case SOCIAL_ERROR_CODE.selfBlock:
			return t("error.selfBlock");
		/**
		 * Restriction comes in two codes: whole account (`account_restricted`) and capability-only
		 * (`capability_restricted`, which covers `social.write` and so blocks following). If the second
		 * is missing, the user gets the generic 'try again later' text, and retrying never succeeds.
		 *
		 * The reason is not shown here. The authority for public reasons is `GET /v2/me/moderation`.
		 * Repeating it in every failure would split one fact across two places. Blocking stays open under
		 * this restriction, so it never reaches this branch.
		 */
		case CAPABILITY_ERROR_CODE.restricted:
		case "account_restricted":
			return action === "follow"
				? t("error.followRestricted")
				: t("error.blockRestricted");
		case "login_required":
			return t("error.loginRequired");
		default:
			/**
			 * 404 does not guess a reason. The server returns the same response for missing and deleted
			 * members on purpose (existence hiding). If the screen distinguished them, that boundary would
			 * leak.
			 */
			return apiError.status === 404 ? t("error.notFound") : failed;
	}
}

export const followErrorMessage = (error: unknown): string =>
	socialErrorMessage(error, "follow");

export const blockErrorMessage = (error: unknown): string =>
	socialErrorMessage(error, "block");
