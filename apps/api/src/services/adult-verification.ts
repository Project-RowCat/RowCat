import {
	ADULT_VERIFICATION_ERROR_CODE,
	type IdentityVerificationHandoff,
} from "@rowcat/contracts";
import type { AgeStatus } from "@rowcat/domain/membership";
import { isChildAge, resolveAgeStatus } from "@rowcat/domain/membership";
import { and, desc, eq } from "drizzle-orm";
import { type Db, db } from "../db/client.ts";
import { identity_verification, member } from "../db/schema.ts";
import { ApiError } from "../lib/errors.ts";
import { newId } from "../lib/id.ts";
import {
	type IdentityVerificationProvider,
	resolveIdentityVerifier,
} from "./identity/provider.ts";

/** The transaction handle the caller passes in: the exact type drizzle gives its callback. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Adult eligibility: the consumer that attaches the judgment "19 or older" to the
 * identity-verification capability.
 *
 * - The browser's success is not evidence. The server asks the authority again with its own
 *   secret.
 * - The client cannot choose the target. The only attempt is the member's single open one.
 * - Verified is not adult. Under 19 is a normal success that turns on only `verified`. Without a
 *   birth date from the authority, `adult` stays false.
 * - Children cannot use this flow, and age status takes precedence over the three adult axes.
 * - A replay changes nothing: one conditional UPDATE makes the second call a no-op.
 * - Entitlements are monotone: `verified` and `adult` only turn on. Revocation is an operator
 *   matter with no operation here.
 * - `show_adult` is never touched. Completing verification must not switch adult content on.
 *
 * This file does not reuse `services/guardian.ts`, though both use the same capability
 * (`services/identity/`). Sharing would let a verification completed by a guardian open a child's
 * adult entitlement. So this file imports nothing about guardian consent, and the tables are
 * separate (`identity_verification` vs `guardian_consent`).
 *
 * Nothing about the verified identity (name, contact, birth date, CI, DI) is stored. The only
 * questions are whether verification completed and whether the person was 19 or older then, and
 * neither needs an identity. Guardian consent does keep name and contact, because the Korean
 * Personal Information Protection Act art. 22-2(2) names them as the minimum data.
 *
 * The authority's answer is evidence only. Entitlement is decided from current server state,
 * re-read inside a transaction that locks the member row, because the account may have become a
 * child or been deleted while the verification window was open.
 */

/**
 * Attempt lifetime: 30 minutes. Shorter than the guardian link (24h) because nobody is waited for
 * here; longer than device pairing (5 min) because mobile redirect round trips take minutes. Not
 * unbounded, because the row means "the attempt open right now": without expiry a stale attempt
 * would be superseded by every new start and the audit trail would read as continuous retrying.
 */
export const ADULT_VERIFICATION_TTL_MS = 30 * 60 * 1000;

/**
 * The attempt's purpose. Only one value exists but it is kept in every predicate so that, once a
 * second consumer uses this table, an attempt made for another purpose is never consumed here (see
 * the table header).
 */
const PURPOSE = "adult_eligibility";

const verifierUnavailable = () =>
	new ApiError(
		503,
		ADULT_VERIFICATION_ERROR_CODE.unavailable,
		"Identity verification isn't available.",
	);
const attemptNotFound = () =>
	new ApiError(
		404,
		ADULT_VERIFICATION_ERROR_CODE.notFound,
		"There is no identity verification in progress.",
	);
const attemptExpired = () =>
	new ApiError(
		410,
		ADULT_VERIFICATION_ERROR_CODE.expired,
		"The identity verification has expired.",
	);
const attemptConflict = () =>
	new ApiError(
		409,
		ADULT_VERIFICATION_ERROR_CODE.conflict,
		"This identity verification already finished or was replaced by another attempt.",
	);
const notCompleted = () =>
	new ApiError(
		400,
		ADULT_VERIFICATION_ERROR_CODE.notCompleted,
		"The identity verification wasn't completed.",
	);
const providerFailed = () =>
	new ApiError(
		400,
		ADULT_VERIFICATION_ERROR_CODE.providerFailed,
		"Identity verification failed.",
	);

function requireVerifier(): IdentityVerificationProvider {
	const verifier = resolveIdentityVerifier();
	if (!verifier) throw verifierUnavailable();
	return verifier;
}

export interface AdultVerificationStarted {
	handoff: IdentityVerificationHandoff;
	expiresAt: Date;
}

