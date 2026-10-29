/**
 * Reads what went wrong from a Postgres driver error.
 *
 * Concurrency rules here usually pair a friendly pre-check for common conflicts (`assertCodeFree`,
 * `ensureOpenCase`) with the database constraint as final authority, and there is always a window
 * between them (two transactions both read "empty" and both write). The loser receives a driver
 * exception, which left alone turns the intended 409 into a silent 500 the screen cannot draw as a
 * domain failure.
 *
 * - Lookup is by `(SQLSTATE, constraint name)`, and each caller translates only the one invariant
 *   it knows; folding every unique violation into 409 would disguise unrelated failures. Unknown
 *   errors propagate.
 * - The `cause` chain is followed because drizzle sometimes wraps the driver error, leaving no
 *   code on the top object.
 */

/** Unique violation. */
export const PG_UNIQUE_VIOLATION = "23505";

/** Bounds the chain walk; circular `cause` chains exist. */
const MAX_CAUSE_DEPTH = 5;

export interface PostgresErrorInfo {
	/**
	 * Name of the violated constraint or index (Postgres puts unique index names in the constraint
	 * field too). `null` when the driver gives none, which makes a caller's narrow check false: it
	 * errs toward not folding unknown errors into domain errors.
	 */
	constraint: string | null;
}

/** Whether this error (or one of its causes) has the given SQLSTATE; returns its metadata if so. */
export function findPostgresError(
	error: unknown,
	sqlState: string,
): PostgresErrorInfo | null {
	let current: unknown = error;
	for (let depth = 0; depth < MAX_CAUSE_DEPTH && current; depth++) {
		if (typeof current !== "object") return null;
		if ((current as { code?: unknown }).code === sqlState) {
			const constraint = (current as { constraint?: unknown }).constraint;
			return {
				constraint: typeof constraint === "string" ? constraint : null,
			};
		}
		current = (current as { cause?: unknown }).cause ?? null;
	}
	return null;
}

/**
 * Unique violation of any constraint. Only for sites where the insert can hit a single unique
 * constraint; otherwise use the narrow check below.
 */
export const isUniqueViolation = (error: unknown): boolean =>
	findPostgresError(error, PG_UNIQUE_VIOLATION) !== null;

/** Unique violation of that one constraint; a different name is false, so other constraints' failures are not disguised. */
export const isUniqueViolationOn = (
	error: unknown,
	constraint: string,
): boolean =>
	findPostgresError(error, PG_UNIQUE_VIOLATION)?.constraint === constraint;
