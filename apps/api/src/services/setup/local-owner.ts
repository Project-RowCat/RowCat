import { eq } from "drizzle-orm";
import { auth } from "../../auth/index.ts";
import { db } from "../../db/client.ts";
import { deployment_setup, member } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import { recordAudit } from "../admin/audit.ts";
import { SETUP_ROW_ID, setupCodeMatches } from "./index.ts";

/**
 * The local owner: a deployment used on one computer without signing in.
 *
 * ```text
 * claim-local   the setup code + a name → an account with no email and no password → admin → setup closes
 * sign-in       a browser on this computer, no session → a session for that account (auth/local-sign-in.ts)
 * ```
 *
 * **It is an ordinary member.** The local database scope, the sync namespace, BYO keys and every
 * gate key on the member id, and they keep doing so; "no login" is only that the session is handed
 * out instead of earned with a password. A second kind of identity (a member-less guest that owns
 * data) would be a fork of every one of those rules.
 *
 * **The address is a placeholder that can never receive mail** (`.invalid`, RFC 2606). Better Auth
 * requires one; inventing a deliverable-looking address would make password reset, email change and
 * verification mail act on a mailbox that does not exist — `.invalid` makes every one of them fail
 * at the transport, where nothing is sent. The account has no password, so nothing signs in with it.
 *
 * **It happens only at setup.** The claim closes setup in the same transaction, exactly like the
 * account claim, so a deployment that already has members can never be turned into one where whoever
 * sits at the server is its administrator.
 *
 * Order: the code is checked first (no account is made for a wrong code), the account is created
 * through Better Auth's own adapter, and the member, role, setup row and audit commit together. If
 * that transaction does not commit, the account it was for is deleted again — an orphan account with
 * no member would never be signed into, but it would hold a row nobody can explain.
 */

export type LocalClaimOutcome =
	| { outcome: "claimed"; memberId: string }
	| { outcome: "closed" }
	| { outcome: "invalid" };

/** The transaction found setup already closed; carried out of it so the account can be removed. */
class SetupClosed extends Error {}

export async function claimLocalOwner(input: {
	code: string;
	nickname: string;
}): Promise<LocalClaimOutcome> {
	const [row] = await db
		.select({
			salt: deployment_setup.salt,
			completedAt: deployment_setup.completed_at,
		})
		.from(deployment_setup)
		.where(eq(deployment_setup.id, SETUP_ROW_ID))
		.limit(1);
	if (!row || row.completedAt) return { outcome: "closed" };
	if (!setupCodeMatches(row.salt, input.code)) return { outcome: "invalid" };

	const context = await auth.$context;
	const user = await context.internalAdapter.createUser(
		{
			email: `${newId()}@local-owner.invalid`,
			name: input.nickname,
			emailVerified: false,
		},
		{ method: "local-owner" },
	);

	try {
		const memberId = await db.transaction(async (tx) => {
			const [locked] = await tx
				.select({ completedAt: deployment_setup.completed_at })
				.from(deployment_setup)
				.where(eq(deployment_setup.id, SETUP_ROW_ID))
				.for("update");
			/** Another claim committed between the check above and this lock. */
			if (!locked || locked.completedAt) throw new SetupClosed();

			const id = newId();
			await tx.insert(member).values({
				id,
				user_id: user.id,
				nickname: input.nickname,
				role: "admin",
			});
			await tx
				.update(deployment_setup)
				.set({
					completed_at: new Date(),
					completed_by: id,
					local_owner_id: id,
				})
				.where(eq(deployment_setup.id, SETUP_ROW_ID));
			await recordAudit(tx, {
				operatorId: id,
				action: "admin.setup.claim_local",
				targetType: "member",
				targetId: id,
				metadata: { before: null, after: "admin" },
			});
			return id;
		});
		return { outcome: "claimed", memberId };
	} catch (error) {
		await context.internalAdapter.deleteUser(user.id).catch(() => {});
		if (error instanceof SetupClosed) return { outcome: "closed" };
		throw error;
	}
}
