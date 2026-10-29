import { isLegalAdultOn } from "@rowcat/domain/membership";
import type {
	IdentityVerification,
	IdentityVerificationProvider,
} from "./provider.ts";

/**
 * PortOne V2 identity verification adapter; provider vocabulary ends here. It knows nothing about
 * guardian consent: verification is a capability and the consumer decides what the result means
 * (`services/identity/provider.ts` header). Only the facts the port defines leave this file;
 * `identityVerificationId`, `verifiedCustomer` and `PortOne ${secret}` stay inside it.
 *
 * What the adapter discards: the lookup response's `verifiedCustomer` also carries `ci`, `di`,
 * `birthDate`, `gender`, `isForeigner` and `operator`. The port type has no slot for them, but the
 * rule is to extract explicitly rather than pass the response object on; one such leak would make
 * the CI our data, and the CI alone links a person across services. The birth date is folded to an
 * adult boolean by the domain function (`isLegalAdultOn`, product-timezone calendar) and dropped.
 *
 * Channel binding: the server makes `identityVerificationId`. If the client chose it, someone
 * else's verification could be attached to its own request. The id is prefixed with our request id
 * and `verify` re-checks that pairing.
 *
 * The API secret exists only on the server. `storeId` and `channelKey` are designed to be public
 * and ride the contract to the screen, but the lookup secret is read only here, so the client
 * cannot perform the result lookup; that is where this integration gets its trust.
 */

const PORTONE_API_ORIGIN = "https://api.portone.io";

export interface PortOneIdentityConfig {
	storeId: string;
	channelKey: string;
	/** Server-only. */
	apiSecret: string;
	/** Test seam; empty means the real PortOne API. */
	origin?: string;
	fetchImpl?: typeof fetch;
}

/**
 * Our verification id. The request id prefix is the binding; the nonce allows retries: a guardian
 * may attempt verification twice on one request (closing the first attempt midway is common), and
 * reusing an id at PortOne would collide with a finished one.
 */
const identityVerificationId = (requestId: string, nonce: string): string =>
	`rowcat-${requestId}-${nonce}`;

/** `verify` re-checks the pairing with this. */
const belongsToRequest = (reference: string, requestId: string): boolean =>
	reference.startsWith(`rowcat-${requestId}-`);

/**
 * Only what we read from the lookup response. Copying the full schema would bring CI and DI into
 * the types; unknown fields are never read, so the provider widening the response changes nothing
 * here.
 */
interface PortOneIdentityVerification {
	status?: string;
	verifiedAt?: string;
	verifiedCustomer?: {
		name?: string | null;
		phoneNumber?: string | null;
		birthDate?: string | null;
	};
}

export function createPortOneVerifier(
	config: PortOneIdentityConfig,
	newNonce: () => string,
): IdentityVerificationProvider {
	const origin = config.origin ?? PORTONE_API_ORIGIN;
	const call = config.fetchImpl ?? fetch;

	return {
		// Name kept in audit records. The channel (Danal, KG Inicis, ...) is omitted because it is a
		// console setting and freezing it on a row would eventually be untrue; look it up at PortOne by
		// the reference.
		name: "portone",

		async begin({ requestId, returnUrl }) {
			const reference = identityVerificationId(requestId, newNonce());
			// No PortOne call here: V2 verification starts when the browser SDK opens its window, so there
			// is nothing to pre-create. We only decide the values handed to that window, and the server
			// choosing the identifier is the channel binding. No network, so nothing to fail, and a guardian
			// closing the window leaves only the stored reference.
			return {
				handoff: {
					kind: "portone-v2",
					storeId: config.storeId,
					channelKey: config.channelKey,
					identityVerificationId: reference,
					redirectUrl: returnUrl,
				},
				reference,
			};
		},

		async verify({ requestId, reference }) {
			// Check the reference/request pairing first. Always true on the normal path (lookup uses the
			// stored value), but without this line a later caller taking the reference as an argument would
			// open that path silently.
			if (!belongsToRequest(reference, requestId))
				return { verified: false, reason: "failed" };

			// try/catch rather than `.catch()`: `fetch` can also throw synchronously (bad URL, an injected
			// implementation's error), which would escape this function and surface as a 500 instead of a
			// verification failure.
			let response: Response | null = null;
			try {
				response = await call(
					`${origin}/identity-verifications/${encodeURIComponent(reference)}`,
					{ headers: { Authorization: `PortOne ${config.apiSecret}` } },
				);
			} catch {
				response = null;
			}

			// Network down or a 5xx. `failed`, not `declined`: the guardian quit nothing and can retry.
			if (!response) return { verified: false, reason: "failed" };

			// 404 means not started or window closed (PortOne creates the record only once verification
			// starts). Folded to `declined`: the screen should say "not completed", not "try again".
			if (response.status === 404)
				return { verified: false, reason: "declined" };
			if (!response.ok) return { verified: false, reason: "failed" };

			const body = (await response
				.json()
				.catch(() => null)) as PortOneIdentityVerification | null;
			if (!body) return { verified: false, reason: "failed" };

			// `READY` means the window opened but is unfinished: incomplete, not a failure. Only `FAILED`
			// counts as failure.
			if (body.status === "READY")
				return { verified: false, reason: "declined" };
			if (body.status !== "VERIFIED")
				return { verified: false, reason: "failed" };

			return toVerification(body, reference);
		},
	};
}

/**
 * Response to fact; what this function drops is the point of the file. It extracts name, contact
 * and birth date only (the birth date is folded to a boolean and dropped) and never reads CI, DI,
 * gender, foreigner flag or carrier: dropping after reading and not reading at all differ when the
 * next person edits that line.
 */
function toVerification(
	body: PortOneIdentityVerification,
	reference: string,
): IdentityVerification {
	const customer = body.verifiedCustomer ?? {};
	const birthDate = customer.birthDate ?? null;

	// A missing birth date is not adult. Docs say every channel provides it, but passing when absent
	// would turn an unverified fact true, and this is the only value separating "the child verified in
	// their own name" from not.
	const adult = birthDate ? isLegalAdultOn(birthDate, new Date()) : false;

	// Use the provider's clock: stamping ours would make the value to reconcile in a dispute one we
	// made, which is not evidence. Falls back to now only if absent or unparsable (verification itself
	// did happen).
	const verifiedAt = body.verifiedAt ? new Date(body.verifiedAt) : new Date();

	return {
		verified: true,
		reference,
		verifiedAt: Number.isNaN(verifiedAt.getTime()) ? new Date() : verifiedAt,
		adult,
		// Minimum data under the Personal Information Protection Act, Art. 22-2(2) (Korea). Empty
		// strings become null.
		name: customer.name?.trim() || null,
		contact: customer.phoneNumber?.trim() || null,
	};
}
