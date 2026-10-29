import type { ReactElement } from "react";
import { render } from "react-email";
import {
	BRAND,
	greeting,
	type MailRecipient,
	passkeyLabel,
} from "./components.tsx";
import ChangeEmailConfirmation from "./emails/change-email-confirmation.tsx";
import PasskeyAdded from "./emails/passkey-added.tsx";
import PasskeyRemoved from "./emails/passkey-removed.tsx";
import PasswordReset from "./emails/password-reset.tsx";
import VerifyEmail from "./emails/verify-email.tsx";
import VerifyNewEmail from "./emails/verify-new-email.tsx";
import type { TransactionalMessage } from "./types.ts";

/**
 * Event to message. There are six typed events and no other mail can leave this system.
 *
 * No surface takes arbitrary strings (`sendMail({ subject, html })`). That is the file's reason to
 * exist: such a surface makes it impossible to grep which code sends which mail, eventually creates
 * a path where user input becomes HTML directly, and lets a marketing sender grow on this
 * infrastructure.
 *
 * All six are account security: about something the person just did, or something done to their
 * account. None goes to every member, and widening the list to "any news the company wants to
 * send" would build the sender this file exists to prevent. `password-reset` entered together with
 * the screen that receives it (`apps/web/src/routes/reset-password.tsx`), so no dead mail exists
 * without a screen. Two former events left with the features they served (the recurring-payment
 * pre-charge notice with billing, the terms revision notice with the terms feature), and neither
 * departure lowers the bar for a seventh.
 *
 * Two layers:
 *
 * ```text
 * emails/*.tsx    the picture: React Email components with a default export and PreviewProps
 * this file       product rules: which events exist, subject, plaintext, which component renders
 * ```
 *
 * `react-email dev` treats each file with a default export as one mail, so copy inside one file's
 * `switch` would break previewing. Pushing the event vocabulary down into that folder would make
 * components know product rules (subject, plaintext, when to send).
 *
 * Escaping is React's job. This file once concatenated HTML strings by hand and escaping was the
 * rule, since display names, emails and passkey labels are user-controlled; JSX escapes children
 * and attributes at render time, so forgetting is no longer possible. The check guarding that looks
 * at the rendered result (`mail.test.ts`). `dangerouslySetInnerHTML` must never appear in this
 * folder, since that one line undoes the guarantee.
 *
 * Plaintext is still hand-written. `render(el, { plainText: true })` writes links as `label [url]`,
 * and the auth flow has a path that opens the first link in the plaintext verbatim (`linkIn` in
 * `test/mail.ts`), so the closing bracket would stick to the URL. Plaintext is also the body of
 * clients that do not render HTML, so its sentences must stand on their own.
 *
 * Deliberately absent:
 *
 * ```text
 * tracking pixels · click tracking · open analytics   (links are on our own domain)
 * marketing footer · unsubscribe · newsletter         not transactional mail
 * remote images · web fonts · external stylesheets    look like open tracking and get blocked
 * passwords · raw tokens · session references         nothing in the body but the token in the link
 * timestamps                                          the same input must give the same body
 * ```
 */

/** Adding a mail means adding a value to this union; sends outside it are blocked by the type. */
export type TransactionalMail =
	/** Signup and resend: confirm that this address is yours. */
	| { kind: "verify-email"; to: MailRecipient; url: string }
	/** Email change step 1: approval request to the current address. */
	| {
			kind: "change-email-confirmation";
			to: MailRecipient;
			newEmail: string;
			url: string;
	  }
	/** Email change step 2: ownership confirmation to the new address. */
	| { kind: "verify-new-email"; to: MailRecipient; url: string }
	/** Passkey registered; sent only after it is actually stored. */
	| { kind: "passkey-added"; to: MailRecipient; label: string | null }
	/** Passkey removed; sent only after the removal succeeded. */
	| { kind: "passkey-removed"; to: MailRecipient; label: string | null }
	/**
	 * Password reset link, sent only when an account exists for the address. Unknown addresses get
	 * nothing (the library does not call the sender on that branch): a "this address is not
	 * registered" mail would reach the address owner, who requested nothing.
	 */
	| { kind: "password-reset"; to: MailRecipient; url: string };

interface MailContent {
	subject: string;
	text: string;
	body: ReactElement;
}

