import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
	GUARDIAN_ERROR_CODE,
	type GuardianConsentStateDto,
	type GuardianConsentStatus,
	type GuardianConsentViewDto,
	type IdentityVerificationHandoff,
	type IdentityVerificationMethod,
} from "@rowcat/contracts";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { guardian_consent, member } from "../db/schema.ts";
import { ApiError } from "../lib/errors.ts";
import { newId } from "../lib/id.ts";
import { checkRateLimit } from "../lib/rate-limit/index.ts";
import {
	type IdentityVerificationProvider,
	resolveIdentityVerifier,
} from "./identity/provider.ts";

/**
 * Guardian consent: the only procedure that opens a child account, and its whole state machine.
 *
 * - A child cannot create their own consent. Approval only follows identity verification,
 *   enforced by `status = 'verified'` in the predicate.
 * - A link cannot be used twice: a replay hits 0 rows in one conditional UPDATE.
 * - One open request and one valid consent per member, enforced by partial unique indexes.
 * - Expiry is an `expires_at` predicate on every read, not a batch job.
 *
 * Deliberately absent:
 * - Guardian accounts. They would be identities with access to the child's data, which this slice
 *   does not build. Conversations stay E2EE.
 * - Token plaintext. Only the hash is stored.
 * - Anything identifying the child in the guardian's response.
 * - Notifications, mail or SMS. No sending infrastructure exists for this (`auth/index.ts`). The
 *   child passes the link to the guardian by means they already have.
 */

/**
 * Link lifetime: 24 hours. Device pairing is 5 minutes because the user waits at the screen; here
 * the child must actually meet the guardian, and 5 minutes would lock out a child at school. Not
 * unbounded because the token is a bearer credential: a link left in a messenger must not let
 * someone who sees it create guardian consent months later.
 */
export const GUARDIAN_CONSENT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The vocabulary lives in the contract (`contracts/identity.ts`) so it holds only values actually
 * in use. the Korean Personal Information Protection Act Enforcement Decree art. 17-2 lists seven verification methods, but only one is implemented.
 * Every value in the vocabulary must be one this constant can point at.
 */
const VERIFICATION_METHOD: IdentityVerificationMethod = "identity-verification";

/** Must be the same string as the web route. */
export const guardianConsentPath = (token: string): string =>
	`/guardian/${token}`;

/**
 * 256 bits: unlike device pairing's 80-bit code, nobody reads or retypes this; the link is passed
 * whole, so there is no reason to shorten it.
 */
const newConsentToken = (): string => randomBytes(32).toString("base64url");

/**
 * Hash used for storage and lookup; the plaintext is kept nowhere. Unsalted on purpose: the input
 * is a 256-bit random value, not a human password, and a per-row salt would make rows unfindable by
 * token.
 */
const hashToken = (token: string): string =>
	createHash("sha256").update(token, "utf8").digest("hex");

/**
 * Constant-time hash comparison. Lookup is indexed so timing does not leak already; this is a
 * recheck after the DB has answered, stating in code that a row with a different value must never
 * come back.
 */
function tokenMatches(hash: string, stored: string): boolean {
	const a = Buffer.from(hash, "utf8");
	const b = Buffer.from(stored, "utf8");
	return a.length === b.length && timingSafeEqual(a, b);
}

const notFound = () =>
	new ApiError(404, GUARDIAN_ERROR_CODE.notFound, "Consent request not found.");
const expired = () =>
	new ApiError(
		410,
		GUARDIAN_ERROR_CODE.expired,
		"The consent request has expired.",
	);
const alreadyResolved = () =>
	new ApiError(
		409,
		GUARDIAN_ERROR_CODE.alreadyResolved,
		"This consent request was already handled.",
	);
const verificationRequired = () =>
	new ApiError(
		409,
		GUARDIAN_ERROR_CODE.verificationRequired,
		"The guardian's identity verification must be completed first.",
	);
const verifierUnavailable = () =>
	new ApiError(
		503,
		GUARDIAN_ERROR_CODE.verifierUnavailable,
		"Guardian identity verification isn't available.",
	);

/** Valid consent: consented and not revoked. No expiry here; consent has no deadline. */
export const activeConsent = (memberId: string) =>
	and(
		eq(guardian_consent.member_id, memberId),
		sql`${guardian_consent.consented_at} is not null`,
		isNull(guardian_consent.revoked_at),
	);

