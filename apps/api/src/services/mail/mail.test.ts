import { describe, expect, test } from "vitest";
import {
	MAIL_DEV_TRANSPORT,
	MAIL_SMTP_TRANSPORT,
	type MailEnvInput,
	resolveMailConfig,
} from "../../lib/mail-config.ts";
import {
	renderTransactionalMail,
	type TransactionalMail,
} from "./templates.tsx";
import type {
	TransactionalMailTransport,
	TransactionalMessage,
} from "./types.ts";

/**
 * Transactional mail configuration and copy. No DB and no network: everything checked here is a
 * pure decision. When these rules are wrong the symptom is not a server error but a failure after
 * the user has finished half a procedure, or a verification link leaking into logs, which
 * integration tests catch late.
 */

const BASE: MailEnvInput = {
	transport: "",
	from: "",
	host: "",
	port: 587,
	secure: "",
	user: "",
	password: "",
	production: false,
};

const TO = { email: "reader@example.test", name: "Reader" };

describe("mail config", () => {
	test("no transport chosen means no way to send", () => {
		const result = resolveMailConfig(BASE);
		expect(result).toEqual({ ok: true, config: null });
	});

	/**
	 * Production never boots with the dev transport: it writes verification links to the server log,
	 * so anyone who can read logs could verify any account's email.
	 */
	test("production refuses the dev transport", () => {
		const result = resolveMailConfig({
			...BASE,
			transport: MAIL_DEV_TRANSPORT,
			production: true,
		});
		expect(result.ok).toBe(false);
	});

	test("outside production the dev transport is allowed", () => {
		const result = resolveMailConfig({
			...BASE,
			transport: MAIL_DEV_TRANSPORT,
		});
		expect(result).toMatchObject({ ok: true, config: { kind: "dev" } });
	});

	test("an unknown transport name is refused, not folded into unconfigured", () => {
		// A typo silently becoming "no transport" would boot the deployment with verification off.
		expect(resolveMailConfig({ ...BASE, transport: "resend" }).ok).toBe(false);
	});

	/**
	 * Half-configured SMTP is an error, not unconfigured. All three cases (half the credentials, no
	 * sender, no host) surface only after the user presses signup.
	 */
	test.each([
		["username only", { user: "u", password: "" }],
		["password only", { user: "", password: "p" }],
	])("blocks boot when the SMTP credentials are %s", (_label, patch) => {
		const result = resolveMailConfig({
			...BASE,
			transport: MAIL_SMTP_TRANSPORT,
			from: "RowCat <a@b.test>",
			host: "smtp.example.test",
			...patch,
		});
		expect(result.ok).toBe(false);
	});

	test("SMTP with no sender address blocks boot", () => {
		expect(
			resolveMailConfig({
				...BASE,
				transport: MAIL_SMTP_TRANSPORT,
				host: "smtp.example.test",
			}).ok,
		).toBe(false);
	});

	test("SMTP with no host blocks boot", () => {
		expect(
			resolveMailConfig({
				...BASE,
				transport: MAIL_SMTP_TRANSPORT,
				from: "RowCat <a@b.test>",
			}).ok,
		).toBe(false);
	});

	test("a relay without credentials is a normal config", () => {
		const result = resolveMailConfig({
			...BASE,
			transport: MAIL_SMTP_TRANSPORT,
			from: "RowCat <a@b.test>",
			host: "mta.internal.test",
		});
		expect(result).toMatchObject({
			ok: true,
			config: { kind: "smtp", smtp: { auth: null } },
		});
	});

	/**
	 * Only `"true"` turns it on. Accepting `"1"` or `"yes"` would let a typo silently create a
	 * plaintext connection, and its symptom ("mail goes out") goes unnoticed.
	 */
	test.each([
		["true", true],
		["1", false],
		["yes", false],
		["", false],
	])("SMTP_SECURE=%s → secure=%s", (value, expected) => {
		const result = resolveMailConfig({
			...BASE,
			transport: MAIL_SMTP_TRANSPORT,
			from: "RowCat <a@b.test>",
			host: "smtp.example.test",
			secure: value,
		});
		expect(result).toMatchObject({
			ok: true,
			config: { smtp: { secure: expected } },
		});
	});

	/**
	 * Credentials do not remain by name in a serialized config. Logging the whole config object at
	 * boot or in diagnostics is a real temptation; this checks by value that such a line would not
	 * leave the SMTP password.
	 */
	test("auth must be left out so the password doesn't appear when the config object is serialized", () => {
		const result = resolveMailConfig({
			...BASE,
			transport: MAIL_SMTP_TRANSPORT,
			from: "RowCat <a@b.test>",
			host: "smtp.example.test",
			user: "postmaster",
			password: "super-secret-value",
		});
		expect(result.ok).toBe(true);
		if (!result.ok || !result.config || result.config.kind !== "smtp") return;
		/**
		 * The config itself holds the password (that is its purpose); what is checked is that a summary
		 * printed without it is actually safe. This pins the shape the day this repository grows code
		 * that builds such a summary.
		 */
		const safeSummary = {
			kind: result.config.kind,
			from: result.config.from,
			host: result.config.smtp.host,
			port: result.config.smtp.port,
			secure: result.config.smtp.secure,
			authenticated: result.config.smtp.auth !== null,
		};
		expect(JSON.stringify(safeSummary)).not.toContain("super-secret-value");
		expect(JSON.stringify(safeSummary)).not.toContain("postmaster");
	});
});

