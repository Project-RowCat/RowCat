import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { user } from "../db/schema.ts";

/**
 * Decides which event a verification mail belongs to. Better Auth's `sendVerificationEmail` is one
 * channel for two events — sign-up/resend (confirm the stored address) and email-change step two
 * (confirm a new, not yet stored address) — and each needs its own copy.
 *
 * - No module-level "change in progress" state: it dies with the process, diverges across
 *   replicas, and the truth is in the DB. The token is not parsed either — it is the library's
 *   signed format.
 * - Instead, compare with the stored address: in the change flow the library passes the new
 *   address (`user: { ...user, email: updateTo }`), so a difference means a change.
 * - A missing row errs toward "not a change": the worst case is slightly vaguer copy, whereas the
 *   reverse tells a new sign-up about an address change that never happened.
 */
export async function isNewAddressVerification(
	userId: string,
	target: string,
): Promise<boolean> {
	const [row] = await db
		.select({ email: user.email })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	if (!row) return false;
	return row.email.toLowerCase() !== target.toLowerCase();
}
