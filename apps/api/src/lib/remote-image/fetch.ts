import { promises as dns } from "node:dns";
import { request as httpsRequest } from "node:https";
import { APP_NAME } from "@rowcat/domain";
import { classifyRuntimeAssetValue } from "@rowcat/runtime/asset";
import { sniffImageMime } from "../media/image.ts";
import { isPublicAddress } from "./address.ts";
import { REMOTE_IMAGE_LIMITS, type RemoteImageLimits } from "./limits.ts";

/**
 * A trusted server fetches remote images on the creator's behalf: the creator runtime's
 * `asset("https://...")`.
 *
 * ```text
 * creator address -> asset() syntax check (runtime) -> this file -> DNS -> address decision -> connect to that address
 *                                                          ^ redo from scratch on every redirect
 * ```
 *
 * ## Why the player's device does not fetch directly
 *
 * `<img src={creator address}>` hands the player's IP, time and User-Agent to a host the creator
 * chose; `asset("https://creator.example/pixel?id=...")` is enough to track who opened what and
 * when. It would also falsify the promise that the runtime sandbox has no `fetch` (an image is a
 * network channel). So the device asks RowCat and RowCat goes to the creator's host.
 *
 * ## SSRF is a correctness condition
 *
 * The creator's address becomes a request leaving our server. It can point at a private network,
 * loopback or cloud metadata, and neither `https:` nor a public hostname prevents that (the
 * creator's DNS resolves the name). Four things are enforced:
 *
 * ```text
 * name -> address   every address from lookup must be public (one private address rejects)
 * address -> connect  open the socket to the very address that passed; never re-resolve the name
 * redirects         re-run syntax, name and address decisions per Location (cap 3)
 * response          image/* only, magic bytes must match the header, byte cap, deadline
 * ```
 *
 * The second line is the DNS-rebinding defence. "Resolve, then `fetch(name)` if public" lets that
 * `fetch` resolve the name once more, and a TTL-0 record can change the answer in between. Here
 * `https.request` gets a `lookup` that returns the vetted address verbatim, so there is no second
 * resolution: the address connected to and the address judged are the same value. SNI and `Host`
 * are still the name, so TLS verifies normally.
 *
 * ## The transport is injected
 *
 * DNS and sockets sit behind one `RemoteImageTransport`. Tests plug in a fake to produce redirects,
 * private resolutions, oversize and timeouts without the internet, and check by value that the
 * address connected to equals the address judged. Production is `nodeTransport` below.
 *
 * ## What this file does not do
 *
 * Caching, authorization and rate limiting belong to the route. Response headers are not passed
 * through (no `Set-Cookie`, server name or upstream cache directives). A failure reason is one
 * name; upstream sentences, addresses and stacks never appear in the result.
 */

/** Accepted response formats: only what both the web and native renderers draw. No SVG. */
export const REMOTE_IMAGE_MIME_TYPES: readonly string[] = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
];

/** The numbers live in a leaf module (`limits.ts`) because the byte budget reads the same values. */
export { REMOTE_IMAGE_LIMITS, type RemoteImageLimits };

/**
 * The outbound request shape; this is all of it. No cookies, authorization, referrer or client
 * headers.
 *
 * The User-Agent carries no contact URL. The operator's site address was once baked in, which put
 * someone else's contact on requests from every deployment of this code and pointed recipients at
 * the wrong place to complain. Nothing breaks without a contact, so only the name and a version go
 * out.
 */
const OUTBOUND_HEADERS: Readonly<Record<string, string>> = {
	accept: REMOTE_IMAGE_MIME_TYPES.join(","),
	"user-agent": `${APP_NAME}-RuntimeAssets/1`,
};

export type RemoteImageFailure =
	/** The address fails `asset()` syntax (the route filters first, but redirects can also produce this). */
	| "invalid-url"
	/** The name does not resolve. */
	| "unresolvable"
	/** At least one resolved address is not public internet. */
	| "private-destination"
	/** Redirects exceeded the cap or `Location` is missing. */
	| "too-many-redirects"
	/** Not 200 (404, 403 and 5xx all fold into one so the creator learns no status). */
	| "upstream-status"
	/** `Content-Type` is outside the allowlist or the bytes are not that format. */
	| "unsupported-type"
	/** `Content-Length` or the actual stream exceeds the cap. */
	| "too-large"
	/** Did not finish within the deadline. */
	| "timeout"
	/** Connection, TLS or stream error. */
	| "network"
	/** The requester left (`signal`); the remaining body was dropped unread. */
	| "cancelled";

export type RemoteImageResult =
	| { ok: true; bytes: Buffer; contentType: string }
	| { ok: false; reason: RemoteImageFailure };

/** One connection's destination: the vetted address and the name arrive together. */
export interface RemoteImageConnection {
	/** TLS SNI and `Host` header; the name. */
	readonly hostname: string;
	/** The address the socket actually opens; returned by `resolve` and already vetted. */
	readonly address: string;
	readonly family: 4 | 6;
	readonly path: string;
}

