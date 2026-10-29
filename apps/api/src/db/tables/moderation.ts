import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { member } from "./member.ts";
import { story } from "./story.ts";

/**
 * Moderation: reports, cases, actions, appeals.
 *
 * Four tables on purpose. Folding them into one table with a `type` column would make "a report is
 * enforcement" representable and leave no place to keep actions immutable.
 *
 * ```text
 * moderation_report  who asked for what to be reviewed, and why
 * moderation_case    what has happened around one target
 * moderation_action  who enforced what (immutable audit record)
 * moderation_appeal  what the enforced person objected to
 * ```
 *
 * Each FK's `onDelete` differs, and that difference is half of the account-deletion policy:
 * - reporter: `set null`. Reports are mostly about someone else's content, so only the identity
 *   is detached. (`ai_response` reports carry private conversation evidence and are deleted whole
 *   by `services/account/deletion.ts`.)
 * - target member: `cascade`. There is no retention basis for sanction records of a deleted
 *   account.
 * - operator (`actor`): `set null`. The action concerns someone else and must stay; only the
 *   departed operator's identity goes.
 *
 * Deliberately absent: an event log (the action row is the audit record), report counters or risk
 * scores (nothing reads them), and a `restrictions` JSON array on the member row (expiry, release
 * and appeal would all become application code).
 */

/**
 * A case is the workspace attached to one target. A report finds the target's open case on intake
 * and creates one if absent, so concurrent reports cannot produce contradictory actions on the same
 * work.
 *
 * `target_id` is nullable because `ai_response` reports have no server row to point at
 * (conversations are E2EE); they cannot be grouped, which is why the unique index below is partial.
 * There is no FK to the target: it is one of three kinds, and a polymorphic FK is impossible.
 * Actions carry the per-type FKs instead.
 */
