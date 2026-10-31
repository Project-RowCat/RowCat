import { expo } from "@better-auth/expo";
import { passkey as passkeyPlugin } from "@better-auth/passkey";
import { PASSWORD_LENGTH } from "@rowcat/contracts";
import { APP_BUNDLE_ID, APP_NAME } from "@rowcat/domain";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { twoFactor as twoFactorPlugin } from "better-auth/plugins/two-factor";
import { db } from "../db/client.ts";
import {
	account,
	passkey,
	session,
	twoFactor,
	user,
	verification,
} from "../db/schema.ts";
import {
	appleSignIn,
	appleSignInEnabled,
	emailVerificationRequired,
	env,
	googleEnabled,
	isProduction,
	kakaoEnabled,
	passwordResetEnabled,
	publicApiUrl,
	trustedOrigins,
	webauthnConfig,
} from "../env.ts";
import { createAppleClientSecretSigner } from "../lib/apple-signin-config.ts";
import { AUTH_CLIENT_IP_HEADER } from "../lib/client-ip.ts";
import { getRedis } from "../lib/redis.ts";
import { deleteAccountForUser } from "../services/account/deletion.ts";
import {
	MailDeliveryError,
	sendTransactionalMail,
	type TransactionalMail,
} from "../services/mail/index.ts";
import { enforceAccountDeletionPolicy } from "./account-deletion-policy.ts";
import { findAuthUser } from "./auth-user.ts";
import { localSignInPlugin } from "./local-sign-in.ts";
import { enforcePasswordResetTarget } from "./password-reset-policy.ts";
import { createRedisAuthRateLimitStorage } from "./rate-limit-storage.ts";
import {
	withAppleAuthOrigin,
	withNativeAuthOrigin,
} from "./trusted-origins.ts";
import { enforceTwoFactorPolicy } from "./two-factor-policy.ts";
import { isNewAddressVerification } from "./verification-target.ts";

/**
 * Auth, moved from the legacy Next.js app into the API. The web has no server of its own, so this
 * is the only place sessions are verified. Better Auth's handler is mounted on `/v2/auth/*` as-is;
 * OAuth callback, state, PKCE and cookie signing are not worth hand-writing.
 *
 * Five sign-in methods (credentials, Google, Apple, Kakao, passkey) all end in the same Better Auth
 * user and session. Product identity is resolved from `user.id` by `auth/viewer.ts`, so nothing
 * outside this file sees which method was used. Passkeys live in their own table
 * (`db/tables/passkey.ts`) because one account can hold several, so they cannot be a
 * `LoginMethodProvider` value.
 *
 * - Kakao alone does not guarantee an email; see the provider block below.
 * - Apple alone calls back with a cross-site POST (`response_mode=form_post`). The library's
 *   callback handler bounces it into a GET at the same address; the only addition here is trusting
 *   that POST's origin (`trusted-origins.ts`).
 * - The mail transport (`services/mail/`) enables email-ownership verification, email change,
 *   passkey notices and password reset, each only where a transport exists.
 *
 * Not carried over from legacy: Redis secondaryStorage. It adds infrastructure for one axis of
 * session lookup; `session_token_idx` is enough until it is not.
 */

/**
 * Returns the current Apple `client_secret`. On a deployment without Apple the provider block is
 * not registered, so this is unreachable; it throws to catch an accidental call.
 */
const appleClientSecret = appleSignIn
	? createAppleClientSecretSigner(appleSignIn)
	: () => {
			throw new Error(
				"Sign in with Apple is not configured in this deployment — the provider is not registered, so this can't be reached",
			);
		};

/**
 * `null` when Redis is not configured; the limiter then falls back to the library's in-memory
 * default.
 */
const authRateLimitRedis = getRedis();

/**
 * Sends a mail without making the response wait for it. Every sender whose response must not say
 * whether an address is registered goes through here: sign-up and verification resend (an existing
 * or unknown address gets the same answer and no mail), email change (an address in use gets the
 * same answer and no mail), password reset (an unknown address gets the same answer and no mail).
 * Awaiting SMTP in those senders made **response time** answer the question the sentence hides: the
 * branch that sends waits a mail round trip, the one that does not returns at once.
 *
 * The price is the one password reset already paid: a send failure is a log line (no address, no
 * URL, no body), never the response, so a resend button draws success even when the transport is
 * down. `env:doctor` and the boot log are where a broken transport shows.
 */
