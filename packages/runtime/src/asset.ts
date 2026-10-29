import { RUNTIME_ERROR_CODE, RuntimeError } from "./internal/errors.ts";
import { RUNTIME_ASSET } from "./internal/symbols.ts";

/**
 * Asset reference: an opaque value owned by RowCat. It can point at a logical asset
 * ('characters/sena/smile', a name RowCat manages) or at a remote public HTTPS image.
 * - The wire format is one string for both kinds. The kind is derived from the value, so it is
 *   not written.
 * - A remote reference is a request to draw one picture, not fetch(). The creator gets no
 *   response, headers or request ability. RowCat's trusted image path fetches the bytes, and the
 *   server decides where the address may lead.
 * - Opacity: the symbol key that holds the value cannot be named by creators. url, id, path and
 *   kind are not expressible, and classifyRuntimeAssetValue and runtimeAssetPath are not exported
 *   from the root.
 */

/**
 * The interface has no url, id or kind by design. What it holds is a matter between this package
 * and the trusted host, with no room for creator code in between.
 */
export interface AssetRef {
	readonly [RUNTIME_ASSET]: string;
}

/**
 * The kind of thing a reference points at. This is trusted-layer vocabulary, not exported from the
 * root.
 * - logical: a name for a RowCat-managed asset, which the published binding table resolves to
 *   media.
 * - remote: a public HTTPS image address, fetched and drawn by RowCat's image path. Web, native
 *   and the server all get this judgment from one function. Separate checks would give four rules,
 *   and one could route a logical path to the proxy or fold an address into a placeholder, with no
 *   error.
 */
export type RuntimeAssetTarget =
	| { readonly kind: "logical"; readonly path: string }
	| { readonly kind: "remote"; readonly url: string };

/**
 * Shape of an accepted logical path, deliberately narrow. Namespaces are not reserved (characters/
 * and music/ are not keywords). This file fixes only characters and shape. Which image a name
 * refers to is decided outside this contract: authoring binds names to media, and publishing
 * freezes that table. The media database id is not accepted directly. Doing so would tie this
 * contract to our storage identity, and changing storage would break saved projects.
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Upper bounds for logical paths. The limits can be widened later. */
const MAX_LOGICAL_LENGTH = 200;
const MAX_SEGMENTS = 8;

/**
 * Upper bound for remote addresses. Deliberately a different value and reason from the logical path
 * bound. Signed CDN and image transform addresses legitimately exceed hundreds of characters. The
 * 200-character logical bound would block them entirely. Widening the logical bound that far would
 * admit sentences, not names. This constant is the single source: apps/api imports this module
 * as-is, and the docs are checked against the number by a test.
 */
export const RUNTIME_REMOTE_ASSET_MAX_URL_LENGTH = 8 * 1024;

/**
 * The only allowed remote scheme. http: is plaintext, so anyone on the path could alter the
 * picture. data:, blob:, file: and javascript: are content or execution, not addresses. Allowing
 * one value is safer than blocking a list, since a list can miss an entry.
 */
const REMOTE_SCHEME = "https://";

/**
 * A scheme-like prefix. If present, the value is checked as an address, not a logical path.
 * Uppercase or mixed-case schemes (HTTPS://, Data:) would otherwise fail with misleading path
 * errors. An address should receive address errors.
 */
const SCHEME_LIKE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * Control characters and whitespace cannot appear anywhere in an address. This blocks tab-folding
 * tricks such as java\tscript: from the start. Code points are counted instead of matched with a
 * regex: control characters in a regex literal are flagged by linters, and escaped ranges are hard
 * to verify.
 */
function hasControlOrSpace(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x20 || code === 0x7f) return true;
	}
	return false;
}

/**
 * Host label: ASCII letters, digits and hyphens, not starting or ending with a hyphen.
 * International domains must be written in punycode (xn--). Accepting Unicode hosts would make
 * normalization differ across runtimes, and this check must give the same answer everywhere.
 */
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const MAX_HOST_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;

/**
 * Characters allowed in path and query: RFC 3986 pchar plus / and ?. Percent-encoding must be %XX,
 * so a lone % is rejected. Non-ASCII must be percent-encoded by the creator. Encoding it here would
 * make the written characters differ from what the reference points at.
 */
const PATH_QUERY = /^(?:[A-Za-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9A-Fa-f]{2})*$/;

/**
 * A name meaning loopback. No runtime treats it as a public host. The server re-checks by resolved
 * address at connect time, so this list is not the only defense. It exists so creators get the
 * error at authoring time. Someone who writes localhost should not find out after publishing, when
 * the cause is hard to trace.
 */
