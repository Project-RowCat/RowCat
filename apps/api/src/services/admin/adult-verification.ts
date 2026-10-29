import type { AdminAdultVerificationResponse } from "@rowcat/contracts";
import type { AgeStatus } from "@rowcat/domain/membership";
import { isChildAge, resolveAgeStatus } from "@rowcat/domain/membership";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { member } from "../../db/schema.ts";
import { ApiError } from "../../lib/errors.ts";
import { recordAudit } from "./audit.ts";

/**
 * Manual adult-eligibility setting: the only operation where an operator sets two member axes
 * directly.
 *
 * Why `services/adult-verification.ts` is not reused: that file reflects a fact the verification
 * authority answered, while this reflects an operator's judgment, so one of its rules does not hold
 * here. There `verified` and `adult` only turn on and revocation is "operations' job"; in one file
 * that monotonicity would become an optional argument, and a path users can call themselves would
 * become a way to roll back identity state.
 *
 * No verification attempt row is created: `identity_verification` records that the authority
 * answered, and an operator granting an exception is not that, so a row would record as verified
 * something we did not verify. The only trace is one audit row (`admin.member.adult_verification`)
 * holding before, after and reason.
 *
 * Invariants kept here:
 * - no adult eligibility without identity verification: the contract blocks it and it is checked
 *   again right before the write
 * - cannot be turned on for a child: judged by the locked row's current age
 * - `show_adult` is untouched; it is the member's own choice
 * - audit comes with the write in one transaction, so a failed write leaves no record
 * - requesting the same state again succeeds, since the target state is received (idempotent)
 *
 * Suspension and restriction are absent for the reason `services/admin/members.ts` is read-only:
 * those enforcements must pass through `executeAction` to keep the action ledger and
 * `member.status` aligned, and this is an eligibility state, not a sanction, so there is no case to
 * appeal.
 */

export interface AdminSetAdultVerificationInput {
	memberId: string;
	operatorId: string;
	verified: boolean;
	adult: boolean;
	reason: string;
	now?: Date;
}

/**
 * Moves adult eligibility to the target state; `null` if the member is missing (the route makes it
 * a 404).
 *
 * The member row is locked and its current value read before judging. The route checks existence
 * first, but a deletion or age re-declaration can arrive between that read and this write, and a
 * judgment in an irreversible direction must be made again in the write's own transaction
 * (`services/adult-verification.ts` locks the same row for the same reason).
 */
export async function setAdultVerificationAsAdmin(
	input: AdminSetAdultVerificationInput,
): Promise<AdminAdultVerificationResponse | null> {
	const now = input.now ?? new Date();

	return db.transaction(async (tx) => {
		const [current] = await tx
			.select({
				verified: member.verified,
				adult: member.adult,
				showAdult: member.show_adult,
				storedAgeStatus: member.age_status,
				ageThresholdDate: member.age_threshold_date,
			})
			.from(member)
			.where(eq(member.id, input.memberId))
			.for("update")
			.limit(1);
		if (!current) return null;

		/**
		 * Re-checks the combination the contract blocks. The contract's `refine` applies only to requests
		 * through this server's route, and an operations script may call this later; adult eligibility
		 * without identity verification lacks the first half of the legal requirement and must not arise
		 * by any path.
		 */
		if (input.adult && !input.verified)
			throw new ApiError(
				400,
				"invalid_input",
				"You can't turn on adult eligibility alone without identity verification.",
			);

		const ageStatus = resolveAgeStatus({
			stored: current.storedAgeStatus as AgeStatus,
			thresholdDate: current.ageThresholdDate,
			now,
		});
		/**
		 * Cannot be turned on for a child: the rule that age dominates the three adult axes outranks an
		 * operator's judgment, since that combination opening is irreversible. Turning off is not blocked
		 * (no reason to except an operation that reduces eligibility).
		 */
		if ((input.verified || input.adult) && isChildAge(ageStatus))
			throw new ApiError(
				403,
				"minor_adult_restricted",
				"Adult eligibility can't be granted to members under 14.",
			);

		const changed =
			current.verified !== input.verified || current.adult !== input.adult;

		/**
		 * Audit is written even when nothing changed: it records that an operator actually attempted the
		 * operation and answers who looked at this account's adult eligibility, like a grant that leaves
		 * the ledger untouched yet is still audited.
		 */
		await recordAudit(tx, {
			operatorId: input.operatorId,
			action: "admin.member.adult_verification",
			targetType: "member",
			targetId: input.memberId,
			metadata: {
				reason: input.reason,
				/** Previous state; without it the audit line cannot say from what to what. */
				before: { verified: current.verified, adult: current.adult },
				after: { verified: input.verified, adult: input.adult },
				changed,
			},
		});

		if (changed)
			await tx
				.update(member)
				/** No `show_adult` in this statement: the display opt-in is the member's choice, and without eligibility adult content stays closed even if it is true. */
				.set({ verified: input.verified, adult: input.adult })
				.where(eq(member.id, input.memberId));

		return {
			memberId: input.memberId,
			verified: input.verified,
			adult: input.adult,
			showAdult: current.showAdult,
			changed,
		};
	});
}
