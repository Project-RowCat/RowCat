import {
	PushRegistrationDto,
	type PushRegistrationResponse,
} from "@rowcat/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { resolveSessionId } from "../../auth/session-id.ts";
import { invalidInput, unauthorized } from "../../lib/errors.ts";
import { requireViewer } from "../../lib/gates.ts";
import { getViewer } from "../../middleware/viewer.ts";
import {
	registerPushInstallation,
	removePushInstallation,
} from "../../services/push/registrations.ts";

/**
 * Native push registration: two operations on this one installation.
 *
 * ```text
 * PUT     /v2/me/push/registration   register or refresh (idempotent)
 * DELETE  /v2/me/push/registration   turn off on this device (idempotent)
 * ```
 *
 * - No `GET`, on purpose. A "my devices" response would inevitably grow a remote-revoke button
 *   next to it, and that already exists as the session list (`/me/account/sessions`): registrations
 *   are bound to sessions, so ending a session ends its push.
 * - Ownership is not in the body. The member and session id both come from the request's session;
 *   the body carries only the installation id, platform and token, and the `.strict()` contract
 *   rejects a `memberId` with a 400.
 * - Gate is `requireViewer`: a suspended or blocked member must still be able to receive
 *   notifications (the sanction reason lives in that inbox). This is the member's own receive
 *   setting, not an outward interaction; `/me/notifications` made the same call.
 * - A disabled transport does not reject. Registration says "this device is ready" while
 *   transport is deployment state; a 503 here would force every device to re-register the day
 *   transport turns on. `env:doctor` reports that nothing is being sent.
 */
export const mePush = new Hono<AppEnv>()
	.put("/registration", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const sessionId = await resolveSessionId(c.req.raw.headers);
		// A registration bound to no session would survive sign-out, so refuse.
		if (!sessionId) throw unauthorized();

		const parsed = PushRegistrationDto.safeParse(
			await c.req.json().catch(() => null),
		);
		if (!parsed.success) throw invalidInput(parsed.error);

		const body: PushRegistrationResponse = await registerPushInstallation({
			memberId: viewer.id,
			sessionId,
			registration: parsed.data,
			now: new Date(),
		});
		c.header("Cache-Control", "no-store");
		return c.json(body);
	})
	.delete("/registration", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const sessionId = await resolveSessionId(c.req.raw.headers);
		if (!sessionId) throw unauthorized();

		await removePushInstallation({ memberId: viewer.id, sessionId });
		// The removed count is not reported: it would reveal whether that session had a registration.
		const body: PushRegistrationResponse = { registered: false };
		c.header("Cache-Control", "no-store");
		return c.json(body);
	});