/**
 * The state of the child's own request. The token is never included: it rides only on the response
 * that created the request, so a briefly borrowed account cannot obtain a consent link by reading.
 */
export async function readGuardianConsentState(input: {
	memberId: string;
	required: boolean;
	now?: Date;
}): Promise<GuardianConsentStateDto> {
	const now = input.now ?? new Date();
	const [row] = await db
		.select({
			status: guardian_consent.status,
			expiresAt: guardian_consent.expires_at,
			consentedAt: guardian_consent.consented_at,
			revokedAt: guardian_consent.revoked_at,
		})
		.from(guardian_consent)
		.where(eq(guardian_consent.member_id, input.memberId))
		.orderBy(desc(guardian_consent.requested_at))
		.limit(1);

	if (!row)
		return {
			status: null,
			expiresAt: null,
			approvedAt: null,
			required: input.required,
		};

	// Fold expiry here: an expired open request must not read as `pending`, or the child waits for an
	// approval that will never come. The status column is not edited (expiry is a predicate).
	const open = row.status === "pending" || row.status === "verified";
	const stale = open && row.expiresAt.getTime() <= now.getTime();

	return {
		status: stale ? null : (row.status as GuardianConsentStatus),
		expiresAt: stale || !open ? null : row.expiresAt.toISOString(),
		approvedAt: row.consentedAt?.toISOString() ?? null,
		required: input.required,
	};
}

export interface GuardianRequestCreated {
	token: string;
	expiresAt: Date;
}

/**
 * New consent request; any previously open request dies. The server holds only the token hash and
 * cannot show an old link again, so "a request exists, use that" would strand someone who lost the
 * link. A single live link is also better for security.
 *
 * Locks the member row: two simultaneous requests could both close the old one and both create a
 * new one, leaving a supposedly dead link alive. The partial unique index is the final authority,
 * but the lock turns that conflict into ordering instead of a 500.
 *
 * With no verifier configured no request is created (503): the child would hand over a link and the
 * guardian would see a screen that never works.
 */
export async function startGuardianConsentRequest(input: {
	memberId: string;
	now?: Date;
}): Promise<GuardianRequestCreated> {
	if (!resolveIdentityVerifier()) throw verifierUnavailable();

	const now = input.now ?? new Date();
	const token = newConsentToken();
	const expiresAt = new Date(now.getTime() + GUARDIAN_CONSENT_TTL_MS);

	await db.transaction(async (tx) => {
		// Serialization point for the one-per-member rule. A missing member is stopped by the FK below.
		await tx
			.select({ id: member.id })
			.from(member)
			.where(eq(member.id, input.memberId))
			.for("update")
			.limit(1);

		// `revoked`, not `declined`: the guardian refusing and the child making a new link are different
		// facts, and writing the former here would make the audit trail lie.
		await tx
			.update(guardian_consent)
			.set({ status: "revoked", revoked_at: now, updated_at: now })
			.where(
				and(
					eq(guardian_consent.member_id, input.memberId),
					sql`${guardian_consent.status} in ('pending', 'verified')`,
				),
			);

		await tx.insert(guardian_consent).values({
			id: newId(),
			member_id: input.memberId,
			status: "pending",
			token_hash: hashToken(token),
			requested_at: now,
			expires_at: expiresAt,
			created_at: now,
			updated_at: now,
		});
	});

	return { token, expiresAt };
}

interface ConsentRow {
	id: string;
	memberId: string;
	status: GuardianConsentStatus;
	tokenHash: string;
	expiresAt: Date;
	/**
	 * Reference to the verification started earlier. It never passes through the client; that is this
	 * procedure's channel binding. The confirm step reads this column and asks the authority again, so
	 * a client cannot attach someone else's verification to its own request.
	 */
	verificationRef: string | null;
}

/**
 * Token to request: the single entry point of the guardian path. A missing token, a revoked one and
 * one whose account was deleted all give the same 404 (the FK cascade already removed that row);
 * distinguishing them would leak that an account existed to someone whose identity is unchecked.
 * Only expiry states its reason, because whoever reaches that branch already held a valid token,
 * and the screen can then tell them to ask the child for a new link.
 */
