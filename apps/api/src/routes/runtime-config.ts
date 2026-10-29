import type { RuntimeConfigDto } from "@rowcat/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { readRuntimeConfig } from "../services/ops.ts";

/**
 * Public runtime config — `GET /v2/runtime-config`.
 *
 * Read once at client boot. There is no session (no gate, no viewer lookup) because the login
 * screen and first run must see it: an app needs to know signup is closed before signing in.
 *
 * This response is not authorization. A client that ignores a value and sends the request anyway is
 * refused by the server (`requireFeatureEnabled`); the endpoint only avoids drawing dead buttons.
 *
 * It is identical for everyone, so it can sit in shared caches (`public, max-age=30`); that
 * freshness sets how fast a switch reaches newly booting apps. Already-open apps learn from server
 * refusals, so there is no polling or SSE.
 *
 * The operator axis (`updatedBy`, `updatedAt`, internal reason) has no slot in `RuntimeConfigDto`
 * rather than being filtered out; a member id here would be a public leak.
 */
export const runtimeConfig = new Hono<AppEnv>().get("/", async (c) => {
	const body: RuntimeConfigDto = await readRuntimeConfig();
	c.header("Cache-Control", "public, max-age=30");
	return c.json(body);
});
