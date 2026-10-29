import { APP_NAME } from "@rowcat/domain";

/**
 * WebAuthn config resolution: one pure function.
 *
 * These two values (rpID and origins) are the passkey security boundary. Left unset, the plugin
 * derives them from request headers and the API domain, which is wrong twice in our deployment: the
 * ceremony happens on the web origin yet the rpID becomes the API host, and the verification origin
 * becomes a client-controlled header.
 *
 * Mixed in with `env.ts`'s `process.exit(1)` this decision cannot be checked by value, and a
 * mistake here shows up not as an error but as the browser refusing registration, with nothing in
 * the server log.
 */

export interface WebAuthnConfig {
	rpId: string;
	rpName: string;
	/** Origins allowed to run the ceremony; this list, not a header, is used for verification. */
	origins: string[];
}

export type WebAuthnConfigResult =
	| { ok: true; config: WebAuthnConfig }
	| { ok: false; message: string };

/** Host of one origin; it already passed the origin parser, so parsing cannot fail. */
const originHost = (origin: string): string => new URL(origin).hostname;

/**
 * Whether the rpID is usable for that host. WebAuthn requires the rpID to equal the origin host or
 * be a registrable suffix of it. Plain `endsWith` would let `evil-rowcat.com` pass for
 * `rowcat.com`, so the dot boundary is checked too; that one character is half this function's
 * reason to exist.
 */
export const rpIdCoversHost = (rpId: string, host: string): boolean =>
	host === rpId || host.endsWith(`.${rpId}`);

export function resolveWebAuthnConfig(input: {
	/** Empty falls back to the canonical web origin's host. */
	rpId: string;
	rpName: string;
	/** Already-parsed origin list; empty is a failure. */
	origins: readonly string[];
	/** Canonical web origin; the rpID default comes from it. */
	webOrigin: string;
}): WebAuthnConfigResult {
	if (input.origins.length === 0)
		return {
			ok: false,
			message:
				"WEBAUTHN_ORIGIN is empty — there is no origin to verify passkey ceremonies against",
		};

	const rpId = input.rpId || originHost(input.webOrigin);

	/**
	 * Never boot with a mismatched value: if the rpID does not cover an origin, the browser refuses
	 * the ceremony there, which looks like a device problem rather than a config error and leaves
	 * nothing in the server log.
	 */
	const uncovered = input.origins.filter(
		(origin) => !rpIdCoversHost(rpId, originHost(origin)),
	);
	if (uncovered.length > 0)
		return {
			ok: false,
			message: `WEBAUTHN_RP_ID (${rpId}) does not cover these origins: ${uncovered.join(", ")} — the rpID must equal each origin's host or be a parent domain of it`,
		};

	return {
		ok: true,
		config: {
			rpId,
			rpName: input.rpName || APP_NAME,
			origins: [...input.origins],
		},
	};
}
