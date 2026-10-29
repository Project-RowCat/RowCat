import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { member } from "./member.ts";

/**
 * Operations plane: two remote settings and one audit log.
 *
 * ```text
 * ops_feature_flag          breaker that closes risky operations immediately
 * ops_app_version_floor     floor that sends old mobile apps back to the store
 * admin_audit_log           the fact that a privileged operation happened
 * ```
 *
 * Why not one `ops_setting(key, value jsonb)` table: free keys and free JSON make rows nobody reads
 * representable. A typo is stored silently, the screen shows "configured", and the server does not
 * know the key. The vocabulary lives in `@rowcat/contracts`' `FeatureFlagKey` and writes reject
 * keys outside it. A single row with a column per switch is also wrong: every new key needs a
 * migration and there is no place to record who touched each switch.
 *
 * The audit log differs from `moderation_action`. An action is the enforcement itself (the row
 * means the sanction is live). The audit log is an observation: it changes nothing, deleting it
 * changes no product behavior, and it can therefore record even reads. Merging them would make "we
 * deleted the audit log and the sanction lifted" representable.
 */

/**
 * Feature switch; the key is the primary key. No row is the normal state (`state: "default"`).
 * Seeding rows at boot would give the product default two sources, and the seeded row, not the
 * contract's `defaultState`, would be what actually runs.
 */
export const ops_feature_flag = pgTable("ops_feature_flag", {
	/** `@rowcat/contracts`' `FeatureFlagKey`. The DB does not enforce the vocabulary; the boundary does. */
	key: text("key").primaryKey(),
	/** `default | on | off` */
	state: text("state").notNull().default("default"),
	/** One sentence shown to users while off. Empty means the app uses its default copy. */
	message: text("message").notNull().default(""),
	updated_at: timestamp("updated_at", { withTimezone: true, precision: 3 })
		.notNull()
		.defaultNow(),
	/**
	 * Last operator to change it; NULL after they delete their account. The audit record of who
	 * changed it is `admin_audit_log`, not this column, which only lets the console show a "last
	 * touched by" line.
	 */
	updated_by: text("updated_by").references(() => member.id, {
		onDelete: "set null",
	}),
});

/**
 * Minimum supported app version; the platform is the primary key.
 *
 * NULL `min_version` means no floor. An empty string is avoided because the value enters
 * comparisons and `""` behaves like `0.0.0`, silently passing everything.
 *
 * Web is deliberately absent: a refresh makes it the latest code, so a floor does not exist, and a
 * row would eventually get filled and lock web users out.
 */
export const ops_app_version_floor = pgTable("ops_app_version_floor", {
	/** `ios | android` */
	platform: text("platform").primaryKey(),
	/** NULL means no floor. Only `MAJOR.MINOR.PATCH` arrives (validated by the contract). */
	min_version: text("min_version"),
	message: text("message").notNull().default(""),
	updated_at: timestamp("updated_at", { withTimezone: true, precision: 3 })
		.notNull()
		.defaultNow(),
	updated_by: text("updated_by").references(() => member.id, {
		onDelete: "set null",
	}),
});

/**
 * Audit log, append-only: the service has no update or delete statement and the HTTP surface is
 * read-only.
 *
 * `operator` is `set null` for the same reason as `moderation_action.actor`: the record concerns
 * someone else and stays; only the departed operator's identity goes. `target_id` has no FK because
 * targets vary (member, story, comment, order, switch key) and the record must outlive its target.
 *
 * Do not put secrets in `metadata`; each service picks what to store and a static scan covers the
 * boundary (`lib/no-secret-logging.test.ts`). Everything a query reads (who, what, when) is a
 * column; jsonb holds only human-readable context.
 */
export const admin_audit_log = pgTable(
	"admin_audit_log",
	{
		id: text("id").primaryKey(),
		/** NULL after the operator deletes their account; the record stays. */
		operator: text("operator").references(() => member.id, {
			onDelete: "set null",
		}),
		/** `domain.target.action`, e.g. `ops.feature_flag.set`. */
		action: text("action").notNull(),
		/** `member | story | comment | feature_flag | app_version_floor | …` */
		target_type: text("target_type").notNull().default(""),
		target_id: text("target_id").notNull().default(""),
		metadata: jsonb("metadata").notNull().default({}),
		created_at: timestamp("created_at", { withTimezone: true, precision: 3 })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		// Dominant path: newest first after the cursor. The cursor carries `(created_at, id)`, hence
		// millisecond precision (`lib/cursor.ts` header).
		index("idx_admin_audit_recent").on(t.created_at.desc(), t.id.desc()),
		index("idx_admin_audit_operator").on(t.operator, t.created_at.desc()),
		index("idx_admin_audit_action").on(t.action, t.created_at.desc()),
		index("idx_admin_audit_target").on(t.target_id, t.created_at.desc()),
	],
);
