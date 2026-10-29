import { isRowCatApiError } from "@rowcat/sdk";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Maps an account write failure to a sentence the user can read.
 *
 * Two reasons the server's sentence is not drawn as-is. A caught exception can carry internal
 * details such as the request URL (network errors), and, more importantly, the screen has to branch
 * on the **reason**, not the sentence. The reason's name is `code`, and the server decides it.
 *
 * Only reasons this screen can actually produce are handled here. Listing codes that never occur
 * would make it impossible to tell which branches are live.
 */
export function accountErrorMessage(error: unknown): string {
	if (!isRowCatApiError(error))
		return translator("account")("accountError.couldnTSendTheRequest");

	switch (error.code) {
		/**
		 * The client rejected the input itself, before sending. The request never reached the server.
		 *
		 * The sentence is not used verbatim. That text is zod's message for developers (in English), and
		 * the form already gives the same rule in Korean. Reaching this point means the path bypassed
		 * that guidance.
		 */
		case "invalid_request":
			return translator("account")("accountError.theValueEnteredIsnT");
		/**
		 * The server rejected it under its own rules. The message is ours, so it is shown, but the
		 * **field path** prefix is stripped.
		 *
		 * The prefix (`showAdult: `) is there so that the server's `invalidInput` says which field is
		 * wrong, which is useful to logs and developers. On screen the message already sits next to that
		 * field, so the information would appear twice, and the name is the contract's English field
		 * name, which would make the Korean sentence look like a system log.
		 */
		case "invalid_input":
			return error.message.replace(/^[A-Za-z_][\w.]*:\s*/, "");
		case "account_restricted":
			return translator("account")("accountError.thisAccountIsRestrictedSo");
		case "login_required":
			return translator("account")("accountError.youVeBeenSignedOut");
		default:
			return translator("account")("accountError.couldnTSaveTheChange");
	}
}