export interface RemoteImageResponse {
	readonly status: number;
	/** Lowercase name to value; first value only when several. */
	readonly headers: Readonly<Record<string, string | undefined>>;
	readonly body: AsyncIterable<Uint8Array>;
	/** Cuts the connection without reading the whole body (cap, deadline). */
	abort(): void;
}

export interface RemoteImageTransport {
	/** Name to every address (A and AAAA); resolution failure throws. */
	resolve(hostname: string): Promise<{ address: string; family: 4 | 6 }[]>;
	/** One GET to the vetted address; does not follow redirects. */
	request(
		connection: RemoteImageConnection,
		signal: AbortSignal,
	): Promise<RemoteImageResponse>;
}

export interface FetchRemoteImageOptions {
	readonly transport?: RemoteImageTransport;
	readonly limits?: Partial<RemoteImageLimits>;
	/**
	 * Signals that the requester left; aborting also cuts the upstream connection. Without it we would
	 * download all 10 MiB after the player left the screen, bytes that go to no one and only spend the
	 * member's budget and a process slot.
	 */
	readonly signal?: AbortSignal;
	/**
	 * Reports body bytes actually read from upstream, per chunk, including failed responses.
	 *
	 * It is a callback rather than part of the result so failure shapes do not change. A response cut
	 * for exceeding the cap or discarded for a wrong format still used our bandwidth; not counting it
	 * would let a host send 10 MiB of deliberately wrong formats outside the budget. Redirect bodies
	 * are dropped unread, so they are not counted.
	 */
	readonly meter?: (bytes: number) => void;
}

interface Target {
	readonly hostname: string;
	readonly path: string;
}

/**
 * `https://host[:443]/path?query` to name and path. It already passed `asset()` syntax, so there is
 * no fragment or credential and the port is 443 only. `URL` is avoided here because that parser is
 * lenient and would repair shapes the runtime rejected.
 */
function targetOf(url: string): Target | null {
	const target = classifyRuntimeAssetValue(url);
	if (target === null || target.kind !== "remote") return null;
	const rest = target.url.slice("https://".length);
	const cut = rest.search(/[/?]/);
	const authority = cut === -1 ? rest : rest.slice(0, cut);
	const path = cut === -1 ? "/" : rest.slice(cut).replace(/^\?/, "/?");
	const hostname = authority.endsWith(":443")
		? authority.slice(0, -":443".length)
		: authority;
	return { hostname, path };
}

/**
 * `Location` to an absolute address; relative ones resolve against the current address. The result
 * goes through the syntax check again (a redirect down to `http:` is caught there).
 */
function resolveLocation(current: string, location: string): string | null {
	const trimmed = location.trim();
	if (trimmed.length === 0) return null;
	if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed) || trimmed.startsWith("//"))
		return trimmed;
	const base = targetOf(current);
	if (base === null) return null;
	const origin = `https://${base.hostname}`;
	if (trimmed.startsWith("/")) return `${origin}${trimmed}`;
	const directory = base.path.replace(/\?.*$/, "").replace(/[^/]*$/, "");
	return `${origin}${directory}${trimmed}`;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const mediaTypeOf = (contentType: string | undefined): string | null => {
	if (!contentType) return null;
	const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
	return type.length > 0 ? type : null;
};

async function readBounded(
	response: RemoteImageResponse,
	maxBytes: number,
	meter: (bytes: number) => void,
): Promise<Buffer | "too-large"> {
	const chunks: Buffer[] = [];
	let total = 0;
	for await (const chunk of response.body) {
		total += chunk.byteLength;
		meter(chunk.byteLength);
		if (total > maxBytes) {
			response.abort();
			return "too-large";
		}
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks, total);
}

/**
 * Fetches one address; the result is bytes or a named failure.
 *
 * Every redirect hop is judged again from scratch (syntax, DNS, address); passing the first
 * decision says nothing about the second destination.
 */
