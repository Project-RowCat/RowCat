import { eq } from "drizzle-orm";
import { auth } from "../auth/index.ts";
import { emailVerificationRequired, env } from "../env.ts";
import { newId } from "../lib/id.ts";
import { db } from "./client.ts";
import { member, user } from "./schema.ts";

/**
 * Creates a development account; runs only when invoked explicitly.
 *
 * ```bash
 * pnpm --filter @rowcat/api db:seed:dev-user                       # default account
 * pnpm --filter @rowcat/api db:seed:dev-user me@rowcat.test pw1234 # given email and password
 * ```
 *
 * What blocks local work is what comes after login, not login itself. Without Google credentials
 * the social button is off (`googleEnabled`), and an email-signup account passes neither identity
 * nor adult verification, so adult works can be neither published nor seen in the gallery. Those
 * two axes are set by the verification authority (`db/tables/member.ts`) and cannot be turned on
 * from the web; editing the DB directly is the only way, and every developer doing it differently
 * with psql leaves "works only on my local" states.
 *
 * So the script does three things: one account with known credentials, one member row with every
 * gate open (including managed generation), and the **email-verified flag**. Nothing more.
 *
 * ## Why the verified flag is set here
 *
 * In deployments that can send mail, ownership confirmation is required
 * (`emailVerificationRequired`), but this account's `.test` address receives nothing, so the
 * developer could not log in. Of the two ways out, the script sets DB state directly:
 *
 * ```text
 * HTTP back door   a dev verification route    stays open in a misconfigured deployment; not built
 * seed DB write    emailVerified = true        unreachable from the router; refuses to run in production
 * ```
 *
 * The back door is not built for the same reason there is no dev login route or `X-Dev-User`
 * header: that branch ships in production builds. The password hash is still made only inside the
 * Better Auth boundary; the boolean written here is the **result** of the verification step, not a
 * credential. To walk the real verification flow, start the server with `MAIL_TRANSPORT=dev` and
 * sign up normally; the link is printed to the server console (`services/mail/dev.ts`).
 *
 * ## No authentication bypass
 *
 * A dev login route or header back door would ship in production builds with one env variable as
 * the only guard, so one deployment-config mistake would disable authentication. This is an
 * ordinary email/password account, so its login path is the same as users' (if that path breaks, it
 * breaks here too, which is also information). The signup API is called instead of writing
 * `account.password` directly: imitating the scrypt parameters would break only this account the
 * day the library changes them.
 */

/** Default credentials. `.test` is not a real domain, so no mail can go out by mistake. */
const DEFAULT_EMAIL = "dev@rowcat.test";
/** Above Better Auth's minimum length (8); a shorter value makes signup fail silently. */
const DEFAULT_PASSWORD = "rowcat-dev";
const NICKNAME = "Developer";

/**
 * Gates this account opens: verified, adult, adult display, and the **managed generation
 * allowlist**. The last is needed so a local developer can try conversations with their own account
 * under the deployment default (`MANAGED_GENERATION_ACCESS=allowlist`); going through the console
 * toggle would require setting up an admin account first, the very hand-editing step this script
 * exists to remove.
 */
const DEV_GATES = {
	verified: true,
	adult: true,
	show_adult: true,
	managed_generation_allowed: true,
};

async function main(): Promise<void> {
	if (env.NODE_ENV === "production") {
		console.error(
			"[seed-dev-user] does not run in production — it would create an account with a known password in production",
		);
		process.exitCode = 1;
		return;
	}

	const email = process.argv[2] || DEFAULT_EMAIL;
	const password = process.argv[3] || DEFAULT_PASSWORD;

	const [existing] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, email))
		.limit(1);

	let userId: string;
	/** Whether this password can actually log in; decides whether the last line is printed. */
	let usable = true;
	if (existing) {
		userId = existing.id;
		/**
		 * An existing account's password is not overwritten (the developer may have changed it, or it may
		 * be social-only). It only checks whether the password works now; printing "done" without that
		 * check sends people hunting for why login fails.
		 */
		const signedIn = await auth.api
			.signInEmail({ body: { email, password } })
			.then(() => true)
			.catch(() => false);
		usable = signedIn;
		console.log(
			signedIn
				? "[seed-dev-user] the account already exists — this password signs in"
				: "[seed-dev-user] the account already exists but this password does not sign in (social-only, or a different password) — pass another email as the argument",
		);
	} else {
		const created = await auth.api.signUpEmail({
			body: { email, password, name: NICKNAME },
		});
		userId = created.user.id;
		console.log(`[seed-dev-user] created account user=${userId}`);
	}

	/**
	 * Member row: normally created by the first request (`auth/viewer.ts`), but here the gates must be
	 * on, so we create it. If it exists only the gates are raised; nickname and bio may have been
	 * changed on screen and the script does not revert them.
	 */
	const [row] = await db
		.insert(member)
		.values({ id: newId(), user_id: userId, nickname: NICKNAME, ...DEV_GATES })
		.onConflictDoUpdate({ target: member.user_id, set: DEV_GATES })
		.returning({ id: member.id, nickname: member.nickname });

	console.log(
		`[seed-dev-user] member member=${row?.id} (${row?.nickname}) verified·adult·show_adult·managed_generation_allowed on`,
	);

	/**
	 * Email-verified flag. This account's `.test` address cannot receive mail. Set even where
	 * verification is not required: a value that varies with deployment config brings back "works only
	 * on my local", and this flag opens nothing but login (not adult entitlement or member status).
	 */
	await db
		.update(user)
		.set({ emailVerified: true, updatedAt: new Date() })
		.where(eq(user.id, userId));
	console.log(
		emailVerificationRequired
			? "[seed-dev-user] marked the email verified — this deployment requires ownership verification, and no mail reaches a .test address"
			: "[seed-dev-user] marked the email verified (this deployment does not require it, but the value is not left to vary by deployment)",
	);

	/** Credentials that do not work are not printed as guidance; people would trust the line and get lost at the login screen. */
	if (usable) console.log(`[seed-dev-user] sign in: ${email} / ${password}`);
}

await main();
// The script must close the connection pool for the process to exit.
await db.$client.end();
