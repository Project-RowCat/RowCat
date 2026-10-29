import { MemberRole } from "@rowcat/contracts";
import { eq } from "drizzle-orm";
import { db } from "./client.ts";
import { member, user } from "./schema.ts";

/**
 * Grants an operations role: the only promotion path outside the product API.
 *
 * ```bash
 * pnpm --filter @rowcat/api db:seed:moderator dev@rowcat.test         # staff
 * pnpm --filter @rowcat/api db:seed:moderator dev@rowcat.test admin   # admin
 * pnpm --filter @rowcat/api db:seed:moderator dev@rowcat.test user    # revert
 * ```
 *
 * ## Why a script and not an API
 *
 * A route under `/me` that changes roles would let anyone make themselves an operator, whatever
 * gate guards it, since the code that guards and the code that breaks through share a surface.
 * Promotion is something a person does on the server, not deployed code, so this file is
 * unreachable from the router (§20).
 *
 * It does not bypass authentication either: it changes one column of an **existing account** and
 * never creates accounts or plants passwords (`db:seed:dev-user` creates accounts through the
 * ordinary signup path).
 *
 * Unlike `db:seed:dev-user`, it is not blocked under `NODE_ENV=production`: that script creates a
 * known-password account (a vulnerability in production), while this is the way production
 * operators must be set up. Blocking it would leave no way to appoint one, and someone would build
 * a temporary API.
 */

const [email, roleArg = "staff"] = process.argv.slice(2);

async function main(): Promise<void> {
	if (!email) {
		console.error(
			"[seed-moderator] usage: db:seed:moderator <email> [user|staff|admin]",
		);
		process.exitCode = 1;
		return;
	}

	/** The vocabulary belongs to the contract; relisting strings here would grow only one side. */
	const role = MemberRole.safeParse(roleArg);
	if (!role.success) {
		console.error(
			`[seed-moderator] unknown role: ${roleArg} (user|staff|admin)`,
		);
		process.exitCode = 1;
		return;
	}

	/**
	 * Email to auth account to member. The member row may be missing: members are created on the first
	 * request, not at signup (`auth/viewer.ts`), so an account that signed up and did nothing has
	 * none. It says what to do rather than inventing a row, which would add a second creation path
	 * beside `ensureMember`.
	 */
	const [account] = await db
		.select({ memberId: member.id, nickname: member.nickname })
		.from(user)
		.leftJoin(member, eq(member.user_id, user.id))
		.where(eq(user.email, email))
		.limit(1);

	if (!account) {
		console.error(`[seed-moderator] no account for that email: ${email}`);
		process.exitCode = 1;
		return;
	}
	if (!account.memberId) {
		console.error(
			"[seed-moderator] the account exists but has no member row yet — sign in with it once, then run again",
		);
		process.exitCode = 1;
		return;
	}

	await db
		.update(member)
		.set({ role: role.data })
		.where(eq(member.id, account.memberId));

	/** The email is not put back into logs; the member id is enough. */
	console.log(
		`[seed-moderator] changed member=${account.memberId} to role=${role.data}`,
	);
}

await main();
// The script must close the connection pool for the process to exit.
await db.$client.end();
