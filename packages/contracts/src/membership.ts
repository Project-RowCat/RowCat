import { z } from "zod";

/**
 * Membership protocol: the shape that age declaration and **guardian consent** travel over.
 *
 * What is NOT here:
 * - Birth date. It appears once, in the request, since there is no other way to learn the age.
 *   The server reduces it to an `AgeStatus` plus a transition date and discards it. No response
 *   schema has a slot for it, so code that later wants to show the birth date on screen must change
 *   the contract first.
 * - Member ID. Neither the person declaring an age nor the person whose consent is requested is
 *   identified by the client. The session decides. The guardian-side request is the exception: its
 *   identity is a **one-time token**, and nothing on the client can change which member that token
 *   points to.
 * - The guardian's resident registration number, CI, or raw verification data. The server narrows
 *   what the agency answered and records only that. The record is never returned in any response.
 * - The shape of identity verification itself. That belongs to the **capability** in
 *   `identity.ts`. Guardian consent is one consumer of it. If the shape lived here, a second
 *   consumer would have to reuse guardian vocabulary.
 * - Any child age or consent state in public projections. `PublicProfileDto`, `StoryDto`,
 *   `StoryCommentDto` and `NotificationDto` contain no type from this file.
 *
 * What the guardian screen receives: the guardian is not a member. They have no session or account,
 * only the link the child passed on. This contract is most careful about one point: the guardian's
 * view (`GuardianConsentViewDto`) contains **no value that can identify the child**. If the link
 * reaches the wrong person, they learn at most that a join request from someone under 14 exists,
 * not who it is.
 */

/** Age bracket. Same vocabulary as the domain's `AgeStatus` (`@rowcat/domain/membership`). */
export const AgeStatus = z.enum(["unknown", "child", "standard"]);
export type AgeStatus = z.infer<typeof AgeStatus>;

/** Entry gate. `null` means no gate applies, and that is itself a valid value. */
export const MembershipGate = z
	.enum(["age_required", "guardian_consent_required"])
	.nullable();
export type MembershipGate = z.infer<typeof MembershipGate>;

/**
 * Status of a guardian-consent request. There are five values. approved, declined and revoked are
 * final.
 *
 * - pending: the link was created and the guardian has not finished identity verification.
 * - verified: identity verification is done. The consent intent has not been given yet.
 * - approved: consent given. Only this status unlocks the child account.
 * - declined: the guardian did not consent.
 * - revoked: consent was given and later withdrawn.
 *
 * `expired` is deliberately not a value. A predicate decides expiry (`expiresAt`). If expiry were a
 * status, correctness would depend on a batch job writing it. While that job was stopped, expired
 * requests would stay alive. This matches the reasoning for moderation-restriction expiry.
 */
export const GuardianConsentStatus = z.enum([
	"pending",
	"verified",
	"approved",
	"declined",
	"revoked",
]);
export type GuardianConsentStatus = z.infer<typeof GuardianConsentStatus>;

/**
 * Rejection codes for what a child account has closed off. **Adult-gate codes are not reused.**
 * `adult_verification_required` means 'complete adult verification'. For a child under 14 that
 * sentence is false, and anyone following it would look for a procedure that does not exist.
 * Different reasons get different codes.
 */
export const MEMBERSHIP_ERROR_CODE = {
	/**
	 * The account has not verified its age, but attempted an action that requires age verification.
	 */
	ageRequired: "age_verification_required",
	/** The member is under 14 and has no valid guardian consent. */
	guardianConsentRequired: "guardian_consent_required",
	/** Accounts under 14 cannot view, publish or display adult-oriented content. */
	minorAdultRestricted: "minor_adult_restricted",
	/** Accounts under 14 cannot connect a personal API key or generate with one. */
	minorByoRestricted: "minor_byo_restricted",
} as const;
export type MembershipErrorCode =
	(typeof MEMBERSHIP_ERROR_CODE)[keyof typeof MEMBERSHIP_ERROR_CODE];

/**
 * Rejection codes for the guardian-consent procedure. **Split only where the screen must say
 * different things.** This table is not collapsed into one 'an error occurred' for that reason. A
 * guardian holding an expired link must have the child request a new one. A guardian whose identity
 * verification failed can simply try again. In a deployment with no verification method configured,
 * neither helps. Each message points to a different next action.
 */
export const GUARDIAN_ERROR_CODE = {
	/**
	 * No such request. **Not distinguished** from expired, cancelled or deleted-account cases
	 * (existence hiding).
	 */
	notFound: "guardian_request_not_found",
	/**
	 * The request existed but is past its validity period. Only someone holding the token reaches
	 * this, so this branch states the reason.
	 */
	expired: "guardian_request_expired",
	/** The request already ended in consent, refusal or revocation (replay defense). */
	alreadyResolved: "guardian_request_already_resolved",
	/** Identity verification is not complete yet. It comes before the consent intent. */
	verificationRequired: "guardian_verification_required",
	/** Identity verification failed, or the guardian aborted it. */
	verificationFailed: "guardian_verification_failed",
	/** The verified person is not an adult, so they cannot act as a legal guardian. */
	verifierNotAdult: "guardian_not_adult",
	/**
	 * This deployment has no identity verification method configured. **This is the surface of
	 * fail-closed.** The 503 is the point. A 400 or 403 would make the guardian try to fix their
	 * input. A 200 would record an unverified consent as verified.
	 */
	verifierUnavailable: "guardian_verifier_unavailable",
	/** A member who is not under 14 tried to start the guardian-consent procedure. */
	notRequired: "guardian_consent_not_required",
} as const;
export type GuardianErrorCode =
	(typeof GUARDIAN_ERROR_CODE)[keyof typeof GUARDIAN_ERROR_CODE];

