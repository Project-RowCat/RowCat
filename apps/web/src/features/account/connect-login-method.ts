import type { LoginMethodProvider } from "@rowcat/domain";
import { authClient } from "#/lib/auth.ts";
import { translator } from "#/lib/i18n/current.ts";
import {
	isLabeledLoginMethod,
	loginMethodLabel,
} from "./login-method-label.ts";

/**
 * Provider linking — **not sign-in: it attaches one more sign-in method to the current account.**
 *
 * The name is not `connect-provider.ts` for a reason. That name already belongs to
 * `features/settings/connect-provider.ts`, whose "provider" means a **BYO generation provider**
 * (OpenAI, Anthropic, Gemini). What is connected here is a **sign-in method**, and the two have
 * nothing to do with each other. Two folders with the same name would allow a wrong auto-complete
 * import that the compiler does not catch (both modules export a single function).
 *
 * ## Why it is kept apart from sign-in
 *
 * It looks like the same button as on the login screen, but the endpoint it calls differs
 * (`/sign-in/social` vs `/link-social`). That difference carries all of this slice's safety
 * properties:
 *
 * ```text
 * sign-in   finds the owner of that Google identity — if none, **creates a new account**
 * linking   **binds** that identity to the user of the current session — rejects it if it belongs to someone else
 * ```
 *
 * If the linking screen mistakenly called the sign-in side, a provider identity not attached to any
 * account would **create a second RowCat member**. That member has no local data and no works, and
 * the user reads their own account as empty. That is why this file exists: the account screen must
 * have no place where `signInWithGoogle` or `signInWithApple` can be called.
 *
 * ## Identity is unchanged
 *
 * Even when linking succeeds, the Better Auth user stays the same, and therefore the RowCat member
 * (`member.id`) too. The local database scope and the sync namespace do not move either, so after
 * returning, the only thing re-fetched is **one account-info field** (`invalidateAccountDetails`).
 *
 * ## No function per provider
 *
 * Only the name differs. The policy actually inside here (constant destination, origin assembly) is
 * provider-independent. Copying it would eventually leave one side without an `errorCallbackURL`,
 * and only people attempting to link with that method would be returned to the account screen
 * without an explanation.
 *
 * ## The user does not decide where the return goes
 *
 * The callback URL is built here from a **constant path**. Passing a value read from the query
 * would make the link itself a phishing path. Unlike the login side (which filters the value with
 * `redirectTargetFrom`), no value is accepted here to filter: the destination of linking is always
 * the one account screen. The server's `trustedOrigins` adds one more layer.
 */

/** Where linking returns to. No other destination exists besides this screen. */
const RETURN_PATH = "/account";

/**
 * Parameters carried in the address as the "came back" marker.
 *
 * `error` is **attached by Better Auth**: the library appends `?error=<code>` to the
 * `errorCallbackURL` we supplied, so the name cannot be chosen by us. That is why a separate marker
 * of ours (`connect`) exists: judging by `error` alone would, on the day another feature uses the
 * same name, make the account screen draw someone else's failure as a linking failure.
 */
const PARAMS = ["connected", "connect", "provider", "error"] as const;

/** Result of the linking round trip — carried back in the address. */
export type ConnectReturn =
	| { status: "connected" }
	/**
	 * `provider` may be `null`: if the value in the address is not a method we know, it is dropped.
	 * The only use of that value is to put a name in a sentence, but unvalidated, another party's link
	 * string would become our screen's sentence verbatim.
	 */
	| {
			status: "failed";
			provider: ConnectableProvider | null;
			code: string | null;
	  }
	| null;

/**
 * Reads the result from the address and builds the **address with its traces removed** — a pure
 * function.
 *
 * Two reasons it must be removed: refresh, back and address sharing would redraw the same result,
 * and the failure code would stay in browser history.
 *
 * The value is **not sent back to the server**. What is read here only decides what to draw;
 * whether the linking actually happened is answered by the account info fetched again.
 * `connected=google` in the address is a **claim** anyone can type by hand.
 */
export function readConnectReturn(href: string): {
	result: ConnectReturn;
	cleanedHref: string;
} {
	const url = new URL(href);
	const connected = url.searchParams.get("connected");
	const connect = url.searchParams.get("connect");
	const provider = url.searchParams.get("provider");
	const error = url.searchParams.get("error");

	for (const param of PARAMS) url.searchParams.delete(param);
	const cleanedHref = `${url.pathname}${url.search}${url.hash}`;

	if (connected) return { result: { status: "connected" }, cleanedHref };
	if (connect === "error")
		return {
			result: {
				status: "failed",
				provider: knownProvider(provider),
				code: error,
			},
			cleanedHref,
		};
	return { result: null, cleanedHref: href };
}

/**
 * Reads the result from the address and removes it — it disappears after one call.
 *
 * `history.replaceState` is used to bypass the router. Handling it as a navigation would add one
 * history entry, and back would return to the address just cleaned (the identity-verification
 * return made the same decision).
 */
