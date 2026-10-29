import type { IdentityVerificationHandoff } from "@rowcat/contracts";
import {
	identityVerificationProvider,
	isProduction,
	portOneIdentityConfig,
} from "../../env.ts";
import { newId } from "../../lib/id.ts";
import { createPortOneVerifier } from "./portone.ts";

/**
 * Trust boundary of identity verification. This file is all of it.
 *
 * This is a capability, not a feature, so it lives here and not under `services/guardian/`.
 * Verification yields one fact, "the authority verified this person", and each consumer decides
 * what it means. There are two consumers: guardian consent and a member's own adult eligibility.
 * The adapter imports neither, so one consumer's vocabulary cannot leak into the other.
 *
 * - The port reports facts, not judgments. If it returned `approved: boolean`, the judgment would
 *   sink into the adapter, and a second adapter could carry a different policy. Guardian consent
 *   derives "may be a legal guardian" from adulthood in `services/guardian.ts`.
 * - The consumer decides what to store. Guardian consent keeps name and contact under the Korean Personal
 *   Information Protection Act art. 22-2(2). A consumer without that basis discards them.
 * - The identity fields are a closed contract: an opaque reference plus name and contact. There
 *   is no slot for resident registration number, CI, DI, birth date, gender or carrier, because a
 *   slot eventually becomes a column and gets filled. The adapter folds the birth date to an adult
 *   boolean and drops it.
 * - `reference` must not be a CI. The type cannot enforce this. It carries the authority's
 *   transaction id, useful only to reconcile with its records, never to re-identify someone.
 * - The client does not bridge begin and verify. The consumer stores `reference` from `begin` on
 *   its own row, and `verify` receives that stored value. A client-supplied value would let someone
 *   attach another person's verification to their own request.
 * - Fail-closed. With no verifier configured, every consumer returns 503: no child account opens
 *   and no adult eligibility is granted. There is no pass-through default, because a misconfigured
 *   deployment that looks normal would silently never record consent or verify adulthood.
 */

/** Facts the authority answered; judgments (does this count as consent) are not in this type. */
export type IdentityVerification =
	| {
			verified: true;
			/** The authority's opaque transaction reference, not a CI, DI or resident number. */
			reference: string;
			/** When the authority finished the verification; not our clock. */
			verifiedAt: Date;
			/**
			 * Whether the verified person is 19 or older (the Korean Civil Act art. 4). The adapter folds the birth date into
			 * this boolean using the product-timezone calendar and drops the date. Holding it would make it
			 * possible to answer questions we need not answer, and would create leak and disclosure
			 * exposure. This states one fact only. "May be a legal guardian" is the consumer's judgment.
			 */
			adult: boolean;
			/**
			 * Minimum data under the Personal Information Protection Act, Art. 22-2(2) (Korea). Null if
			 * the authority provides none.
			 */
			name: string | null;
			contact: string | null;
	  }
	| {
			verified: false;
			/**
			 * Split only as far as the screen needs different sentences. `declined`: the guardian quit or
			 * has not finished; `failed`: not verified. Folded into one, someone who quit on their own would
			 * be told "failed".
			 */
			reason: "declined" | "failed";
	  };

/** What `begin` returns: how to hand off, and the reference to that attempt. */
export interface IdentityVerificationStart {
	/** How to send the person to the authority; the contract's discriminated union, so the server says what the screen must do. */
	handoff: IdentityVerificationHandoff;
	/** Stored by the server and received again by `verify`. It never passes the client, or it becomes a claim instead of evidence. */
	reference: string;
}

/**
 * Two methods only: `begin` builds the handoff and `verify` turns that attempt's result into a
 * fact. Everything between (screens, authentication, terms) belongs to the authority and is not
 * imitated.
 */