const LOOPBACK_HOST = "localhost";

const invalid = (value: string, why: string): RuntimeError =>
	new RuntimeError(
		RUNTIME_ERROR_CODE.invalidAssetRef,
		`Can't create the asset reference "${value}": ${why}`,
	);

/**
 * Checks one logical path. Returns the path if it passes, otherwise the reason. Whitespace is
 * rejected, not trimmed. Trimming would make the written characters differ from what the reference
 * points at, and that would surface only as a missing asset. It is the same judgment as not
 * trimming passwords.
 */
function checkLogicalPath(path: string): string | null {
	if (path.length > MAX_LOGICAL_LENGTH)
		return `It exceeds ${MAX_LOGICAL_LENGTH} characters.`;

	/**
	 * Anything that could be read as an address was split off above, so no colon reaches here.
	 * Backslashes and double slashes are not in the segment syntax, so scheme-less addresses
	 * (//host/a.png) and backslash paths are rejected below.
	 */
	const segments = path.split("/");
	if (segments.length > MAX_SEGMENTS)
		return `The path has more than ${MAX_SEGMENTS} segments.`;

	for (const segment of segments) {
		if (segment === "") return "There is an empty path segment.";
		if (segment === "." || segment === "..")
			return "The path can't go up to a parent.";
		if (!SEGMENT.test(segment))
			return "Paths can use only letters, digits and `.`, `_`, `-`, and each segment starts with a letter or digit.";
	}
	return null;
}

/**
 * Checks one host name. It must be a DNS name. IP literals (127.0.0.1, [::1]) are rejected. Images
 * are rarely hosted by IP, and accepting IP forms would require counting every way to write a
 * private address (0x7f000001, 2130706433, 127.1, IPv4-mapped IPv6 and more). Requiring a name
 * removes that surface. A name whose last label is all digits is also rejected, since a dotted
 * decimal IPv4 has that shape.
 */
function checkHost(host: string): string | null {
	if (host.length === 0) return "The address has no host.";
	if (host.startsWith("["))
		return "It must be a domain name, not an IP address.";
	if (host.length > MAX_HOST_LENGTH) return "The host name is too long.";
	const labels = host.split(".");
	if (labels.length < 2)
		return "The host must be a domain name with at least one dot.";
	for (const label of labels) {
		if (label.length > MAX_LABEL_LENGTH || !HOST_LABEL.test(label))
			return "The host name has characters that can't be used.";
	}
	const last = labels[labels.length - 1] as string;
	if (/^[0-9]+$/.test(last))
		return "It must be a domain name, not an IP address.";
	if (last === LOOPBACK_HOST || host === LOOPBACK_HOST)
		return "Addresses pointing at this device are not accepted.";
	return null;
}

/**
 * Checks one remote address. Returns null if it passes, otherwise the reason. It is split by hand,
 * without URL. This function also runs inside the VM, which has no URL. Even where URL exists it
 * would not be used: that parser is lenient (it fixes case, backslashes and spaces), so it would
 * make the written text differ from what the reference points at, and it varies slightly across
 * runtimes. Only already-normalized shapes are accepted; everything else is rejected.
 */
