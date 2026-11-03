import { translator } from "#/lib/i18n/current.ts";
import type { DraftArchiveFailure } from "./draft-archive.ts";

/**
 * One sentence per reason, shared by both directions. The archive's own detail (which field, which
 * file) is for logs and bug reports, never the screen: it names hashes and paths the person did not
 * write. An unknown failure gets the generic sentence rather than a guess.
 */
export const archiveFailureMessage = (
	reason: DraftArchiveFailure | null,
): string =>
	translator("create")(
		reason === null ? "archive.failure.generic" : `archive.failure.${reason}`,
	);
