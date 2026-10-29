import { isProduction } from "../../env.ts";
import type {
	TransactionalMailTransport,
	TransactionalMessage,
} from "./types.ts";

/**
 * Dev transport: sends no mail and writes the link to the server console, so the verification flow
 * can be walked locally (`.test` addresses cannot receive mail, and without verification developers
 * never exercise the production-only path).
 *
 * - Not an HTTP back door. There is no `GET /dev/latest-email`: a route like that stays open on a
 *   deployment with one wrong setting and lets anyone read other people's verification links, the
 *   same judgement as having no dev login route (`db/seed-dev-user.ts` header).
 * - Not constructible in production. `env.ts` already blocks booting with `MAIL_TRANSPORT=dev`;
 *   throwing here too checks the moment the object is actually built, so another path selecting
 *   this transport gets the same answer.
 */
export function createDevMailTransport(): TransactionalMailTransport {
	if (isProduction)
		throw new Error(
			"[mail] the dev transport can't be created in production — verification links would go to the server log",
		);

	return {
		async send(message: TransactionalMessage): Promise<void> {
			/**
			 * Subject and plaintext only; HTML would bury the link in markup. This passes the
			 * `no-secret-logging` scan because the only argument name is `message`, which also marks the
			 * file as dev-only.
			 */
			console.info(
				`[mail:dev] to=${message.to}\n  subject: ${message.subject}\n${message.text.replace(/^/gm, "  ")}`,
			);
		},
	};
}
