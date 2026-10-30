import { API_BASE_PATH, type ApiErrorBody } from "@rowcat/contracts/http";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { type RequestIdVariables, requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { authSurfaceRefusal } from "./auth/http-surface.ts";
import { auth } from "./auth/index.ts";
import type { Viewer } from "./auth/viewer.ts";
import { env, isProduction } from "./env.ts";
import { allowOrigin } from "./lib/allowed-origin.ts";
import { ApiError, badRequest, forbidden, notFound } from "./lib/errors.ts";
import { isLocalHonoRequest } from "./lib/local-request.ts";
import { requestLogger } from "./lib/request-logger.ts";
import { withViewer } from "./middleware/viewer.ts";
import { routes } from "./routes/index.ts";
import { requireFeatureEnabled } from "./services/ops.ts";

export type AppEnv = {
	Variables: RequestIdVariables & {
		/** Resolved once per request; planted by `middleware/viewer.ts`. */
		viewer: () => Promise<Viewer | null>;
	};
};

export const app = new Hono<AppEnv>();

app.use("*", requestId());
app.use("*", requestLogger());

/**
 * Security headers, applied to the JSON API too: without HSTS the first plaintext request can be
 * stripped (the OAuth round trip is exactly that), and `nosniff` on the two image routes alone
 * would leave Better Auth's callback and error responses without it. No CSP (no documents are
 * served). CORP is off because its `same-origin` default blocks the web on another origin from
 * loading `/v2/media` and covers via `<img>` (no-cors requests, not CORS); COEP is off for the same
 * reason.
 */
app.use(
	"*",
	secureHeaders({
		strictTransportSecurity: isProduction
			? "max-age=31536000; includeSubDomains"
			: false,
		xFrameOptions: "DENY",
		referrerPolicy: "no-referrer",
		crossOriginResourcePolicy: false,
		crossOriginEmbedderPolicy: false,
		crossOriginOpenerPolicy: false,
	}),
);

/**
 * CORS runs before the body limit and origin check: an allowed web request can still end in a 413,
 * and without the headers the browser sees only a CORS failure instead of the error envelope.
 * Preflights also end here without reading a body or passing product gates.
 */
app.use(
	`${API_BASE_PATH}/*`,
	cors({
		origin: allowOrigin,
		/**
		 * Custom request headers the browser blocks unless listed here (`Idempotency-Key`). The preflight
		 * passes with a 204 and only the real request dies with `net::ERR_FAILED`: nothing in the server
		 * log, "network failure" on the client, and in-process tests (`app.request`) skip CORS and all
		 * pass.
		 */
		allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
		allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
		/**
		 * Response headers outside the safelist must be listed for scripts to read them. Without
		 * `Retry-After`, a 429 or an "in progress" 409 loses the server's wait time and the client falls
		 * back to its own backoff, hammering a limiter it is already stuck on. Better Auth's limiter
		 * answers with `X-Retry-After`, so that is listed too.
		 */
		exposeHeaders: ["Retry-After", "X-Retry-After"],
		// Session cookies are sent, so the origin must be an allowlist (no `*`).
		credentials: true,
	}),
);

/**
 * Default body cap. `c.req.json()` buffers the whole body before parsing, so zod's `.max()` runs
 * too late; without this line even unauthenticated login routes buffered arbitrary sizes. The value
 * is twice the largest legitimate JSON (chat generation, about 8MB, `contracts/chat.ts`).
 *
 * Routes with their own cap (images, guardian consent) skip this middleware: Hono's `bodyLimit`
 * wraps the stream, so a smaller global cap standing first would void the route's larger one.
 * `app-security.test.ts` reads the route files to check this list against reality.
 */
export const DEFAULT_BODY_LIMIT_BYTES = 16 * 1024 * 1024;
/** Prefix match. */
export const ROUTES_WITH_OWN_BODY_LIMIT: readonly string[] = [
	`${API_BASE_PATH}/me/avatar`,
	`${API_BASE_PATH}/me/scene-images`,
	`${API_BASE_PATH}/me/runtime-assets`,
	`${API_BASE_PATH}/me/runtime-audio`,
	`${API_BASE_PATH}/guardian/`,
];
/** `/v2/stories/:id/cover`; the id sits mid-path so it cannot be a prefix. */
const COVER_PATH = new RegExp(`^${API_BASE_PATH}/stories/[^/]+/cover$`);
const hasOwnBodyLimit = (path: string): boolean =>
	ROUTES_WITH_OWN_BODY_LIMIT.some((prefix) => path.startsWith(prefix)) ||
	COVER_PATH.test(path);
const limitDefaultBody = bodyLimit({
	maxSize: DEFAULT_BODY_LIMIT_BYTES,
	onError: () => {
		throw new ApiError(
			413,
			"payload_too_large",
			"The request body is too large.",
		);
	},
});
app.use(`${API_BASE_PATH}/*`, async (c, next) => {
	if (hasOwnBodyLimit(c.req.path)) return next();
	return limitDefaultBody(c, next);
});

/**
 * CSRF boundary for cookie-carrying product writes. CORS only stops the browser from reading the
 * response, not the request itself, and the web and API are different origins of the same site so
 * SameSite=Lax cookies ride along; a write with an `Origin` header is checked against the exact
 * browser allowlist here.
 *
 * Requests without `Origin` pass: native mobile, SSR and CI reports send none, and blocking them is
 * not CSRF defence. OPTIONS is left to the CORS middleware above.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
app.use(`${API_BASE_PATH}/*`, async (c, next) => {
	const origin = c.req.header("Origin");
	/** Better Auth has its own list (`AUTH_TRUSTED_ORIGINS`) and its own CSRF check. */
	const betterAuthRoute = c.req.path.startsWith(`${API_BASE_PATH}/auth/`);
	if (
		!betterAuthRoute &&
		origin &&
		!SAFE_METHODS.has(c.req.method) &&
		!allowOrigin(origin)
	)
		throw forbidden(
			"This request comes from an origin that isn't allowed.",
			"untrusted_origin",
		);
	await next();
});

