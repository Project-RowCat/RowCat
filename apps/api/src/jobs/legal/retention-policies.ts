import type { SQL } from "drizzle-orm";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import {
	guardian_consent,
	identity_verification,
	session,
	sync_pairing,
	verification,
} from "../../db/schema.ts";

/**
 * The registry of records judged expired by retention period.
 *
 * The rule is: do not infer the law. What is registered here are records that have no use once
 * they expire: the period is the record's own lifetime, already enforced elsewhere in the code (a
 * token, session, link, attempt or relay that has expired is refused wherever it is presented),
 * so keeping the row past it only holds personal data nothing reads. A category is registered only
 * when all four are settled: which table and rows, a period that already exists in the code (not a
 * number invented for this file), which column marks the period's start, and whether the action is
 * deletion or anonymization. If any is open the category goes to `UNRESOLVED_RETENTION` with its
 * reason and nothing here deletes it. Do not fill unresolved categories just because the registry
 * looks empty; that puts irreversible deletion on a guess.
 *
 * Not here:
 * - Automatic deletion of long-dormant accounts: the software has no such mechanism, and adding
 *   one is a deployment's policy decision, not an expiry.
 * - Sync records, conversations, drafts: they last until the member deletes them.
 * - `sync_push_dedupe`: the push path sweeps expired rows opportunistically, that table's comment
 *   decided on no separate worker, and it is not a statutory retention category.
 */

/** One deletion target. */
export interface RetentionPolicy {
	readonly id: string;
	/**
	 * The lifetime that makes the record useless once it passes; without one it is not eligible for
	 * registration.
	 */
	readonly source: string;
	/** Human-readable period; `expired` does the actual computation. */
	readonly period: string;
	/**
	 * Deletion is the only value because every category needing anonymization is unresolved; a
	 * pre-declared `"anonymize"` would invite code that fills it.
	 */
	readonly action: "delete";
	readonly table: PgTable;
	/**
	 * Selects the rows to delete as of `now`. Taking `now` as an argument keeps the cutoff fixed
	 * within a run and lets tests pin the boundary by value.
	 */
	expired(now: Date): SQL;
}

/**
 * ⚠️ These five follow lifetimes the code already enforces. A deployment whose privacy policy
 * states retention periods should state these; changing a value here without changing that
 * document makes the policy the one that lies.
 */
export const RETENTION_POLICIES: readonly RetentionPolicy[] = [
	{
		id: "auth.verification-token",
		source:
			"email verification, email change and password reset tokens — useless after expiry (1 hour)",
		period: "the token's own validity (1 hour)",
		action: "delete",
		table: verification,
		/**
		 * The token lifetime is the retention period: an expired token is useless everywhere (Better Auth
		 * checks that time), so keeping it only holds unused personal data. The camelCase column is
		 * Better Auth's schema.
		 */
		expired: (now) => lt(verification.expiresAt, now),
	},
	{
		id: "auth.session",
		source: "sessions — cannot authenticate after expiry (30 days)",
		period: "30 days (the session row's expiry time)",
		action: "delete",
		table: session,
		/**
		 * An expired session row no longer authenticates but still records when and from which device
		 * someone connected, which has no use past the session's own 30 days. Sign-out does not wait for this job;
		 * Better Auth deletes the row immediately.
		 */
		expired: (now) => lt(session.expiresAt, now),
	},
	{
		id: "guardian.abandoned-request",
		source:
			"guardian consent request links — do not open after expiry (24 hours)",
		period: "the link's validity (24 hours)",
		action: "delete",
		table: guardian_consent,
		/**
		 * Deletes only abandoned requests, never consent records. The table holds both: consent records
		 * required by PIPA art. 22-2 (approve, decline, revoke), kept for the account's lifetime, and
		 * links that expired unopened, kept 24 hours. Hence four predicates: an open status
		 * (`pending`/`verified`), expired, with neither consent nor decline recorded. Such a row may hold
		 * a guardian's name and contact (verified, then the consent screen was closed), which is a third
		 * party's personal data with no basis to keep once the purpose is gone.
		 *
		 * `revoked` is left alone: a new request closes the previous one with that status, so some
		 * revoked rows have no consent, but whether they are deletable is not settled.
		 */
		expired: (now) =>
			and(
				sql`${guardian_consent.status} in ('pending', 'verified')`,
				lt(guardian_consent.expires_at, now),
				isNull(guardian_consent.consented_at),
				isNull(guardian_consent.declined_at),
			) as SQL,
	},
	{
		id: "identity.abandoned-attempt",
		source:
			"identity verification attempts — cannot complete after expiry (30 minutes)",
		period: "the attempt's validity (30 minutes)",
		action: "delete",
		table: identity_verification,
		/**
		 * A finished verification is a record: `verified`/`failed` rows are the audit trail of what the
		 * account went through and last for its lifetime. Only `pending` attempts
		 * abandoned with the window open are deleted.
		 */
		expired: (now) =>
			and(
				eq(identity_verification.status, "pending"),
				lt(identity_verification.expires_at, now),
			) as SQL,
	},
	{
		id: "sync.pairing-relay",
		source:
			"device pairing relays — no device can use them after expiry (5 minutes)",
		period: "the relay's validity (5 minutes)",
		action: "delete",
		table: sync_pairing,
		/**
		 * The table's own comment says rows vanish when consumed, cancelled or expired, but only the
		 * opportunistic cleanup at the next pairing start made that true; if nobody paired again, a
		 * sealed DEK envelope stayed forever. An expired relay is unusable by either device.
		 */
		expired: (now) => lt(sync_pairing.expires_at, now),
	},
];

/**
 * Intentionally inactive categories, kept as documentation so "not in the registry" can be told
 * from "forgotten" (someone seeing no access log should find here why there is none). These are
 * decisions a deployment's own privacy policy makes, not expiries this software can read off a
 * record. The deletion path never reads this; the job logs its count each run, and a test checks
 * that no table named here has a deletion predicate.
 */
export interface UnresolvedRetention {
	readonly id: string;
	/** Whether the period is settled; a settled period stays here if the scope is open. */
	readonly period: string;
	/** What blocks it. */
	readonly blockedBy: string;
	readonly reason: string;
}

export const UNRESOLVED_RETENTION: readonly UnresolvedRetention[] = [
	{
		id: "consumer-dispute",
		period:
			"3 years (Korean E-Commerce Act Enforcement Decree art. 6 — settled)",
		blockedBy: "no such data",
		reason:
			"this product has no inquiry or dispute handling system. Listing a policy with no target means that slot eventually gets filled with the wrong table",
	},
	{
		id: "advertising-record",
		period:
			"6 months (Korean E-Commerce Act Enforcement Decree art. 6 — settled)",
		blockedBy: "no such data",
		reason: "no advertising",
	},
	{
		id: "access-log",
		period:
			"3 months (Korean Protection of Communications Secrets Act Enforcement Decree art. 41 — whether it applies is unresolved)",
		blockedBy: "for the deployment's privacy policy to decide",
		reason:
			"the DB has no access log table. Everything is the process's stdout and the deployment's reverse proxy logs, and the latter is outside the repository, so this repository's jobs cannot enforce it",
	},
];
