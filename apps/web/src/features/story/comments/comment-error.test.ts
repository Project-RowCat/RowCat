import {
	CAPABILITY_ERROR_CODE,
	STORY_COMMENT_ERROR_CODE,
} from "@rowcat/contracts";
import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import { commentErrorMessage } from "./comment-error.ts";

/**
 * Failure copy is tested without rendering. The two kinds of failure differ by what the user does
 * next.
 * - Restriction (`capability_restricted`, `account_restricted`) is persistent. Retrying gets the
 *   same answer, so the copy points to the account screen.
 * - Everything else is transient or unknown, so the copy says to try again.
 *
 * If the first group is folded into the second, the symptom is quiet. The error shows and the
 * wording looks natural, but a restricted user keeps retrying and never sees where to go. The
 * browser journey cannot catch this, since it only observes that an error appeared and nothing was
 * saved.
 */

/**
 * Reproduces a server failure the way the screen receives it. The message is the developer-facing
 * text the screen should never show.
 */
const apiError = (code: string, status: number): RowCatApiError =>
	new RowCatApiError({
		status,
		code,
		message: "what the server tells developers",
	});

describe("commentErrorMessage", () => {
	/**
	 * Two restriction codes with different scopes (whole account vs `comment.write` alone) but the
	 * same user action, so they share a branch and are tested together. Testing only one side was a
	 * real gap: the capability restriction was added later.
	 */
	it.each([
		["capability restriction", CAPABILITY_ERROR_CODE.restricted],
		["account sanction", "account_restricted"],
	])("%s sends to the account screen — no retry suggested", (_label, code) => {
		const message = commentErrorMessage(apiError(code, 403));
		expect(message).toContain("account screen");
		expect(message).not.toContain("in a moment");
	});

	/**
	 * The reason is not rendered here. The authority for public reasons is `GET /v2/me/moderation`.
	 * Repeating the reason in failure copy would split one fact across two places.
	 */
	it("the sanction wording invents no reason", () => {
		expect(
			commentErrorMessage(apiError(CAPABILITY_ERROR_CODE.restricted, 403)),
		).not.toContain("rule");
	});

	/**
	 * The opposite side: an unknown failure is where retry belongs. Folding it into a restriction
	 * would make a user whose network blipped read that their account is restricted.
	 */
	it("an unknown failure only says to try again", () => {
		const message = commentErrorMessage(apiError("http_error", 500));
		expect(message).toContain("in a moment");
		expect(message).not.toContain("account screen");
	});

	/** A failure with no error envelope at all (network down) also belongs in the retry branch. */
	it("a non-API failure is also a retry case", () => {
		expect(commentErrorMessage(new Error("network"))).toContain("in a moment");
	});

	/**
	 * Only 429 is a failure the user can actually fix, by waiting. It is kept apart from restriction.
	 */
	it("rate limiting is not a sanction", () => {
		const message = commentErrorMessage(
			apiError(STORY_COMMENT_ERROR_CODE.rateLimited, 429),
		);
		expect(message).toContain("in a moment");
		expect(message).not.toContain("account screen");
	});

	/**
	 * 404 does not reveal a reason. Whether a work went private or was deleted is a distinction the
	 * server folds on purpose. If the screen spelled it out, the comment path would become a presence
	 * detector.
	 */
	it("a 404 says only that posting isn't possible, without a reason", () => {
		const message = commentErrorMessage(apiError("not_found", 404));
		expect(message).not.toContain("private");
		expect(message).not.toContain("deleted");
	});
});