/**
 * What an event becomes. Pure: no `new Date()`, since the same input must give the same body for
 * whole-result template tests, and the server's timezone differs from the user's; the user reads
 * when it happened from their mail client's receipt time.
 */
function contentOf(mail: TransactionalMail): MailContent {
	switch (mail.kind) {
		case "verify-email":
			return {
				subject: `[${BRAND}] Please verify your email address`,
				text: [
					`Hi ${greeting(mail.to)},`,
					"",
					`Please verify the email address of your ${BRAND} account. Open the address below in a browser to finish.`,
					"",
					mail.url,
					"",
					"This link expires after a while. If it has expired, you can send it again from the sign-in screen.",
					"If you didn't request this, please ignore this email.",
				].join("\n"),
				body: <VerifyEmail to={mail.to} url={mail.url} />,
			};

		case "change-email-confirmation":
			return {
				subject: `[${BRAND}] Please approve your email address change`,
				text: [
					`Hi ${greeting(mail.to)},`,
					"",
					`There was a request to change your ${BRAND} account's email address to ${mail.newEmail}.`,
					"Open the address below to approve it, and one more verification email goes to the new address. The change completes once that email is verified at the new address.",
					"",
					mail.url,
					"",
					"If you didn't request this, don't open this link. Your email address won't change unless the link is opened. We recommend changing your password on the account screen and signing out other devices.",
				].join("\n"),
				body: (
					<ChangeEmailConfirmation
						to={mail.to}
						newEmail={mail.newEmail}
						url={mail.url}
					/>
				),
			};

		case "verify-new-email":
			return {
				subject: `[${BRAND}] Please verify your new email address`,
				text: [
					`Hi ${greeting(mail.to)},`,
					"",
					`There was a request to use this address as your ${BRAND} account's new email address. Open the address below to finish the change.`,
					"",
					mail.url,
					"",
					"This link expires after a while. If you didn't request this, please ignore this email — nothing happens unless the link is opened.",
				].join("\n"),
				body: <VerifyNewEmail to={mail.to} url={mail.url} />,
			};

		case "passkey-added":
			return {
				subject: `[${BRAND}] A passkey was added`,
				text: [
					`Hi ${greeting(mail.to)},`,
					"",
					`A passkey (${passkeyLabel(mail.label)}) was added to your ${BRAND} account. You can now sign in with that device.`,
					"",
					"If this wasn't you, delete that passkey in the security section of the account screen, change your password, and sign out other devices.",
				].join("\n"),
				body: <PasskeyAdded to={mail.to} label={mail.label} />,
			};

		case "passkey-removed":
			return {
				subject: `[${BRAND}] A passkey was removed`,
				text: [
					`Hi ${greeting(mail.to)},`,
					"",
					`A passkey (${passkeyLabel(mail.label)}) was removed from your ${BRAND} account. That device can no longer sign in.`,
					"",
					"If this wasn't you, change your password and sign out other devices.",
				].join("\n"),
				body: <PasskeyRemoved to={mail.to} label={mail.label} />,
			};

		/**
		 * The only mail that states the expiry as a number. Other link mails say "after a while" because those
		 * lifetimes are library defaults; this one is stated by us (`resetPasswordTokenExpiresIn` in
		 * `auth/index.ts`), so changing it changes this sentence.
		 *
		 * The sentence about signing out of every device is a promise (`revokeSessionsOnPasswordReset`);
		 * a commit turning that setting off must remove it.
		 */
		case "password-reset":
			return {
				subject: `[${BRAND}] Password reset`,
				text: [
					`Hi ${greeting(mail.to)},`,
					"",
					`There was a request to reset your ${BRAND} account's password. Open the address below in a browser and set a new password.`,
					"",
					mail.url,
					"",
					"This link expires in 1 hour and can be used only once. Once you set a new password, you'll be signed out on every device that was signed in to this account.",
					"If you didn't request this, please ignore this email — nothing changes unless you open the link and set a new password.",
				].join("\n"),
				body: <PasswordReset to={mail.to} url={mail.url} />,
			};
	}
}

/**
 * Event to the message actually sent. Async because React Email's render is async; that leaks in
 * one place (`sendTransactionalMail`), which was already async.
 */
export async function renderTransactionalMail(
	mail: TransactionalMail,
): Promise<TransactionalMessage> {
	const { subject, text, body } = contentOf(mail);
	return { to: mail.to.email, subject, text, html: await render(body) };
}