/**
 * Signup breaker (`ops` slice), mounted before the Better Auth handler. Middleware is the only
 * place to gate signup alone because Better Auth owns its whole subtree.
 *
 * It blocks email signup only. Social login arrives at `/auth/callback/*` after the provider has
 * already authenticated, so rejecting there shows the error after the Google consent screen; that
 * path is blocked where the member row is created (`ensureMember` in `auth/viewer.ts`), the one
 * point both paths meet.
 *
 * The scope must stay `sign-up`: covering all of `/auth/*` would close login and logout too, and
 * existing members could neither enter nor leave their accounts.
 */
app.use(`${API_BASE_PATH}/auth/sign-up/*`, async (_c, next) => {
	await requireFeatureEnabled("signup");
	await next();
});

/**
 * Mounted before the router: Better Auth owns its whole subtree (callbacks, state, sign-out) and
 * our routes must not intercept any of it. The one exception is what `auth/http-surface.ts` names:
 * endpoints our own routes replace, the Expo relay toward anything but a provider, and the local
 * owner's sign-in from anywhere but this computer. Those are
 * refused here, at the HTTP edge, so our server-side calls into the same operations still work.
 */
app.on(["GET", "POST"], `${API_BASE_PATH}/auth/*`, (c) => {
	const url = new URL(c.req.url);
	const refusal = authSurfaceRefusal(
		url.pathname.slice(`${API_BASE_PATH}/auth`.length),
		url.searchParams,
		() => isLocalHonoRequest(c, allowOrigin),
	);
	if (refusal === "closed") throw notFound();
	if (refusal === "proxy-target")
		throw badRequest("Invalid authorizationURL", "auth_proxy_target_refused");
	return auth.handler(c.req.raw);
});

app.use(`${API_BASE_PATH}/*`, withViewer());
app.route(API_BASE_PATH, routes);

app.notFound((c) =>
	c.json<ApiErrorBody>(
		{
			code: "not_found",
			message: "The address you requested wasn't found.",
			requestId: c.get("requestId"),
		},
		404,
	),
);

app.onError((err, c) => {
	const rid = c.get("requestId");

	if (err instanceof ApiError) {
		/**
		 * `Retry-After` is attached here, not at the throw site or in routes. Three routes once attached
		 * it themselves and any that missed the wiring returned a 429 with no wait time (silent: the
		 * client falls back to its own backoff and keeps hitting the limiter). The error carries the
		 * value (`ApiError.retryAfterSeconds`), so whoever creates a new 429 cannot forget the header. It
		 * must also be in `exposeHeaders` above.
		 */
		if (err.retryAfterSeconds !== null)
			c.header("Retry-After", String(err.retryAfterSeconds));
		return c.json<ApiErrorBody>(
			{
				code: err.code,
				message: err.message,
				requestId: rid,
				/** Only structured values the thrower supplied go out; otherwise the key is absent. */
				...(err.details === undefined ? {} : { details: err.details }),
			},
			err.status,
		);
	}

	if (err instanceof HTTPException) {
		return c.json<ApiErrorBody>(
			{ code: "http_error", message: err.message, requestId: rid },
			err.status,
		);
	}

	// Unexpected exception: the stack goes to the log only, never the response.
	console.error(`[${rid}] unhandled`, err);
	return c.json<ApiErrorBody>(
		{
			code: "internal_error",
			/**
			 * The raw text goes out on development machines only. Testing `NODE_ENV !== "production"` would
			 * make staging and sandbox deployments return Postgres error text (constraint and column names)
			 * to clients.
			 */
			message:
				env.NODE_ENV === "development" || env.NODE_ENV === "test"
					? String(err)
					: "Something went wrong on the server. Please try again in a moment.",
			requestId: rid,
		},
		500,
	);
});

export type App = typeof app;