function checkRemoteUrl(url: string): string | null {
	if (url.length > RUNTIME_REMOTE_ASSET_MAX_URL_LENGTH)
		return `The address exceeds ${RUNTIME_REMOTE_ASSET_MAX_URL_LENGTH} characters.`;
	if (hasControlOrSpace(url))
		return "The address contains whitespace or control characters.";
	if (!url.startsWith(REMOTE_SCHEME))
		return "Remote images accept only addresses starting with `https://`.";

	const rest = url.slice(REMOTE_SCHEME.length);
	const authorityEnd = rest.search(/[/?#]/);
	const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
	const tail = authorityEnd === -1 ? "" : rest.slice(authorityEnd);

	/**
	 * user:pass@host. Credentials cannot appear in an address, and published source is not a place for
	 * secrets.
	 */
	if (authority.includes("@")) return "The address can't contain credentials.";

	let host = authority;
	const portAt = authority.lastIndexOf(":");
	if (portAt !== -1) {
		/**
		 * The only port is 443. Opening arbitrary ports would make the proxy a route to arbitrary
		 * services on a private network, and legitimate image hosts do not serve on other ports. :443 is
		 * an explicit default and is accepted.
		 */
		if (authority.slice(portAt + 1) !== "443")
			return "Remote images can use only the default HTTPS port (443).";
		host = authority.slice(0, portAt);
	}
	if (host !== host.toLowerCase()) return "Write the host name in lowercase.";
	const hostProblem = checkHost(host);
	if (hostProblem !== null) return hostProblem;

	/**
	 * A fragment (#...) is never sent with the request, so it has no meaning. It also blurs cache
	 * identity.
	 */
	if (tail.includes("#")) return "The address can't contain a `#` fragment.";
	if (!PATH_QUERY.test(tail))
		return "The address's path or query has characters that can't be used (percent-encode non-ASCII).";
	return null;
}

/**
 * Classifies a string as one kind of asset, and reports the reason on failure. asset() and the
 * trusted layer (classifyRuntimeAssetValue) share this judgment, so the renderer never reads a
 * sealed value as a different kind.
 */
function classify(
	value: string,
): { ok: true; target: RuntimeAssetTarget } | { ok: false; why: string } {
	if (value.length === 0) return { ok: false, why: "The value is empty." };
	if (value.trim() !== value)
		return { ok: false, why: "There is surrounding whitespace." };

	if (SCHEME_LIKE.test(value) || value.startsWith("//")) {
		const why = checkRemoteUrl(value);
		return why === null
			? { ok: true, target: { kind: "remote", url: value } }
			: { ok: false, why };
	}
	const why = checkLogicalPath(value);
	return why === null
		? { ok: true, target: { kind: "logical", path: value } }
		: { ok: false, why };
}

/**
 * Seals a string as an asset reference. It accepts a logical path (characters/sena/smile) or a
 * public HTTPS image address. The check is deterministic and local: no clock, randomness or
 * network, so the same string gives the same result anywhere. This shares the determinism axis of
 * artifacts. It creates the value only and fetches nothing.
 */
export function asset(value: string): AssetRef {
	if (typeof value !== "string")
		throw invalid(String(value), "The value is empty.");
	const result = classify(value);
	if (!result.ok) throw invalid(value, result.why);
	return Object.freeze({ [RUNTIME_ASSET]: value }) as AssetRef;
}

/**
 * Is this value an asset reference? This is the judgment trusted hosts use. The root does not
 * export it. Creators do not need it (they build the values themselves), and exporting it would
 * make the internal structure of references part of the language.
 */
export function isAssetRef(value: unknown): value is AssetRef {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { [RUNTIME_ASSET]?: unknown })[RUNTIME_ASSET] === "string"
	);
}

/**
 * The string a reference holds. Only the host reads it. classifyRuntimeAssetValue says whether it
 * is a logical path or a remote address. Not exporting this from the root is the other half of
 * opacity. If creators could call it, a reference would become a wrapped string, and people would
 * start concatenating it.
 */
export function runtimeAssetPath(ref: AssetRef): string {
	return ref[RUNTIME_ASSET];
}

/**
 * The kind of an asset string received over the wire. The renderer and the server both call this
 * one judgment. Returns null for values asset() would reject (corrupted artifacts, hand-built
 * bundles). It does not throw: the renderer shows a placeholder for one bad image instead of
 * killing the session, and the server answers 400.
 */
export function classifyRuntimeAssetValue(
	value: string,
): RuntimeAssetTarget | null {
	if (typeof value !== "string") return null;
	const result = classify(value);
	return result.ok ? result.target : null;
}

/**
 * Remote image addresses that this artifact declares statically in its source. Valid syntax does
 * not mean the address may be fetched. asset() creates a value without asking where it came from,
 * so creator code can assemble an address at runtime:
 *
 * <Image source={asset(`https://creator.example/p.png?q=${input}`)} />
 *
 * Not being able to read the response does not make this safe. The address's path and query reach
 * the creator's server and can carry typed text, saved state or AI-generated sentences. Hiding our
 * IP does not stop the value itself from passing through. So a remote address must also be one
 * written as a static address in the source at compile time. The artifact is the authority; the
 * server creates it by compiling at publish time. No contract lets a client assert the list.
 */
export type RuntimeRemoteAssetAllowlist = ReadonlySet<string>;

/**
 * An artifact with no remote addresses anywhere in its list. This is exactly the state of older
 * artifacts.
 */
export const EMPTY_REMOTE_ASSET_ALLOWLIST: RuntimeRemoteAssetAllowlist =
	Object.freeze(new Set<string>()) as ReadonlySet<string>;

