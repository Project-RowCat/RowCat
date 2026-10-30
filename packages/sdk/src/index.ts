/**
 * RowCat server client: the only reusable layer that knows endpoint paths and HTTP.
 * - @rowcat/contracts validates the wire format. This package owns transport: base URL, paths,
 *   credentials, cancellation, and error envelope parsing.
 * - @rowcat/domain is the product model used by screens and rules.
 * - Contract and domain shapes match field-for-field because /v2 was designed to align them, so
 *   no copy-only identity mapper is kept. If the wire format diverges, this package absorbs the
 *   difference.
 * - Auth is not here. Better Auth (apps/web/src/lib/auth.ts) owns login and sessions; this
 *   package only sends the session cookie.
 * - No apps/api type imports (no Hono RPC coupling). The boundary is the public contract.
 */
export * from "./admin.ts";
export * from "./admin-mobile-updates.ts";
export * from "./adult-verification.ts";
export * from "./base-url.ts";
export * from "./chat.ts";
export * from "./client.ts";
export * from "./comments.ts";
export * from "./creators.ts";
export * from "./errors.ts";
export * from "./favorites.ts";
export * from "./me.ts";
export * from "./media.ts";
export * from "./membership.ts";
export * from "./moderation.ts";
export * from "./ndjson.ts";
export * from "./notifications.ts";
export * from "./ops.ts";
export * from "./push.ts";
export * from "./setup.ts";
export * from "./social.ts";
export * from "./sse.ts";
export * from "./stories.ts";
export * from "./sync.ts";
export * from "./theme.ts";
