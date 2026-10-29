import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { member } from "./member.ts";

/**
 * Mobile OTA release: the signed bytes verbatim plus the operational state of who receives them.
 *
 * ```text
 * mobile_update_release         one release; body and signatures immutable, only status/percentage move
 * mobile_update_release_event   when and why the state moved; append-only
 * ```
 *
 * Not held here:
 * - Asset bytes: bundles, images and fonts live in object storage/CDN at hash addresses; the API
 *   serves only the manifest, whose addresses are signed into it at publish time.
 * - The signing key: only signatures (publicly verifiable values), not signing authority. Anyone
 *   who edits these rows still cannot produce new code, because the certificate embedded in the
 *   binary rejects a changed body. What remains is serving an already-signed body in the wrong
 *   place, defended by per-channel keys and runtime/manifest filters (`docs/ota/ARCHITECTURE.md`).
 * - Install identifiers: rollout is a per-request hash and is stored nowhere.
 *
 * The body is `text`, not jsonb: signatures cover bytes, and jsonb normalizes key order and
 * whitespace, so a stored-and-read string would differ from the signed one and every client would
 * report a bad signature. Structured axes (channel, platform, runtime, time) are separate columns;
 * registration re-reads them from the body and compares
 * (`services/mobile-updates/registration.ts`).
 */
export const mobile_update_release = pgTable(
	"mobile_update_release",
	{
		/** The manifest's `id` (UUID) verbatim; directive releases get the same id format. */
		id: text("id").primaryKey(),
		/** `update | rollback_to_embedded`; the vocabulary is enforced at the boundary. */
		kind: text("kind").notNull(),
		/** `ios | android`. */
		platform: text("platform").notNull(),
		/** `preview | testflight | production`. */
		channel: text("channel").notNull(),
		/** `rowcat-native-<n>`. */
		runtime_version: text("runtime_version").notNull(),
		/**
		 * The manifest's `createdAt` (or the directive's `commitTime`): the selection-order axis.
		 * Registration time is not used, because clients decide "newer" from the time inside the signed
		 * body; ordering by another time lets the server serve a new release the client reads as old.
		 */
		created_at: timestamp("created_at", {
			withTimezone: true,
			precision: 3,
		}).notNull(),
		registered_at: timestamp("registered_at", {
			withTimezone: true,
			precision: 3,
		})
			.notNull()
			.defaultNow(),
		/** `draft | active | paused | rolled_back`. */
		status: text("status").notNull(),
		rollout_percentage: integer("rollout_percentage").notNull(),
		status_changed_at: timestamp("status_changed_at", {
			withTimezone: true,
			precision: 3,
		})
			.notNull()
			.defaultNow(),
		/** The signed bytes verbatim; the response emits this string without changing a character. */
		body: text("body").notNull(),
		/**
		 * `{ [keyId]: base64 signature }`; two keys exist during key rotation. The response carries only
		 * the signature for the key id named in the request's `expo-expect-signature`; a release without
		 * that key's signature is not even a candidate for that binary (filtered at selection).
		 */
		signatures: jsonb("signatures").$type<Record<string, string>>().notNull(),
		/** The `EXPO_PUBLIC_API_ORIGIN` baked into this bundle; registration compares it with this deployment's origin. */
		api_origin: text("api_origin").notNull(),
		/** `{ hash, byteSize }` of referenced assets, read for garbage-collection reachability. Not the basis of integrity (that is the hash inside the signed body). */
		assets: jsonb("assets")
			.$type<{ hash: string; byteSize: number }[]>()
			.notNull(),
		/**
		 * Key for "is this the same content": hash of the executable asset set. Stops re-running a failed
		 * publish from registering the same code twice. A republish (rollback) intentionally reissues the
		 * same content, which `republish_of` expresses.
		 */
		content_key: text("content_key").notNull(),
		republish_of: text("republish_of"),
		source_commit: text("source_commit").notNull(),
	},
	(t) => [
		check(
			"ck_mobile_update_rollout",
			sql`${t.rollout_percentage} between 0 and 100`,
		),
		check(
			"ck_mobile_update_status",
			sql`${t.status} in ('draft', 'active', 'paused', 'rolled_back')`,
		),
		check(
			"ck_mobile_update_kind",
			sql`${t.kind} in ('update', 'rollback_to_embedded')`,
		),
		check(
			"ck_mobile_update_channel",
			sql`${t.channel} in ('preview', 'testflight', 'production')`,
		),
		check(
			"ck_mobile_update_platform",
			sql`${t.platform} in ('ios', 'android')`,
		),
		/** Dominant path: what can be served now from this stream, newest first. One request scans this index once. */
		index("idx_mobile_update_stream").on(
			t.platform,
			t.channel,
			t.runtime_version,
			t.status,
			t.created_at.desc(),
		),
	],
);

