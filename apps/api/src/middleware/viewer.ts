import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.ts";
import { resolveViewer, type Viewer } from "../auth/viewer.ts";

/**
 * Binds viewer resolution to once per request.
 *
 * A getter is planted instead of resolving eagerly in middleware because the session lookup is two
 * DB round trips (session, member) that paths like `/health` must not pay. Handlers often ask
 * several times (gate decision plus query parameters), so the promise itself is cached and
 * concurrent calls also go out once.
 */
export const withViewer = (): MiddlewareHandler<AppEnv> => async (c, next) => {
	let pending: Promise<Viewer | null> | undefined;
	c.set("viewer", () => {
		pending ??= resolveViewer(c.req.raw.headers);
		return pending;
	});
	await next();
};

/** `const viewer = await getViewer(c)`; null when signed out. */
export const getViewer = (c: Context<AppEnv>): Promise<Viewer | null> =>
	c.get("viewer")();
