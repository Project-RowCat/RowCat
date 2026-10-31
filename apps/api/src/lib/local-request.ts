import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

/**
 * Whether a request may use the local owner's two doors (`POST /v2/setup/claim-local`,
 * `POST /v2/auth/local-sign-in`). It is their whole authority, so it errs toward "no" on every input
 * it cannot vouch for.
 *
 * ```text
 * deployment LOCAL_OWNER_ENABLED=on                   — the deployment says it is one person's computer
 * socket     the TCP peer is a loopback address       — the kernel's answer, not a header
 * proxy      no Forwarded / X-Forwarded-* / X-Real-IP — a reverse proxy that announces itself
 * host       Host names a loopback host (any port)    — a public name, or a DNS-rebinding name
 *                                                      that resolves to 127.0.0.1, is not this computer
 * origin     an allowed browser origin on a loopback host — a page elsewhere can still make the browser
 *                                                      post here; its Origin is the one thing it cannot forge
 * ```
 *
 * **The rows after the first stop browsers, not programs.** A client that is not a browser writes
 * `Host` and `Origin` as it likes, so against it the only row with weight is the socket — and the
 * socket is loopback for anything relayed by a forwarder on the same machine that adds no header:
 * `socat`, an SSH tunnel, `ngrok tcp`, nginx with a bare `proxy_pass` (whose `Host` is
 * `127.0.0.1:<port>`). On a server those are ordinary shapes, so the request cannot prove it is local
 * there, and the deployment has to say so instead (`LOCAL_OWNER_ENABLED`, which only the one-computer
 * installer sets). On that installer the same caveat stands, and its README says it plainly: relaying
 * its ports to another device hands out the owner's session.
 *
 * The origin row requires a loopback host on top of the allowlist: a server whose `WEB_ORIGIN` is
 * public then refuses even a forged request that copied that public origin.
 *
 * `docker compose` deployments never qualify: the browser reaches the container through Docker's
 * port forwarding, so the peer is a bridge address, not loopback. That is the right answer — such a
 * deployment is one people reach over a network, and it sets up with an account.
 *
 * What this does not decide: which origins are allowed (that list is `env.ts`'s, passed in), and what
 * either door then does.
 */

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
	"localhost",
	"127.0.0.1",
	"[::1]",
]);

const PROXY_HEADERS = [
	"forwarded",
	"x-forwarded-for",
	"x-forwarded-host",
	"x-forwarded-proto",
	"x-real-ip",
] as const;

/** `127.0.0.0/8`, `::1`, and IPv4-mapped loopback (`::ffff:127.x.x.x`), as Node reports them. */
export function isLoopbackAddress(address: string | undefined): boolean {
	if (!address) return false;
	const value = address.toLowerCase();
	if (value === "::1") return true;
	const v4 = value.startsWith("::ffff:")
		? value.slice("::ffff:".length)
		: value;
	return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

/** The host part of a `Host` header, lowercased, without the port (`[::1]:3001` → `[::1]`). */
function hostName(host: string): string {
	const value = host.trim().toLowerCase();
	if (value.startsWith("[")) {
		const end = value.indexOf("]");
		return end === -1 ? value : value.slice(0, end + 1);
	}
	const colon = value.indexOf(":");
	return colon === -1 ? value : value.slice(0, colon);
}

export interface LocalRequestFacts {
	remoteAddress: string | undefined;
	/** Lowercased header name → value; absent headers are absent. */
	header: (name: string) => string | undefined;
	/** The deployment's origin matcher (`allowed-origin.ts`); truthy means allowed. */
	isAllowedOrigin: (origin: string) => unknown;
}

/** The browser's `Origin` names this computer: `http://localhost:3000`, `http://[::1]:3002`. */
function loopbackOrigin(origin: string): boolean {
	try {
		return LOOPBACK_HOSTS.has(new URL(origin).hostname.toLowerCase());
	} catch {
		return false;
	}
}

/** The request rows, pure, so every row of the table above is a test rather than a hope. */
export function isLocalRequest(facts: LocalRequestFacts): boolean {
	if (!isLoopbackAddress(facts.remoteAddress)) return false;
	if (PROXY_HEADERS.some((name) => facts.header(name) !== undefined))
		return false;
	const host = facts.header("host");
	if (!host || !LOOPBACK_HOSTS.has(hostName(host))) return false;
	const origin = facts.header("origin");
	return !!origin && loopbackOrigin(origin) && !!facts.isAllowedOrigin(origin);
}

/** The whole decision: the deployment row, then the request rows. */
export function localOwnerDoorOpen(
	enabled: boolean,
	facts: LocalRequestFacts,
): boolean {
	return enabled && isLocalRequest(facts);
}

/**
 * The adapter for a Hono request on the Node server. `getConnInfo` reads the socket the Node adapter
 * hands over; a request with no socket (an in-process `app.request` that passed none) is not local.
 */
export function localOwnerDoorOpenFor(
	c: Context,
	options: { enabled: boolean; isAllowedOrigin: (origin: string) => unknown },
): boolean {
	if (!options.enabled) return false;
	let remoteAddress: string | undefined;
	try {
		remoteAddress = getConnInfo(c).remote.address;
	} catch {
		return false;
	}
	return localOwnerDoorOpen(options.enabled, {
		remoteAddress,
		header: (name) => c.req.header(name),
		isAllowedOrigin: options.isAllowedOrigin,
	});
}