/**
 * Starts verification; a previously open attempt is superseded.
 *
 * Closing and reopening the window is common, and rejecting with "already in progress" would leave
 * the person stuck until expiry. Always having exactly one open attempt also removes the need to
 * ask "which attempt" on the completion path.
 *
 * The member row is locked so two tabs starting at the same instant cannot both close the old
 * attempt and both create a new one. The partial unique index is the final authority; the lock
 * turns that conflict into ordering instead of a 500.
 *
 * With no verifier configured no attempt is created (503): the user would wait for a window and the
 * server would keep a row pointing at nothing.
 *
 * The child decision is not made here: the route gate (`requireNonChild`) owns it and the
 * completion path re-checks inside its transaction.
 */
export async function beginAdultVerification(input: {
	memberId: string;
	/** Return address after verification; built by the server to prevent open redirects. */
	returnUrl: string;
	now?: Date;
}): Promise<AdultVerificationStarted> {
	const verifier = requireVerifier();
	const now = input.now ?? new Date();
	const expiresAt = new Date(now.getTime() + ADULT_VERIFICATION_TTL_MS);
	const attemptId = newId();

	await db.transaction(async (tx) => {
		/** Serialization point for the one-open-attempt-per-member rule. A missing member is stopped by the FK on the INSERT below. */
		await tx
			.select({ id: member.id })
			.from(member)
			.where(eq(member.id, input.memberId))
			.for("update")
			.limit(1);

		/**
		 * Closes the open attempt as `superseded`, not `failed`: an authority rejection and a user
		 * restart are different facts, and writing the former here would falsify the audit trail.
		 */
		await tx
			.update(identity_verification)
			.set({ status: "superseded", updated_at: now })
			.where(
				and(
					eq(identity_verification.member_id, input.memberId),
					eq(identity_verification.purpose, PURPOSE),
					eq(identity_verification.status, "pending"),
				),
			);

		await tx.insert(identity_verification).values({
			id: attemptId,
			member_id: input.memberId,
			purpose: PURPOSE,
			status: "pending",
			provider: verifier.name,
			requested_at: now,
			expires_at: expiresAt,
			created_at: now,
			updated_at: now,
		});
	});

	/**
	 * Only our attempt id goes to the authority, never a session token or member id: whoever saw such
	 * a value in a third party's logs or referrers would own that procedure.
	 */
	const started = await verifier.begin({
		requestId: attemptId,
		returnUrl: input.returnUrl,
	});

	/**
	 * The reference is stored before the handoff goes to the screen; if the save failed but the window
	 * opened, the user would finish verification and the server would not know what to query.
	 *
	 * Written only while `pending`. If another tab superseded this attempt the UPDATE hits 0 rows and
	 * this window's completion falls to "not completed", so a superseded attempt is never revived by
	 * planting a reference.
	 */
	await db
		.update(identity_verification)
		.set({ provider_ref: started.reference, updated_at: now })
		.where(
			and(
				eq(identity_verification.id, attemptId),
				eq(identity_verification.status, "pending"),
			),
		);

	return { handoff: started.handoff, expiresAt };
}

/**
 * The route does not emit this value: the screen receives the confirmed viewer (`toViewerDto`),
 * which already carries `verified` and `adult`. Two shapes for one fact would leave each screen
 * unsure which is authoritative.
 */
export interface AdultVerificationApplied {
	/** Whether this verification actually changed state; false for a replay or an already-entitled member. */
	changed: boolean;
}

interface AttemptRow {
	id: string;
	status: string;
	providerRef: string | null;
	expiresAt: Date;
}

/**
 * The member's most recent attempt; the only entry point of the completion path. Purpose and member
 * are fixed in the predicate, so a request naming someone else's attempt or consuming a
 * verification made for another purpose has no argument to express it.
 */
async function loadLatestAttempt(memberId: string): Promise<AttemptRow | null> {
	const [row] = await db
		.select({
			id: identity_verification.id,
			status: identity_verification.status,
			providerRef: identity_verification.provider_ref,
			expiresAt: identity_verification.expires_at,
		})
		.from(identity_verification)
		.where(
			and(
				eq(identity_verification.member_id, memberId),
				eq(identity_verification.purpose, PURPOSE),
			),
		)
		.orderBy(desc(identity_verification.requested_at))
		.limit(1);
	return row ?? null;
}

/**
 * Applies the verification result to the member's entitlement; this function alone opens adult
 * eligibility.
 *
 * The browser can only say "finished": the input has no result, no verification id, not even an
 * attempt id. The server queries the authority with the reference it stored and trusts only that
 * answer.
 *
 * The three outcomes are different facts:
 * - declined: not finished yet; the attempt stays `pending` and can be retried.
 * - failed: the authority could not verify; the attempt is closed (audit record).
 * - verified: turns on `verified`, and `adult` too if 19 or older.
 *
 * Verified but under 19 is not a failure; telling that person "verification failed" would make them
 * suspect their device or carrier when nothing is wrong.
 *
 * `verified` and `adult` only turn on. A failure does not clear an already verified account (failed
 * means "not verified", not "revoked"), and a later minor verification does not roll back adult
 * entitlement; otherwise a user-invokable operation could change identity state unpredictably.
 *
 * `show_adult` never appears in this transaction: completing verification and choosing to view
 * adult content are different decisions.
 */