/**
 * State history; append-only.
 *
 * Two "who" axes. `actor` is what the publishing environment calls itself (CI run, a person's shell
 * name): a record, not authorization. `operator_id` is the member who pressed it in the console and
 * comes only from the session; CLI/CI transitions have none. Folding them would make one a lie (a
 * member id as text would outlive deletion; a CI name cannot go in the member column).
 *
 * Console transitions also leave an `admin_audit_log` line in the same transaction, pointing at
 * this row's id. The transition values (from/to) live only here; repeating them in the audit line
 * would create two histories that eventually diverge.
 *
 * The service has no update or delete statement: this table answers "what percentage was this
 * release at, and when", which is meaningless if the answer can be edited.
 */
export const mobile_update_release_event = pgTable(
	"mobile_update_release_event",
	{
		id: text("id").primaryKey(),
		release_id: text("release_id")
			.notNull()
			.references(() => mobile_update_release.id, { onDelete: "restrict" }),
		/** `register | rollout | pause | resume | rollback`. */
		action: text("action").notNull(),
		from_status: text("from_status"),
		to_status: text("to_status").notNull(),
		from_rollout: integer("from_rollout"),
		to_rollout: integer("to_rollout").notNull(),
		actor: text("actor").notNull(),
		/** Member who pressed this transition in the console; cleared on account deletion while the history stays (same rule as the audit log). */
		operator_id: text("operator_id").references(() => member.id, {
			onDelete: "set null",
		}),
		reason: text("reason").notNull().default(""),
		created_at: timestamp("created_at", { withTimezone: true, precision: 3 })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		index("idx_mobile_update_event_release").on(t.release_id, t.created_at),
	],
);

/**
 * Publish job: one attempt to create or revive a release.
 *
 * Separate from the release because a release is metadata of an executable update while a job is
 * the orchestration that tries to make one; putting CI state on `mobile_update_release` would turn
 * a failed publish into a row in the table the selection query scans.
 *
 * ```text
 * console   records intent (channel, platform, source, initial percentage, note, reason)
 * API       writes this row and dispatches CI; never signs
 * CI        reports start and result via OIDC; the registration table checks the result releases
 * ```
 *
 * Only one live job per stream: two queued/running jobs for a `(channel, platform)` would fight
 * over the stream head or mix publish and rollback. The final authority is the partial unique
 * index, not a disabled button; two operators pressing at once get one 409.
 */
export const mobile_update_job = pgTable(
	"mobile_update_job",
	{
		id: text("id").primaryKey(),
		/** `publish | rollback`. */
		kind: text("kind").notNull(),
		channel: text("channel").notNull(),
		platform: text("platform").notNull(),
		/** `queued | running | succeeded | failed | cancelled`. */
		status: text("status").notNull(),
		/** Requesting operator; from the session only, cleared on account deletion. */
		requested_by: text("requested_by").references(() => member.id, {
			onDelete: "set null",
		}),
		/** `branch | commit`; a rollback picks no source (null). */
		source_kind: text("source_kind"),
		/** Branch name or 40-character commit. */
		source_ref: text("source_ref"),
		/** Commit CI resolved. */
		source_commit: text("source_commit"),
		/** Runtime generation CI read from the checkout. */
		runtime_version: text("runtime_version"),
		target_release_id: text("target_release_id").references(
			() => mobile_update_release.id,
			{ onDelete: "restrict" },
		),
		to_embedded: boolean("to_embedded").notNull().default(false),
		/** Null registers as draft. */
		initial_rollout: integer("initial_rollout"),
		/** Date id of the update note; null means explicitly none. */
		note_id: text("note_id"),
		reason: text("reason").notNull(),
		/** CI run id, bound by the first report; later reports must be the same run. */
		external_run_id: text("external_run_id"),
		external_run_url: text("external_run_url"),
		result_release_ids: jsonb("result_release_ids")
			.$type<string[]>()
			.notNull()
			.default([]),
		failure_code: text("failure_code"),
		failure_stage: text("failure_stage"),
		created_at: timestamp("created_at", { withTimezone: true, precision: 3 })
			.notNull()
			.defaultNow(),
		started_at: timestamp("started_at", { withTimezone: true, precision: 3 }),
		finished_at: timestamp("finished_at", {
			withTimezone: true,
			precision: 3,
		}),
	},
	(t) => [
		check(
			"ck_mobile_update_job_kind",
			sql`${t.kind} in ('publish', 'rollback')`,
		),
		check(
			"ck_mobile_update_job_status",
			sql`${t.status} in ('queued', 'running', 'succeeded', 'failed', 'cancelled')`,
		),
		check(
			"ck_mobile_update_job_channel",
			sql`${t.channel} in ('preview', 'testflight', 'production')`,
		),
		check(
			"ck_mobile_update_job_platform",
			sql`${t.platform} in ('ios', 'android')`,
		),
		check(
			"ck_mobile_update_job_rollback_target",
			sql`${t.kind} <> 'rollback' or ${t.target_release_id} is not null`,
		),
		uniqueIndex("uq_mobile_update_job_active_stream")
			.on(t.channel, t.platform)
			.where(sql`${t.status} in ('queued', 'running')`),
		index("idx_mobile_update_job_created").on(t.created_at.desc(), t.id.desc()),
		index("idx_mobile_update_job_target").on(t.target_release_id),
	],
);
