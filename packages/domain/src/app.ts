/**
 * The native app's URL scheme: `rowcat` in `rowcat://`. Three places must read the same string: the
 * Expo config `scheme` (registers the app with the OS), the mobile auth client `expoClient({ scheme
 * })` (builds the callback deep link and `expo-origin`), and the server's `trustedOrigins` (accepts
 * requests only from that origin). If only one differs, login fails with one `Invalid origin`
 * server log line and a generic retry message on screen, which is hard to diagnose. The Expo config
 * cannot import workspace packages (its evaluation would depend on their resolution), so the match
 * is enforced by a check in `apps/mobile/src/lib/app-identity.test.ts`, as with `APP_BUNDLE_ID`.
 * This is not the same axis as `APP_BUNDLE_ID`, though they look alike (`com.projectrowcat.app`,
 * `rowcat`). Neither derives from the other: a bundle id change moves the store listing and Apple
 * sign-in audience, while a scheme change breaks deep links in shipped apps. It is not a browser
 * origin, so it is not in the CORS allowlist. Native `fetch` has no CORS, and widening the list to
 * custom schemes would only weaken browser defenses (see `apps/api/src/auth/trusted-origins.ts`).
 */
export const APP_SCHEME = "rowcat";

/**
 * Store app identifier (iOS bundle ID, also the Android package name), the single source. The
 * server uses it as the audience of Apple native sign-in tokens (`appBundleIdentifier`). Making it
 * configurable per deployment gains nothing and would allow a deployment with a wrong value.
 * `apps/mobile/src/lib/app-identity.test.ts` keeps the Expo config literal in sync. A fork changes
 * this value and that literal together.
 */
export const APP_BUNDLE_ID = "com.projectrowcat.app";

/**
 * Product name, one word where a human reads it: the mail subject prefix, the passkey and
 * authenticator app name, the push title, the generation gateway's usage label, the remote image
 * proxy's User-Agent, page titles, the wordmark, the managed model group's name and the operations
 * console's chrome. A hard-coded `RowCat` in each place would leave one behind after a fork renames
 * the product, and that stale line usually surfaces in the user's authenticator app or inbox.
 * Sentences in screen copy keep the literal name: a Korean particle is attached to it, so a
 * substituted name would break the sentence (`docs/oss/FORKING.md` §11). It is not
 * operational config: domains, contacts and the company name come from deployment settings. The
 * Expo `name` is a literal for the same reason, kept in sync by
 * `apps/mobile/src/lib/app-identity.test.ts`.
 */
export const APP_NAME = "RowCat";
