/**
 * Reads and matches the browser origin whitelist.
 *
 * Two boundaries share this decision: CORS (can the browser read the response) and the
 * unsafe-method gate in `app.ts` (may a cookie-bearing request be accepted at all). Reading
 * different lists would yield a deployment that is 403 on one and exposes responses on the other.
 * Malformed entries block boot, and runtime rejections are logged only up to a bounded count.
 *
 * It is separate from `env.ts` for testing: that file validates `process.env` on import and calls
 * `process.exit` on failure, so functions inside it cannot be unit tested.
 */

export type OriginList = {
	/** Normalized, de-duplicated origins in configured order. */
	origins: string[];
	/** Entries that could not be read as origins; callers use them to block boot. */
	invalid: string[];
};

/**
 * Reduces to the shape of the `Origin` header: scheme, host and non-default port only. A stray
 * trailing slash in config would never string-match what browsers send, and the symptom ("it is
 * whitelisted but CORS blocks it") shows up as no error anywhere.
 */
const toOrigin = (entry: string): string | null => {
	let url: URL;
	try {
		url = new URL(entry);
	} catch {
		return null;
	}
	// Browsers send Origin for http(s) only; any other scheme is a typo.
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	return url.origin;
};

/** CSV (`a,b`) to an origin list; whitespace and empty entries are dropped. */
export const parseOriginList = (value: string): OriginList => {
	const origins: string[] = [];
	const invalid: string[] = [];

	for (const entry of value.split(",").map((part) => part.trim())) {
		if (!entry) continue;
		const origin = toOrigin(entry);
		if (!origin) {
			invalid.push(entry);
			continue;
		}
		if (!origins.includes(origin)) origins.push(origin);
	}

	return { origins, invalid };
};

/**
 * Detects a production deployment still on the dev default (`http://localhost:3000`). Such an API
 * passes the health check and SSR requests (no Origin) while blocking every browser call, the
 * hardest failure to notice.
 */
export const isLoopbackOrigin = (origin: string): boolean => {
	const host = new URL(origin).hostname;
	return (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host === "127.0.0.1" ||
		host === "[::1]"
	);
};

/** Cap on remembered rejected origins: `Origin` is client-controlled, so without it one bot inflates log and memory. */
const REJECT_LOG_LIMIT = 16;

/**
 * Matcher for hono `cors`'s `origin`. Allows exactly what passing the array would; the only
 * difference is that rejections are logged, since the rejected string is itself the fix (add it to
 * `WEB_ORIGIN`).
 */
export const createCorsOriginMatcher = (
	allowed: string[],
): ((origin: string) => string | null) => {
	const whitelist = new Set(allowed);
	const rejected = new Set<string>();

	return (origin) => {
		// Requests with no Origin (SSR, curl, health checks) are outside CORS.
		if (!origin) return null;
		if (whitelist.has(origin)) return origin;

		if (!rejected.has(origin) && rejected.size < REJECT_LOG_LIMIT) {
			rejected.add(origin);
			console.warn(
				`[cors] rejected an origin not on the allowlist: ${origin} — if the address is right, add it to WEB_ORIGIN (allowed now: ${allowed.join(", ") || "(none)"})`,
			);
		}
		return null;
	};
};
