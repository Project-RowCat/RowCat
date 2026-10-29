import type {
	GuardianConsentStateDto,
	GuardianConsentViewDto,
	GuardianRequestCreatedDto,
} from "@rowcat/contracts";
import type { Viewer } from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { VIEWER_QUERY_KEY } from "./viewer.ts";

/**
 * Membership cache policy: age declaration and guardian consent. The keys split in two:
 * - ["viewer","membership", …] holds the member's own state. Logout and account switches clear
 *   it.
 * - ["guardian", token] serves the guardian screen, a public flow with no viewer. The guardian
 *   key sits outside ["viewer"] on purpose. The person on that screen is a guardian who received a
 *   link from a child, not a member. The browser may have no session, or someone else's. Under the
 *   viewer prefix, every login or logout by that person would wipe an in-progress consent flow.
 *   Polling exists only on the child's screen: guardianStateQueryOptions re-asks at a short
 *   interval while waiting for approval. This does not conflict with the no-automatic-sync rule,
 *   for the same reason as device pairing. It is an explicit procedure the user watches, and the
 *   timer stops when they leave the screen. SSE is not extended to this event, so the notification
 *   plane does not widen into a general realtime bus.
 */

export const MEMBERSHIP_QUERY_KEY_PREFIX = ["viewer", "membership"] as const;

export const GUARDIAN_STATE_QUERY_KEY = [
	"viewer",
	"membership",
	"guardian",
] as const;

/**
 * Guardian screen, outside the viewer prefix (see header). The token is part of the key because one
 * browser can receive links from two children (siblings). Without the token, the second link would
 * read the first link's cache.
 */
export const guardianConsentQueryKey = (token: string) =>
	["guardian", token] as const;

/**
 * Refetch interval while waiting for approval: 3 seconds. Polling is the only way this screen
 * learns that the guardian pressed consent on another device. The interval is short because the
 * user watches and waits. Leaving the screen removes the observer, and the timer stops with it.
 */
const GUARDIAN_POLL_MS = 3_000;

/**
 * The member's own guardian-consent state. No `enabled` flag: the calling screen already sits
 * behind the child gate, and putting the condition here would duplicate that decision. A non-child
 * member asking gets a 200 saying no consent is required. Polling stops once the state is final.
 * Re-asking after approval or rejection changes nothing, and when the gate clears the screen
 * unmounts anyway.
 */
export function guardianStateQueryOptions(client: RowCatClient) {
	return queryOptions<GuardianConsentStateDto>({
		queryKey: GUARDIAN_STATE_QUERY_KEY,
		queryFn: ({ signal }) => client.membership.guardianState({ signal }),
		staleTime: 0,
		refetchInterval: (query) => {
			const status = query.state.data?.status;
			return status === "pending" || status === "verified"
				? GUARDIAN_POLL_MS
				: false;
		},
	});
}

/**
 * Guardian-screen query: the token is the identity. staleTime is 0 because the value changes on
 * other devices (if the child creates a new request, this link dies). There is no polling: the
 * guardian acts on this screen directly and has nothing to wait for. State changes come from this
 * browser's own mutations.
 */
export function guardianConsentQueryOptions(
	client: RowCatClient,
	token: string,
) {
	return queryOptions<GuardianConsentViewDto>({
		queryKey: guardianConsentQueryKey(token),
		queryFn: ({ signal }) => client.membership.guardianView(token, { signal }),
		staleTime: 0,
		/**
		 * Does not retry. Failures here are usually an expired or unknown token, so a retry returns the
		 * same answer while the guardian sees an unexplained placeholder. The screen must state the exact
		 * cause from the error code: `The link expired` (link expired) versus `Couldn't connect` (connection
		 * failed).
		 */
		retry: false,
	});
}

/**
 * Age declaration: writes the confirmed viewer value straight into the cache. No optimistic update:
 * this value decides the gate for the whole app, so there is no reason to open a window the server
 * might reject. Terms consent makes the same call. Does not invalidate the whole ["viewer"] prefix.
 * Only the viewer cell changed, and a full invalidation would refetch personalization, account,
 * notifications, billing and the creator workspace on every declaration. Guardian state is
 * invalidated too. Once the age is confirmed as under 14, the guardian screen mounts immediately,
 * and the cache would still hold the pre-declaration value (usually `No request`). A child who had
 * already created a request would then see the `Create a request` screen again.
 */
export function declareAgeMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
) {
	return {
		mutationKey: ["viewer", "membership", "declare-age"] as const,
		mutationFn: (input: { birthDate: string }) =>
			client.membership.declareAge(input),
		onSuccess: async (viewer: Viewer) => {
			queryClient.setQueryData<Viewer | null>(VIEWER_QUERY_KEY, viewer);
			await queryClient.invalidateQueries({
				queryKey: GUARDIAN_STATE_QUERY_KEY,
			});
		},
	};
}

/**
 * New guardian consent request. The response's state goes into the cache, but the token does not.
 * The token appears only in this response and is shown on screen right away. Cached, it would seem
 * to persist across a reload and then vanish at some point. A one-time value's lifetime should not
 * be decided by the cache.
 */
export function requestGuardianConsentMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
) {
	return {
		mutationKey: ["viewer", "membership", "request-guardian"] as const,
		mutationFn: () => client.membership.requestGuardianConsent(),
		onSuccess: (created: GuardianRequestCreatedDto) => {
			queryClient.setQueryData<GuardianConsentStateDto>(
				GUARDIAN_STATE_QUERY_KEY,
				created.state,
			);
		},
	};
}

/**
 * Guardian-side mutations. All of them write the confirmed server value directly. None is
 * optimistic: what changes here is a legal status, so a window showing `Consented` after a failure must
 * not exist. A guardian who saw it would believe the task was done and close the screen.
 */
export function guardianVerifyMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
	token: string,
) {
	return {
		mutationKey: ["guardian", token, "verify"] as const,
		/**
		 * Takes no arguments. The server stored the verification's identifier when the flow started, and
		 * this request only says 'done, please verify'. A value sent by the client would be a claim, not
		 * evidence.
		 */
		mutationFn: () => client.membership.submitGuardianVerification(token),
		onSuccess: (view: GuardianConsentViewDto) => {
			queryClient.setQueryData<GuardianConsentViewDto>(
				guardianConsentQueryKey(token),
				view,
			);
		},
	};
}

export function guardianConsentMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
	token: string,
) {
	return {
		mutationKey: ["guardian", token, "consent"] as const,
		mutationFn: () =>
			client.membership.submitGuardianConsent(token, { agreed: true }),
		onSuccess: (view: GuardianConsentViewDto) => {
			queryClient.setQueryData<GuardianConsentViewDto>(
				guardianConsentQueryKey(token),
				view,
			);
		},
	};
}

export function guardianDeclineMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
	token: string,
) {
	return {
		mutationKey: ["guardian", token, "decline"] as const,
		mutationFn: () => client.membership.declineGuardianConsent(token),
		onSuccess: (view: GuardianConsentViewDto) => {
			queryClient.setQueryData<GuardianConsentViewDto>(
				guardianConsentQueryKey(token),
				view,
			);
		},
	};
}
