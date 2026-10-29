import type { PushRegistrationDto } from "@rowcat/contracts";
import { and, eq, isNull, sql } from "drizzle-orm";
import { type Db, db } from "../../db/client.ts";
import { push_registration, session } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type PushExecutor = Db | Tx;

/**
 * Push registration, owned by one authenticated session. No function here takes "whose
 * registration" as an argument, only the resolved member id and the session id of the request,
 * which the route reads from the auth context rather than the body.
 *
 * Eligibility is a predicate, not a column: `disabled_at is null` and a live session
 * (`session."expiresAt" > now`). Copying expiry into a column would go stale on every session
 * refresh. Cascades already handle deleted session rows; the predicate covers expired sessions
 * whose row remains.
 */

/** The screen draws one fact. */
export interface PushRegistrationResult {
	registered: boolean;
}

/**
 * Creates or revives the registration for this session and installation. The key is `(session_id,
 * installation_id)` and the token is a value: using the token as identity would add a row per
 * refresh and the device would get the same notification several times. A row marked `disabled_at`
 * is revived here too, since "the provider did not know that token then" is older than the app
 * arriving now with a fresh token.
 */
export async function registerPushInstallation(input: {
	memberId: string;
	sessionId: string;
	registration: PushRegistrationDto;
	now: Date;
	executor?: PushExecutor;
}): Promise<PushRegistrationResult> {
	const executor = input.executor ?? db;
	await executor
		.insert(push_registration)
		.values({
			id: newId(),
			member_id: input.memberId,
			session_id: input.sessionId,
			installation_id: input.registration.installationId,
			platform: input.registration.platform,
			provider: input.registration.provider,
			token: input.registration.token,
			created_at: input.now,
			refreshed_at: input.now,
		})
		.onConflictDoUpdate({
			target: [push_registration.session_id, push_registration.installation_id],
			set: {
				token: input.registration.token,
				platform: input.registration.platform,
				provider: input.registration.provider,
				refreshed_at: input.now,
				disabled_at: null,
			},
		});
	return { registered: true };
}

/**
 * Removes the registration bound to the current session. It takes no installation id: "this device"
 * is "this session", and a body-supplied id would make a request pointing at someone else's
 * installation expressible (the ownership predicate would delete 0 rows, but better not
 * expressible). It deletes rather than marks because `disabled_at` is a provider fact while this is
 * a user decision, and a mark would be silently revived by the next refresh. Idempotent, and the
 * count is not returned so the response cannot detect whether the session had a registration.
 */
export async function removePushInstallation(input: {
	memberId: string;
	sessionId: string;
	executor?: PushExecutor;
}): Promise<void> {
	const executor = input.executor ?? db;
	await executor
		.delete(push_registration)
		.where(
			and(
				eq(push_registration.member_id, input.memberId),
				eq(push_registration.session_id, input.sessionId),
			),
		);
}

/**
 * Disables a registration the provider said it does not know. Not deleted, so a later refresh by
 * the same installation clears the mark and the history can answer why deliveries were not made
 * (see the `db/tables/push.ts` header). An already disabled row is not touched again: this runs
 * once per delivery in a batch, and moving the timestamp would turn "when did it die" into "last
 * attempt".
 */
export async function disablePushRegistration(input: {
	registrationId: string;
	now: Date;
	executor?: PushExecutor;
}): Promise<void> {
	const executor = input.executor ?? db;
	await executor
		.update(push_registration)
		.set({ disabled_at: input.now })
		.where(
			and(
				eq(push_registration.id, input.registrationId),
				isNull(push_registration.disabled_at),
			),
		);
}

/**
 * Predicate for registrations that can be delivered to now, shared by the creating side
 * (`enqueue.ts`) and the sending side so a delivery is never created that can never be sent.
 */
export const activePushRegistrationPredicate = sql`
	${push_registration.disabled_at} is null
	and exists (
		select 1 from ${session}
		where ${session.id} = ${push_registration.session_id}
			and ${session.expiresAt} > now()
	)
`;
