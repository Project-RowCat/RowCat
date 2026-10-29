import {
	type AdultVerificationStartDto,
	AdultVerificationStartDto as AdultVerificationStartSchema,
	ViewerDto,
} from "@rowcat/contracts";
import type { Viewer } from "@rowcat/domain";
import type { RequestOptions, RowCatTransport } from "./client.ts";
import { invalidResponse } from "./errors.ts";

/**
 * Adult-eligibility verification: the member's own identity check.
 *
 * - Kept separate from `membership`. That resource has two identities (the member's session and a
 *   guardian's one-time token). Here there is one: always the requesting member, so there is no
 *   slot for a target. Merging would make that property false for half the resource and would make
 *   "a guardian's verification" and "my verification" interchangeable neighbors.
 * - Only two functions, and neither sends a value. No return URL, case id, attempt id, or result
 *   comes from the client. The server decides these or re-asks the verifier with its own secret.
 * - The result is not interpreted here. `complete` returns the confirmed viewer, and eligibility
 *   is read from that value (`isAdultEligible`). Collapsing it to a boolean would give the same
 *   fact two shapes, and each screen would trust a different one.
 */
export interface AdultVerificationApi {
	/**
	 * Starts verification. Takes the **method** to use, not a URL.
	 *
	 * Verifiers differ, so the type is a discriminated union. The screen does not proceed on an
	 * unknown kind, and the client also fails closed.
	 *
	 * The return URL is not sent. The server builds it from its canonical origin. Passing a client
	 * value to the verifier would make that parameter an open redirect.
	 */
	begin(options?: RequestOptions): Promise<AdultVerificationStartDto>;
	/**
	 * Tells the server that verification finished. The body is empty by design.
	 *
	 * A "success" reported by the browser SDK is only a value inside that browser. The server asks the
	 * verifier with its own secret and decides there. This call only says "finished, please verify."
	 *
	 * Returns the confirmed viewer, and the screen stores that value in the cache as-is.
	 */
	complete(options?: RequestOptions): Promise<Viewer>;
}

const BEGIN_PATH = "/me/adult-verification";
const VERIFY_PATH = "/me/adult-verification/verify";

export function createAdultVerificationApi({
	requestJson,
}: RowCatTransport): AdultVerificationApi {
	return {
		async begin(options) {
			const json = await requestJson({
				method: "POST",
				path: BEGIN_PATH,
				/**
				 * Omitting `body` is the most important line in this function. Even an empty object would
				 * eventually gain a field, and that field would become a return address.
				 */
				signal: options?.signal,
			});
			const parsed = AdultVerificationStartSchema.safeParse(json);
			if (!parsed.success) throw invalidResponse(BEGIN_PATH);
			return parsed.data;
		},

		async complete(options) {
			const json = await requestJson({
				method: "POST",
				path: VERIFY_PATH,
				signal: options?.signal,
			});
			/**
			 * Does not trust a 200 as-is. This value unlocks adult eligibility. A mismatched shape could
			 * either show eligibility to someone unverified (an empty object leaked by the server) or roll
			 * someone who just finished verifying back to an old state.
			 */
			const parsed = ViewerDto.safeParse(json);
			if (!parsed.success) throw invalidResponse(VERIFY_PATH);
			// The contract and the domain Viewer currently have 1:1 fields, so no identity mapper is kept.
			return parsed.data;
		},
	};
}
