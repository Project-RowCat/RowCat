/**
 * Limits for one remote-image request: a leaf module of numbers only.
 *
 * `fetch.ts` (transport pulling in DNS and HTTPS) and `budget.ts` (read by the rate-limit policy)
 * must see the same values. The policy table (`lib/rate-limit/policy.ts`) has to stay pure and
 * cannot import the transport, so the numbers live here, which keeps "reservation size equals
 * response cap" true without a copy.
 */

export interface RemoteImageLimits {
	readonly maxBytes: number;
	readonly timeoutMs: number;
	readonly maxRedirects: number;
}

export const REMOTE_IMAGE_LIMITS: RemoteImageLimits = {
	/**
	 * Response byte cap, twice the cover still-image cap (5 MiB). The proxy does not re-encode, so one
	 * image is our bandwidth. `Content-Length` may be false or absent, so this is enforced while
	 * counting the stream.
	 */
	maxBytes: 10 * 1024 * 1024,
	/** Total deadline per request including redirects, so a slow host cannot hold our connection. */
	timeoutMs: 10_000,
	/** Redirect cap; one is common (www to cdn) and three is enough. */
	maxRedirects: 3,
};
