import {
	SETUP_ERROR_CODE,
	SetupClaimRequest,
	type SetupClaimResponse,
	type SetupStatusDto,
} from "@rowcat/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { ApiError, forbidden, invalidInput } from "../lib/errors.ts";
import { requireActiveViewer } from "../lib/gates.ts";
import { noStore, readJson } from "../lib/http.ts";
import { checkRateLimit } from "../lib/rate-limit/index.ts";
import { getViewer } from "../middleware/viewer.ts";
import {
	claimDeploymentSetup,
	readSetupStatus,
} from "../services/setup/index.ts";

/**
 * First-run setup, `/v2/setup` (`services/setup/index.ts` holds the rules).
 *
 * - `GET /` is public: the console's login screen asks it before anyone is signed in. One bit, and
 *   the bit is useless without the code that only the server's log holds.
 * - `POST /claim` requires a signed-in, unrestricted member. The request is the code alone — no role,
 *   no member — so what it can grant and to whom is fixed by the route, not the body.
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
	});