export async function completeAdultVerification(input: {
	memberId: string;
	now?: Date;
}): Promise<AdultVerificationApplied> {
	const verifier = requireVerifier();
	const now = input.now ?? new Date();

	const attempt = await loadLatestAttempt(input.memberId);
	if (!attempt) throw attemptNotFound();

	/**
	 * A replay is not an error: a retry from a browser that lost its response is the normal path. An
	 * already applied attempt is not applied again; the current state is the answer.
	 */
	if (attempt.status === "verified") return { changed: false };
	if (attempt.status !== "pending") throw attemptConflict();
	if (attempt.expiresAt.getTime() <= now.getTime()) throw attemptExpired();
	/**
	 * The start step was never completed: either completion was submitted without opening the window,
	 * or another tab superseded this attempt before a reference was planted. There is nothing to
	 * query.
	 */
	if (!attempt.providerRef) throw notCompleted();

	const outcome = await verifier.verify({
		requestId: attempt.id,
		reference: attempt.providerRef,
	});

	if (!outcome.verified) {
		/**
		 * `declined` does not close the attempt: the user closed the window or has not finished, and must
		 * be able to retry the same attempt. Only `failed` closes it, because that fact belongs in the
		 * audit record.
		 */
		if (outcome.reason === "failed")
			await db
				.update(identity_verification)
				.set({ status: "failed", updated_at: now })
				.where(
					and(
						eq(identity_verification.id, attempt.id),
						eq(identity_verification.status, "pending"),
					),
				);
		throw outcome.reason === "declined" ? notCompleted() : providerFailed();
	}

	return db.transaction(async (tx) => {
		/**
		 * Decides from the member's current state: the account may have become a child, already gained
		 * entitlement or been deleted while the window was open.
		 */
		const [current] = await tx
			.select({
				verified: member.verified,
				adult: member.adult,
				storedAgeStatus: member.age_status,
				ageThresholdDate: member.age_threshold_date,
			})
			.from(member)
			.where(eq(member.id, input.memberId))
			.for("update")
			.limit(1);
		/** Deleted at the same moment; the route maps this to 404. */
		if (!current) throw attemptNotFound();

		const ageStatus = resolveAgeStatus({
			stored: current.storedAgeStatus as AgeStatus,
			thresholdDate: current.ageThresholdDate,
			now,
		});
		/**
		 * Never applied to a child. The route gate already checked, but it saw the viewer at request
		 * start and an account can re-declare its age while the window is open. An irreversible decision
		 * is repeated in the same transaction as the write.
		 */
		if (isChildAge(ageStatus))
			throw new ApiError(
				403,
				"minor_adult_restricted",
				"Members under 14 can't use adult content.",
			);

		/** Consumes the attempt; this conditional UPDATE is the replay defence (a concurrent second request gets 0 rows). */
		const [consumed] = await tx
			.update(identity_verification)
			.set({
				status: "verified",
				adult: outcome.adult,
				/** The authority's clock; stamping our own would not be evidence. */
				verified_at: outcome.verifiedAt,
				consumed_at: now,
				updated_at: now,
			})
			.where(
				and(
					eq(identity_verification.id, attempt.id),
					eq(identity_verification.status, "pending"),
				),
			)
			.returning({ id: identity_verification.id });
		if (!consumed) return { changed: false };

		/** Monotone: overwriting `adult` with `outcome.adult` would let a later minor verification revoke confirmed adult entitlement (see header). */
		const nextVerified = true;
		const nextAdult = current.adult || outcome.adult;
		const changed =
			current.verified !== nextVerified || current.adult !== nextAdult;

		/** Skips the write when nothing changed; the attempt row already records that the verification happened. */
		if (changed)
			await tx
				.update(member)
				.set({ verified: nextVerified, adult: nextAdult })
				.where(eq(member.id, input.memberId));

		return { changed };
	});
}

/**
 * Account deletion cleanup: removes the member's verification attempts. The FK cascade would do it
 * anyway; it is called explicitly so what gets deleted is visible in code (the
 * `services/account-deletion.ts` rule). It matters more here: an open attempt dies here, so a
 * completion request arriving right after deletion has no row to point at.
 */
export async function purgeIdentityVerifications(
	tx: Tx,
	memberId: string,
): Promise<number> {
	const purged = await tx
		.delete(identity_verification)
		.where(eq(identity_verification.member_id, memberId))
		.returning({ id: identity_verification.id });
	return purged.length;
}
