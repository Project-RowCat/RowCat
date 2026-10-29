import type { ByoProvider } from "@rowcat/chat";
import type { CredentialCheck } from "../../lib/generation/byo.ts";
import type { ProviderError } from "../../lib/generation/errors.ts";
import type { ProviderConnectionStore } from "../../lib/local-provider/store.ts";
import {
	PROVIDER_BYO_LOCKED,
	PROVIDER_EMPTY_KEY,
	PROVIDER_FOREIGN_SESSION,
	PROVIDER_SAVE_FAILURE,
} from "./provider-copy.ts";

/**
 * Ordering for connecting one provider: validate, and save only while the store still belongs to
 * this session.
 *
 * The logic lives here rather than in the dialog because it is rules, not markup, and this app's
 * tests do not render screens. Each of the first five steps would be wrong if reordered:
 * - 1, same-tick lock: a tap overlapping Enter would send two probes and two writes.
 * - 2, eligibility: a key with an unusable shape must not reach the provider, where it is billed
 *   to the user.
 * - 3, empty-value filter: there is nothing to ask the provider about.
 * - 4, probe: if reversed, a key rejected with 401 would briefly show as connected.
 * - 5, ownership re-check: the step this app adds on top of the web.
 * - 6, save: only keys that passed reach here.
 *
 * Step 5 matters most. The probe waits on the network, and the account can change during that wait:
 * Alice presses connect (scope A), the probe is still running, Alice signs out and Bob signs in
 * (scope B), and the probe returns. Saving then would put Alice's key in Bob's Keychain entry. A
 * member id comparison is not enough: Alice signing out and back in keeps the same id, but the
 * scope closed and reopened, so it is a different session. The check compares the store instance
 * (`ownsScope` does the same). The target is never swapped for whichever store is open now, because
 * that only renames the problem: when the operation's session is not the current one, nothing is
 * saved.
 *
 * The secret does not persist here. It is passed in and handed to the two calls, and held in no
 * module global, closure or cache. Failures log no secret, only the error vocabulary
 * (`lib/generation/errors.ts`).
 *
 * Connecting does not touch the preference. A successful connection does not switch the global
 * target to that provider, because choosing a target is the user's decision. Disconnecting does not
 * clear the preference either.
 */

/**
 * Outcome of this operation. The states split on **whether the key was saved**.
 *
 * `rejected` and `failed` are separate because the screen does something different with each. The
 * first means the key is wrong, so the user must edit the value. The second means our side, the
 * network, or the provider is temporarily failing, so the right move is to **keep the input and
 * press again**. Merging them would report a brief network drop as "the API key is wrong", and the
 * user would go get a perfectly good key reissued.
 */
export type ConnectProviderOutcome =
	/** Verified and saved. */
	| { status: "connected" }
	/**
	 * This **account** cannot use a personal API key (under 14). **Nothing was done.**
	 *
	 * Kept apart from `rejected` and `failed` because there is no next action at all. Those two can be
	 * fixed by editing the value or pressing again, but neither helps here. Unless the message says
	 * so, the user will go get a perfectly good key reissued.
	 */
	| { status: "not_permitted"; message: string }
	/** The input is empty. **The provider was not asked.** */
	| { status: "empty"; message: string }
	/** The provider rejected this key. **Not saved.** */
	| { status: "rejected"; message: string }
	/** Cannot be verified right now (network, limit, provider outage, or save failure). **Not saved.** */
	| { status: "failed"; message: string }
	/**
	 * The session ended while the operation was running. **Not saved.**
	 *
	 * Distinct from failure because there is no next action: pressing again does not bring this
	 * session back, and a connection made in a new session is a **different operation**.
	 */
	| { status: "foreign"; message: string }
	/** The same operation is already running; nothing was done. */
	| { status: "busy" };