export const moderation_case = pgTable(
	"moderation_case",
	{
		id: text("id").primaryKey(),
		/** story | comment | member | ai_response — the contract's `ReportTargetType`. */
		target_type: text("target_type").notNull(),
		/** NULL for ai_response. */
		target_id: text("target_id"),
		/** open | resolved | dismissed */
		status: text("status").notNull().default("open"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		// SELECT-then-INSERT is not enough: two concurrent reports would both read nothing and both
		// create a case. The loser bounces off this constraint and re-reads the winner's row.
		uniqueIndex("uq_moderation_case_open_target")
			.on(t.target_type, t.target_id)
			.where(sql`${t.status} = 'open' and ${t.target_id} is not null`),
		index("idx_moderation_case_status").on(t.status, t.created_at.desc()),
	],
);

/**
 * One report. `evidence` is jsonb because its shape genuinely differs per target (a story snapshot
 * and AI-response evidence share no fields); the contract (`ReportEvidence`) validates on write and
 * the operator response re-checks on read. Everything a query reads is a column.
 */
export const moderation_report = pgTable(
	"moderation_report",
	{
		id: text("id").primaryKey(),
		case_id: text("case_id")
			.notNull()
			.references(() => moderation_case.id, { onDelete: "cascade" }),
		/** NULL after the reporter deletes their account; the report stays as an anonymous one. */
		reporter: text("reporter").references(() => member.id, {
			onDelete: "set null",
		}),
		target_type: text("target_type").notNull(),
		target_id: text("target_id"),
		reason: text("reason").notNull(),
		details: text("details").notNull().default(""),
		/** Snapshot at report time. The server takes it for public targets; only AI responses come from the device. */
		evidence: jsonb("evidence").notNull(),
		status: text("status").notNull().default("open"),
		created_at: timestamp("created_at", { withTimezone: true, precision: 3 })
			.notNull()
			.defaultNow(),
		resolved_at: timestamp("resolved_at", { withTimezone: true }),
		resolver: text("resolver").references(() => member.id, {
			onDelete: "set null",
		}),
		resolution_note: text("resolution_note").notNull().default(""),
	},
	(t) => [
		// Queue path: open reports oldest first. The cursor carries (created_at, id); millisecond
		// precision matches what the cursor can express, or a boundary row appears on two pages.
		index("idx_moderation_report_queue").on(t.status, t.created_at, t.id),
		index("idx_moderation_report_case").on(t.case_id, t.created_at),
		// One open report per reporter per target. Duplicates across different reporters are kept: volume
		// is itself a moderation signal.
		uniqueIndex("uq_moderation_report_open_by_reporter")
			.on(t.reporter, t.target_type, t.target_id)
			.where(
				sql`${t.status} = 'open' and ${t.reporter} is not null and ${t.target_id} is not null`,
			),
		// Axis for account-deletion cleanup (reporter anonymization / AI evidence deletion).
		index("idx_moderation_report_reporter").on(t.reporter),
	],
);

/**
 * An action: an immutable audit record. After creation only `reversed_by` changes; reversing a
 * decision leaves a new action rather than editing this one, so "when was it blocked and when
 * lifted" survives.
 *
 * Target FKs are split per type because a polymorphic FK is impossible and a bare `target_id text`
 * would leave actions pointing at deleted works. `target_comment_id` alone has no FK: a comment
 * deletion action must outlive the comment, and `comment_snapshot` holds the original for appeals
 * and audit.
 */
export const moderation_action = pgTable(
	"moderation_action",
	{
		id: text("id").primaryKey(),
		case_id: text("case_id")
			.notNull()
			.references(() => moderation_case.id, { onDelete: "cascade" }),
		/** NULL after the operator's account is deleted; the record stays. */
		actor: text("actor").references(() => member.id, { onDelete: "set null" }),
		/**
		 * The affected member, filled for every action kind (story owner, comment author, or the account
		 * itself). Appeal ownership is decided by this one column; per-kind ownership paths would
		 * eventually loosen for one kind.
		 */
		target_member: text("target_member").references(() => member.id, {
			onDelete: "cascade",
		}),
		target_story: text("target_story").references(() => story.id, {
			onDelete: "cascade",
		}),
		/** No FK: the record of a deleted comment must remain. */
		target_comment_id: text("target_comment_id"),
		/** Original of a deleted comment, captured in the same transaction as the deletion. */
		comment_snapshot: jsonb("comment_snapshot"),
		kind: text("kind").notNull(),
		/** Only for `restrict_capability` and `unrestrict_capability`. */
		capability: text("capability"),
		/** Operator-internal reason; never sent to the enforced member. */
		reason: text("reason").notNull(),
		/** The reason the enforced member reads. */
		public_reason: text("public_reason").notNull().default(""),
		created_at: timestamp("created_at", { withTimezone: true, precision: 3 })
			.notNull()
			.defaultNow(),
		/** Capability-restriction expiry. Unused for account actions. */
		expires_at: timestamp("expires_at", { withTimezone: true }),
		/**
		 * The action that reversed this one; once set it is no longer active. The self-reference needs
		 * the `AnyPgColumn` annotation or drizzle cannot infer the type. `set null` so this action
		 * survives if the reversing one is deleted (e.g. target member deletion).
		 */
		reversed_by: text("reversed_by").references(
			(): AnyPgColumn => moderation_action.id,
			{ onDelete: "set null" },
		),
	},
	(t) => [
		index("idx_moderation_action_case").on(t.case_id, t.created_at),
		// Dominant path of account-status recomputation: "live actions on this member". `member.status`
		// is a folded copy of that query and must never diverge, so every path that writes an action
		// recounts through this index in the same transaction.
		index("idx_moderation_action_member").on(
			t.target_member,
			t.kind,
			t.reversed_by,
		),
		index("idx_moderation_action_story").on(t.target_story),
	],
);

/**
 * Capability restriction: a narrow sanction for cases where a full suspension is too much. Each
 * restriction needs its own expiry, release time and originating action (for appeals), which a JSON
 * array on the member row would push into application code.
 *
 * Sweeping expired rows is not a correctness condition: the gate puts `expires_at` in its
 * predicate.
 */
export const member_restriction = pgTable(
	"member_restriction",
	{
		id: text("id").primaryKey(),
		member_id: text("member_id")
			.notNull()
			.references(() => member.id, { onDelete: "cascade" }),
		capability: text("capability").notNull(),
		/** The action that created this restriction; appeals point at it. */
		action_id: text("action_id")
			.notNull()
			.references(() => moderation_action.id, { onDelete: "cascade" }),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		/** NULL means indefinite. */
		expires_at: timestamp("expires_at", { withTimezone: true }),
		/** Marked rather than deleted because this is an audit record. */
		revoked_at: timestamp("revoked_at", { withTimezone: true }),
	},
	(t) => [
		// Gate path: "is this capability restricted for this member now". Partial on live rows to stay
		// small; the predicate finishes the expiry check.
		index("idx_member_restriction_active")
			.on(t.member_id, t.capability)
			.where(sql`${t.revoked_at} is null`),
	],
);

/**
 * An appeal. The FK to `action_id` roots ownership: the appeal points at an action and the action
 * carries `target_member`, so the client has no slot to say whose action it is. The member FK
 * cascades: with the account gone there is nothing to restore and the text was theirs.
 */
export const moderation_appeal = pgTable(
	"moderation_appeal",
	{
		id: text("id").primaryKey(),
		action_id: text("action_id")
			.notNull()
			.references(() => moderation_action.id, { onDelete: "cascade" }),
		member_id: text("member_id")
			.notNull()
			.references(() => member.id, { onDelete: "cascade" }),
		message: text("message").notNull(),
		/** open | accepted | rejected */
		status: text("status").notNull().default("open"),
		created_at: timestamp("created_at", { withTimezone: true, precision: 3 })
			.notNull()
			.defaultNow(),
		resolved_at: timestamp("resolved_at", { withTimezone: true }),
		resolver: text("resolver").references(() => member.id, {
			onDelete: "set null",
		}),
		resolution_note: text("resolution_note").notNull().default(""),
	},
	(t) => [
		// One open appeal per action; an application check alone cannot stop concurrent submits.
		uniqueIndex("uq_moderation_appeal_open_action")
			.on(t.action_id)
			.where(sql`${t.status} = 'open'`),
		index("idx_moderation_appeal_queue").on(t.status, t.created_at, t.id),
		index("idx_moderation_appeal_member").on(t.member_id, t.created_at),
	],
);
