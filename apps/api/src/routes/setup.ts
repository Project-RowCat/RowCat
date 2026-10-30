import {
	SETUP_ERROR_CODE,
	SetupClaimLocalRequest,
	SetupClaimRequest,
	type SetupClaimResponse,
	type SetupStatusDto,
} from "@rowcat/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { allowOrigin } from "../lib/allowed-origin.ts";
import { ApiError, forbidden, invalidInput } from "../lib/errors.ts";
import { requireActiveViewer } from "../lib/gates.ts";
import { noStore, readJson } from "../lib/http.ts";
import { isLocalHonoRequest } from "../lib/local-request.ts";
import { checkRateLimit } from "../lib/rate-limit/index.ts";
import { getViewer } from "../middleware/viewer.ts";
import {
	claimDeploymentSetup,
	readSetupStatus,
} from "../services/setup/index.ts";
import { claimLocalOwner } from "../services/setup/local-owner.ts";

/**
 * First-run setup, `/v2/setup` (`services/setup/index.ts` holds the rules).
 *
 * - `GET /` is public: the console's login screen asks it before anyone is signed in. One bit, and
 *   the bit is useless without the code that only the server's log holds.
 * - `POST /claim` requires a signed-in, unrestricted member. The request is the code alone — no role,
 *   no member — so what it can grant and to whom is fixed by the route, not the body.
 * - `POST /claim-local` requires no session and creates the member it promotes (the local owner,
 *   `services/setup/local-owner.ts`). It opens only to a request from this computer — anywhere else
 *   is a 403 that says to set up with an account — and the code is still the authority.
 */
export const setup = new Hono<AppEnv>()
	.get("/", async (c) => {
		const body: SetupStatusDto = await readSetupStatus();
		noStore(c);
		return c.json(body);
	})

	.post("/claim", async (c) => {
		const viewer = requireActiveViewer(await getViewer(c));
		/** Every attempt counts, before the body is read, so a malformed body is not a free try. */
		await checkRateLimit("setupClaim", viewer.id);

		const parsed = SetupClaimRequest.safeParse(await readJson(c));
		if (!parsed.success) throw invalidInput(parsed.error);

		const outcome = await claimDeploymentSetup({
			memberId: viewer.id,
			code: parsed.data.code,
		});
		if (outcome === "closed")
			throw new ApiError(
				409,
				SETUP_ERROR_CODE.closed,
				"Setup is already complete.",
			);
		if (outcome === "invalid")
			throw forbidden(
				"That setup code isn't right. Copy it again from the API log.",
				SETUP_ERROR_CODE.invalidCode,
			);

		const body: SetupClaimResponse = { memberId: viewer.id };
		noStore(c);
		return c.json(body);
	})

	.post("/claim-local", async (c) => {
		/** Before the counter: a remote caller is not a guess at the code, and must not use up this computer's tries. */
		if (!isLocalHonoRequest(c, allowOrigin))
			throw forbidden(
				"Using it without signing in can only be set up on the computer it runs on. Set it up with an account instead.",
				SETUP_ERROR_CODE.localUnavailable,
			);
		await checkRateLimit("setupClaimLocal", "deployment");

		const parsed = SetupClaimLocalRequest.safeParse(await readJson(c));
		if (!parsed.success) throw invalidInput(parsed.error);

		const result = await claimLocalOwner(parsed.data);
		if (result.outcome === "closed")
			throw new ApiError(
				409,
				SETUP_ERROR_CODE.closed,
				"Setup is already complete.",
			);
		if (result.outcome === "invalid")
			throw forbidden(
				"That setup code isn't right. Copy it again from the API log.",
				SETUP_ERROR_CODE.invalidCode,
			);

		const body: SetupClaimResponse = { memberId: result.memberId };
		noStore(c);
		return c.json(body);
	});