export interface IdentityVerificationProvider {
	/** Kept in audit records as `guardian_consent.verification_provider`. */
	readonly name: string;
	/**
	 * `returnUrl` is built by the server (`webOrigin` in `env.ts`); a client-supplied value would be
	 * an open redirect that sends the consent link to someone else's site. `requestId` is the
	 * consumer's request id; never pass a bearer credential (for guardian consent, the link's token),
	 * or whoever sees it in a third party's logs or referrers owns the procedure.
	 */
	begin(input: {
		requestId: string;
		returnUrl: string;
	}): Promise<IdentityVerificationStart>;
	/** Asks for the result by the stored reference. Taking `requestId` too is a second binding: the adapter can check the pairing, which blocks one reference attaching to several requests. */
	verify(input: {
		requestId: string;
		reference: string;
	}): Promise<IdentityVerification>;
}

/**
 * Dev/test verifier that passes anyone. No path runs it in production: `env.ts` blocks boot on
 * production + `dev`, and `resolveIdentityVerifier` checks again. The cost of this mistake is
 * asymmetric (wrongly blocked fails the deploy visibly; wrongly open silently records consent never
 * given). There is no dev HTTP route: it goes through the same endpoints as production, `begin`
 * returns an address straight back to the web guardian screen and that screen calls `verify` as
 * usual; a separate route would ship in the production bundle and void every defence here. It also
 * builds the same reference shape as the PortOne adapter, since a dev-only shortcut would be a code
 * path production never takes.
 */
/**
 * What the dev verifier answers; only tests change it. Automated tests must cover all three
 * branches (adult, minor, failure); deriving them from browser input or a request body would ship
 * that code to production too. As module state there is no production surface to change it: the
 * setter below throws in production, and the adapter is never resolved there. The default `adult`
 * is the adapter's original behaviour, which the guardian consent tests assume.
 */
export type DevIdentityOutcome = "adult" | "minor" | "failed";

let devOutcome: DevIdentityOutcome = "adult";

/**
 * Pins the dev verifier's result; test-only and throws in production, on the same asymmetric-cost
 * axis `env.ts` already guards (wrongly blocked fails a test visibly; wrongly open silently records
 * unverified adult eligibility).
 */
export function setDevIdentityOutcome(outcome: DevIdentityOutcome): void {
	if (isProduction)
		throw new Error(
			"the development verifier's result can't be changed in production — that adapter isn't resolved in production",
		);
	devOutcome = outcome;
}

/** Restores the default after a test. */
export const resetDevIdentityOutcome = (): void => {
	devOutcome = "adult";
};

const devProvider: IdentityVerificationProvider = {
	name: "dev",
	async begin({ requestId, returnUrl }) {
		const reference = `dev-${requestId}`;
		const url = new URL(returnUrl);
		// Return straight back without the authority. The address carries no result, matching production,
		// where the screen is told only "finished".
		url.searchParams.set("verification", "done");
		return {
			handoff: { kind: "redirect", redirectUrl: url.toString() },
			reference,
		};
	},
	async verify({ requestId, reference }) {
		if (reference !== `dev-${requestId}`)
			return { verified: false, reason: "failed" };
		// The three branches map 1:1 to the port's three shapes. A shape that works only in dev would be
		// a code path production never takes, and tests would verify a road production does not walk.
		if (devOutcome === "failed") return { verified: false, reason: "failed" };
		return {
			verified: true,
			reference,
			verifiedAt: new Date(),
			adult: devOutcome === "adult",
			name: null,
			contact: null,
		};
	},
};

/**
 * This deployment's verifier; `null` blocks every path using the capability. Decided per call
 * rather than at module load so tests can reproduce a deployment with no verifier (503), the most
 * important path in this slice.
 */
export function resolveIdentityVerifier(): IdentityVerificationProvider | null {
	if (!identityVerificationProvider) return null;
	if (identityVerificationProvider === "dev")
		return isProduction ? null : devProvider;
	if (identityVerificationProvider === "portone") {
		// A half configuration means no verifier: with one of three missing, begin works but lookup fails
		// (or lookup works but no window opens), and that surfaces after the guardian is halfway through,
		// when the child has already handed over the link.
		const config = portOneIdentityConfig;
		return config ? createPortOneVerifier(config, newId) : null;
	}
	// Name configured but no adapter: do not pass. A typo must not become a path to consent without
	// verification. Adding another authority adds a branch here, in the same commit as its adapter.
	return null;
}
