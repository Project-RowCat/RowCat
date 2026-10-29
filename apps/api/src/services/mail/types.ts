/**
 * The shape of transactional mail; only these three types travel regardless of transport. Neither
 * nodemailer nor SMTP appears here: the application must not know whether mail leaves by SMTP, a
 * provider API or an array in a test, or swapping transport becomes editing domain code.
 */

export interface TransactionalMessage {
	to: string;
	subject: string;
	/**
	 * Plaintext body. HTML is never sent alone: clients that do not render HTML (and spam filters)
	 * would see an empty mail, and a verification link only inside it leaves that person no way in.
	 */
	text: string;
	html: string;
}

/**
 * The transport port: one method. Failures are thrown; swallowing them makes callers believe the
 * mail was sent, with no symptom until the user opens their inbox.
 */
export interface TransactionalMailTransport {
	send(message: TransactionalMessage): Promise<void>;
}

/**
 * Whether a failure is about this one message or the whole transport.
 *
 * ```text
 * transport   connection, TLS, auth, server "try later" (421): the next message fails the same way
 * message     specific to this recipient or body: the next message can go out
 * ```
 *
 * Bulk sending needs the distinction to know when to stop. Without it, a blocked server gets a
 * reconnect per remaining message, and when the block is a rate limit those attempts extend it.
 */
export type MailFailureScope = "transport" | "message";

/**
 * The failure a transport throws, carrying only what diagnosis needs: no recipient, body, link or
 * raw server response (responses can echo the recipient on `RCPT TO` rejections, so only the
 * numeric code stays). The whole object is safe to log and the job log reads its fields.
 */
export class MailDeliveryError extends Error {
	override readonly name = "MailDeliveryError";
	readonly scope: MailFailureScope;
	/** The transport's failure kind (SMTP: `EAUTH`, `ECONNECTION`, ...); `unknown` if not known. */
	readonly code: string;
	/** The server's response code (421, 535, ...); `null` if disconnected before a response. */
	readonly responseCode: number | null;

	constructor(
		message: string,
		detail: {
			scope: MailFailureScope;
			code: string;
			responseCode: number | null;
		},
	) {
		super(message);
		this.scope = detail.scope;
		this.code = detail.code;
		this.responseCode = detail.responseCode;
	}
}