async function loadByToken(
	token: string,
	now: Date,
	options?: { allowResolved?: boolean },
): Promise<ConsentRow> {
	const hash = hashToken(token);
	const [row] = await db
		.select({
			id: guardian_consent.id,
			memberId: guardian_consent.member_id,
			status: guardian_consent.status,
			tokenHash: guardian_consent.token_hash,
			expiresAt: guardian_consent.expires_at,
			verificationRef: guardian_consent.verification_ref,
		})
		.from(guardian_consent)
		.where(eq(guardian_consent.token_hash, hash))
		.limit(1);

	if (!row || !tokenMatches(hash, row.tokenHash)) throw notFound();

	const consent: ConsentRow = {
		...row,
		status: row.status as GuardianConsentStatus,
	};

	if (consent.status !== "pending" && consent.status !== "verified") {
		// Finished request. Reads are allowed (the guardian must see the result they just pressed);
		// writes get 409, which is the replay-defence surface.
		if (options?.allowResolved) return consent;
		throw alreadyResolved();
	}
	if (consent.expiresAt.getTime() <= now.getTime()) throw expired();
	return consent;
}

/** Nothing here can identify the child. */
export async function readGuardianConsentView(
	token: string,
	now = new Date(),
): Promise<GuardianConsentViewDto> {
	const row = await loadByToken(token, now, { allowResolved: true });
	return {
		status: row.status,
		expiresAt: row.expiresAt.toISOString(),
		verified: row.status !== "pending",
	};
}

/**
 * Starts verification: builds the address that sends the guardian to the authority. Without a
 * verifier this is a 503 so the guardian hears it immediately, rather than drawing something and
 * blocking at the last step, which makes them repeat the procedure.
 */
export async function beginGuardianVerification(input: {
	token: string;
	returnUrl: string;
	now?: Date;
}): Promise<IdentityVerificationHandoff> {
	const verifier = requireVerifier();
	const now = input.now ?? new Date();
	const row = await loadByToken(input.token, now);
	// Begin has a limit too. While only verification was counted, begin could be called without bound
	// with just a token; today the adapter's `begin` makes no network call, but the day a provider
	// reserves a transaction there this unauthenticated path would amplify paid calls. The budget is
	// separate from verification (`guardianBegin` in `policy.ts`).
	await checkRateLimit("guardianBegin", row.id);

	// The authority receives the request id, not the token: the token is a bearer credential and must
	// not land in third-party logs, referrers or address bars.
	const started = await verifier.begin({
		requestId: row.id,
		returnUrl: input.returnUrl,
	});

	// Store the reference before handing the handoff to the screen: if the save failed after the
	// window opened, the guardian would finish but the server would not know what to look up.
	// Overwrite only while `pending`: retries after closing the window are common (a new reference is
	// issued), but a later attempt overwriting a confirmed request's reference would change what that
	// confirmation points at and make the audit trail lie.
	await db
		.update(guardian_consent)
		.set({ verification_ref: started.reference, updated_at: now })
		.where(
			and(
				eq(guardian_consent.id, row.id),
				eq(guardian_consent.status, "pending"),
			),
		);

	return started.handoff;
}

/**
 * Submits the verification result: `pending` to `verified`. The single conditional UPDATE is the
 * replay defence: a second submission hits 0 rows and never re-verifies an already verified request
 * (a later verification time would make the audit trail lie).
 */
export async function submitGuardianVerification(input: {
	token: string;
	now?: Date;
}): Promise<GuardianConsentViewDto> {
	const now = input.now ?? new Date();
	const row = await loadByToken(input.token, now);

	// Never went through begin: a verification submitted without opening the window. Answered with the
	// same sentence as `declined` (not completed).
	if (!row.verificationRef)
		throw new ApiError(
			400,
			GUARDIAN_ERROR_CODE.verificationFailed,
			"The identity verification wasn't completed.",
		);

	const verifier = requireVerifier();
	// Count after validating the request and right before the provider call. Counting the path token
	// first would let any string create a Redis/memory key, and the key count becomes a remote memory
	// exhaustion path. The row id is a fixed-length server-issued identity, and requests that never
	// began do not reach here, so one counter maps to one real paid call.
	await checkRateLimit("guardianVerify", row.id);

	// Ask again with the stored reference. A value from the request body is never used; that is this
	// procedure's channel binding, and why this function has no slot for a result.
	const outcome = await verifier.verify({
		requestId: row.id,
		reference: row.verificationRef,
	});

	if (!outcome.verified)
		throw new ApiError(
			400,
			GUARDIAN_ERROR_CODE.verificationFailed,
			outcome.reason === "declined"
				? "The identity verification wasn't completed."
				: "Guardian identity verification failed.",
		);

	// A non-adult cannot be a legal guardian. The authority confirming an identity does not make that
	// person eligible; without this a child could verify on their own phone and create their own
	// consent, turning the whole procedure into a formality.
	if (!outcome.adult)
		throw new ApiError(
			403,
			GUARDIAN_ERROR_CODE.verifierNotAdult,
			"A legal guardian must be an adult.",
		);

	await db
		.update(guardian_consent)
		.set({
			status: "verified",
			verification_method: VERIFICATION_METHOD,
			verification_provider: verifier.name,
			verification_ref: outcome.reference,
			guardian_name: outcome.name,
			guardian_contact: outcome.contact,
			verified_at: outcome.verifiedAt,
			updated_at: now,
		})
		.where(
			and(
				eq(guardian_consent.id, row.id),
				eq(guardian_consent.status, "pending"),
			),
		);

	// 0 rows is not an error: a concurrent second submission won, or the guardian verified twice.
	// Either way the current state is the answer.
	return readGuardianConsentView(input.token, now);
}

