import { isRowCatApiError } from "@rowcat/sdk";

/**
 * A 4xx returns the same answer when asked again, so **do not retry**.
 *
 * Default retries (exponential backoff) assume a transient network blip. A 4xx is not that. The
 * server has judged this request unprocessable under this identity, so repeating it gets the same
 * answer. Retrying would hold the screen on a placeholder while the user waits seconds for a result
 * that is already final.
 *
 * This matters most when logged out or as a guest. A member query gets a 401 at that moment, and
 * with default retries the just-logged-out user would see that section as loading. A definitive
 * failure must be immediate so the screen can move on. When the tab is in the background, TanStack
 * Query pauses retries entirely, so the screen appears frozen.
 *
 * 5xx and network errors still retry, because there is a value worth asking for again.
 *
 * One shared definition is the point. This judgement was once hand-written per query, the same
 * expression in nine places, three of them as local functions with the same name. With copies, a
 * change to the cap (`3`) or to the status range can land in one place only, and the mismatch then
 * appears on that screen alone.
 */
export const retryUnlessClientError = (
	failureCount: number,
	error: Error,
): boolean =>
	isRowCatApiError(error) && error.status >= 400 && error.status < 500
		? false
		: failureCount < 3;
