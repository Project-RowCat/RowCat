/**
 * Mail configuration resolution as one pure function. It only decides; `env.ts` exits on failure.
 * Kept out of `env.ts` so the rules are testable by value: each failure here would otherwise
 * surface only after a user is halfway through a flow.
 */

/** Credentials do not leave this object. */
export interface SmtpConfig {
	host: string;
	port: number;
	/** TLS from connect (465); otherwise upgraded with STARTTLS. */
	secure: boolean;
	auth: { user: string; pass: string } | null;
}

/** `null` means no mail transport; every sender must know that state rather than get a fake default. */
export type MailTransportConfig =
	| { kind: "smtp"; from: string; smtp: SmtpConfig }
	| { kind: "dev"; from: string }
	| null;

export type MailConfigResult =
	| { ok: true; config: MailTransportConfig }
	| { ok: false; message: string };

export const MAIL_DEV_TRANSPORT = "dev";
export const MAIL_SMTP_TRANSPORT = "smtp";

/** Placeholder sender for the dev transport; deliberately conspicuous so it does not leak into production. */
const DEV_FROM = "RowCat <dev@rowcat.test>";

export interface MailEnvInput {
	transport: string;
	from: string;
	host: string;
	port: number;
	secure: string;
	user: string;
	password: string;
	production: boolean;
}

/**
 * Environment to transport config. A failure is a message; blocking boot is the caller's job. The
 * four failing combinations:
 *
 * ```text
 * production + dev      that transport leaks verification links into server logs, letting
 *                       whoever reads them verify any account's email
 * unknown name          a typo would silently become "no transport"
 * half credentials      fails at auth, only after the user has signed up
 * no from / host        looks configured but fails at send time
 * ```
 */
export function resolveMailConfig(input: MailEnvInput): MailConfigResult {
	if (input.production && input.transport === MAIL_DEV_TRANSPORT)
		return {
			ok: false,
			message:
				"production can't boot with MAIL_TRANSPORT=dev — that transport sends no mail and leaks verification links to the server log",
		};

	if (
		input.transport &&
		input.transport !== MAIL_DEV_TRANSPORT &&
		input.transport !== MAIL_SMTP_TRANSPORT
	)
		return {
			ok: false,
			message: `MAIL_TRANSPORT must be ${MAIL_SMTP_TRANSPORT} or ${MAIL_DEV_TRANSPORT} (got: ${input.transport})`,
		};

	// Half credentials are an error, not "unset", even with no transport chosen: leftover values mean
	// a half-moved configuration that would be debugged first the day a transport is enabled.
	if (Boolean(input.user) !== Boolean(input.password))
		return {
			ok: false,
			message:
				"SMTP_USER and SMTP_PASSWORD must be present together or absent together — with only one, sending fails at the auth step after the user finishes signing up",
		};

	if (!input.transport) return { ok: true, config: null };

	if (input.transport === MAIL_DEV_TRANSPORT)
		// The dev transport has a sender too, so rendering matches production and template mistakes show
		// up in development.
		return { ok: true, config: { kind: "dev", from: input.from || DEV_FROM } };

	if (!input.from)
		return {
			ok: false,
			message:
				"MAIL_TRANSPORT=smtp, but MAIL_FROM is empty — mail with no sender is refused at send time",
		};
	if (!input.host)
		return {
			ok: false,
			message:
				"MAIL_TRANSPORT=smtp, but SMTP_HOST is empty — there is no server to connect to",
		};

	return {
		ok: true,
		config: {
			kind: "smtp",
			from: input.from,
			smtp: {
				host: input.host,
				port: input.port,
				// Only `"true"` turns it on; accepting `"1"`/`"yes"` lets a typo silently produce a plaintext
				// connection that still sends mail (same convention as `MEMBERSHIP_AGE_GATE`).
				secure: input.secure === "true",
				auth:
					input.user && input.password
						? { user: input.user, pass: input.password }
						: null,
			},
		},
	};
}
