/**
 * What a member types (or scans) as a server address, folded into the one value that is an instance's
 * identity: **the normalized https origin** (`docs/mobile/INSTANCES.md` §인스턴스의 신원).
 *
 * The origin — scheme, host, port, nothing else — is the identity because it is the one thing a server
 * cannot claim on another's behalf: TLS proves it. A server-issued id would not do (a malicious server can
 * claim any id), and a URL with a path would let two spellings of one server become two instances with
 * two sets of local data.
 *
 * ```text
 * accepted    rowcat.example.org → https://rowcat.example.org   (no scheme means https)
 *             https://RowCat.Example.org:443/ → https://rowcat.example.org
 * refused     a path, query, fragment or credentials     — not an origin
 *             http:, or a loopback · private · link-local host   — only development builds accept these
 * ```
 *
 * `allowInsecure` comes from the build (the development profile reaches a server on the same Wi-Fi); a
 * screen does not decide it. Pure: no network, no React Native.
 */

export type InstanceOriginIssue = "invalid" | "not_origin" | "insecure";

export type InstanceOriginResult =
	| { ok: true; origin: string }
	| { ok: false; issue: InstanceOriginIssue };

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Loopback, private and link-local destinations: a production build never treats them as a server. */
export function isLocalHost(hostname: string): boolean {
	const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
	if (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host.endsWith(".local")
	)
		return true;
	const v4 = IPV4.exec(host);
	if (v4) {
		const [a, b] = [Number(v4[1]), Number(v4[2])];
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168)
		);
	}
	if (host.includes(":"))
		return (
			host === "::1" ||
			host === "::" ||
			/^f[cd][0-9a-f]{2}:/.test(host) ||
			/^fe[89ab][0-9a-f]:/.test(host)
		);
	return false;
}

export function normalizeInstanceOrigin(
	input: string,
	options: { allowInsecure: boolean },
): InstanceOriginResult {
	const raw = input.trim();
	if (!raw) return { ok: false, issue: "invalid" };
	let url: URL;
	try {
		url = new URL(
			/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`,
		);
	} catch {
		return { ok: false, issue: "invalid" };
	}
	if (url.protocol !== "https:" && url.protocol !== "http:")
		return { ok: false, issue: "invalid" };
	if (!url.hostname) return { ok: false, issue: "invalid" };
	if (url.username || url.password || url.search || url.hash)
		return { ok: false, issue: "not_origin" };
	if (url.pathname !== "/" && url.pathname !== "")
		return { ok: false, issue: "not_origin" };
	if (
		!options.allowInsecure &&
		(url.protocol === "http:" || isLocalHost(url.hostname))
	)
		return { ok: false, issue: "insecure" };
	return { ok: true, origin: url.origin };
}
