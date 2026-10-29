import { eq } from "drizzle-orm";
import { revokeGuardianConsent } from "../services/guardian.ts";
import { db } from "./client.ts";
import { member, user } from "./schema.ts";

/**
 * Guardian consent revocation: the only revocation path outside the product API.
 *
 * Run as `pnpm --filter @rowcat/api guardian:revoke <email>`.
 *
 * Why a script and not an API: the person who can request revocation is the legal guardian, who has
 * no account and cannot be identified again without storing a linking value (CI). This slice does
 * not store one (`docs/membership/ARCHITECTURE.md` §7). A possession-based token would let anyone
 * who saw the consent link, including the child, lock the account. So revocation goes through the
 * deployment's contact channel, and this script performs it. the Korean Personal Information Protection Act art. 22-2
 * requires that revocation be possible, not that a button for it exist.
 *
 * What it does not do:
 * - Delete the account. Destruction is a separate decision, handled by account deletion
 *   (`services/account/deletion.ts`).
 * - Delete the consent record. It only fills `revoked_at`. Deleting would merge "never consented"
 *   with "consented then revoked", which need different next steps.
 * - Verify identity. The operator confirms the requester is the legal guardian before running
 *   this.
 *
 * After revocation the account sees the guardian consent gate from the next request. Data stays, so
 * it can be used again once consent is re-obtained.
 */

const [email] = process.argv.slice(2);

async function main(): Promise<void> {
	if (!email) {
		console.error("[guardian:revoke] usage: guardian:revoke <email>");
		process.exitCode = 1;
		return;
	}

	const [account] = await db
		.select({ memberId: member.id, ageStatus: member.age_status })
		.from(user)
		.leftJoin(member, eq(member.user_id, user.id))
		.where(eq(user.email, email))
		.limit(1);

	if (!account?.memberId) {
		console.error("[guardian:revoke] no member found for that email");
		process.exitCode = 1;
		return;
	}

	const revoked = await revokeGuardianConsent({ memberId: account.memberId });
	/** The email is not put back into logs; the member id is enough (same rule as `db:seed:moderator`). */
	console.log(
		revoked
			? `[guardian:revoke] member=${account.memberId} consent revoked — the guardian consent gate stands from the next request`
			: `[guardian:revoke] member=${account.memberId} has no valid consent to revoke`,
	);
}

await main();
// The script must close the connection pool for the process to exit.
await db.$client.end();
