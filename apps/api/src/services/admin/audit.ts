import type { AuditLogEntryDto, AuditLogPage } from "@rowcat/contracts";
import { and, desc, eq, like, lt, or } from "drizzle-orm";
import { type Db, db } from "../../db/client.ts";
import { admin_audit_log, member } from "../../db/schema.ts";
import {
	decodeTimelineCursor,
	encodeTimelineCursor,
} from "../../lib/cursor.ts";
import { newId } from "../../lib/id.ts";
import { prefixPattern } from "../../lib/like.ts";

/**
 * Audit records: the fact that a privileged operation happened.
 *
 * 1. Writes happen inside the original transaction. `recordAudit` requires the `Tx`; with a `db`
 *    default some caller would run outside a transaction and commit "operated but unrecorded".
 * 2. Append-only: there is no `update` or `delete` here or on the route, so the absence of an
 *    edit button is the operation not existing.
 * 3. Secrets stay out of metadata. The calling service chooses what to store and a static scan
 *    covers it (`lib/no-secret-logging.test.ts`); this file stores values as given, since values
 *    are only checkable where they are made.
 *
 * Unlike `moderation_action` (the enforcement itself; deleting it lifts the sanction), an audit row
 * is an observation, so even reads may leave one (member detail view). Merging the two tables would
 * make "deleting the audit log lifted a sanction" representable. Enforcement operations therefore
 * do not leave a second row here; the action ledger is the authority.
 */

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface RecordAuditInput {
	/** The operator's member id, from the session only; the request body has no slot for it. */
	operatorId: string;
	/** `domain.target.action`, e.g. `ops.feature_flag.set`. */
	action: string;
	targetType: string;
	targetId: string;
	/**
	 * Values needed to understand the operation. No secrets: tokens, hashes, ciphertext, full emails
	 * or card data (a member id traces back to the email, and several operators read this log).
	 */
	metadata?: Record<string, unknown>;
}

/**
 * Writes one audit row; the transaction is the argument. Failure throws so the original transaction
 * rolls back: a privileged operation whose audit failed must not report success.
 */
export async function recordAudit(
	tx: Tx,
	input: RecordAuditInput,
): Promise<void> {
	await tx.insert(admin_audit_log).values({
		id: newId(),
		operator: input.operatorId,
		action: input.action,
		target_type: input.targetType,
		target_id: input.targetId,
		metadata: input.metadata ?? {},
	});
}

/**
 * Audit for operations that need no transaction; read-only operations only (member detail view is
 * the sole consumer). There is nothing to roll back, and a failed record must not turn the lookup
 * into a 500 during an incident, so the failure is swallowed and logged here only. A write calling
 * this has crossed the boundary; use `recordAudit` with the original transaction.
 */
export async function recordReadAudit(input: RecordAuditInput): Promise<void> {
	try {
		await db.insert(admin_audit_log).values({
			id: newId(),
			operator: input.operatorId,
			action: input.action,
			target_type: input.targetType,
			target_id: input.targetId,
			metadata: input.metadata ?? {},
		});
	} catch (err) {
		console.error(
			`[audit] failed to record a read action=${input.action}`,
			err,
		);
	}
}

export interface ListAuditInput {
	operatorId: string;
	/** Prefix match: `ops.` shows every operational-setting change. */
	action: string;
	targetId: string;
	cursor: string;
	limit: number;
}

/**
 * One page of audit rows, newest first.
 *
 * The cursor is `(created_at, id)` because the list grows while read; with offset a row arriving
 * between pages would duplicate or skip a boundary row, and a missing audit row is especially bad.
 * The operator nickname is joined, not snapshotted on the row (same as notifications): renames show
 * on old rows, and identity stays with the `operator` column.
 */
export async function listAuditLog(
	input: ListAuditInput,
): Promise<AuditLogPage> {
	const size = Math.min(Math.max(input.limit, 1), 50);
	const after = input.cursor ? decodeTimelineCursor(input.cursor) : null;

	const rows = await db
		.select({
			id: admin_audit_log.id,
			operator: admin_audit_log.operator,
			operatorNickname: member.nickname,
			action: admin_audit_log.action,
			targetType: admin_audit_log.target_type,
			targetId: admin_audit_log.target_id,
			metadata: admin_audit_log.metadata,
			createdAt: admin_audit_log.created_at,
		})
		.from(admin_audit_log)
		/**
		 * Left join: an operator's deletion nulls `operator`, and an inner join would erase all of that
		 * person's rows from the audit log.
		 */
		.leftJoin(member, eq(admin_audit_log.operator, member.id))
		.where(
			and(
				input.operatorId
					? eq(admin_audit_log.operator, input.operatorId)
					: undefined,
				input.action
					? like(admin_audit_log.action, prefixPattern(input.action))
					: undefined,
				input.targetId
					? eq(admin_audit_log.target_id, input.targetId)
					: undefined,
				after
					? or(
							lt(admin_audit_log.created_at, after.createdAt),
							and(
								eq(admin_audit_log.created_at, after.createdAt),
								lt(admin_audit_log.id, after.id),
							),
						)
					: undefined,
			),
		)
		.orderBy(desc(admin_audit_log.created_at), desc(admin_audit_log.id))
		// One extra row tells whether a next page exists, without a total.
		.limit(size + 1);

	const page = rows.slice(0, size);
	const items: AuditLogEntryDto[] = page.map((row) => ({
		id: row.id,
		operatorMemberId: row.operator,
		operatorNickname: row.operatorNickname ?? null,
		action: row.action,
		targetType: row.targetType,
		targetId: row.targetId,
		metadata: (row.metadata ?? {}) as Record<string, unknown>,
		createdAt: row.createdAt.toISOString(),
	}));

	const last = page.at(-1);
	return {
		items,
		nextCursor:
			rows.length > size && last
				? encodeTimelineCursor({ createdAt: last.createdAt, id: last.id })
				: null,
	};
}
