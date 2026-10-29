import {
	type GenerationProvider,
	type GenerationTarget,
	isByoProvider,
} from "./generation-preference.ts";

/**
 * Maps the requested target to the target this device can actually run.
 *
 * Kept separate from the precedence resolver (`resolveEffectiveGeneration`) because the two answer
 * different questions and need different responses:
 * - no requested target: inherit from the layer above (the precedence resolver's job)
 * - requested target unusable: block generation and tell the user (this file's job)
 *
 * If merged, the second case would be handled like the first. A provider with no connection would
 * silently fall back to RowCat, which breaks a product rule: billing destination, prompt route,
 * model character and provider policy all change while the user sees nothing happen. So this file
 * cannot express a substitution. The result is either an executable target or a blocking reason,
 * never another target.
 *
 * Pure function: no IndexedDB, no fetch. Connection state and catalog are passed in, so the rule
 * can be checked without a browser, and the later Expo app can reuse it.
 */

/**
 * Reasons it cannot run. The user can do different things about each, so they are not collapsed.
 * With no connection the next step is to connect in settings; with a model gone it is to pick
 * another model. One message for both would be a dead end for one of them.
 */
export type GenerationBlockedReason =
	/**
	 * The account may not use a personal API key (BYO) because it is under 14. Checked before
	 * connection status: telling a child to connect would send them to obtain a key only to be blocked
	 * again, and by then the reason has been lost.
	 *
	 * The reason is that a BYO request does not pass through the RowCat server. The browser calls the
	 * provider directly, so the RowCat server cannot meet that provider's age or guardian requirements
	 * on the user's behalf. Routing the request through the server to get around this would break the
	 * definition of BYO.
	 */
	| "byo_not_permitted"
	/**
	 * This conversation runs only on RowCat-provided models, because the work is a protected-prompt
	 * copy.
	 *
	 * The manuscript of a protected work is not sent to the device; the server assembles the prompt
	 * (`protected-generation.ts`). A BYO request has the browser call the provider directly, so there
	 * is no way to carry that manuscript. Without this block, generation would silently proceed with a
	 * prompt missing its manuscript, and the failure would show only as lower response quality, not as
	 * an error.
	 */
	| "managed_only"
	| "provider_not_connected"
	/** The saved target is no longer in the current catalog (the model was retired or renamed). */
	| "model_unavailable";

/**
 * Result of the execution check. A `blocked` result carries the requested target unchanged, so the
 * screen can name it, and the saved preference is never erased. Reconnecting the provider makes the
 * room run again without any further action.
 */
export type GenerationExecution =
	| { status: "executable"; target: GenerationTarget }
	| {
			status: "blocked";
			/** The target the user selected. The verdict never changes or clears this value. */
			target: GenerationTarget;
			reason: GenerationBlockedReason;
	  };

/** The only catalog fields the verdict reads: provider and model name. */
export interface GenerationCatalogEntry {
	provider: GenerationProvider;
	model: string;
}

export interface GenerationExecutionInput {
	/** The target chosen by precedence resolution (`resolveEffectiveGeneration`). */
	target: GenerationTarget;
	/**
	 * Providers that have credentials on this device. The managed tier does not need to appear here.
	 */
	connectedProviders: readonly GenerationProvider[];
	/**
	 * Whether this account may use BYO. False for accounts under 14.
	 *
	 * This is separate from `connectedProviders`, which asks whether this device holds a key. Merging
	 * the two, for example by emptying the connection list, would show a child a 'connect in settings'
	 * dead end.
	 *
	 * It has no default on purpose: every call site states it. An omitted value would fall to the
	 * permissive side and let a child's prompt reach a provider the RowCat server does not control.
	 * `GallerySelector.ownPrivateVisible` avoids a default for the same reason.
	 */
	byoAllowed: boolean;
	/**
	 * True when this conversation may run only on RowCat-provided models (a protected-prompt room).
	 * Omitting it means false.
	 *
	 * Only conversation turns know this axis, because the server assembles protected manuscripts. The
	 * other callers (memory maintenance, reply suggestions, the settings summary) carry no manuscript.
	 * A false default is wrong only if a conversation turn forgets to pass the value, so those turns
	 * pass it explicitly.
	 */
	managedOnly?: boolean;
	/**
	 * The current catalog. May be omitted.
	 *
	 * Not passed at generation time. The catalog is server state and may not have been read; blocking
	 * generation on 'the model cannot be verified' would turn a brief network blip into a blocked
	 * conversation. If the model really is gone, the provider rejects the request, and that failure is
	 * accurate.
	 *
	 * The settings screen does pass it, because there the point is to warn in advance that the
	 * conversation points to a model that no longer exists. Even then the saved preference is
	 * untouched.
	 */
	catalog?: readonly GenerationCatalogEntry[] | undefined;
}

/**
 * Whether this device can run the target. The order of checks is part of the rule.
 *
 * The connection is checked before the catalog. When both are missing, the user's first step is to
 * connect; without a connection, fixing the model list still leaves the target unusable.
 */
export function resolveGenerationExecution(
	input: GenerationExecutionInput,
): GenerationExecution {
	const { target, connectedProviders, catalog, byoAllowed } = input;

	/**
	 * The protected-manuscript check runs first. In that conversation neither connection nor age can
	 * change the outcome; the only action is choosing a RowCat-provided model.
	 */
	if (isByoProvider(target.provider) && input.managedOnly)
		return { status: "blocked", target, reason: "managed_only" };

	/**
	 * The account eligibility check comes before the connection check. An under-14 account that
	 * already has a key connected on this device (age confirmed later) must get the same answer. If
	 * 'connected, so it works' applied, the restriction would block nothing.
	 *
	 * The saved key is not deleted. This verdict is about executability, and the device's credentials
	 * are the user's private data. Removing the key because age was confirmed is not for the app to
	 * decide; the account can use it again unchanged at 14.
	 */
	if (isByoProvider(target.provider) && !byoAllowed)
		return { status: "blocked", target, reason: "byo_not_permitted" };

	if (
		isByoProvider(target.provider) &&
		!connectedProviders.includes(target.provider)
	)
		return { status: "blocked", target, reason: "provider_not_connected" };

	/**
	 * If a catalog was passed and the target is not in it, block. The saved preference is left
	 * unchanged. A model may be withdrawn temporarily and return; overwriting the value would leave
	 * the user on a model they never chose.
	 */
	if (
		catalog &&
		!catalog.some(
			(entry) =>
				entry.provider === target.provider && entry.model === target.model,
		)
	)
		return { status: "blocked", target, reason: "model_unavailable" };

	return { status: "executable", target };
}
