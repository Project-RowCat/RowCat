import {
	AgeDeclarationRequest,
	type GuardianConsentStateDto,
	GuardianConsentStateDto as GuardianConsentStateSchema,
	type GuardianConsentSubmitRequest,
	type GuardianConsentViewDto,
	GuardianConsentViewDto as GuardianConsentViewSchema,
	type GuardianRequestCreatedDto,
	GuardianRequestCreatedDto as GuardianRequestCreatedSchema,
	type IdentityVerificationHandoff,
	IdentityVerificationHandoff as IdentityVerificationHandoffSchema,
	ViewerDto,
} from "@rowcat/contracts";
import type { Viewer } from "@rowcat/domain";
import type { RequestOptions, RowCatTransport } from "./client.ts";
import { invalidRequest, invalidResponse } from "./errors.ts";

/**
 * Membership: age declaration and guardian consent. Two identities share this resource.
 * `declareAge`, `guardianState`, and `requestGuardianConsent` use the session, while the rest use a
 * one-time token, since the caller is a guardian who has no account. They share a file because the
 * domain is the same, which keeps the child's request and the guardian's view readable together. No
 * method takes a member id. Session methods have no target slot, and token methods use the token as
 * the target. Otherwise a client could record someone else's age or confirm someone else's consent.
 * The birth date is sent only by `declareAge` and appears in no response type, so showing it later
 * requires changing the contract first.
 */
export interface MembershipApi {
	/**
	 * Returns the confirmed viewer, which includes the next gate (`membershipGate`). If the screen
	 * caches it, no `/me` refetch is needed after declaring, and the client does not guess what to
	 * draw next.
	 */
	declareAge(
		input: { birthDate: string },
		options?: RequestOptions,
	): Promise<Viewer>;
	/**
	 * The guardian consent state for the current user, which the child's waiting screen polls. No
	 * token here. The token is returned only once, in the response that creates the request. If a
	 * query could fetch it again, it would not be one-time.
	 */
	guardianState(options?: RequestOptions): Promise<GuardianConsentStateDto>;
	/**
	 * Creates a new guardian consent request. This creates a link, not consent. Any earlier open
	 * request is killed. The server stores only a hash of the token and cannot show an old link again,
	 * so a response saying 'one already exists, use it' would be a dead end for someone who lost the
	 * link.
	 */
	requestGuardianConsent(
		options?: RequestOptions,
	): Promise<GuardianRequestCreatedDto>;

	/** What this request is about. The response has no value that identifies the child. */
	guardianView(
		token: string,
		options?: RequestOptions,
	): Promise<GuardianConsentViewDto>;
	/**
	 * Starts identity verification. Takes the method to proceed by, not a single address. Methods
	 * differ per verifier, so this is a discriminated union. The screen stops on an unknown kind,
	 * since the client is fail-closed as well. The return address is not sent. The server builds it
	 * from its own canonical origin, because a client-supplied value passed to the verifier would be
	 * an open redirect.
	 */
	startGuardianVerification(
		token: string,
		options?: RequestOptions,
	): Promise<IdentityVerificationHandoff>;
	/**
	 * Reports that verification has finished. There is no value to send. Not even the verification's
	 * identifier, let alone name, birth date, contact, or adulthood. Any such value would be a claim,
	 * not evidence, and an identifier would open a path to attach someone else's verification to this
	 * request. The server asks the verifier back using the reference it stored itself at the start.
	 */
	submitGuardianVerification(
		token: string,
		options?: RequestOptions,
	): Promise<GuardianConsentViewDto>;
	/**
	 * Confirms consent. `agreed` is typed as the literal `true`, so a refusal cannot be expressed
	 * through this call.
	 */
	submitGuardianConsent(
		token: string,
		input: GuardianConsentSubmitRequest,
		options?: RequestOptions,
	): Promise<GuardianConsentViewDto>;
	/** Declines consent. A separate call, for the same reason as above. */
	declineGuardianConsent(
		token: string,
		options?: RequestOptions,
	): Promise<GuardianConsentViewDto>;
}

