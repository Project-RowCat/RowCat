import { corsOrigins } from "../env.ts";
import { createCorsOriginMatcher } from "./origins.ts";

/**
 * The deployment's browser-origin decision, built once. CORS, the unsafe-method gate in `app.ts` and
 * the local-owner doors (`local-request.ts`) all ask this one matcher: separate matchers over the same
 * list would agree today and drift the day one of them is built from a different source.
 *
 * Passed around as a function rather than an array so rejections get logged; the browser console
 * alone gives the server side no way to see why an origin was refused.
 */
export const allowOrigin = createCorsOriginMatcher(corsOrigins);
