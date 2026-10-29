import {
	type PushRegistrationDto,
	PushRegistrationResponse,
	PushRegistrationDto as PushRegistrationSchema,
} from "@rowcat/contracts";
import type { RequestOptions, RowCatTransport } from "./client.ts";
import { invalidRequest, invalidResponse } from "./errors.ts";

/**
 * Native push registration: two operations on one install.
 *
 * It sits beside notifications as a separate resource because the questions differ. Notifications
 * ask what happened, are paged by cursor, and are polled often. Registration says whether this
 * device is ready to receive, and is stated once per login.
 *
 * There is no `list()` by design. The server has no such response. The reason is in the contract
 * header, where the session list already offers that operation.
 *
 * Neither function takes a member, session, or install id to target. The install id passed to
 * `register` is the caller's own. The target is always the session that sent the request, and
 * identity comes only from the cookie.
 */
export interface PushApi {
	/**
	 * Creates or updates this install's registration. The call is idempotent: repeating it with the
	 * same values adds no rows, and a changed token updates that value.
	 */
	register(
		input: PushRegistrationDto,
		options?: RequestOptions,
	): Promise<boolean>;

	/**
	 * Turns push off on this device. The call is idempotent: it succeeds even when no registration
	 * exists. It does not report how many were removed, since that count would itself reveal whether
	 * the session had a registration.
	 *
	 * It does not revert the OS notification permission. The app cannot do that. The operation means
	 * only that the RowCat server stops sending push to this install.
	 */
	unregister(options?: RequestOptions): Promise<void>;
}

const BASE = "/me/push/registration";

export function createPushApi({ requestJson }: RowCatTransport): PushApi {
	return {
		async register(input, options) {
			// Input is also filtered by the contract. The server uses `.strict()`, so a shape mismatch is a
			// 400.
			const parsed = PushRegistrationSchema.safeParse(input);
			if (!parsed.success)
				throw invalidRequest(
					`PUT ${BASE}`,
					parsed.error.issues[0]?.message ?? "Invalid registration request",
				);

			const json = await requestJson({
				method: "PUT",
				path: BASE,
				body: parsed.data,
				signal: options?.signal,
			});
			const response = PushRegistrationResponse.safeParse(json);
			if (!response.success) throw invalidResponse(`PUT ${BASE}`);
			return response.data.registered;
		},

		async unregister(options) {
			await requestJson({
				method: "DELETE",
				path: BASE,
				signal: options?.signal,
			});
		},
	};
}