function sendWithoutWaiting(mail: TransactionalMail, what: string): void {
	void sendTransactionalMail(mail).catch((error: unknown) => {
		const delivery = error instanceof MailDeliveryError ? error : null;
		console.warn(`[auth] failed to send the ${what}`, {
			errorName: error instanceof Error ? error.name : "Error",
			code: delivery?.code ?? null,
			responseCode: delivery?.responseCode ?? null,
			scope: delivery?.scope ?? null,
		});
	});
}

export const auth = betterAuth({
	appName: APP_NAME,
	// Base for callback URLs; `/v2/auth` is the mount point inside this API.
	baseURL: `${publicApiUrl}/auth`,
	secret: env.BETTER_AUTH_SECRET || undefined,
	database: drizzleAdapter(db, {
		provider: "pg",
		// Explicit model-to-table map: passing the whole schema lets the adapter guess by name and
		// mistake tables such as `member` for auth models.
		schema: { user, session, account, verification, passkey, twoFactor },
	}),
	/**
	 * Redirects after sign-in never leave this list (open-redirect defence). It differs from the
	 * browser CORS list (`corsOrigins`): the native app's `rowcat://` is here and not there
	 * (`trusted-origins.ts` header).
	 */
	trustedOrigins: withAppleAuthOrigin(
		withNativeAuthOrigin(trustedOrigins),
		appleSignInEnabled,
	),
	/**
	 * Expo native client. The server's share is three things:
	 * 1. Native requests carry no `Origin`. The plugin moves the client's `expo-origin` into
	 *    `origin`, so `trustedOrigins` runs through the same code as the web (no native-only CSRF
	 *    bypass).
	 * 2. Relay to the OAuth authorization URL (`/expo-authorization-proxy`), because native has no
	 *    place to plant the `state` cookie.
	 * 3. When the callback redirects to a custom scheme, `Set-Cookie` rides in that URL's query,
	 *    the only way the app can move the cookie into SecureStore.
	 *
	 * No second auth backend on the Expo side: two Better Auth instances would mean two signing keys
	 * and two trust lists, and the looser one becomes the real policy. The plugin adds `exp://` itself
	 * only in development; production adds nothing, and why we do not write it by hand is in the
	 * `trusted-origins.ts` header.
	 */
	plugins: [
		expo(),
		/**
		 * Passkeys. The WebAuthn protocol is the plugin's; we decide only which domain's ceremony to
		 * trust (rpID and origin), validated at boot by `env.ts`.
		 *
		 * - The defaults are wrong here: the plugin derives rpID from `baseURL`'s host (the API domain)
		 *   and takes the verification origin from the request's `Origin` header. The ceremony happens on
		 *   the web origin, so a mismatched rpID makes the browser refuse registration, and a non-browser
		 *   client can put anything in `Origin`, which voids WebAuthn's origin binding.
		 * - Passkeys never create accounts: `registration.requireSession` stays at its default (true).
		 *   As a side effect the plugin requires a fresh session to issue registration options
		 *   (`freshSessionMiddleware`), which stops one stolen cookie from becoming a permanent login
		 *   method, so do not disable `freshAge`.
		 * - The registration notice is not sent from `afterVerification`: that hook runs before the
		 *   credential row is stored, so a failed save would still say "added". `hooks.after` below sends
		 *   it.
		 */
		passkeyPlugin({
			rpID: webauthnConfig.rpId,
			rpName: webauthnConfig.rpName,
			origin: webauthnConfig.origins,
		}),
		/**
		 * Two-factor auth. TOTP, backup codes, the challenge cookie and failure lockout are the plugin's;
		 * ours are the options below and the door rules in `two-factor-policy.ts`.
		 *
		 * - It guards the password door only: the challenge stands behind `/sign-in/email`. Social and
		 *   passkey sign-in are not challenged because they are already a factor other than the password,
		 *   and what this stops is a leaked password. The screens state that scope.
		 * - `allowPasswordless` stays off: an account with no password has no door to guard, and
		 *   "enabled" there would be false.
		 * - No `otpOptions`: email/SMS OTP means another mail, and a deployment's privacy policy may
		 *   close the list of mails the company sends.
		 * - Enabling returns ten backup codes. The screen asks for confirmation that they were written
		 *   down before it asks for the authenticator's first code, and the account turns on only when
		 *   that code verifies, so an account enabled without backup codes is not representable. Each
		 *   code works once; ten new ones can be generated with the password, which kills the old ones.
		 *   Plaintext appears only in those two responses.
		 */
		/**
		 * The local owner's password-less sign-in (`local-sign-in.ts`). Harmless on a deployment that
		 * was set up with an account: with no local owner it answers 404, and `app.ts` refuses it before
		 * the library for any request that is not from this computer.
		 */
		localSignInPlugin(),
		twoFactorPlugin({
			issuer: APP_NAME,
			skipVerificationOnEnable: false,
			backupCodeOptions: {
				amount: 10,
				length: 10,
				storeBackupCodes: "encrypted",
			},
		}),
	],
	/**
	 * Social providers: only configured ones are registered. An unconfigured provider would give the
	 * user Better Auth's own error text; unregistered, the API answers a "provider not found" 400 that
	 * the screen translates into its own sentence.
	 */
	socialProviders: {
		...(googleEnabled
			? {
					google: {
						clientId: env.GOOGLE_CLIENT_ID,
						clientSecret: env.GOOGLE_CLIENT_SECRET,
					},
				}
			: {}),
		/**
		 * Apple's config shape differs from Google's: there is no secret to paste. The token endpoint
		 * wants a short-lived JWT we sign with the `.p8` key, and the library reads `clientSecret` at
		 * request time, so an accessor makes expiry unrepresentable. A string built at boot would make
		 * Apple sign-in alone fail months after deploy in a long-lived process. This works because
		 * signing is synchronous (`crypto.sign`).
		 *
		 * `appBundleIdentifier` is the audience for native sign-in. The token's `aud` differs per path:
		 *
		 * ```text
		 * browser round trip   aud = Services ID   the web's clientId is that value
		 * native sheet         aud = bundle id
		 * ```
		 *
		 * The library's apple provider folds both into one slot (`audience = options.audience ??
		 * options.appBundleIdentifier ?? options.clientId`, `social-providers/apple.mjs` in
		 * `@better-auth/core`), so without this line native tokens always fail verification and only
		 * Apple sign-in breaks. Only the id-token path reads it (`oauth2/verify-id-token.mjs`); the
		 * browser round trip is unchanged.
		 *
		 * Not an env var: a bundle id is not secret and cannot change after registration (changing it is
		 * a store product migration), so a knob only makes a deployment with a wrong value representable.
		 * Read `APP_BUNDLE_ID` from `@rowcat/domain` instead of restating it here.
		 */
		...(appleSignIn
			? {
					apple: {
						clientId: appleSignIn.clientId,
						get clientSecret() {
							return appleClientSecret();
						},
						appBundleIdentifier: APP_BUNDLE_ID,
					},
				}
			: {}),
		/**
		 * Kakao is close to Google; the difference is one consent item.
		 *
		 * - Scope is narrowed. The default is `account_email`, `profile_nickname`, `profile_image`. The
		 *   last is dropped because nothing reads it: Better Auth stores the URL in `user.image` and no
		 *   code here reads that column (avatars come from the media pipeline and legacy
		 *   `member.avatar_url`). Keeping it would add a consent item we cannot explain and unread
		 *   personal data (Korean PIPA data-minimisation principle, Article 3(1)). There is no syntax to
		 *   remove an item from the default list, so `disableDefaultScope` plus re-listing the two is the
		 *   method.
		 * - Email is not guaranteed and we do not work around it. `account_email` is optional consent;
		 *   when refused, Better Auth creates no account and returns `email_not_found`
		 *   (`api/routes/callback.mjs`). Inventing a synthetic address (`<kakao id>@kakao.local`) would
		 *   put email verification, email change and password setup on an unproven address, and mail sent
		 *   there goes nowhere. The web has its own sentence for that failure
		 *   (`features/auth/social-sign-in.ts`).
		 * - The Client Secret is passed only when set. It is an optional console setting, so
		 *   `undefined` is valid, and an empty string would send `client_secret=` on the token request.
		 */
		...(kakaoEnabled
			? {
					kakao: {
						clientId: env.KAKAO_REST_API_KEY,
						...(env.KAKAO_CLIENT_SECRET
							? { clientSecret: env.KAKAO_CLIENT_SECRET }
							: {}),
						disableDefaultScope: true,
						scope: ["account_email", "profile_nickname"],
					},
				}
			: {}),
	},
	/**
	 * Email ownership verification uses Better Auth's built-in flow, with no token table of our own:
	 * link validation (expiry, reuse, subject matching) is the kind of code that is wrong when
	 * hand-written.
	 *
	 * The `callbackURL` in the link is client-supplied, but opening the link runs `originCheck`
	 * against `trustedOrigins`. Leaving that check on (`disableOriginCheck: false` below) is this
	 * slice's whole open-redirect defence.
	 */
	emailVerification: {
		/**
		 * Sending only; the copy is chosen by a typed event (`services/mail/templates.tsx`). No token or
		 * URL goes in logs: a failure is one line with the transport's error code, which carries no
		 * address or body (`services/mail/smtp.ts`), and the response does not wait for it
		 * (`sendWithoutWaiting`).
		 *
		 * Tokens carrying `updateTo` (step 2 of email change) also arrive here, with `user.email` already
		 * switched to the new address by the library, so the recipient is always that value. Only the
		 * copy forks: a new signup and someone moving addresses must not get the same sentence.
		 */
		sendVerificationEmail: async ({ user: target, url }) => {
			/** Not awaited, including the lookup: see `sendWithoutWaiting`. */
			void isNewAddressVerification(target.id, target.email).then(
				(movingAddress) =>
					sendWithoutWaiting(
						{
							kind: movingAddress ? "verify-new-email" : "verify-email",
							to: { email: target.email, name: target.name },
							url,
						},
						"verification mail",
					),
				() => {
					console.warn("[auth] failed to read the verification target");
				},
			);
		},
		/**
		 * Sending right after signup follows `requireEmailVerification`. Hardcoding `true` here would
		 * send links that lock nothing on deployments that do not require verification.
		 */
		/**
		 * Sign-in re-sends the verification mail: the migration path for existing unverified accounts
		 * when a deployment turns verification on. Bulk-setting `emailVerified = true` would record a
		 * fact we never verified.
		 *
		 * This branch is reached only after the password is verified, so the response revealing
		 * "unverified" is not a member-lookup oracle: seeing it requires already knowing that account's
		 * password.
		 */
		sendOnSignIn: true,
		/**
		 * No automatic sign-in on opening the link: the mailbox opens on other devices, possibly a shared
		 * PC. Verification proves ownership, not intent to sign in.
		 */
		autoSignInAfterVerification: false,
	},

	emailAndPassword: {
		enabled: true,
		/**
		 * Email/password uses Better Auth's built-in authenticator (scrypt hashing, credential check,
		 * session issuance). The password exists only inside that library boundary (`account.password`);
		 * neither the member table nor `@rowcat/contracts` knows it.
		 *
		 * The length policy comes from one contract value (`PASSWORD_LENGTH`), shared with the signup and
		 * change-password forms. With separate copies, one fix would make the server reject a password
		 * the form accepted, which reads as "wrong password". It is explicit rather than the library
		 * default so a library change cannot silently change policy. No composition rules: blocking long
		 * passphrases yields worse passwords.
		 */
		minPasswordLength: PASSWORD_LENGTH.min,
		maxPasswordLength: PASSWORD_LENGTH.max,
		/**
		 * Required only where a mail transport exists (derived in `env.ts`). A separate switch would
		 * allow the disaster combination "required but cannot send", which produces accounts that sign up
		 * and can never sign in. When on, the library changes three things:
		 * 1. Signup gives no session; the web's signup flow ends at "check your mail".
		 * 2. Signup with an existing email returns a success-looking response, so the form is not a
		 *    member lookup.
		 * 3. An unverified account's sign-in is a 403 and re-sends the verification mail.
		 */
		requireEmailVerification: emailVerificationRequired,
		/**
		 * Signup gives a session only where verification is not required; otherwise the library ignores
		 * this and ends without one.
		 */
		autoSignIn: true,
		/**
		 * Password reset uses the library's built-in flow. None of the endpoints needs a session; token
		 * issuance, expiry, single use and the return-address check (`originCheck`) are the library's.
		 *
		 * ```text
		 * POST /request-password-reset   email -> (if an account exists) one mail
		 * GET  /reset-password/:token    opens the link, redirects to the web's /reset-password?token=…
		 * POST /reset-password           token + new password
		 * ```
		 *
		 * Not wrapped in our routes, same as email change: that would be a second token implementation,
		 * and the password would cross our contract.
		 *
		 * - Registered only when reset is open: a mail transport and `PASSWORD_RESET_ENABLED`
		 *   (`passwordResetEnabled` in `env.ts`). Without a transport `sendTransactionalMail` silently
		 *   does nothing while the flow answers "sent", leaving the person waiting for mail that never
		 *   comes. Unregistered, the library answers `RESET_PASSWORD_DISABLED` (400) and the screen says
		 *   it cannot be done. The switch exists because a deployment's privacy policy may close the list
		 *   of mails, and one whose policy omits the reset mail must stay closed. The public runtime config carries the same value so the screen
		 *   hides the link when closed.
		 * - The mail is not awaited. The library answers an unknown address immediately and a known one
		 *   only after this callback, so awaiting SMTP would make response time reveal whether the
		 *   address is registered. The cost is that a send failure is only a log line with no address or
		 *   link, just the codes the transport leaves (`services/mail/types.ts`); surfacing it in the
		 *   response would be the same signal.
		 * - A social-only account gains a password when it completes the flow (the library creates the
		 *   credential row). Accepted: mailbox ownership is proven, and it may be the only way back after
		 *   losing the provider. Same result as the account screen's `setPassword`.
		 * - Finishing a reset does not mark the email verified (the library does not write
		 *   `emailVerified`), and no code here sets it by hand because verification has one recorder.
		 */
		...(passwordResetEnabled
			? {
					sendResetPassword: async ({ user: target, url }) => {
						sendWithoutWaiting(
							{
								kind: "password-reset",
								to: { email: target.email, name: target.name },
								url,
							},
							"password reset mail",
						);
					},
				}
			: {}),
		/**
		 * Link lifetime, explicit even though it equals the default (1 hour): the mail body promises this
		 * number (`services/mail/templates.tsx`). Expired token rows are removed by the retention job
		 * (`auth.verification-token` in `jobs/legal/retention-policies.ts`, same table).
		 */
		resetPasswordTokenExpiresIn: 60 * 60,
		/**
		 * Reset revokes other sessions, unlike change. Whoever resets does not know the current password,
		 * and whoever does may already hold a session; keeping it alive would add a door without closing
		 * the open one. The mail body states this, so turning this off removes that sentence in the same
		 * commit.
		 */
		revokeSessionsOnPasswordReset: true,
	},
	/**
	 * Account deletion belongs to the auth layer. There is no `DELETE /me/account` route under `/v2`:
	 * that would be a second entrance to a destructive operation with a hand-rolled identity check
	 * (password verification, "recent login"), the looser one becoming the real policy, and it would
	 * put a password field into `@rowcat/contracts` and `@rowcat/sdk`. The web calls this endpoint
	 * through the Better Auth client directly (`lib/auth.ts`), the same channel sign-in and sign-out
	 * use.
	 *
	 * Identity: the current password for credential accounts, recent login (24 hours by default) for
	 * social-only ones, so no fake password input. The first half is ours, not the library's — it checks
	 * a password only when one is sent (`account-deletion-policy.ts`). On failure the hook below
	 * never runs. `sendDeleteAccountVerification` is deliberately absent: with no sender, deletion
	 * would stall at "verification mail sent" forever, and an account that cannot be deleted is worse
	 * than one that can.
	 */
	user: {
		/**
		 * Email change completes only when both addresses agree. There is no own `PATCH /me/email` route:
		 * it would need a second token implementation and code that UPDATEs `user.email` directly, which
		 * is the path where the email changes without verification.
		 *
		 * ```text
		 * signed-in member submits a new address
		 *     -> approval request to the CURRENT address   (this slice's security notice)
		 *     -> approved there; ownership confirmation goes to the new address
		 *     -> confirmed there; only now does user.email change
		 * ```
		 *
		 * - Step one going to the current address is the point: someone who stole a session and tries
		 *   to change the address lands in the real owner's mailbox, and nothing happens unless the link
		 *   is opened.
		 * - `updateEmailWithoutVerification` stays off. An unverified current address is no ground to
		 *   skip proving ownership of the new one; nobody has ever proven ownership of that account. So
		 *   an unverified account's change ends with the new-address confirmation alone, since an
		 *   approval sent to an unverified address proves nothing.
		 * - Conflicts are not merged. If the address is in use the library does nothing and returns
		 *   success (existence hiding), and no account-merge or resource-move path exists, so the screen
		 *   only says "mail sent".
		 * - The completion notice to the old address is deferred: no supported hook knows the old
		 *   address at that point (`afterEmailVerification` only gets the already-changed user in 1.7.0),
		 *   and building our own token scheme for one mail is what this slice avoids.
		 */
		changeEmail: {
			enabled: true,
			sendChangeEmailConfirmation: async ({ user: target, newEmail, url }) => {
				/** Not awaited: an address already in use gets the same answer and no mail (`sendWithoutWaiting`). */
				sendWithoutWaiting(
					{
						kind: "change-email-confirmation",
						to: { email: target.email, name: target.name },
						newEmail,
						url,
					},
					"email change confirmation",
				);
			},
			updateEmailWithoutVerification: false,
		},
		deleteUser: {
			enabled: true,
			/**
			 * Product-data cleanup, run before deletion is final. Throwing here deletes nothing
			 * (fail-closed). The service also deletes the auth account row in the same transaction, so the
			 * library's later delete is an idempotent no-op (reason in the service header).
			 */
			beforeDelete: async (deleted) => {
				const summary = await deleteAccountForUser(deleted.id);
				/**
				 * Audit line. The summary type has no slot for email, nickname or title, so a deleted account's
				 * profile is not rebuilt in logs.
				 */
				console.info(
					`[account-deletion] done member=${summary.memberId || "-"} anonymized=${summary.anonymizedStories} deleted=${summary.deletedStories} records=${summary.deletedSyncRecords} comments=${summary.deletedComments} reports=${summary.deletedReports} anonReports=${summary.anonymizedReports}`,
				);
			},
		},
	},
	/**
	 * Passkey registration notice, sent after looking at the response.
	 * `registration.afterVerification` is not used because it runs before the credential row is
	 * stored, so a failed save would still say "added".
	 *
	 * `hooks.after` runs after the handler with the result in `ctx.context.returned`, but thrown
	 * requests arrive here too (then `returned` is an error object), so we send only after confirming
	 * the saved passkey's shape (`id` + `userId`).
	 *
	 * - A send failure does not undo the registration: the mail is a latency-reducing notice, not
	 *   correctness, the same judgement as the sync wake-up not undoing a push.
	 * - Nothing is logged: `returned` carries the credential id and public key, only `userId` and
	 *   `name` are read, and the object is not printed on failure.
	 */
	hooks: {
		/**
		 * Door rules standing in front of the library: two-factor (`two-factor-policy.ts`), account
		 * deletion's password (`account-deletion-policy.ts`) and where a reset link may land
		 * (`password-reset-policy.ts`).
		 */
		before: createAuthMiddleware(async (ctx) => {
			enforcePasswordResetTarget(ctx);
			await enforceTwoFactorPolicy(ctx);
			await enforceAccountDeletionPolicy(ctx);
		}),
		after: createAuthMiddleware(async (ctx) => {
			if (ctx.path !== "/passkey/verify-registration") return;
			const registered = ctx.context.returned as
				| { id?: unknown; userId?: unknown; name?: unknown }
				| undefined;
			if (
				typeof registered?.id !== "string" ||
				typeof registered.userId !== "string"
			)
				return;
			const owner = await findAuthUser(registered.userId);
			if (!owner) return;
			await sendTransactionalMail({
				kind: "passkey-added",
				to: { email: owner.email, name: owner.name },
				label: typeof registered.name === "string" ? registered.name : null,
			}).catch(() => {
				/** A notice failure does not undo the registration (see above). */
			});
		}),
	},
	/**
	 * Limiter for sign-in, signup and password change, and the only limiter on this path:
	 * `lib/rate-limit` deliberately skips unauthenticated endpoints because there is no trustworthy
	 * IP. It was once unconfigured: on only in production, counting in memory (per replica, forgotten
	 * on restart), and reading `X-Forwarded-For` straight from the client. One value was trusted
	 * outright (a fresh bucket per forged header, so password guessing was unlimited) and an absent or
	 * multi-value header folded to `null`, so everyone shared one `no-trusted-ip` bucket and a single
	 * client could cap the whole deployment's sign-in at 3 per 10 seconds.
	 *
	 * Rules (window and cap per path) are the library defaults. The storage (Redis when present) and
	 * the address are ours: `app.ts` resolves it from the socket and the deployment's proxy list
	 * (`lib/client-ip.ts`) and hands it over in one header, which is the only one the library reads.
	 */
	rateLimit: {
		enabled: isProduction,
		...(authRateLimitRedis
			? { customStorage: createRedisAuthRateLimitStorage(authRateLimitRedis) }
			: {}),
	},
	session: {
		expiresIn: 60 * 60 * 24 * 30,
		// Extends on each request from one day before expiry; refreshing on every request would turn
		// read-only traffic into session-table writes.
		updateAge: 60 * 60 * 24,
	},
	advanced: {
		/**
		 * See `rateLimit` above. The address is already decided when the request arrives, so the
		 * library reads that one header and is given no proxy list: with one, it would walk the single
		 * value we set and drop it whenever the client happens to sit inside a trusted range.
		 */
		ipAddress: {
			ipAddressHeaders: [AUTH_CLIENT_IP_HEADER],
		},
		/**
		 * Origin check is enabled explicitly, though it is the default, for verifiability. Left empty,
		 * Better Auth sets it `true` itself under `isTest()`, so the `trustedOrigins` path would never
		 * run in tests and dropping `rowcat://` from the list, or opening an open redirect, would stay
		 * green until a device hits a sign-in 403. Explicit, `expo-session.test.ts` really gets an
		 * untrusted scheme's callback rejected.
		 *
		 * `disableCSRFCheck` is untouched (default `false`); it is the Origin/Fetch Metadata check on
		 * cookie-bearing requests, i.e. the web's CSRF defence itself.
		 */
		disableOriginCheck: false,
		// With web and API on different subdomains the cookie must sit on the parent domain for the
		// browser to send it.
		crossSubDomainCookies: env.AUTH_COOKIE_DOMAIN
			? { enabled: true, domain: env.AUTH_COOKIE_DOMAIN }
			: { enabled: false },
		defaultCookieAttributes: {
			httpOnly: true,
			/**
			 * `SameSite=Lax`, the narrowest value that works for this deployment shape. `None` is needed
			 * only for cross-site requests, but web and API sharing a registrable domain (example.com /
			 * api.example.com) are same-site to the browser even though their origins differ (that is CORS's
			 * axis). Dev localhost:3000 <-> localhost:3001 works the same way.
			 *
			 * `None` would attach the session cookie to requests from any site, so one state-changing
			 * endpoint missing CSRF defence becomes exploitable, for no gain. The OAuth round trip works
			 * under Lax because the callback is a top-level GET navigation.
			 *
			 * `secure` is off in dev because Secure cookies are not stored on http origins, so sign-in would
			 * not work locally.
			 */
			sameSite: "lax",
			secure: isProduction,
		},
	},
});