/**
 * Age declaration. **This is the only place a birth date passes through this contract.** It is a
 * `YYYY-MM-DD` string with no time or timezone. The server never accepts an age the client
 * calculated. Age calculation depends on timezone and leap years, so devices can disagree, and the
 * disagreement shows up only as 'under 14 but let through'. The server counts once, in the product
 * timezone.
 *
 * Bounds are not locked here. Validity checks (future dates, impossible years) belong entirely to
 * the domain's `declareAge`. The contract checks only shape. If both sides judged, a loosening on
 * one side would show users a client rejecting a value the server had accepted.
 */
export const AgeDeclarationRequest = z.object({
	birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
});
export type AgeDeclarationRequest = z.infer<typeof AgeDeclarationRequest>;

/**
 * Child-facing view of **their own request's status**. The guardian's name, contact details and
 * verification reference are absent. There is no product reason to show these to the child, and
 * they are **another person's personal information**. Nothing in this procedure requires showing
 * the child who the adult receiving the link was.
 *
 * `consentUrl` is returned **only in the response that creates the request**
 * (`GuardianRequestCreatedDto`). It cannot be read back through a status lookup. If the token could
 * be re-read repeatedly, it would not be one-time.
 */
export const GuardianConsentStateDto = z.object({
	status: GuardianConsentStatus.nullable(),
	/** When this request expires. Absent for nonexistent or finished requests. */
	expiresAt: z.iso.datetime().nullable(),
	/** When consent was finalized. Present only when `approved`. */
	approvedAt: z.iso.datetime().nullable(),
	/**
	 * Whether this account **currently requires guardian consent**. It looks derivable from `status`
	 * but is not: this request is only the latest one, while the gate asks whether a valid consent
	 * exists at all. That judgment belongs to the server's `resolveMembershipGate`.
	 */
	required: z.boolean(),
});
export type GuardianConsentStateDto = z.infer<typeof GuardianConsentStateDto>;

/**
 * The response that creates a new request: **the only response that carries the token.** The server
 * stores only the token's hash, so the value leaves here once and is never reconstructed. If it is
 * lost, create a new request. The old link then dies, because each member has at most one open
 * request.
 */
export const GuardianRequestCreatedDto = z.object({
	/** Absolute path to hand to the guardian. The client knows the origin. */
	consentPath: z.string(),
	expiresAt: z.iso.datetime(),
	state: GuardianConsentStateDto,
});
export type GuardianRequestCreatedDto = z.infer<
	typeof GuardianRequestCreatedDto
>;

/**
 * What the guardian screen receives: **no value here can identify the child.** There is no
 * nickname, email, member ID or join date. If the link reaches the wrong person, the most they
 * learn is that a request from a child under 14 to join RowCat exists.
 *
 * What the consent is **about** is stated by the guardian screen itself: using the service and the
 * processing of the child's personal information. Under Article 22-2 of the Personal Information
 * Protection Act the guardian must be able to know what they consent to. This repository ships no
 * terms or privacy policy; a deployment that publishes its own links them on that screen
 * (`docs/oss/FORKING.md`).
 */
export const GuardianConsentViewDto = z.object({
	status: GuardianConsentStatus,
	expiresAt: z.iso.datetime(),
	/** Whether identity verification is complete. True at `verified` and above. */
	verified: z.boolean(),
});
export type GuardianConsentViewDto = z.infer<typeof GuardianConsentViewDto>;

/**
 * Submitting the verification result has **no request body.** The absence of a schema here is one
 * of the most important facts in this contract, so it is noted here. An earlier design had the
 * client send back the value the agency returned. That makes the value a **claim**: a request
 * carrying someone else's verification identifier becomes expressible.
 *
 * Now the server stores the identifier it created at start in the consent-request row. At the
 * confirm step it re-queries the agency with the **stored value**. The client can only say 'it is
 * finished, please check', and that sentence has no value to carry.
 */

/**
 * Consent intent: **one explicit `true`.** `z.literal(true)` is used instead of `agreed: boolean`.
 * Refusal goes through another endpoint (`/decline`). Putting a different value in the same body
 * would make an accidental default flow through into consent expressible. In legal consent that is
 * a defect. This is the same rule as a checkbox that is not pre-checked on screen.
 */
export const GuardianConsentSubmitRequest = z.object({
	agreed: z.literal(true),
});
export type GuardianConsentSubmitRequest = z.infer<
	typeof GuardianConsentSubmitRequest
>;
