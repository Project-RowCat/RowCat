import type { PublicProfile } from "@rowcat/domain";
import { isRowCatApiError } from "@rowcat/sdk";
import type { PublicSurfaceContext } from "../discover/discover-state.ts";

/**
 * What the public profile draws now, and which inputs it deliberately ignores. Like discover and
 * story state, identity and device storage are accepted but not read: the profile is public data
 * and must render for guests, before `/me` answers, and before SQLite opens. Identity only reaches
 * the header actions.
 *
 * A 404 does not state its reason. The server answers a never-existed id and a deleted member
 * identically; telling them apart would let a deleted identity be re-confirmed by id. So the type
 * has no `deleted`, `suspended` or `hidden` kinds — a kind that exists eventually gets filled.
 */

export interface ProfileQuerySnapshot {
	status: "pending" | "success" | "error";
	/** `fetchStatus === "paused"`: offline and retries stopped. `status` stays pending. */
	paused: boolean;
	error: unknown;
	data: PublicProfile | undefined;
}

export interface ProfileStateInputs {
	/** Identity and device storage. Not read by the resolver. */
	context: PublicSurfaceContext;
	profile: ProfileQuerySnapshot;
}

/**
 * ```text
 * loading   first fetch still running
 * offline   paused with no network; no endless placeholder is drawn
 * missing   server answered 404; the reason is unknown, so there is nothing to retry
 * failed    any other failure; the request id is the user's only clue
 * profile   draws the identity
 * ```
 *
 * The `profile` kind carries the profile itself. A screen that re-read it from the query result
 * would reintroduce an assertion the type cannot check, and the assertion would fail silently.
 */
export type ProfileState =
	| { kind: "loading" }
	| { kind: "offline" }
	| { kind: "missing" }
	| { kind: "failed"; requestId: string | null }
	| { kind: "profile"; profile: PublicProfile };

export function resolveProfileState(inputs: ProfileStateInputs): ProfileState {
	const { status, paused, error, data } = inputs.profile;

	/**
	 * Never clear a held value. If a background refresh fails, the identity stays on screen; erasing
	 * it on a network blip would read as the person having left.
	 */
	if (data) return { kind: "profile", profile: data };

	if (status === "error") {
		const apiError = isRowCatApiError(error) ? error : null;
		if (apiError?.status === 404) return { kind: "missing" };
		/**
		 * Neither the body nor the stack is kept. The request id is kept because it is the only clue a
		 * user can screenshot and send back.
		 */
		return { kind: "failed", requestId: apiError?.requestId ?? null };
	}

	return paused ? { kind: "offline" } : { kind: "loading" };
}