export function consumeConnectReturn(): ConnectReturn {
	if (typeof window === "undefined") return null;
	const { result, cleanedHref } = readConnectReturn(window.location.href);
	if (result) window.history.replaceState(null, "", cleanedHref);
	return result;
}

/**
 * The methods **this screen can link**.
 *
 * Excluding credentials is the entire vocabulary here. That method is created not by an OAuth round
 * trip but by setting a password, and that operation lives in the password section below. Having it
 * here would give the same operation two entrances, and one of them could not say what it does by
 * its name ("link" would open the password-setting dialog).
 *
 * The list is derived by **excluding** rather than written by hand, because of drift: if this had
 * to be edited alongside each new provider, one would eventually be missed, and a missed method
 * would only appear in the list as "not connected" with no way to connect it.
 */
export type ConnectableProvider = Exclude<LoginMethodProvider, "credential">;

/**
 * String returned in the address → a method we know.
 *
 * Judged by the keys of the label table. Re-listing the methods here would make only this function
 * stale when a method is added, and then only that method's failures would get a nameless sentence
 * (a silent mismatch).
 */
const knownProvider = (value: string | null): ConnectableProvider | null =>
	value !== null && value !== "credential" && isLabeledLoginMethod(value)
		? (value as ConnectableProvider)
		: null;

/**
 * OAuth callback error code → human-readable sentence.
 *
 * **Does not reveal whether an account exists.** `account_already_linked_to_different_user` means
 * that the provider account is attached to another RowCat account. Stating that as fact would make
 * this screen a lookup asking "did you sign up to RowCat with this account". However, **the person
 * chose their own account and has just finished authenticating**, so it cannot be used to detect
 * someone else's account; they still need to know what to do. So the sentence says only "already
 * linked to another account", not which one.
 *
 * **Never merged automatically.** There is no path in this repository that merges accounts or moves
 * resources on this failure, and none will be created.
 *
 * The provider name is an argument because the sentence uses it, and the source of that name is the
 * single label table. Re-typing "Apple" here would make only this sentence stale on the day the
 * label changes.
 */
export function connectLoginMethodErrorMessage(
	/** `null` means **the method is unknown** (see `ConnectReturn` above). */
	provider: ConnectableProvider | null,
	code: string | null,
): string {
	const t = translator("account");
	const subject = provider
		? t("connect.providerAccount", { provider: loginMethodLabel(provider) })
		: t("connect.account");
	switch (code) {
		case "account_already_linked_to_different_user":
			return t("connect.alreadyLinked", { subject });
		/**
		 * Better Auth's default (`allowDifferentEmails: false`) produces this failure. We did not turn
		 * off the rule that linking requires matching emails, because that rule is the place that blocks
		 * the assumption "same email, so same person".
		 *
		 * **On Apple this branch is close to the normal path.** When the user picks "Hide My Email", the
		 * provider gives an arbitrary relay address, which can never equal the RowCat account's email.
		 * What that person can do is choose to share the real address on the Apple screen again, so the
		 * sentence points there. Rather than turning off the rule, the guidance is made accurate.
		 * (Turning it off would not revive the "same email, same person" assumption; it would instead let
		 * two unrelated identities be joined without our verifying anything.)
		 */
		case "email_does_not_match":
			return provider === "apple"
				? t("connect.emailMismatchApple", { subject })
				: t("connect.emailMismatch", { subject });
		case "unable_to_link_account":
			return t("connect.failed", { subject });
		/**
		 * Cancelling on the provider's screen also lands here. That is not a failure, but how providers
		 * return codes differs per deployment, so the sentence stays neutral: asserting "it failed" would
		 * make someone who stopped on their own suspect their account.
		 */
		default:
			return t("connect.incomplete", { subject });
	}
}

/**
 * Starts linking — the browser leaves for that provider.
 *
 * Both `callbackURL` and `errorCallbackURL` are built here as **this app's origin + a constant
 * path**. The point is that callers have no argument to pass an origin or path, because such an
 * argument would be an open redirect. The server then compares both URLs against `trustedOrigins`
 * again.
 *
 * The success marker carries the provider name, but **nothing is judged by that value** (see the
 * header). What the screen trusts after returning is always the account info the server confirms.
 */
export function connectLoginMethod(provider: ConnectableProvider) {
	const origin = typeof window === "undefined" ? "" : window.location.origin;
	return authClient.linkSocial({
		provider,
		callbackURL: `${origin}${RETURN_PATH}?connected=${provider}`,
		/**
		 * The method used is carried **on the failure path too**. Without this value, the returning
		 * screen could not say which thing failed. Remembering the method being attempted is another
		 * option, but that state would vanish while the browser is away, and restoring it would require a
		 * storage layer.
		 *
		 * The returned value is **validated before use** (`knownProvider`). The library appends
		 * `&error=…` to this URL, so the existing query stays intact.
		 */
		errorCallbackURL: `${origin}${RETURN_PATH}?connect=error&provider=${provider}`,
	});
}
