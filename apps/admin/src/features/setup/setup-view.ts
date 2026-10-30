import { SETUP_ERROR_CODE } from "@rowcat/contracts";
import type { Viewer } from "@rowcat/domain";
import { canModerate } from "@rowcat/domain";
import { isRowCatApiError } from "@rowcat/sdk";

/**
 * Which face `/setup` shows. Pure so the order is a rule rather than a stack of conditions inside a
 * component, where the natural mistake is checking the viewer before the setup status and drawing a
 * sign-up form on a deployment that has been set up for months.
 *
 * ```text
 * loading       status or viewer not answered yet
 * unavailable   the status (or, while open, the viewer) could not be read — not "closed"
 * closed        setup is complete; operators go to the console, everyone else to sign-in
 * account       open, nobody signed in — create the administrator account or sign in
 * code          open, signed in — enter the code from the API log
 * done          this page's own claim succeeded — readiness list and the way in
 * ```
 *
 * The claim's own state comes first. Its success refetches the status, which answers closed before the
 * mutation itself reports success; read in the other order, the person who just finished is told
 * "setup is already complete" in place of their result, and the code form unmounts mid-request. So a
 * claim in flight keeps the code step, and a claim that succeeded is `done` whatever the status says.
 * That state lives in the page, not the form — a callback passed to `mutate()` never fires once the
 * form that called it has unmounted, which is exactly what the status refetch does.
 *
 * A failed lookup is never folded into `closed` or `account`. "Couldn't ask" and "the answer is no"
 * need different actions, and drawing a sign-up form because `/me` timed out sends an operator who is
 * already signed in to make a second account.
 */
export type SetupView =
	| { step: "loading" }
	| { step: "unavailable" }
	| { step: "closed"; operator: boolean }
	| { step: "account" }
	| { step: "code"; nickname: string }
	| { step: "done" };

export interface ResolveSetupViewInput {
	status: { open: boolean } | undefined;
	statusFailed: boolean;
	/** `null` is the server answering "not signed in"; `undefined` is not answered yet. */
	viewer: Viewer | null | undefined;
	viewerPending: boolean;
	viewerFailed: boolean;
	/** This page's claim mutation. */
	claim: "idle" | "pending" | "succeeded";
}

export function resolveSetupView(input: ResolveSetupViewInput): SetupView {
	if (input.claim === "succeeded") return { step: "done" };
	if (input.claim === "pending" && input.viewer)
		return { step: "code", nickname: input.viewer.nickname };
	if (!input.status)
		return input.statusFailed ? { step: "unavailable" } : { step: "loading" };
	if (!input.status.open)
		return { step: "closed", operator: canModerate(input.viewer ?? null) };
	if (input.viewerFailed) return { step: "unavailable" };
	if (input.viewerPending || input.viewer === undefined)
		return { step: "loading" };
	if (!input.viewer) return { step: "account" };
	return { step: "code", nickname: input.viewer.nickname };
}

/**
 * The claim's failures, in the operator's words. `closed` is not here: the page refetches the status
 * and draws the closed face instead of an error line.
 *
 * A network failure is kept apart from a refusal: nothing was checked, and the operator should look at
 * the API, not retype the code. The caught error's own text is not shown (it can carry the request URL).
 */
export function setupClaimErrorMessage(error: unknown): string {
	if (!isRowCatApiError(error))
		return "Couldn't reach the API. Check that it is running, then try again.";
	switch (error.code) {
		case SETUP_ERROR_CODE.invalidCode:
			return "That code doesn't match. Copy it again from the API log — the latest start prints it.";
		case SETUP_ERROR_CODE.rateLimited:
			return "Too many attempts. Wait a few minutes, then try again.";
		case "account_restricted":
			return "This account is restricted, so it can't become the administrator. Use another account.";
		case "login_required":
			return "Your session ended. Sign in again to continue.";
		default:
			return "Setup didn't complete. Try again.";
	}
}

/**
 * The local claim's failures. Two are its own: a request the server judged not to be from its
 * computer, and a claim that went through but whose sign-in did not — setup is finished then, and the
 * next load on this computer signs in, so the sentence says to reload rather than to try again.
 */
export function setupClaimLocalErrorMessage(error: unknown): string {
	if (error instanceof Error && error.name === "LocalSignInError")
		return "Setup is finished, but signing this computer in didn't work. Reload the page.";
	if (
		isRowCatApiError(error) &&
		error.code === SETUP_ERROR_CODE.localUnavailable
	)
		return "Using it without signing in can only be set up on the computer the API runs on. Create an administrator account instead.";
	return setupClaimErrorMessage(error);
}

export const isSetupClosedError = (error: unknown): boolean =>
	isRowCatApiError(error) && error.code === SETUP_ERROR_CODE.closed;