/**
 * Confirms consent. This function alone opens a child account. One transaction does two things:
 * 1. Revokes any previously valid consent; the partial unique index allows only one, and a
 *    re-consent would otherwise be blocked by it.
 * 2. Marks this request approved with a conditional UPDATE. A replay hits 0 rows and becomes a
 *    409.
 */
export async function submitGuardianConsent(input: {
	token: string;
	now?: Date;
}): Promise<GuardianConsentViewDto> {
	const now = input.now ?? new Date();
	const row = await loadByToken(input.token, now);

	if (row.status !== "verified") throw verificationRequired();

	await db.transaction(async (tx) => {
		await tx
			.update(guardian_consent)
			.set({ status: "revoked", revoked_at: now, updated_at: now })
			.where(and(activeConsent(row.memberId), ne(guardian_consent.id, row.id)));

		const [approved] = await tx
			.update(guardian_consent)
			.set({ status: "approved", consented_at: now, updated_at: now })
			.where(
				and(
					eq(guardian_consent.id, row.id),
					eq(guardian_consent.status, "verified"),
				),
			)
			.returning({ id: guardian_consent.id });
		if (!approved) throw alreadyResolved();
	});

	return readGuardianConsentView(input.token, now);
}

/** Same conditional UPDATE, different terminal state. */
export async function declineGuardianConsent(input: {
	token: string;
	now?: Date;
}): Promise<GuardianConsentViewDto> {
	const now = input.now ?? new Date();
	const row = await loadByToken(input.token, now);

	const [declined] = await db
		.update(guardian_consent)
		.set({ status: "declined", declined_at: now, updated_at: now })
		.where(
			and(
				eq(guardian_consent.id, row.id),
				sql`${guardian_consent.status} in ('pending', 'verified')`,
			),
		)
		.returning({ id: guardian_consent.id });
	if (!declined) throw alreadyResolved();

	return readGuardianConsentView(input.token, now);
}

/**
 * Revokes consent without deleting the row. the Korean Personal Information Protection Act arts. 22-2 and 37 presuppose withdrawal of
 * consent, not erasure of the record. Deleting would make "never consented" and "consented then
 * revoked" the same state, though they call for different next steps.
 *
 * The account sees the `guardian_consent_required` gate from the next request. Data is not erased
 * here: renewed consent must let the account continue, and destruction belongs to account deletion.
 *
 * No HTTP surface. Only the ops script (`guardian:revoke`) and tests call this. The requester is
 * the guardian, who has no account, and no stable reference exists to identify them again without
 * storing CI. Handling goes through the privacy policy's contact channel, which is more honest than
 * a self-service button that does not exist.
 */
export async function revokeGuardianConsent(input: {
	memberId: string;
	now?: Date;
}): Promise<boolean> {
	const now = input.now ?? new Date();
	const revoked = await db
		.update(guardian_consent)
		.set({ status: "revoked", revoked_at: now, updated_at: now })
		.where(activeConsent(input.memberId))
		.returning({ id: guardian_consent.id });
	return revoked.length > 0;
}

function requireVerifier(): IdentityVerificationProvider {
	const verifier = resolveIdentityVerifier();
	if (!verifier) throw verifierUnavailable();
	return verifier;
}
