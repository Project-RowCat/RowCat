import { createTransport, type Transporter } from "nodemailer";
import type { SmtpConfig } from "../../env.ts";
import {
	MailDeliveryError,
	type MailFailureScope,
	type TransactionalMailTransport,
	type TransactionalMessage,
} from "./types.ts";

/**
 * The EHLO name: the sender address's domain.
 *
 * Unset, nodemailer sends `os.hostname()`, which in a container is a container id; a non-domain
 * EHLO name is one known cause of Gmail's `421 4.7.0 Try again later (EHLO)` (sender IP reputation
 * is the other). That rejection comes before auth, so no password fixes it, and it does not
 * reproduce on dev machines with sane hostnames.
 *
 * No new env var: this deployment has no reason to use an EHLO name different from the sender
 * domain, and a second knob would make mismatched deployments representable. If no domain can be
 * read (dev values like `noreply@localhost`) the result is `null` and the library default stays.
 */
export function ehloNameFrom(from: string): string | null {
	const domain = /@([^\s@<>]+)>?\s*$/.exec(from)?.[1]?.toLowerCase();
	if (!domain) return null;
	return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(
		domain,
	)
		? domain
		: null;
}

/**
 * SMTP connection options, a pure function so the TLS invariants can be tested without a network.
 *
 * Implicit TLS (`secure=true`) is encrypted from the start; every other mode requires STARTTLS. The
 * two axes are not mixed: `secure=true` on 587 breaks the connection with ordinary submission
 * servers.
 *
 * `pool` is on. Off, every `sendMail` opens a new connection and authenticates even on a reused
 * transporter, so a notice mail of dozens of messages attempts that many logins and the provider
 * reads it as a flood. The connection cap is the library default (5).
 */
export const smtpTransportOptions = (config: SmtpConfig, from: string) => {
	const name = ehloNameFrom(from);
	return {
		pool: true,
		host: config.host,
		port: config.port,
		secure: config.secure,
		requireTLS: !config.secure,
		...(name ? { name } : {}),
		...(config.auth ? { auth: config.auth } : {}),
	};
};

/**
 * Whether this failure also affects the next message.
 *
 * nodemailer's connection, TLS, auth and protocol codes are independent of the recipient, and 421
 * on any command means the connection is closing, so it counts too.
 *
 * Unknown codes fold to `message`. The other direction would let a new failure that hits one row
 * stand at the front of every run and block everyone else forever (the candidate query has no
 * ordering, so the same row can come first again). The cost of this direction is a few extra
 * attempts against a blocked server.
 */
const TRANSPORT_CODES = new Set([
	"ECONNECTION",
	"ETIMEDOUT",
	"ESOCKET",
	"EDNS",
	"ETLS",
	"EAUTH",
	"ENOAUTH",
	"EOAUTH2",
	"EPROTOCOL",
]);

export function smtpFailureScope(
	code: string,
	responseCode: number | null,
): MailFailureScope {
	return TRANSPORT_CODES.has(code) || responseCode === 421
		? "transport"
		: "message";
}

/**
 * SMTP transport, the only file in this repository where a vendor appears.
 *
 * No commercial provider (Resend, SES, SendGrid, Postmark, Mailgun) is chosen because choosing one
 * is an operational decision tied to contracts, pricing and domain authentication, and code
 * choosing for the deployment would make it carry an SDK it does not use. SMTP is the surface all
 * five offer, so any of them attaches with env vars alone. The legacy mail code was not revived: it
 * assumed another config system and template engine, and all that is needed is a one-method port
 * implementation.
 *
 * Connections are reused: `createTransport` is not called per send and the transporter is pooled
 * (`smtpTransportOptions`). Missing either gives a new connection and login per message, and a
 * burst of signups or notices looks like a flood to the SMTP server.
 *
 * Errors carry no content: no recipient, body or URL. Better Auth's send call logs failures with
 * its own logger (`runInBackgroundOrAwait`), and a verification link in that line would let anyone
 * who can read logs verify that account.
 */
export function createSmtpMailTransport(
	config: SmtpConfig,
	from: string,
): TransactionalMailTransport {
	let transporter: Transporter | null = null;

	const resolve = (): Transporter => {
		if (!transporter)
			transporter = createTransport(smtpTransportOptions(config, from));
		return transporter;
	};

	return {
		async send(message: TransactionalMessage): Promise<void> {
			try {
				await resolve().sendMail({
					from,
					to: message.to,
					subject: message.subject,
					text: message.text,
					html: message.html,
				});
			} catch (error) {
				/**
				 * The original error is not rethrown: nodemailer can attach the command log (`RCPT TO:<...>`)
				 * to it, which contains the recipient. Diagnosis needs only which host failed at which stage.
				 */
				const code =
					typeof (error as { code?: unknown } | null)?.code === "string"
						? (error as { code: string }).code
						: "unknown";
				/**
				 * The raw response (`error.response`) is not included: `RCPT TO` rejections echo the address.
				 * The numeric code alone separates 421 (later), 535 (auth) and 550 (rejected).
				 */
				const rawResponseCode = (error as { responseCode?: unknown } | null)
					?.responseCode;
				const responseCode =
					typeof rawResponseCode === "number" ? rawResponseCode : null;
				throw new MailDeliveryError(
					`SMTP send failed (host=${config.host}, code=${code}, response=${responseCode ?? "none"})`,
					{ scope: smtpFailureScope(code, responseCode), code, responseCode },
				);
			}
		},
	};
}
