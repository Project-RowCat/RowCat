import { z } from "zod";

/**
 * Identity verification protocol. This is a capability, not a feature. Verification produces one
 * fact: the agency confirmed who this person is.
 *
 * What that fact means is decided by each consumer. Guardian consent accepts a verified adult as
 * the child's guardian (membership.ts). Adult eligibility opens adult access when the verified
 * person is 19 or older (adult-verification.ts).
 *
 * A second consumer appeared later, and this boundary paid off. Had the shape carried one
 * consumer's name (e.g. `GuardianVerificationHandoff`), adult eligibility would have had to reuse
 * guardian vocabulary or duplicate it.
 *
 * This file holds only the handoff method. The verification result shape is not part of the
 * contract. It stays server-side (apps/api/src/services/identity/provider.ts), and only the
 * consumer's state goes on the wire. Names, contact details and birth dates are intentionally
 * absent.
 *
 * The verification ID is also not returned with the result. The server creates it and sends it to
 * the browser, and the browser never sends it back. Neither consumer's completion request has a
 * body; the server re-queries the agency using the reference it stored.
 */

/**
 * How the verification agency is reached. Agencies differ, so this is a discriminated union. Some
 * agencies take a server-built URL; others need the browser to load the agency's SDK. If the screen
 * had to guess, switching agencies would silently make it follow the wrong procedure. So the server
 * states what must happen.
 *
 * The vendor name is deliberately here. The browser must know which SDK to load. If that were
 * decided outside the contract, the agency the server chose could diverge from the window the
 * screen opens.
 *
 * The screen does not proceed on an unknown kind; the client also fails closed. No secrets are sent
 * in either case. storeId and channelKey are designed to be public. The API secret used to fetch
 * results lives only on the server, which is why clients cannot query verification results
 * directly. That is where trust in this integration comes from.
 */
export const IdentityVerificationHandoff = z.discriminatedUnion("kind", [
	/** Redirects to the URL the server built, as-is. */
	z.object({ kind: z.literal("redirect"), redirectUrl: z.url() }),
	/**
	 * PortOne V2 identity verification: the browser SDK opens the window. The server generates
	 * `identityVerificationId` and sends it down. That is this procedure's channel binding. If the
	 * client chose the value, it could attach someone else's verification to its own request, and
	 * identity verification would reduce to 'fetch any verification'. The server stores the value in
	 * its own row and, at the confirm step, queries using the stored value.
	 */
	z.object({
		kind: z.literal("portone-v2"),
		storeId: z.string().min(1),
		channelKey: z.string().min(1),
		identityVerificationId: z.string().min(1),
		/**
		 * URL to return to after finishing verification on mobile. The server builds it to prevent open
		 * redirects.
		 */
		redirectUrl: z.url(),
	}),
]);
export type IdentityVerificationHandoff = z.infer<
	typeof IdentityVerificationHandoff
>;

/**
 * Verification method vocabulary. There is only one value for now. Article 17-2 of the Enforcement
 * Decree of the Personal Information Protection Act lists seven methods for verifying guardian
 * consent. This release implements only verification through an identity verification agency. Mail,
 * fax and phone are not represented, because no organization is documented to carry out those
 * procedures. A value in this vocabulary must mean that the procedure actually exists.
 */
export const IdentityVerificationMethod = z.enum(["identity-verification"]);
export type IdentityVerificationMethod = z.infer<
	typeof IdentityVerificationMethod
>;