/**
 * The token goes in the path, not the query string. A credential in a query string is logged by
 * server access logs, proxies, and referers. A path is not perfect either, since the same logs
 * record it, but it does not leak through referers, and this value identifies a one-use flow, so
 * the exposure window is narrow. `encodeURIComponent` is the identity for base64url, but it stays:
 * if the token encoding ever changes, this line is what prevents a silently broken path.
 */
const guardianPath = (token: string, suffix = ""): string =>
	`/guardian/${encodeURIComponent(token)}${suffix}`;

const parseView = (json: unknown, path: string): GuardianConsentViewDto => {
	const parsed = GuardianConsentViewSchema.safeParse(json);
	if (!parsed.success) throw invalidResponse(path);
	return parsed.data;
};

export function createMembershipApi({
	requestJson,
}: RowCatTransport): MembershipApi {
	return {
		async declareAge(input, options) {
			/**
			 * Checked against the server's schema before sending, to avoid a round trip. Plausibility
			 * (future dates, impossible years) is not checked here. That is `declareAge`'s domain judgment
			 * in the product timezone; a client-side check using the device clock would disagree with it
			 * when the device clock or timezone differs.
			 */
			const parsed = AgeDeclarationRequest.safeParse(input);
			if (!parsed.success)
				throw invalidRequest(
					"/me/membership/age",
					parsed.error.issues[0]?.message ?? "Invalid date of birth",
				);
			const json = await requestJson({
				method: "POST",
				path: "/me/membership/age",
				body: parsed.data,
				signal: options?.signal,
			});
			const viewer = ViewerDto.safeParse(json);
			if (!viewer.success) throw invalidResponse("/me/membership/age");
			return viewer.data;
		},

		async guardianState(options) {
			const json = await requestJson({
				method: "GET",
				path: "/me/membership/guardian",
				signal: options?.signal,
			});
			const parsed = GuardianConsentStateSchema.safeParse(json);
			if (!parsed.success) throw invalidResponse("/me/membership/guardian");
			return parsed.data;
		},

		async requestGuardianConsent(options) {
			const json = await requestJson({
				method: "POST",
				path: "/me/membership/guardian",
				signal: options?.signal,
			});
			const parsed = GuardianRequestCreatedSchema.safeParse(json);
			if (!parsed.success) throw invalidResponse("/me/membership/guardian");
			return parsed.data;
		},

		async guardianView(token, options) {
			const json = await requestJson({
				method: "GET",
				path: guardianPath(token),
				signal: options?.signal,
			});
			/**
			 * Validation matters most here. If the server leaks a consent row whole, it contains the
			 * guardian's name, contact, and identity-verification reference, plus the child's member id. The
			 * schema drops fields outside the contract, so skipping validation would let those values sit on
			 * screen, in the cache, and in devtools.
			 */
			return parseView(json, guardianPath(token));
		},

		async startGuardianVerification(token, options) {
			const json = await requestJson({
				method: "POST",
				path: guardianPath(token, "/verification"),
				signal: options?.signal,
			});
			const parsed = IdentityVerificationHandoffSchema.safeParse(json);
			if (!parsed.success)
				throw invalidResponse(guardianPath(token, "/verification"));
			return parsed.data;
		},

		async submitGuardianVerification(token, options) {
			/** No body. See the interface comment above for the reason. */
			const json = await requestJson({
				method: "POST",
				path: guardianPath(token, "/verify"),
				signal: options?.signal,
			});
			return parseView(json, guardianPath(token, "/verify"));
		},

		async submitGuardianConsent(token, input, options) {
			const json = await requestJson({
				method: "POST",
				path: guardianPath(token, "/consent"),
				body: input,
				signal: options?.signal,
			});
			return parseView(json, guardianPath(token, "/consent"));
		},

		async declineGuardianConsent(token, options) {
			const json = await requestJson({
				method: "POST",
				path: guardianPath(token, "/decline"),
				signal: options?.signal,
			});
			return parseView(json, guardianPath(token, "/decline"));
		},
	};
}