export interface ConnectProviderInput {
	provider: ByoProvider;
	/**
	 * Whether this account may use a personal API key; false for under-14s.
	 *
	 * **Disabling the button in the screen is not enforcement.** That is why this rule lives in a pure
	 * function, and why it must be checkable without opening the dialog.
	 *
	 * This layer is nonetheless the **last real gate** for this restriction, and that should be stated
	 * honestly. BYO credentials live in this device's Keychain and requests made with them do not pass
	 * through our server, so the server has no place to decide again. That limit comes with the
	 * definition of this feature; `docs/membership/ARCHITECTURE.md` states it in the same terms.
	 *
	 * No default: the caller states it explicitly. An optional value would silently fall to "allowed"
	 * when a new caller forgot it, and on this axis that direction removes the restriction entirely.
	 */
	byoAllowed: boolean;
	/** The key the user typed. The store trims it once more. */
	secret: string;
	/**
	 * The store at the moment the operation started. **Saves only to this instance.**
	 *
	 * Why the currently open store is not read inside is step 5 in the header.
	 */
	store: ProviderConnectionStore;
	/** Whether the store **still** belongs to this session. Judges the instance, not the member id. */
	ownsStore: (store: ProviderConnectionStore) => boolean;
	/** Verification: asks the provider **cheaply** (this is not a generation request). */
	probe: (provider: ByoProvider, secret: string) => Promise<CredentialCheck>;
	/**
	 * Synchronous copy of the in-progress flag.
	 *
	 * React state is not enough: `setState` takes effect only on the next render, so a submit arriving
	 * twice in the same tick (a repeated tap, or a tap overlapping confirmation) passes both checks.
	 * Two probes would then go out and the two writes would race; whichever finishes last wins, which
	 * may not be the key the user just entered.
	 */
	guard: { current: boolean };
}

export async function connectProvider(
	input: ConnectProviderInput,
): Promise<ConnectProviderOutcome> {
	if (input.guard.current) return { status: "busy" };
	/**
	 * **Eligibility comes before the probe.** If it ran after, a request with an unusable key would
	 * still reach the provider, which is billed to the user and recorded on that account. Judging
	 * before the guard is set is also intended: nothing has started, so there is nothing to release.
	 */
	if (!input.byoAllowed)
		return { status: "not_permitted", message: PROVIDER_BYO_LOCKED };

	/**
	 * Empty values also come before the probe. Asking the provider about an empty key returns 401,
	 * which is drawn as "the key is wrong" — worse guidance than the fact that nothing was entered.
	 */
	if (!input.secret.trim())
		return { status: "empty", message: PROVIDER_EMPTY_KEY };

	input.guard.current = true;
	try {
		/**
		 * Asked once more at the start too. The dialog may have been open for a long time, and if the
		 * account changed meanwhile there is no reason to send a request to the provider at all.
		 */
		if (!input.ownsStore(input.store))
			return { status: "foreign", message: PROVIDER_FOREIGN_SESSION };

		const check = await input.probe(input.provider, input.secret);
		if (!check.ok) {
			const message = credentialFailureMessage(check.error);
			return check.error.code === "invalid_credential"
				? { status: "rejected", message }
				: { status: "failed", message };
		}

		/**
		 * **Ask again just before the irreversible write.** Between the check above and this one there is
		 * a single network round trip, and an account switch happens exactly in that window.
		 */
		if (!input.ownsStore(input.store))
			return { status: "foreign", message: PROVIDER_FOREIGN_SESSION };

		/**
		 * Only keys that passed are saved. Replacement is the same call: because it overwrites, there is
		 * no window in which the old connection disappears if the save fails (`local-provider/store.ts`).
		 */
		await input.store.connect(input.provider, input.secret);
		return { status: "connected" };
	} catch {
		/**
		 * Storage and Keychain error text is not shown. The sentence says nothing the user can act on,
		 * and we cannot guarantee what the exception message contains.
		 */
		return { status: "failed", message: PROVIDER_SAVE_FAILURE };
	} finally {
		input.guard.current = false;
	}
}

/**
 * Verification failure → the sentence read **on this screen**.
 *
 * The generation screen's copy is not reused because the context differs. Here the user is entering
 * a key, not choosing a model yet, so saying "select another model" in response to
 * `model_unavailable` (404) would send them looking for a choice that is not there. For the same
 * reason network and 5xx errors are **folded into one sentence**: on this screen both call for the
 * same action (press again shortly).
 *
 * Two things must **not** be folded. A rejected key (must be edited) and a limit or credit problem
 * (must wait, or check the provider account) need different next actions.
 */
export function credentialFailureMessage(error: ProviderError): string {
	switch (error.code) {
		case "invalid_credential":
			return "The provider rejected this API key. Please check the key.";
		case "rate_limited":
			return "You've hit the provider's request limit. Please try again in a moment.";
		case "quota_exceeded":
			return "You've exceeded your provider account's usage limit. Please check your provider account.";
		default:
			return "The key can't be checked right now. Please try again in a moment.";
	}
}
