import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * The envelope's shape belongs to `ApiErrorBody` in @rowcat/contracts; this file only holds how the
 * server builds it (Hono exceptions).
 */
export class ApiError extends HTTPException {
	readonly code: string;
	/**
	 * Seconds for `Retry-After`; `onError` in `app.ts` moves it into the header. It lives on the type
	 * because per-route copies of the reader once let a route return a 429 without a wait time, which
	 * sends clients into their own immediate-retry backoff.
	 */
	readonly retryAfterSeconds: number | null;
	/**
	 * Structured value sent as the envelope's `details`. Its shape is a contract schema; never put
	 * exception strings or driver errors here, since they go out in the response verbatim.
	 */
	readonly details: unknown;

	constructor(
		status: ContentfulStatusCode,
		code: string,
		message: string,
		options: { retryAfterSeconds?: number; details?: unknown } = {},
	) {
		super(status, { message });
		this.code = code;
		this.retryAfterSeconds = options.retryAfterSeconds ?? null;
		this.details = options.details;
	}
}

/** Seconds, minimum 1: `Retry-After: 0` means "now", so a 900ms wait would retry into another 429. */
export const retryAfterSecondsFrom = (waitMs: number): number =>
	Math.max(1, Math.ceil(waitMs / 1_000));

/** 429. Only the limiter should call this (`lib/rate-limit/limiter.ts`), or limits scatter again. */
export const tooManyRequests = (
	message: string,
	code: string,
	retryAfterSeconds: number,
) => new ApiError(429, code, message, { retryAfterSeconds });

/**
 * 503: we cannot decide right now. Kept apart from 429 because the fault differs; folded into 429
 * the user would think they were too fast and keep thinking so while waiting never helps.
 */
export const serviceUnavailable = (
	message: string,
	code: string,
	retryAfterSeconds?: number,
) => new ApiError(503, code, message, { retryAfterSeconds });

export const badRequest = (message: string, code = "bad_request") =>
	new ApiError(400, code, message);

export const unauthorized = (
	message = "You need to sign in.",
	code = "login_required",
) => new ApiError(401, code, message);

export const forbidden = (message: string, code = "forbidden") =>
	new ApiError(403, code, message);

export const notFound = (message = "Not found.", code = "not_found") =>
	new ApiError(404, code, message);

/** zod failure to 400. Only the first issue is reported, with its path; clients only need which field was wrong. */
export const invalidInput = (error: {
	issues: { path: PropertyKey[]; message: string }[];
}) => {
	const issue = error.issues[0];
	const field = issue?.path.join(".");
	return badRequest(
		issue ? `${field ? `${field}: ` : ""}${issue.message}` : "Invalid request.",
		"invalid_input",
	);
};
