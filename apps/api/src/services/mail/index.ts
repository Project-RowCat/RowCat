import { mailTransportConfig } from "../../env.ts";
import { createDevMailTransport } from "./dev.ts";
import { createSmtpMailTransport } from "./smtp.ts";
import {
	renderTransactionalMail,
	type TransactionalMail,
} from "./templates.tsx";
import type { TransactionalMailTransport } from "./types.ts";

export type { TransactionalMail } from "./templates.tsx";
export {
	MailDeliveryError,
	type MailFailureScope,
	type TransactionalMailTransport,
	type TransactionalMessage,
} from "./types.ts";

/**
 * The single entry point for transactional mail. Callers are the auth config (`auth/index.ts`) and
 * the passkey service, and the argument is one typed event; neither subject nor body is decided by
 * the caller (`templates.tsx` header).
 *
 * - The transport is created lazily, so requests that send no mail (gallery, chat) do not pay for
 *   it and tests importing this module do not build a network client.
 * - `setMailTransport` exists so tests never touch the network. It does not throw in production;
 *   only tests call it and no route can reach it.
 */

/** `undefined` means not yet resolved; `null` means no transport. */
let transport: TransactionalMailTransport | null | undefined;

function resolveTransport(): TransactionalMailTransport | null {
	if (transport !== undefined) return transport;
	transport = !mailTransportConfig
		? null
		: mailTransportConfig.kind === "dev"
			? createDevMailTransport()
			: createSmtpMailTransport(
					mailTransportConfig.smtp,
					mailTransportConfig.from,
				);
	return transport;
}

/**
 * Test-only. `null` means no transport; omitting the argument re-resolves from configuration.
 */
export function setMailTransport(
	next: TransactionalMailTransport | null | undefined,
): void {
	transport = next;
}

/**
 * Sends one event. With no transport it silently does nothing: every caller is a step of the auth
 * flow, and a deployment that cannot send mail would otherwise 500 on signup. The boot log reports
 * that state (`env.ts`) and the email-verification requirement is derived from it.
 *
 * Failures are thrown; swallowing them makes the resend button draw success while the user waits
 * for mail that never comes.
 */
export async function sendTransactionalMail(
	mail: TransactionalMail,
): Promise<void> {
	const active = resolveTransport();
	if (!active) return;
	await active.send(await renderTransactionalMail(mail));
}
