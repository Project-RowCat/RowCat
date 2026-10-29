import { ApiErrorBody } from "@rowcat/contracts/http";

/**
 * The only error type the SDK throws.
 *
 * Failures are not turned into empty values (`null`, `[]`). If they were, "the server did not
 * respond" and "there is no result" would become the same value. The screen could not pick guidance
 * text, and metrics would record the failure as normal. Protocol failures are not product data.
 *
 * `code` is exposed because callers must branch on it. For example, the adult gate shows different
 * screens inside the same 403. Deciding which branch applies is the server's job; this layer only
 * receives the name of a decision already made.
 */
export class RowCatApiError extends Error {
	/** HTTP status code. It is always present, even when the envelope could not be read. */
	readonly status: number;
	/** Machine-readable reason. Falls back to `http_error` when there is no envelope. */
	readonly code: string;
	/**
	 * Request id from the server. It is the only clue the user can carry back, so the screen shows it.
	 */
	readonly requestId?: string;
	/**
	 * Milliseconds from `Retry-After`, when present.
	 *
	 * The sync engine honors this value on 429 and on the "processing" 409. Without it, the engine
	 * falls back to exponential backoff, which is the path where a rate-limited client keeps retrying
	 * while still throttled and makes things worse. If the header were not read here, its value would
	 * be lost along with the response.
	 */
	readonly retryAfterMs?: number;
	/**
	 * Structured value from the envelope. Its shape is determined by the code, and it is usually
	 * absent.
	 *
	 * The SDK deliberately does not parse it. The schema belongs to the contract that knows the code.
	 * Currently there is one, `StoryRuntimePublishFailure` for `story_runtime_invalid`, and the screen
	 * parses with that schema. Parsing here would make the SDK know every domain's failure shape.
	 */
	readonly details?: unknown;

	constructor(init: {
		status: number;
		code: string;
		message: string;
		requestId?: string;
		retryAfterMs?: number;
		details?: unknown;
	}) {
		super(init.message);
		this.name = "RowCatApiError";
		this.status = init.status;
		this.code = init.code;
		this.requestId = init.requestId;
		this.retryAfterMs = init.retryAfterMs;
		this.details = init.details;
	}
}

/**
 * Narrowing without `instanceof`. Bundles can split (an SSR bundle and a client bundle), which
 * yields two class identities. Matching by name lets the screen still choose the error view in that
 * case.
 */
export function isRowCatApiError(error: unknown): error is RowCatApiError {
	return (
		error instanceof RowCatApiError ||
		(error instanceof Error && error.name === "RowCatApiError")
	);
}

/**
 * Converts a failed response into an error. It tries the shared envelope first and otherwise falls
 * back to a generic error carrying only the status code, because proxies and gateways can send HTML
 * error pages that are not our envelope.
 */
export async function apiErrorFromResponse(
	response: Response,
): Promise<RowCatApiError> {
	const body = await response.json().catch(() => null);
	const retryAfterMs = readRetryAfterMs(response);
	const parsed = ApiErrorBody.safeParse(body);
	if (parsed.success)
		return new RowCatApiError({
			...parsed.data,
			status: response.status,
			...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
		});
	return new RowCatApiError({
		status: response.status,
		code: "http_error",
		message: `The request failed (HTTP ${response.status}).`,
		...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
	});
}

/**
 * `Retry-After` to milliseconds.
 *
 * Only integer seconds are read. The HTTP-date form is also in the spec, but it carries the
 * difference between server and client clocks, and devices hours off do exist. The date form is
 * ignored and falls back to backoff, because a wrong wait time is worse than not knowing it.
 */
function readRetryAfterMs(response: Response): number | undefined {
	const header = response.headers.get("Retry-After");
	if (!header) return undefined;
	const seconds = Number(header);
	return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

/**
 * A success response whose shape differs from the contract. Passing a 200 through would make the
 * screen render an empty list, and the cause would appear far later as a different symptom.
 * Stopping at the point of mismatch is much cheaper.
 */
export const invalidResponse = (path: string) =>
	new RowCatApiError({
		status: 200,
		code: "invalid_response",
		message: `The server response does not match the contract (${path}).`,
	});

/**
 * Stream framing is broken: a line that is not JSON arrived.
 *
 * The broken line is not skipped, because omissions are invisible in a stream. If one middle frame
 * were silently dropped, the screen would show a response missing some characters and end normally,
 * and nobody would ever know. Stopping here at least reveals that the response is partial.
 *
 * The status is 200 because a 200 was actually received; the failure happened in the body, not the
 * headers.
 */
export const invalidStreamFrame = () =>
	new RowCatApiError({
		status: 200,
		code: "invalid_stream_frame",
		message: "Couldn't read a stream frame.",
	});

/** The frame parsed, but the event shape differs from the contract. It is not cast through. */
export const invalidStreamEvent = () =>
	new RowCatApiError({
		status: 200,
		code: "invalid_stream_event",
		message: "A stream event does not match the contract.",
	});

/**
 * The stream ended without a terminal event, or a frame arrived after the terminal event.
 *
 * It is kept separate from framing (`invalid_stream_frame`) and shape (`invalid_stream_event`)
 * failures because this is a protocol-state failure. The lines are fine and each event's shape
 * matches the contract. Here the socket closes after ten deltas with neither `done` nor `error`.
 * Frame-level checks never catch this, and if it is not caught, the truncated response is saved as
 * complete. The user sees the model stop mid-sentence, and the next turn's context carries the half
 * answer.
 *
 * A user-initiated stop never gets here. That is a cancel, not an EOF (see chat.ts).
 */
export const invalidStreamTermination = () =>
	new RowCatApiError({
		status: 200,
		code: "invalid_stream_termination",
		message: "The generation stream did not end normally.",
	});

/**
 * The request was **not sent** because it differs from the contract.
 *
 * Status 0 is a fact, not a placeholder: there is no response. `code` names the reason so that 0 is
 * not read as "the server returned 0."
 *
 * For boolean-body requests like favorites, a plain `.parse()` is left to throw, because such a
 * value cannot be wrong; it only catches assembly mistakes. This error exists for requests carrying
 * **user-entered** values, where rules like nickname length are often violated. The screen then
 * needs the same error shape as other failures, so the copy can be chosen in one place.
 *
 * It does not replace server validation. It is a shortcut that saves a round trip, and the server
 * remains the final authority.
 */
export const invalidRequest = (path: string, detail: string) =>
	new RowCatApiError({
		status: 0,
		code: "invalid_request",
		message: `The request does not match the contract (${path}): ${detail}`,
	});
