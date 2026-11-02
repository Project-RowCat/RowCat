import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "../db/client.ts";
import { verification } from "../db/schema.ts";
import { newId } from "../lib/id.ts";

/**
 * Storage for the native app's one-time session hand-off (`@rowcat/contracts`' `app-session-handoff.ts`
 * says what the hand-off is and why it exists).
 *
 * A row lives in Better Auth's `verification` table — the table the library already keeps for
 * short-lived, single-use secrets, and the one the retention job already sweeps by `expiresAt`
 * (`jobs/legal/retention-policies.ts`). A table of our own would be one more place expired secrets
 * could outlive their purpose.
 *
 * ```text
 * identifier   app-session-handoff:<sha256(code)>   the code itself is never stored
 * value        { binding, sessionToken }             the session the browser just created
 * expiresAt    now + 2 minutes                       the app redeems the moment the browser closes
 * ```
 *
 * Redemption is **one statement** — `DELETE … RETURNING` on an unexpired row — so a code is spent
 * whether or not the verifier then matches. Two concurrent redeems cannot both get the session, and a
 * party that intercepted the code but has no verifier can at most spend it, which gains them nothing:
 * the redirect that carried it was already theirs, not the app's.
 */

const IDENTIFIER_PREFIX = "app-session-handoff:";
export const APP_SESSION_HANDOFF_TTL_MS = 2 * 60_000;

const identifierFor = (code: string): string =>
	`${IDENTIFIER_PREFIX}${createHash("sha256").update(code).digest("hex")}`;

interface StoredHandoff {
	binding: string;
	sessionToken: string;
}

export async function saveAppSessionHandoff(
	code: string,
	handoff: StoredHandoff,
	now: Date = new Date(),
): Promise<void> {
	await db.insert(verification).values({
		id: newId(),
		identifier: identifierFor(code),
		value: JSON.stringify(handoff),
		expiresAt: new Date(now.getTime() + APP_SESSION_HANDOFF_TTL_MS),
		createdAt: now,
		updatedAt: now,
	});
}

/** Spends the code. `null` when it is unknown, expired, already spent or the row is malformed. */
export async function takeAppSessionHandoff(
	code: string,
	now: Date = new Date(),
): Promise<StoredHandoff | null> {
	const [row] = await db
		.delete(verification)
		.where(
			and(
				eq(verification.identifier, identifierFor(code)),
				gt(verification.expiresAt, now),
			),
		)
		.returning({ value: verification.value });
	if (!row) return null;
	try {
		const parsed = JSON.parse(row.value) as Partial<StoredHandoff>;
		return typeof parsed.binding === "string" &&
			typeof parsed.sessionToken === "string"
			? { binding: parsed.binding, sessionToken: parsed.sessionToken }
			: null;
	} catch {
		return null;
	}
}