/**
 * Canonicalizes a list: checks, deduplicates and sorts deterministically. The same project must
 * always yield the same list, or the artifact bytes are not deterministic. Without sorting, file
 * traversal order would vary between repositories and leak straight into the hash. Sorting compares
 * code units. localeCompare varies by locale, so the same source could produce different artifacts
 * on different machines. Non-remote values (logical paths, corrupted strings) are dropped. Logical
 * references are not subject to authorization, and mixing them in would carry two kinds in one
 * list.
 */
export function canonicalRemoteAssetList(values: Iterable<unknown>): string[] {
	const seen = new Set<string>();
	for (const value of values) {
		if (typeof value !== "string") continue;
		const target = classifyRuntimeAssetValue(value);
		if (target === null || target.kind !== "remote") continue;
		seen.add(target.url);
	}
	return [...seen].sort((left, right) =>
		left < right ? -1 : left > right ? 1 : 0,
	);
}

/**
 * Can this session use this reference? One judgment, called by both apps and renderers.
 * - logical: always passes. It is not an authorization concern, since no request goes out.
 * - remote: passes only if it is in the list. Otherwise it returns null, and no proxy address is
 *   built. If each app and renderer wrote its own allowlist.has(...), the judgment would exist in
 *   four places. One could block logical references or skip the list, and that mistake shows no
 *   error: the picture still loads.
 */
export function authorizeRuntimeAssetTarget(
	target: RuntimeAssetTarget,
	allowlist: RuntimeRemoteAssetAllowlist,
): RuntimeAssetTarget | null {
	if (target.kind !== "remote") return target;
	return allowlist.has(target.url) ? target : null;
}

/**
 * Wraps a resolver with authorization. Both apps and both renderers call this one place. Renderer
 * -> wrapped resolver -> list check -> app resolver -> RowCat proxy address. A target that fails
 * the check ends here, and no address is built. Writing these steps separately in each place would
 * eventually leave two of them. A missing check shows no symptom, since the picture still loads;
 * only what the creator's server receives changes. The list is a function, not a value: the
 * renderer is built once and sessions change the list, so a captured value would leak the first
 * session's list into later ones. The type is T because web builds a string address and native
 * builds an Image source. The kind (expect) is only passed through, because remote authorization
 * does not depend on what is drawn; the kind is checked in bindRuntimeAssetResolver.
 */
export function authorizeRuntimeAssetResolver<T>(
	allowlist: () => RuntimeRemoteAssetAllowlist,
	resolve: (
		target: RuntimeAssetTarget,
		expect: RuntimeManagedAssetKind,
	) => T | null,
): (target: RuntimeAssetTarget, expect: RuntimeManagedAssetKind) => T | null {
	return (
		target: RuntimeAssetTarget,
		expect: RuntimeManagedAssetKind,
	): T | null =>
		authorizeRuntimeAssetTarget(target, allowlist()) === null
			? null
			: resolve(target, expect);
}

/**
 * The kind of a managed asset: whether the name refers to an image or a sound. This is the slice's
 * security axis. Logical names share one syntax for images and sounds (characters/sena/smile,
 * audio/bgm/main). Without checking the kind, both of these would pass:
 *
 * <Image source={asset('audio/bgm/main')} />      music bytes on an <img>
 * <Audio source={asset('characters/sena/smile')} />  image bytes on audio
 *
 * Relying on a browser decode failure is too late: the request has already gone out, and it could
 * target media this session may not open. Recording the kind in the table and comparing it before
 * the address is built removes that path. The vocabulary is deliberately two values. Adding a value
 * is the same commit as adding a primitive that draws that kind (MediaKind already follows this
 * rule).
 */
export type RuntimeManagedAssetKind = "image" | "audio";

/**
 * What a logical name refers to: identity and kind. The table's value was once just a media id,
 * which was enough while managed assets were all images. Once sounds joined the same name space,
 * the id alone could not answer: may this primitive use this name?
 */
export interface RuntimeManagedAsset {
	readonly mediaId: string;
	readonly mediaKind: RuntimeManagedAssetKind;
}

/**
 * Maps a logical path to a RowCat media identity and kind.
 *
 * characters/sena/smile -> media-A, image audio/bgm/main -> media-B, audio
 *
 * This stores identity, not address. An address would tie the table to the deployment origin, path
 * rules and signing method, and changing any of them would break already-published works. A media
 * id stays the same across those changes; the address rule lives in one place, the SDK.
 *
 * There is one name space on purpose. With separate tables for images and sounds, the same name
 * could exist in both, and what asset('audio/main') pointed at would depend on which primitive
 * called it.
 *
 * The authority is whatever the session started with: the verified snapshot frozen at publish time
 * in product playback, or a draft copy taken when Run is pressed in studio preview. Each session
 * has one table. It is not global, because assets from work A would then open in work B's session,
 * with no symptom.
 */
