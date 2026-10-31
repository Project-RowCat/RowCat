import { DrizzleQueryError } from "drizzle-orm/errors";

/**
 * What an exception may put in the server log.
 *
 * A failed query surfaces as drizzle's `DrizzleQueryError`, whose message, stack and `params` carry
 * every bound value — a keyring, an `auth_key`, a pairing payload or ciphertext on the sync writes;
 * a session token, a password hash or a verification value on Better Auth's. A pool timeout or a
 * restart during a deploy is enough to trigger it, so the log of an ordinary incident held material
 * the secret-logging scan exists to keep out. The scan reads call sites; it cannot see what a
 * library puts inside an error object.
 *
 * A query error is found anywhere in the cause chain, because libraries wrap it (Better Auth's
 * `APIError`), and a wrapper's own message may quote the inner one. What survives is the outer
 * name, the SQL text (placeholders only), the driver's SQLSTATE and its message. The driver's
 * `detail` is dropped too: for a unique violation it spells out the conflicting key. Anything with
 * no query error inside is returned as it was.
 */
export function loggableError(error: unknown): unknown {
	const query = queryErrorIn(error);
	if (query === null) return error;
	const cause = query.cause as
		| { code?: unknown; message?: unknown }
		| undefined;
	return {
		name: error instanceof Error ? error.name : "DrizzleQueryError",
		query: query.query,
		cause: cause
			? {
					code: typeof cause.code === "string" ? cause.code : undefined,
					message:
						typeof cause.message === "string" ? cause.message : undefined,
				}
			: undefined,
	};
}

/** Bounds the walk; circular `cause` chains exist. */
const MAX_CAUSE_DEPTH = 5;

function queryErrorIn(error: unknown): DrizzleQueryError | null {
	let current: unknown = error;
	for (let depth = 0; depth < MAX_CAUSE_DEPTH && current; depth++) {
		if (current instanceof DrizzleQueryError) return current;
		if (typeof current !== "object") return null;
		current = (current as { cause?: unknown }).cause;
	}
	return null;
}

/** The same rule for a value that will be printed as text. */
export const loggableErrorText = (error: unknown): string => {
	const safe = loggableError(error);
	return safe === error ? String(error) : JSON.stringify(safe);
};
