import { z } from "zod";

/**
 * Transport-layer contract: the part above route schemas that decides where requests go. The server
 * (apps/api) and the client (@rowcat/sdk) both depend on this package. If each side kept its own
 * copy, editing only one would leave the types valid and fail with 404s at runtime only.
 */

/**
 * Breaking changes do not bump this value. A new `/v3` is opened alongside `/v2`, and the old
 * version is removed afterward.
 */
export const API_VERSION = "v2";

/**
 * The API lives on a dedicated host (e.g. api.example.com), so the path adds no `/api` prefix. Keep
 * the value a string literal type (`/v2`) so Hono's route types track the real URL.
 */
export const API_BASE_PATH = `/${API_VERSION}` as const;

/**
 * Every failure response on `/v2` has this shape regardless of status code. A machine-readable
 * `code` is included because status codes alone cannot drive client branching. Cases with the same
 * status already rely on it: the gallery gate (`GALLERY_ERROR_CODE`) distinguishes reasons within
 * one 403.
 *
 * If the server wrote this shape in its own code, the SDK would copy it, and editing one side would
 * break at runtime while the types still pass. How the server builds the envelope (such as Hono's
 * exception classes) is out of scope. Only the shape on the wire belongs to the contract.
 */
export const ApiErrorBody = z.object({
	code: z.string(),
	message: z.string(),
	/**
	 * Request tracing ID. Users typically bring this in a screenshot, so it is the only clue they
	 * have.
	 */
	requestId: z.string().optional(),
	/**
	 * Structured data attached to the failure. Its shape is decided by the code that raises it, and
	 * the field is absent by default. It is not free-form. Each code using it has its own schema
	 * (currently only `StoryRuntimePublishFailure` for `story_runtime_invalid`), and the screen parses
	 * the value with that schema. The envelope types it as `unknown` so it does not need to know those
	 * shapes.
	 *
	 * Server internals never go here: stack traces, file paths, or driver messages. `onError` does not
	 * populate this field for unknown exceptions.
	 */
	details: z.unknown().optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
