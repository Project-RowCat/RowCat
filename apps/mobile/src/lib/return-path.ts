/**
 * The return destination after sign-in. **The only judgement of its kind in this app.**
 *
 * Values come from three sources (the heart action's current path, the comments panel's path, a
 * hand-edited deep link) and are used in three places (navigation after email sign-in or sign-up,
 * Google's `callbackURL`). Checking each place separately eventually misses one, and **that missed
 * place is a phishing path**: Better Auth's Expo client turns the path received here into an app
 * deep link with `Linking.createURL` and hands it to the OAuth provider.
 *
 * ## Origins are not compared; absolute values are **never accepted**
 *
 * Only paths within this app pass (relative paths starting with `/`), so no host can be expressed.
 * There is no allowlist to maintain, and no domain left off a list becomes a hole. This is the same
 * judgement as the web's `redirectTargetFrom` (`apps/web/src/lib/auth.ts`).
 *
 * Forms that are blocked:
 *
 * ```text
 * https://evil.test        does not start with `/`
 * javascript:alert(1)      same reason
 * rowcat://evil/path       same reason; being our scheme does not make it an internal path
 * //evil.test/path         protocol-relative URL. Both the browser and RN's links leave the app
 * /\evil.test              some parsers read the backslash as a slash
 * /\n/evil                 a parser that strips whitespace and control characters yields a different value
 * /a/../../evil            parent traversal. **Rejected, not normalized** (see below)
 * ```
 *
 * ## Why `..` is rejected instead of normalized
 *
 * The web appends the value to a dummy origin and normalizes it with `new URL()`, to fold it by the
 * **same rules as the browser**. Hermes has no `URL` that implements those rules (what React Native
 * provides is an abbreviated version that does not follow the spec in full). If this code folded it
 * by hand, the day that folding diverged from real navigation the check would still pass while the
 * navigation went elsewhere. When it cannot be folded, rejecting is correct; the paths this app
 * builds never contain `..`.
 *
 * ## The login screen is not a destination
 *
 * Otherwise sign-in would loop: login → login screen → (already authenticated) → login again.
 *
 * It always returns **a string**, never `undefined`. If six call sites each wrote `?? "/"`, one of
 * them would eventually omit it, and that spot would become a place where a rejected value is used
 * as-is instead of "no return target".
 */

/** The default destination after sign-in, used when the origin of the request is unknown. */
export const DEFAULT_RETURN_PATH = "/";

/** The login screen's own path. It cannot be a destination. */
const LOGIN_PATH = "/login";

/**
 * Characters that disrupt the parser: control characters and backslashes.
 *
 * Whitespace inside the value (`/\n/evil`) turns into a different path in a parser that trims it.
 * Backslashes are read as slashes by some implementations, so `/\evil.test` leaks out as a
 * protocol-relative URL.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the purpose is to block characters that disrupt the parser.
const UNSAFE = /[\u0000-\u0020\u007f\\]/;

export function safeMobileReturnPath(raw: unknown): string {
	if (typeof raw !== "string") return DEFAULT_RETURN_PATH;
	if (!raw.startsWith("/")) return DEFAULT_RETURN_PATH;
	// `//evil.test` and `/\evil.test` are read as addresses with a host.
	if (raw.length > 1 && (raw[1] === "/" || raw[1] === "\\"))
		return DEFAULT_RETURN_PATH;
	if (UNSAFE.test(raw)) return DEFAULT_RETURN_PATH;
	// Parent traversal that cannot be folded is rejected (see the header).
	if (raw.split(/[/?#]/).includes("..")) return DEFAULT_RETURN_PATH;
	if (raw === LOGIN_PATH || raw.startsWith(`${LOGIN_PATH}?`))
		return DEFAULT_RETURN_PATH;
	return raw;
}
