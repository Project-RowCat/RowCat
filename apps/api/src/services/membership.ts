import { declareAge } from "@rowcat/domain/membership";
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { member } from "../db/schema.ts";

/**
 * Age declaration: the only place the server sees a birth date, and it never stores it. The value
 * is dropped after folding into `age_status` (unknown → child | standard) and `age_threshold_date`
 * (children only: the day they turn 14).
 *
 * Basis is data minimization (Personal Information Protection Act Art. 16(1)). The only questions
 * to answer are whether guardian consent is needed now and when that ends; holding the date would
 * allow answering questions nobody needs answered, and that state invites leaks, demands and
 * misuse. Members 14 and over keep not even the transition date; the 19+ axis belongs to adult
 * verification.
 *
 * Re-declaring is allowed, including a correction that makes someone a child: typos happen, and an
 * account that cannot self-correct needs support to recover. Blocking only child → adult would trap
 * a child who mistyped. Stopping a child from re-declaring as adult is not this layer's job (it is
 * self-reported); age verification solves that, not a re-declaration ban.
 */

export type AgeDeclarationOutcome =
	| { status: "ok"; ageStatus: "child" | "standard" }
	| { status: "invalid"; reason: "malformed" | "future" | "implausible" }
	| { status: "gone" };

/**
 * Folds the birth date and records it on the member row. Not a transaction: one row changes and
 * nothing else belongs inside (no notification or ledger; a member's age declaration is private
 * state).
 *
 * Does not clear the three adult axes when the member becomes a child. The decision already
 * overrides them (`isChildViewer` in `lib/gates.ts`), and clearing would silently erase the adult
 * verification of someone who merely fixed a typo, a value the verification authority established,
 * not us.
 */
export async function declareMemberAge(input: {
	memberId: string;
	birthDate: string;
	now?: Date;
}): Promise<AgeDeclarationOutcome> {
	const now = input.now ?? new Date();
	const declaration = declareAge(input.birthDate, now);
	if (declaration.status === "invalid")
		return { status: "invalid", reason: declaration.reason };

	const [updated] = await db
		.update(member)
		.set({
			age_status: declaration.ageStatus,
			/** Reset to NULL at 14 or over: otherwise a member who went from child to adult keeps a birth-derived date, the very value this function exists to drop. */
			age_threshold_date: declaration.thresholdDate,
			age_recorded_at: now,
		})
		.where(eq(member.id, input.memberId))
		.returning({ id: member.id });

	// Concurrent account deletion; returned rather than thrown because the route maps it to a 404.
	if (!updated) return { status: "gone" };
	return { status: "ok", ageStatus: declaration.ageStatus };
}
