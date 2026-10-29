import type { AdminManagedGenerationResponse } from "@rowcat/contracts";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { member } from "../../db/schema.ts";
import { recordAudit } from "./audit.ts";

/**
 * The managed generation allowlist — **an operator setting one column of a member row.**
 *
 * In the public release, managed generation runs unmetered on the operator's provider key. The rate
 * limit bounds how much one person uses, and this column bounds **who uses it**: the decision is
 * made by `services/generation/access.ts` alone, and this file only moves the column.
 *
 * Same shape as the manual adult eligibility setting: it takes a target state, so it is naturally
 * idempotent, and the audit row stays even when nothing changes (it records that an operator tried).
 * It is not a sanction, so it does not go through the action ledger: not being allowed is not a
 * penalty but the fact that this deployment does not lend out the operator's key, and that member
 * keeps going with their own key (BYO).
 */
export interface AdminSetManagedGenerationInput {
	memberId: string;
	operatorId: string;
	allowed: boolean;
	reason: string;
}

/** Moves the allowed state to the target — `null` when there is no member (the route turns it into 404). */
export async function setManagedGenerationAsAdmin(
	input: AdminSetManagedGenerationInput,
): Promise<AdminManagedGenerationResponse | null> {
	return db.transaction(async (tx) => {
		const [current] = await tx
			.select({ allowed: member.managed_generation_allowed })
			.from(member)
			.where(eq(member.id, input.memberId))
			.for("update")
			.limit(1);
		if (!current) return null;

		const changed = current.allowed !== input.allowed;
		await recordAudit(tx, {
			operatorId: input.operatorId,
			action: "admin.member.managed_generation.set",
			targetType: "member",
			targetId: input.memberId,
			metadata: {
				reason: input.reason,
				before: current.allowed,
				after: input.allowed,
				changed,
			},
		});
		if (changed)
			await tx
				.update(member)
				.set({ managed_generation_allowed: input.allowed })
				.where(eq(member.id, input.memberId));

		return { memberId: input.memberId, allowed: input.allowed, changed };
	});
}
