import {
	SetupClaimLocalRequest,
	SetupClaimRequest,
	SetupClaimResponse,
	SetupStatusDto,
} from "@rowcat/contracts";
import type { RequestOptions, RowCatTransport } from "./client.ts";
import { invalidResponse } from "./errors.ts";

/**
 * First-run setup, `/v2/setup`. Only `apps/admin` calls it.
 *
 * Its own resource rather than a method on `admin`: the callers are not operators yet. The status
 * is read on the console's login screen before anyone is signed in, and the claim is made by a member
 * whose role is still `user` — under `admin` it would read as an operator call that happens to
 * succeed for non-operators.
 *
 * `claim` takes the code as typed. Folding it is the server's (`normalizeSetupCode`), so the console
 * cannot accept a shape the server refuses; the SDK validates only the request's outline.
 */
export interface SetupApi {
	status(options?: RequestOptions): Promise<SetupStatusDto>;
	claim(code: string, options?: RequestOptions): Promise<SetupClaimResponse>;
	/**
	 * Set up for use without signing in: the server creates the local owner and makes it admin. It
	 * opens only to a request from the computer the API runs on (`setup_local_unavailable` otherwise),
	 * and it does not sign in — the caller asks Better Auth's `local-sign-in` for the session next, the
	 * same door every later page load uses.
	 */
	claimLocal(
		input: SetupClaimLocalRequest,
		options?: RequestOptions,
	): Promise<SetupClaimResponse>;
}

export function createSetupApi({ requestJson }: RowCatTransport): SetupApi {
	return {
		async status(options) {
			const json = await requestJson({
				method: "GET",
				path: "/setup",
				signal: options?.signal,
			});
			const parsed = SetupStatusDto.safeParse(json);
			if (!parsed.success) throw invalidResponse("/setup");
			return parsed.data;
		},

		async claim(code, options) {
			const json = await requestJson({
				method: "POST",
				path: "/setup/claim",
				body: SetupClaimRequest.parse({ code }),
				signal: options?.signal,
			});
			const parsed = SetupClaimResponse.safeParse(json);
			if (!parsed.success) throw invalidResponse("POST /setup/claim");
			return parsed.data;
		},

		async claimLocal(input, options) {
			const json = await requestJson({
				method: "POST",
				path: "/setup/claim-local",
				body: SetupClaimLocalRequest.parse(input),
				signal: options?.signal,
			});
			const parsed = SetupClaimResponse.safeParse(json);
			if (!parsed.success) throw invalidResponse("POST /setup/claim-local");
			return parsed.data;
		},
	};
}
