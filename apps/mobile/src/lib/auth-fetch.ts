/**
 * Authenticated transport — **the credential is read per request.**
 *
 * This file exists for one reason: on native, whoever knows the session cookie is Better Auth, and
 * that value comes out **only asynchronously** (a SecureStore read). `RowCatClientOptions.headers`
 * in `@rowcat/sdk` freezes when the client is created, so the cookie cannot go in there. Put it
 * there and the value at that moment is sent for the whole life of the process.
 *
 * ```text
 * app start          guest
 * Alice signs in     Alice's cookie
 * Alice signs out    no cookie
 * Bob signs in       Bob's cookie
 * ```
 *
 * One process sees all four. A header frozen at construction stays on the first step, and requests
 * Bob sends then carry Alice's cookie — not a defect but a **cross-account incident**.
 *
 * ## Why `@rowcat/sdk` is not changed
 *
 * The SDK already has a seam for this (`RowCatClientOptions.fetch`). What that package needs to
 * know is "how to send", not "where the credential lives in this runtime". If Better Auth,
 * SecureStore or `getCookie()` crossed that boundary, the same package the web uses would carry an
 * unrelated native auth implementation.
 *
 * ## Why it is pure
 *
 * This file imports neither `expo-secure-store` nor `better-auth`. The cookie's source is an
 * argument. That is how the four-step transition above is verified without a simulator
 * (`auth-fetch.test.ts`) — every P0 assertion in this slice lives in that file.
 */

/**
 * Reads the current session cookie. `null` (or an empty string) if there is none.
 *
 * **Failures are not swallowed.** If a storage read throws, it rethrows. Silently sending without a
 * cookie makes the server honestly answer "guest", and the screen that receives that answer draws
 * the user **as signed out**. Not being able to read something and it being absent are different
 * facts.
 */
export type AuthCookieSource = () => Promise<string | null>;

/**
 * A `fetch` that attaches the cookie to every request.
 *
 * `baseFetch` is an argument not only for tests: calling a `globalThis.fetch` destructured out and
 * invoked directly throws `Illegal invocation` on some runtimes. Wrapping the default in an arrow
 * is the convention `@rowcat/sdk` already uses.
 */
export function createAuthenticatedFetch(
	readCookie: AuthCookieSource,
	baseFetch: typeof globalThis.fetch = (input, init) =>
		globalThis.fetch(input, init),
): typeof globalThis.fetch {
	return async (input, init) => {
		/**
		 * Copies the incoming headers and edits the copy. The SDK builds these per request (`Accept`,
		 * `Content-Type`, `Idempotency-Key`); rebuilding them here would silently drop one, and the
		 * symptom would surface much later as sync push idempotency breaking.
		 */
		const headers = new Headers(init?.headers);
		const cookie = await readCookie();

		/**
		 * An empty value **deletes** the header. A stale header left on a guest request would stop
		 * sign-out from reaching the server.
		 */
		if (cookie) headers.set("Cookie", cookie);
		else headers.delete("Cookie");

		return baseFetch(input, {
			...init,
			headers,
			/**
			 * Does **not** use the native cookie jar.
			 *
			 * The SDK sends `credentials: "include"` on the assumption of a browser. In React Native that
			 * value switches on the OS cookie store (iOS `HTTPCookieStorage`, Android `CookieJar`). Leaving
			 * it on gives the session cookie two sources, and the second is one that our sign-out does not
			 * clear: a cookie left in that store after Alice signs out could still attach to later requests.
			 *
			 * With `omit`, the single source of the credential is the line above, and the lifetime of that
			 * value is owned entirely by Better Auth's SecureStore (Better Auth's Expo client sends the same
			 * value on its own requests). A runtime with no browser loses nothing here.
			 */
			credentials: "omit",
		});
	};
}
