import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.ts";

/**
 * The request target that may be written to the access log.
 *
 * The whole query is dropped: some paths (Better Auth email-verification tokens, OAuth code/state)
 * make the query itself a credential, and masking known keys goes stale the day a new flow appears.
 * The guardian-consent token is in the path, so that segment is folded to the route template.
 */
export function requestLogTarget(url: string): string {
	let pathname: string;
	try {
		pathname = new URL(url).pathname;
	} catch {
		/** Hono request URLs are absolute, but on failure the raw text is never echoed into the log. */
		return "(invalid-url)";
	}

	return pathname.replace(/^(\/v2\/guardian\/)[^/]+/, "$1:token");
}

/**
 * Safe replacement for Hono's default logger, which prints the full URL twice per request. This
 * logs the same operational data (method, path, status, time) with a request id and only the
 * sanitized target.
 */
export const requestLogger =
	(): MiddlewareHandler<AppEnv> => async (c, next) => {
		const startedAt = Date.now();
		const method = c.req.method;
		const target = requestLogTarget(c.req.url);
		const requestId = c.get("requestId");

		console.log(`[${requestId}] <-- ${method} ${target}`);
		await next();
		console.log(
			`[${requestId}] --> ${method} ${target} ${c.res.status} ${Date.now() - startedAt}ms`,
		);
	};
