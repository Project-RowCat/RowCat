import type { LoginMethodProvider } from "@rowcat/domain";
import type { ConnectableProvider } from "../../lib/account-security-auth.ts";
import { LOGIN_METHOD_LABEL } from "./account-copy.ts";

/**
 * Pure rules for connecting a provider; the request itself is sent by
 * `lib/account-security-auth.ts`.
 *
 * The outcome is judged from server state, not from a returned address. Web reads
 * `?connected=google` off the return URL, but here `@better-auth/expo` runs the round trip in a
 * browser session and closes the sheet on the callback redirect, so there is no address to read.
 * That is a feature: nothing is sent to be trusted, and the only input is the account info
 * re-fetched after the round trip.
 *
 * Connecting is not signing in, so there is no `signIn` here either. Calling it from the account
 * screen would create a second RowCat member when the provider identity has no owner
 * (`lib/account-security-auth.ts` header).
 */

/**
 * The methods this app draws; array order is display order.
 *
 * It matches the server's order (`LOGIN_METHOD_ORDER` in `services/account/index.ts`). The server
 * sorts connected methods and this list fills in the "not connected" rows; if the orders diverge,
 * connecting one method moves its row. The list is fixed so rows never appear or vanish, and so
 * "Google can be connected" is visible at all.
 */
export const LOGIN_METHOD_ROWS: readonly LoginMethodProvider[] = [
	"credential",
	"google",
	"apple",
	"kakao",
] as const;

/**
 * Whether a method is connected by an OAuth round trip, i.e. everything but credentials.
 * Credentials come from setting a password, which the password section owns; a button here would be
 * a second entrance to that operation, labelled "connect" while opening a password dialog.
 */
export const isConnectableProvider = (
	provider: LoginMethodProvider,
): provider is ConnectableProvider => provider !== "credential";

/**
 * The methods this app can actually start connecting.
 *
 * Being in the vocabulary does not mean being wired. A `Link` button on an unwired method sends the
 * person to the provider before they learn it cannot work, and a disabled button is a promise of
 * "coming soon". The row stays and says "not connected", so a method linked on another device is
 * still visible and can be disconnected here.
 *
 * Apple sign-in is wired on the login screen (`lib/auth-social.ts`) but is not listed here, on
 * purpose. A deployment that does not configure Apple leaves `APPLE_SIGN_IN_*` empty and its server
 * does not know that provider. The login screen states
 * which methods the product offers and has other paths beside it; a connect row only has value if
 * the round trip can succeed. A value is added here together with the decision to register that
 * provider in the deployment.
 */
export const MOBILE_CONNECTABLE_PROVIDERS: readonly ConnectableProvider[] = [
	"google",
] as const;

export const canConnectOnMobile = (
	provider: LoginMethodProvider,
): provider is ConnectableProvider =>
	isConnectableProvider(provider) &&
	MOBILE_CONNECTABLE_PROVIDERS.includes(provider);

/**
 * Judges a finished round trip from one input: whether the re-fetched account info contains the
 * method. The browser session's result, a URL marker and the fact that we started it are not
 * inputs.
 *
 * Success returns `null` because the row already says it (it flips to connected with a timestamp).
 * Failure is worded without certainty: a person who closed the sheet themselves and a server
 * rejection look identical here (the reason arrives as the deep link's `?error=`, which the plugin
 * consumes internally; see `social_without_session` in `lib/auth-error.ts`), and "failed" would
 * make the first person doubt their account.
 */
export function connectOutcomeNotice(
	provider: ConnectableProvider,
	linked: boolean,
): string | null {
	if (linked) return null;
	return `Linking ${LOGIN_METHOD_LABEL[provider]} didn't complete. It may already be linked to another RowCat account, or linking may have been cancelled.`;
}