export async function fetchRemoteImage(
	url: string,
	options: FetchRemoteImageOptions = {},
): Promise<RemoteImageResult> {
	const transport = options.transport ?? nodeTransport;
	const limits = { ...REMOTE_IMAGE_LIMITS, ...options.limits };
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
	const meter = options.meter ?? (() => {});
	/** Ties outside cancellation to the same controller as this request's deadline, so there is one place that cuts. */
	const external = options.signal;
	const onCancel = () => controller.abort();
	external?.addEventListener("abort", onCancel, { once: true });
	if (external?.aborted) controller.abort();
	/** Why it stopped: the outside left or the deadline passed. */
	const stopped = (): RemoteImageFailure =>
		external?.aborted ? "cancelled" : "timeout";
	let current = url;
	try {
		for (let hop = 0; hop <= limits.maxRedirects; hop += 1) {
			const target = targetOf(current);
			if (target === null) return { ok: false, reason: "invalid-url" };

			let addresses: { address: string; family: 4 | 6 }[];
			try {
				addresses = await transport.resolve(target.hostname);
			} catch {
				return { ok: false, reason: "unresolvable" };
			}
			if (controller.signal.aborted) return { ok: false, reason: stopped() };
			if (addresses.length === 0) return { ok: false, reason: "unresolvable" };
			/**
			 * One private address rejects everything. Picking only a public one would let a name with both
			 * public and private A records through, and the creator owns that name.
			 */
			if (!addresses.every((entry) => isPublicAddress(entry.address)))
				return { ok: false, reason: "private-destination" };
			const chosen = addresses[0] as { address: string; family: 4 | 6 };

			let response: RemoteImageResponse;
			try {
				response = await transport.request(
					{
						hostname: target.hostname,
						address: chosen.address,
						family: chosen.family,
						path: target.path,
					},
					controller.signal,
				);
			} catch {
				return {
					ok: false,
					reason: controller.signal.aborted ? stopped() : "network",
				};
			}

			if (REDIRECT_STATUSES.has(response.status)) {
				response.abort();
				const location = response.headers.location;
				if (location === undefined || hop === limits.maxRedirects)
					return { ok: false, reason: "too-many-redirects" };
				const next = resolveLocation(current, location);
				if (next === null) return { ok: false, reason: "invalid-url" };
				current = next;
				continue;
			}

			if (response.status !== 200) {
				response.abort();
				return { ok: false, reason: "upstream-status" };
			}

			const declared = mediaTypeOf(response.headers["content-type"]);
			if (declared === null || !REMOTE_IMAGE_MIME_TYPES.includes(declared)) {
				response.abort();
				return { ok: false, reason: "unsupported-type" };
			}

			const length = Number(response.headers["content-length"]);
			if (Number.isFinite(length) && length > limits.maxBytes) {
				response.abort();
				return { ok: false, reason: "too-large" };
			}

			let bytes: Buffer | "too-large";
			try {
				bytes = await readBounded(response, limits.maxBytes, meter);
			} catch {
				return {
					ok: false,
					reason: controller.signal.aborted ? stopped() : "network",
				};
			}
			if (bytes === "too-large") return { ok: false, reason: "too-large" };
			if (controller.signal.aborted) return { ok: false, reason: stopped() };

			/**
			 * The bytes, not the header, state the format. HTML labelled `image/png` is caught here, and a
			 * header/bytes mismatch is input we cannot describe, so it is rejected (same judgement as the
			 * upload pipeline).
			 */
			const sniffed = sniffImageMime(bytes);
			if (sniffed === null || sniffed !== declared)
				return { ok: false, reason: "unsupported-type" };

			return { ok: true, bytes, contentType: sniffed };
		}
		return { ok: false, reason: "too-many-redirects" };
	} finally {
		clearTimeout(timer);
		external?.removeEventListener("abort", onCancel);
	}
}

/**
 * Production transport: Node's DNS and `https.request`.
 *
 * `lookup` is the point. Given a name, `https.request` resolves it itself and could get a different
 * answer than the one we judged. Passing a `lookup` that returns the vetted address makes the
 * socket open to that address only, while SNI and `Host` stay the name so certificate verification
 * is unchanged.
 */
const nodeTransport: RemoteImageTransport = {
	async resolve(hostname) {
		const entries = await dns.lookup(hostname, { all: true, verbatim: true });
		return entries
			.filter((entry) => entry.family === 4 || entry.family === 6)
			.map((entry) => ({
				address: entry.address,
				family: entry.family as 4 | 6,
			}));
	},
	request(connection, signal) {
		return new Promise((resolve, reject) => {
			const req = httpsRequest(
				{
					protocol: "https:",
					hostname: connection.hostname,
					servername: connection.hostname,
					port: 443,
					path: connection.path,
					method: "GET",
					headers: OUTBOUND_HEADERS,
					signal,
					/** The single vetted address; the callback shape depends on `all`, but either way the name is never re-resolved. */
					lookup: (_hostname, options, callback) => {
						const cb = callback as unknown as (
							error: Error | null,
							address: unknown,
							family?: number,
						) => void;
						if (
							typeof options === "object" &&
							options !== null &&
							(options as { all?: boolean }).all
						)
							cb(null, [
								{ address: connection.address, family: connection.family },
							]);
						else cb(null, connection.address, connection.family);
					},
				},
				(res) => {
					const headers: Record<string, string | undefined> = {};
					for (const [name, value] of Object.entries(res.headers))
						headers[name.toLowerCase()] = Array.isArray(value)
							? value[0]
							: value;
					resolve({
						status: res.statusCode ?? 0,
						headers,
						body: res as AsyncIterable<Uint8Array>,
						abort: () => {
							res.destroy();
							req.destroy();
						},
					});
				},
			);
			req.on("error", reject);
			req.end();
		});
	},
};