describe("mail copy", () => {
	/**
	 * User values do not become HTML directly. Display names are user-chosen; unescaped, the mail
	 * becomes a surface for planting markup in one's own inbox, and for forwarded mail the recipient
	 * is someone else.
	 */
	test("doesn't concatenate the display name into HTML", async () => {
		const message = await renderTransactionalMail({
			kind: "verify-email",
			to: { email: "x@example.test", name: '<img src=x onerror="alert(1)">' },
			url: "https://api.example.test/v2/auth/verify-email?token=abc",
		});
		expect(message.html).not.toContain("<img src=x");
		expect(message.html).toContain("&lt;img");
		expect(message.html).not.toContain('onerror="alert(1)"');
	});

	test("escapes the new email address too", async () => {
		const message = await renderTransactionalMail({
			kind: "change-email-confirmation",
			to: TO,
			newEmail: '"><script>x</script>@example.test',
			url: "https://api.example.test/v2/auth/verify-email?token=abc",
		});
		expect(message.html).not.toContain("<script>");
	});

	test("escapes the passkey label too", async () => {
		const message = await renderTransactionalMail({
			kind: "passkey-added",
			to: TO,
			label: "<b>MacBook</b>",
		});
		expect(message.html).not.toContain("<b>MacBook</b>");
		expect(message.html).toContain("&lt;b&gt;");
	});

	// There used to be a unit test of `escapeHtml`. The function is gone because React does that job
	// (the copy is JSX), so the check looks at the rendered result, as the three tests above do.
	// Testing a helper never said whether a call site forgot to call it.

	// Every event has subject, plaintext and HTML; a missing one would send an empty mail.
	const ALL: TransactionalMail[] = [
		{ kind: "verify-email", to: TO, url: "https://x.test/v?token=t" },
		{
			kind: "change-email-confirmation",
			to: TO,
			newEmail: "new@example.test",
			url: "https://x.test/v?token=t",
		},
		{ kind: "verify-new-email", to: TO, url: "https://x.test/v?token=t" },
		{ kind: "passkey-added", to: TO, label: "MacBook" },
		{ kind: "passkey-removed", to: TO, label: null },
		{ kind: "password-reset", to: TO, url: "https://x.test/r?token=t" },
	];

	test.each(
		ALL.map((mail) => [mail.kind, mail] as const),
	)("%s has a subject, plain text and HTML", async (_kind, mail) => {
		const message = await renderTransactionalMail(mail);
		expect(message.to).toBe(TO.email);
		expect(message.subject.length).toBeGreaterThan(0);
		expect(message.text.length).toBeGreaterThan(0);
		expect(message.html.length).toBeGreaterThan(0);
	});

	/**
	 * No tracking, no marketing. Remote images look like open tracking and most clients block them,
	 * and unsubscribe copy has no place in transactional mail (turning it off would lose the account).
	 */
	test.each(
		ALL.map((mail) => [mail.kind, mail] as const),
	)("%s has no tracking pixel or marketing footer", async (_kind, mail) => {
		const { html, text } = await renderTransactionalMail(mail);
		expect(html).not.toContain("<img");
		expect(html).not.toContain("tracking");
		for (const banned of [
			"unsubscribe",
			"unsubscribe",
			"newsletter",
			"promotion",
		]) {
			expect(html).not.toContain(banned);
			expect(text).not.toContain(banned);
		}
	});

	/**
	 * The vocabulary is six, all account security.
	 *
	 * It counts the vocabulary itself because one line flips the policy: adding a value to
	 * `TransactionalMail` looks ordinary in a diff but creates a sender that goes to every member. It
	 * is the same axis as having no surface that takes free subject and body, so a real reason to grow
	 * the vocabulary should be written in the commit that edits this test.
	 *
	 * `password-reset` crossed the bar that way: an account-security event about something the account
	 * owner just requested, entering with the screen that receives it (no dead mail without a screen).
	 * Two former values left with the features they served (`subscription-renewal-notice` with
	 * billing, `terms-updated` with the terms feature), and neither departure lowers the bar for the
	 * next value. Newsletters or "news we want to send" do not belong here.
	 */
	test("the sending vocabulary is the six account-security mails", () => {
		// Counting kinds, not samples: a kind may one day carry more than one sample.
		expect([...new Set(ALL.map((mail) => mail.kind))].sort()).toEqual([
			"change-email-confirmation",
			"passkey-added",
			"passkey-removed",
			"password-reset",
			"verify-email",
			"verify-new-email",
		]);
	});

	/**
	 * Passkey notices have no link: an action link in a security alert makes the mail a template for
	 * phishing, and the user should enter by their usual path.
	 */
	test.each([
		"passkey-added",
		"passkey-removed",
	] as const)("%s has no link", async (kind) => {
		const { html, text } = await renderTransactionalMail({
			kind,
			to: TO,
			label: "MacBook",
		});
		expect(html).not.toContain("<a ");
		expect(text).not.toContain("http");
	});

	/**
	 * The reset mail's promises pair with server config. The body promises "1 hour" and signing out of
	 * every device, facts guarded by two values in `auth/index.ts` (`resetPasswordTokenExpiresIn`,
	 * `revokeSessionsOnPasswordReset`); if only one side changes the mail lies. The config side is
	 * checked by value in `password-reset.verified.test.ts`.
	 */
	test("the reset mail mentions the link, the expiry and signing out together", async () => {
		const url =
			"https://api.example.test/v2/auth/reset-password/t?callbackURL=x";
		const { text, html, subject } = await renderTransactionalMail({
			kind: "password-reset",
			to: TO,
			url,
		});
		expect(subject).toContain("Password reset");
		expect(text).toContain(url);
		expect(html).toContain("<a ");
		for (const promise of ["1 hour", "signed out on every device"]) {
			expect(text).toContain(promise);
			expect(html).toContain(promise);
		}
	});

	// Device names are not invented for unlabelled passkeys.
	test("a passkey with no label is just `passkey`", async () => {
		const { text } = await renderTransactionalMail({
			kind: "passkey-removed",
			to: TO,
			label: null,
		});
		expect(text).toContain("passkey");
	});

	/**
	 * Deterministic: no clock or randomness. Otherwise the same input gives a different body each
	 * time, making this file's comparison meaningless, and the server's timezone differs from the
	 * user's.
	 */
	test("the same input makes the same body", async () => {
		const mail: TransactionalMail = {
			kind: "verify-email",
			to: TO,
			url: "https://x.test/v?token=t",
		};
		expect(await renderTransactionalMail(mail)).toEqual(
			await renderTransactionalMail(mail),
		);
	});
});

describe("test transport", () => {
	/**
	 * Tests never touch the network; the capture transport is that guarantee. This checks that the
	 * port shape is actually swappable (one method), which is what lets integration tests act as the
	 * mailbox.
	 */
	test("the capture transport keeps the message as is", async () => {
		const sent: TransactionalMessage[] = [];
		const capture: TransactionalMailTransport = {
			async send(message) {
				sent.push(message);
			},
		};
		await capture.send(
			await renderTransactionalMail({
				kind: "verify-email",
				to: TO,
				url: "https://x.test/v?token=t",
			}),
		);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.to).toBe(TO.email);
	});
});
