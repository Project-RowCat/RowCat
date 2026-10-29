/**
 * The single rule that builds an address on the canonical web site: the one path for this app's
 * links to screens that live on the web. Each caller asks the same question, whether a screen is on
 * the web or not yet built here, and only the first kind comes through this module. The sites are
 * public account-deletion guidance, guardian consent links (opened by a guardian, not a member), the
 * web account screen, shared story addresses, and password reset.
 *
 * It lives in `lib/`, not a feature folder: the deletion-guide link is used by both the account
 * screen and the entry gate, and a feature folder would make the other one import it.
 *
 * The origin comes from deployment config (`EXPO_PUBLIC_WEB_ORIGIN`). When it is missing the
 * functions return `null` and the screen draws no link. The origin is never derived from the API
 * origin (`lib/env.ts`), because a guessed domain is a dead link, and a dead link reads as
 * breakage.
 *
 * The origin is an argument rather than a module global read inside, so the rule can be checked
 * without faking environment variables.
 */

/**
 * Origin plus an absolute path. The path is either a constant written here or a value the server
 * returned.
 *
 * Never put user input here: the function would become a way to open arbitrary addresses, and the
 * in-app browser opens them as given.
 */
export function publicWebUrl(
	origin: string | null,
	path: string,
): string | null {
	if (!origin) return null;
	/** A leftover trailing slash would produce `//account-deletion`, which resolves differently by origin. */
	const base = origin.replace(/\/+$/, "");
	/** A non-absolute path is not built: joining it would overwrite the origin's last segment. */
	return path.startsWith("/") ? `${base}${path}` : null;
}

/**
 * The public account-deletion guide, the single source for what is deleted and what remains.
 *
 * This app does not draw that document a second time: a copy here would drift from the web's.
 * The link is also not a substitute for the deletion action, which the account screen and the entry
 * gate hold directly (sending a gated person to the account screen would create a loop).
 */
export const accountDeletionGuideUrl = (origin: string | null): string | null =>
	publicWebUrl(origin, "/account-deletion");

/**
 * The consent link handed to a guardian. The server builds the path
 * (`GuardianRequestCreatedDto.consentPath`), because the token is inside it and this app cannot
 * invent it; only the origin is attached here.
 *
 * Not built as an app-scheme (`rowcat://`) link: whoever opens it is the guardian the child gave it
 * to, not a member, and that person's device has no reason to have this app installed.
 */
export const guardianConsentUrl = (
	origin: string | null,
	consentPath: string,
): string | null => publicWebUrl(origin, consentPath);

/**
 * The web account screen: the canonical place for one action this app does not have.
 *
 * Adult verification used to be that action, because the verifier's hand-off needed a browser SDK.
 * That premise is gone: verification now completes inside the app (`features/adult-verification/`).
 * The link now points at a different action, turning on adult content display on iOS. That is a
 * product decision rather than a contract limit (`features/account/adult-content-policy.ts`), so on
 * Android the link does not appear. The rule against pointing at a path that does not exist still
 * holds: signing in on the web lets that setting be turned on there.
 *
 * On the rare deployment that picks a verification method this app does not know, the same address
 * is used: the app does not proceed and sends the user here instead (the client is fail-closed
 * too).
 */
export const accountWebUrl = (origin: string | null): string | null =>
	publicWebUrl(origin, "/account");

/**
 * The shareable story address. The canonical address is on the web.
 *
 * Not built as `rowcat://stories/<id>`: whoever opens a shared link is the recipient, whose device
 * may not have this app, so an app-scheme link goes nowhere for them (the consent link made the
 * same call). A web address opens the app automatically on devices that have it once universal
 * links exist, and this function does not change then.
 *
 * The screen never assembles the path. A copy of `/stories/${id}` in shared code could drift from
 * the route rule, and the address leaves the app and stays on other people's devices, so a wrong
 * one is a dead link. The id is encoded even though server-issued ids are hex with no hyphens,
 * where encoding changes nothing today; relying on that would silently break shared addresses the
 * day the id format changes (the shell's `splitPath` pairs with this for the same reason).
 *
 * With no origin configured the result is `null` and the screen draws no share action: a link built
 * on a guessed domain 404s for the recipient.
 */
export const storyWebUrl = (
	origin: string | null,
	storyId: string,
): string | null =>
	publicWebUrl(origin, `/stories/${encodeURIComponent(storyId)}`);

/**
 * Password reset: the whole flow is on the web.
 *
 * The app does not draw its own request form, because the end of the flow is the web anyway. The
 * reset mail links back to the web's `/reset-password` (the server filters that return path through
 * its trusted list), and that link also opens from a mailbox on a device without this app. A form
 * in the app would put the first half of one procedure here and the rest on the web, and the same
 * sentences (account-existence hiding, expiry, signing out other devices) would be maintained in
 * two places.
 *
 * Not returned via an app-scheme (`rowcat://`) link: the mail may be opened on a desktop, where
 * that scheme goes nowhere.
 *
 * The destination (`redirect`) is not carried: it is the web's route vocabulary, a different axis
 * from this app's return path. A person who finishes the reset returns to this app and signs in
 * with the new password.
 */
export const passwordResetWebUrl = (origin: string | null): string | null =>
	publicWebUrl(origin, "/reset-password");
