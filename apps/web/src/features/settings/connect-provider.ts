import type { ByoProvider } from "@rowcat/chat";
import type { ProviderError } from "#/lib/generation/errors.ts";
import type { CredentialCheck } from "#/lib/generation/transport.ts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * The order for connecting a provider: verify, and save only if verification passes. It was split
 * out of the dialog because what lives here is rules, not markup. Three rules are checkable without
 * rendering:
 * - Verify before save. Reversed, a key rejected with 401 would briefly show as connected.
 * - No save on failure, transient or otherwise. A probably-valid key is not saved.
 * - One at a time. Two submits in the same tick must not make two verifications and two writes.
 *
 * The plaintext key does not stay here. It is taken as an argument, passed to the two calls, and
 * dropped. It is not kept in module state, closures, or a cache. Even on failure, secrets are not
 * logged; only the vocabulary in `lib/generation/errors.ts` remains.
 *
 * Connecting does not change the preference. Connecting does not switch the global target to that
 * provider; that choice belongs to the user, and making it here would look like the model changed
 * after adding a key. Disconnecting does not clear the preference either.
 */

/**
 * Outcomes split on whether something was saved. `rejected` and `failed` are separate because the
 * screen does different things for each. `rejected` means the key is wrong, so the user must edit
 * the value. `failed` means our side, the network, or the provider is temporarily unavailable, so
 * the input stays and pressing again is the fix. Collapsing them would report a brief outage as an
 * invalid key, and the user would re-issue a working key.
 */
export type ConnectProviderOutcome =
	| { status: "connected" }
	/**
	 * The account cannot use a personal API key because the account holder is under 14. Nothing was
	 * done. This is kept apart from `rejected` and `failed` because there is no next action at all:
	 * those two can be fixed by editing the value or pressing again, while this one cannot. If the
	 * screen does not say so plainly, the user will go re-issue a working key.
	 *
	 * Checked before verification. Otherwise an unusable key would still send one request to the
	 * provider, which costs the user and stays on their account.
	 */
	| { status: "not_permitted"; message: string }
	/** The provider rejected the key. Nothing was saved. */
	| { status: "rejected"; message: string }
	/**
	 * Verification is not possible right now (network, quota, provider outage, or save failure).
	 * Nothing was saved.
	 */
	| { status: "failed"; message: string }
	/** Another operation is already running. Nothing was done. */
	| { status: "busy" };

export interface ConnectProviderInput {
	provider: ByoProvider;
	/**
	 * Whether this account may use a personal API key. False when the account is under 14.
	 *
	 * Having the screen disable the button is not enforcement. That is why this rule is a pure
	 * function: it can be checked without opening the dialog.
	 *
	 * This is still the last real gate on this restriction, and that is stated plainly. BYO
	 * credentials live in this device's IndexedDB, and requests made with the key do not pass through
	 * the server, so the server has no place to check again. That limit comes from the feature's
	 * definition and is stated in `docs/membership/ARCHITECTURE.md`.
	 *
	 * No default is given; callers pass it explicitly. An optional field would let a new caller that
	 * forgot it silently allow the feature, and on this axis that direction removes the restriction
	 * entirely.
	 */
	byoAllowed: boolean;
	/** The key the user typed. Trimming is already done by the caller. */
	secret: string;
	/** Verification. Asks the provider cheaply; this is not a generation request. */
	probe: (provider: ByoProvider, secret: string) => Promise<CredentialCheck>;
	/** Save. Only keys that passed verification reach this. Replacing a key uses the same call. */
	save: (provider: ByoProvider, secret: string) => Promise<void>;
	/**
	 * A synchronous copy of whether progress is running. React state is not enough: `setState` only
	 * takes effect on the next render, so two submits in the same tick (rapid clicks, or Enter and
	 * click overlapping) would both pass. That sends two verification requests, and two writes race,
	 * so whichever finishes last wins, which may not be the key just entered.
	 */
	guard: { current: boolean };
}

export async function connectProvider(
	input: ConnectProviderInput,
): Promise<ConnectProviderOutcome> {
	if (input.guard.current) return { status: "busy" };
	/**
	 * Eligibility is checked before verification. If placed later, a request goes to the provider with
	 * an unusable key, which costs the user and stays on their account. Checking before the guard is
	 * set is intended too: nothing has started, so there is nothing to release.
	 */
	if (!input.byoAllowed)
		return {
			status: "not_permitted",
			message: translator("settings")("connect.notPermitted"),
		};
	input.guard.current = true;
	try {
		const check = await input.probe(input.provider, input.secret);
		if (!check.ok) {
			const message = credentialFailureMessage(check.error);
			return check.error.code === "invalid_credential"
				? { status: "rejected", message }
				: { status: "failed", message };
		}

		// Only keys that passed are saved. Replacing a key uses the same call, which issues a new
		// wrapping key.
		await input.save(input.provider, input.secret);
		return { status: "connected" };
	} catch {
		/**
		 * The raw Dexie or WebCrypto message is not shown. It is not actionable for the user, and the
		 * contents of the exception message cannot be guaranteed.
		 */
		return {
			status: "failed",
			message: translator("settings")("connect.saveFailed"),
		};
	} finally {
		input.guard.current = false;
	}
}

/**
 * The sentence shown on this screen for a verification failure. The generation screen's copy is not
 * reused, because the context differs: here the user has not picked a model yet, they are entering
 * a key. Saying `please choose another model` for `model_unavailable` (404) would send them looking for an
 * option that does not exist. For the same reason, network, browser-blocked, and 5xx errors
 * collapse into one sentence, since on this screen all three call for the same action: try again
 * shortly.
 *
 * Two things must not collapse. A rejected key needs fixing, and a quota or credit limit needs
 * waiting or checking the provider account. Their next actions differ.
 */
export function credentialFailureMessage(error: ProviderError): string {
	const t = translator("settings");
	switch (error.code) {
		case "invalid_credential":
			return t("connect.invalidCredential");
		case "rate_limited":
			return t("connect.rateLimited");
		case "quota_exceeded":
			return t("connect.quotaExceeded");
		default:
			return t("connect.unavailable");
	}
}
