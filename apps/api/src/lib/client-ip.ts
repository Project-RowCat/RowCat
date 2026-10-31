import { BlockList, isIP } from "node:net";

/**
 * The client address the auth limiter counts by, decided from the socket. Better Auth reads its IP
 * from request headers only, and with neither `AUTH_TRUSTED_PROXIES` nor `AUTH_IP_HEADER` set it
 * read `X-Forwarded-For` from the client itself:
 *
 * ```text
 * one value        trusted as is    a fresh value per request is a fresh bucket — password guessing is unlimited
 * absent or two+   no IP            every such request shares one bucket per path — one client locks out sign-in
 * ```
 *
 * That was the shipped compose shape (the API's port is published directly). So the API decides the
 * address itself and hands the library exactly one header it sets (`AUTH_CLIENT_IP_HEADER`, stripped
 * from every incoming request first):
 *
 * ```text
 * AUTH_IP_HEADER set, and the peer is a trusted proxy (or no proxy list)   that header, if it is one IP
 * the peer is a trusted proxy                                             X-Forwarded-For from the right,
 *                                                                         the first untrusted hop
 * otherwise                                                               the socket peer
 * ```
 *
 * A header is believed only from a peer the deployment named, so a request that reaches the API
 * directly is counted by its own address whatever it claims. `AUTH_IP_HEADER` alone keeps its
 * earlier meaning (believed from any peer) because a deployment that set it already put the API
 * behind that proxy; `env-resolve.ts` warns that the port must then be reachable only through it.
 *
 * What this does not decide: how many requests a bucket allows (the library's rules), and anything
 * outside `/v2/auth/*` (`lib/rate-limit` counts members, not addresses).
 */

/** Set by `app.ts` on every request it hands to Better Auth; the library reads only this one. */
export const AUTH_CLIENT_IP_HEADER = "x-rowcat-auth-client-ip";

export interface ClientIpBasis {
	trustedProxies: readonly string[];
	ipHeader: string | null;
}

export interface ClientIpFacts {
	remoteAddress: string | undefined;
	/** Lowercased header name → value; absent headers are absent. */
	header: (name: string) => string | undefined;
}

/** `::ffff:192.0.2.1` → `192.0.2.1`; anything that is not one IP → `null`. */
function normalizeAddress(value: string | undefined): string | null {
	const trimmed = value?.trim();
	if (!trimmed) return null;
	const lower = trimmed.toLowerCase();
	const mapped = lower.startsWith("::ffff:") ? lower.slice(7) : null;
	if (mapped && isIP(mapped) === 4) return mapped;
	return isIP(lower) === 0 ? null : lower;
}

/** The deployment's proxy list as a matcher. Entries were validated at boot (`env-resolve.ts`). */
export function trustedProxyMatcher(
	entries: readonly string[],
): (address: string) => boolean {
	if (entries.length === 0) return () => false;
	const list = new BlockList();
	for (const entry of entries) {
		const [address = "", prefix] = entry.split("/");
		const family = isIP(address) === 6 ? "ipv6" : "ipv4";
		if (prefix === undefined) list.addAddress(address, family);
		else list.addSubnet(address, Number(prefix), family);
	}
	return (address) =>
		list.check(address, isIP(address) === 6 ? "ipv6" : "ipv4");
}

export function resolveClientIp(
	facts: ClientIpFacts,
	basis: ClientIpBasis,
	isTrustedProxy: (address: string) => boolean = trustedProxyMatcher(
		basis.trustedProxies,
	),
): string | null {
	const peer = normalizeAddress(facts.remoteAddress);
	if (peer === null) return null;
	const peerTrusted = isTrustedProxy(peer);

	if (
		basis.ipHeader !== null &&
		(basis.trustedProxies.length === 0 || peerTrusted)
	) {
		const named = normalizeAddress(facts.header(basis.ipHeader));
		if (named !== null) return named;
	}

	if (peerTrusted) {
		const chain = (facts.header("x-forwarded-for") ?? "")
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean);
		for (let i = chain.length - 1; i >= 0; i--) {
			const hop = normalizeAddress(chain[i]);
			/** A malformed hop ends the walk: what is left of it was written by someone untrusted. */
			if (hop === null) break;
			if (!isTrustedProxy(hop)) return hop;
		}
	}

	return peer;
}

/**
 * A request that carries forwarding headers from a connection outside a configured proxy list. Not
 * an attack signal — a direct caller may send anything — but the shape a deployment shows when the
 * hop that actually connects to the API (a host nginx, a docker bridge, a tunnel) is missing from
 * `AUTH_TRUSTED_PROXIES`: every visitor is then counted as that hop. With no list configured there is
 * nothing to misconfigure, so it is never true.
 */
export function forwardedFromUnlistedPeer(
	facts: ClientIpFacts,
	basis: ClientIpBasis,
	isTrustedProxy: (address: string) => boolean,
): boolean {
	if (basis.trustedProxies.length === 0) return false;
	const peer = normalizeAddress(facts.remoteAddress);
	if (peer === null || isTrustedProxy(peer)) return false;
	return (
		facts.header("x-forwarded-for") !== undefined ||
		(basis.ipHeader !== null && facts.header(basis.ipHeader) !== undefined)
	);
}