export type RuntimeManagedAssetBindings = ReadonlyMap<
	string,
	RuntimeManagedAsset
>;

/** Bindings for a session with none. Every logical reference becomes a placeholder. */
export const EMPTY_MANAGED_ASSET_BINDINGS: RuntimeManagedAssetBindings =
	Object.freeze(new Map<string, RuntimeManagedAsset>()) as ReadonlyMap<
		string,
		RuntimeManagedAsset
	>;

/**
 * The resolved destination: what the host's resolver actually receives. This type is kept separate
 * from RuntimeAssetTarget on purpose. That is what the creator wrote; this is what gets fetched. If
 * the logical path stayed in place, the app's resolver could try to build an address from that
 * string, and a logical path is not an address on any deployment. mediaKind is carried for
 * diagnostics and tests, not because the address rule differs by kind. It lets tests confirm by
 * value that the kind check really holds.
 */
export type ResolvedRuntimeAssetTarget =
	| {
			readonly kind: "managed";
			readonly mediaId: string;
			readonly mediaKind: RuntimeManagedAssetKind;
	  }
	| { readonly kind: "remote"; readonly url: string };

/**
 * Builds the logical-path table: checks, deduplication and deterministic order.
 * - Values that are not logical references (remote addresses, corrupted strings) are dropped.
 *   Mixing them in would open a second route around the remote authorization list.
 * - An absent kind means image. Snapshots published before this axis existed have no kind key,
 *   and then managed assets were images only.
 * - Unknown kinds are dropped rather than folded into image, so a non-image value cannot later
 *   sit in an image slot.
 * - For a duplicate path, the first entry wins. The duplicate-trigger handling for situation
 *   images made the same decision with the same reasoning. If the later entry won, list order would
 *   decide the result, and the same publish could point at different assets on the server and on
 *   screen. Publishing already rejects duplicates, so only a corrupted snapshot reaches this rule.
 */
export function runtimeManagedAssetBindings(
	entries: Iterable<{ path?: unknown; assetId?: unknown; kind?: unknown }>,
): RuntimeManagedAssetBindings {
	const bindings = new Map<string, RuntimeManagedAsset>();
	for (const entry of entries) {
		if (typeof entry?.path !== "string" || typeof entry.assetId !== "string")
			continue;
		if (entry.assetId.length === 0) continue;
		const kind = entry.kind;
		if (kind !== undefined && kind !== "image" && kind !== "audio") continue;
		const target = classifyRuntimeAssetValue(entry.path);
		if (target === null || target.kind !== "logical") continue;
		if (bindings.has(target.path)) continue;
		bindings.set(target.path, {
			mediaId: entry.assetId,
			mediaKind: kind === undefined ? "image" : kind,
		});
	}
	return Object.freeze(bindings) as ReadonlyMap<string, RuntimeManagedAsset>;
}

/**
 * Wraps a resolver with logical bindings. Both apps and both renderers call this one place. The
 * kind check lives here, not in each renderer. A wrong-kind byte would silently draw or play
 * nothing, and the only trace would be a request that went out, possibly to media this session may
 * not open. A remote address never resolves as a sound. Sound is an ongoing range-request exchange,
 * not a one-time fetch like an image; AudioProps.source gives the rationale. An unfound logical
 * path is not an exception: assets not yet uploaded and half-renamed paths are normal during
 * authoring. The answer is null, and the renderer shows a placeholder or silence. The table is a
 * function, not a value, for the same reason as authorizeRuntimeAssetResolver: a captured table
 * would leak one session's bindings into the next.
 */
export function bindRuntimeAssetResolver<T>(
	bindings: () => RuntimeManagedAssetBindings,
	resolve: (target: ResolvedRuntimeAssetTarget) => T | null,
): (target: RuntimeAssetTarget, expect: RuntimeManagedAssetKind) => T | null {
	return (
		target: RuntimeAssetTarget,
		expect: RuntimeManagedAssetKind,
	): T | null => {
		if (target.kind === "remote")
			return expect === "image" ? resolve(target) : null;
		const managed = bindings().get(target.path);
		if (managed === undefined || managed.mediaKind !== expect) return null;
		return resolve({
			kind: "managed",
			mediaId: managed.mediaId,
			mediaKind: managed.mediaKind,
		});
	};
}
