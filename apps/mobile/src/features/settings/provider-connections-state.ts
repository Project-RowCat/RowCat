import type { ByoProvider } from "@rowcat/chat";
import {
	MOBILE_BYO_PROVIDERS,
	type ProviderConnectionSummary,
} from "../../lib/local-provider/record.ts";

/**
 * The rules that decide **what the provider connections section draws**, split out as pure
 * functions.
 *
 * Stacking `if`s inside the component makes the order impossible to check without rendering, and a
 * mistake here has only silent symptoms:
 *
 * ```text
 * drawing loading as "not connected"   a person with a connection sees it vanish, then come back
 * locking disconnect too               a member confirmed under 14 can never delete a stored key
 * rows vanishing with the state        someone who came to fix a connection cannot find what to fix
 * ```
 *
 * ## The list of rows is **fixed**
 *
 * It is not built from the catalogue, and it is not filtered by connection state. Users connect a
 * provider before choosing a model, and this screen **must stay up even when the model catalogue
 * fails**. If the list came from a server response, one network blip would make "the connection
 * cannot be fixed".
 */

/** Everything one row draws. **Neither the secret nor its fingerprint is here.** */
export interface ProviderRow {
	provider: ByoProvider;
	connected: boolean;
	/** When the connection was last connected or replaced (ISO). `null` if there is no connection. */
	updatedAt: string | null;
	/**
	 * Whether a new connection can be made or the key replaced. **False when there is no
	 * eligibility.**
	 *
	 * Even when this is false the row is still drawn and disconnect stays open. That asymmetry is the
	 * point of this type: what gets locked is **creating an outgoing credential**, not removing one
	 * that already exists (the same axis as cover deletion and blocking staying open under sanctions).
	 */
	canConnect: boolean;
	/**
	 * Whether the stored key can be deleted. **Always true.**
	 *
	 * It is a field so the fact can be locked by value. If it were folded into a constant, someone
	 * later could add the same condition as `canConnect`, and a member confirmed under 14 could never
	 * delete an API key still on their device.
	 */
	canDisconnect: boolean;
}

export type ProviderConnectionsState =
	/** Keychain has not been read yet. **Different from "no connection".** */
	| { kind: "loading" }
	/** Draw the rows. If not eligible, the reason comes along. */
	| { kind: "ready"; rows: ProviderRow[]; lockedReason: string | null };

export interface ProviderConnectionsInput {
	/** Connections on this device right now. Order does not matter; the row order is set by the fixed list. */
	connections: readonly ProviderConnectionSummary[];
	/** Whether the first result has not yet arrived. */
	loading: boolean;
	/** Whether this **account** may use personal API keys (false for members under 14). */
	byoAllowed: boolean;
	/** Whether the viewer's eligibility is not yet read; this shares the loading slot. */
	capabilityLoading: boolean;
	/** The sentence drawn once when not eligible. */
	lockedMessage: string;
}

export function resolveProviderConnectionsState(
	input: ProviderConnectionsInput,
): ProviderConnectionsState {
	/**
	 * Wait for both. Drawing after only one has arrived makes a row flicker through a different state
	 * for a frame, e.g. a locked member briefly seeing a live `Link` (connect) button.
	 */
	if (input.loading || input.capabilityLoading) return { kind: "loading" };

	const byProvider = new Map(
		input.connections.map((connection) => [connection.provider, connection]),
	);

	return {
		kind: "ready",
		rows: MOBILE_BYO_PROVIDERS.map((provider) => {
			const connection = byProvider.get(provider);
			return {
				provider,
				connected: connection !== undefined,
				updatedAt: connection?.updatedAt ?? null,
				canConnect: input.byoAllowed,
				/** See the field comment above — this value does not look at eligibility. */
				canDisconnect: true,
			};
		}),
		/**
		 * The reason is stated **once per section.** Attaching the same sentence to each row would make a
		 * two-row list say the same guidance twice, and that repetition soon goes unread.
		 */
		lockedReason: input.byoAllowed ? null : input.lockedMessage,
	};
}
