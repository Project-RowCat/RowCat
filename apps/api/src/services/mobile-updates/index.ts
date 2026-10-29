import type {
	MobileUpdateChannel,
	MobileUpdateKind,
	MobileUpdatePlatform,
	MobileUpdateStatus,
} from "@rowcat/contracts";
import { and, desc, eq, gt, lt, ne, sql } from "drizzle-orm";
import { type Db, db } from "../../db/client.ts";
import {
	mobile_update_release,
	mobile_update_release_event,
} from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import type { ServedRelease } from "./protocol.ts";
import type { ValidatedRelease } from "./registration.ts";
import { selectRelease } from "./selection.ts";

/**
 * Storage and selection of mobile OTA releases. The server's only job is to pick one.
 *
 * ```text
 * request path    findServableRelease   called by the public endpoint (read-only)
 * register path   registerRelease       called by the publish environment's process (cli.ts); no HTTP surface
 * transition path transitionRelease     CLI, CI, and the operations console (admin.ts: capability gate, audit)
 * ```
 *
 * Registration is not HTTP because it is the door through which new executable code enters this
 * table. A route would be an upload of signed bundles authorized by one session. The publish
 * environment holds the signing key and DB access together, and the console's publish request only
 * starts CI there; it never reaches this function (`jobs.ts`).
 *
 * Transitions (rollout, pause, resume) need no signing key and only move the spread of an
 * already-signed release, and the transition table forbids shrinking and reviving. So the console
 * calls the same function, adding the operator id and one audit row, rather than restating the
 * table.
 *
 * Fail closed: if the selection query fails, the exception propagates and the route answers 503. It
 * never degrades to "serve the newest release anyway". A client with no response keeps running the
 * bundle it has (or the one embedded in the store binary), which is this system's safe floor.
 */

export class MobileUpdateError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}

/**
 * Cap on candidates one request scans. Once any 100% release is inside it, older ones cannot be the
 * answer; a stream holding 200 partial rollouts is already an operational failure, and the cap
 * protects response time then.
 */
const CANDIDATE_LIMIT = 200;

export interface ServableReleaseQuery {
	platform: MobileUpdatePlatform;
	channel: MobileUpdateChannel;
	runtimeVersion: string;
	keyId: string | null;
	installationId: string | null;
}

export async function findServableRelease(
	query: ServableReleaseQuery,
): Promise<ServedRelease | null> {
	/**
	 * A client that expects no signature gets nothing: this app's binary always ships a certificate
	 * (`app.config.ts`), so such a request is a modified client or a broken build, and either one is a
	 * seat where unsigned code could run.
	 */
	if (!query.keyId) return null;
	const keyId = query.keyId;

	const rows = await db
		.select({
			id: mobile_update_release.id,
			kind: mobile_update_release.kind,
			status: mobile_update_release.status,
			rolloutPercentage: mobile_update_release.rollout_percentage,
			createdAt: mobile_update_release.created_at,
			body: mobile_update_release.body,
			signature: sql<
				string | null
			>`${mobile_update_release.signatures} ->> ${keyId}`,
		})
		.from(mobile_update_release)
		.where(
			and(
				eq(mobile_update_release.platform, query.platform),
				eq(mobile_update_release.channel, query.channel),
				eq(mobile_update_release.runtime_version, query.runtimeVersion),
				eq(mobile_update_release.status, "active"),
				sql`${mobile_update_release.signatures} ? ${keyId}`,
			),
		)
		.orderBy(
			desc(mobile_update_release.created_at),
			desc(mobile_update_release.id),
		)
		.limit(CANDIDATE_LIMIT);

	const chosen = selectRelease(
		rows.map((row) => ({
			...row,
			kind: row.kind as MobileUpdateKind,
			status: row.status as MobileUpdateStatus,
		})),
		query.installationId,
	);
	if (!chosen || !chosen.signature) return null;
	return {
		kind: chosen.kind,
		body: chosen.body,
		signature: chosen.signature,
		keyId,
	};
}

/* Registration */

export interface RegisterOptions {
	/**
	 * `null` leaves the release as draft (served to no one), the default for the production channel;
	 * widening is always a separate, human-typed percentage (`cli.ts`).
	 */
	rolloutPercentage: number | null;
	actor: string;
	reason: string;
	/** Register even if the same executable content is already live; only when a human chose that. */
	allowDuplicateContent: boolean;
}

export interface RegisterResult {
	created: boolean;
	id: string;
	status: MobileUpdateStatus;
	rolloutPercentage: number;
}

const streamOf = (release: ValidatedRelease["bundle"]["release"]) =>
	and(
		eq(mobile_update_release.platform, release.platform),
		eq(mobile_update_release.channel, release.channel),
		eq(mobile_update_release.runtime_version, release.runtimeVersion),
	);

const signaturesOf = (
	bundle: ValidatedRelease["bundle"],
): Record<string, string> =>
	Object.fromEntries(
		bundle.signatures.map((signature) => [signature.keyId, signature.sig]),
	);

export async function registerRelease(
	validated: ValidatedRelease,
	options: RegisterOptions,
): Promise<RegisterResult> {
	const { bundle } = validated;
	const { release } = bundle;
	const isDirective = release.kind === "rollback_to_embedded";

	if (
		options.rolloutPercentage !== null &&
		(options.rolloutPercentage < 1 || options.rolloutPercentage > 100)
	)
		throw new MobileUpdateError(
			"mobile_update_rollout_invalid",
			"the rollout to activate is 1–100. To give it to nobody, leave the rollout out (draft).",
		);
	/** A rollback directive is incident response; rolling back for only some installs is meaningless. */
	const rollout = isDirective ? 100 : options.rolloutPercentage;

	return db.transaction(async (tx) => {
		/**
		 * Serializes the stream: two concurrent registrations in one stream both judging "I am newest"
		 * would let timestamp order diverge from commit order. The transaction-level advisory lock closes
		 * that window.
		 */
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext(${`mobile-update:${release.platform}:${release.channel}:${release.runtimeVersion}`}))`,
		);

		const [existing] = await tx
			.select({
				body: mobile_update_release.body,
				signatures: mobile_update_release.signatures,
				status: mobile_update_release.status,
				rollout: mobile_update_release.rollout_percentage,
			})
			.from(mobile_update_release)
			.where(eq(mobile_update_release.id, release.id));
		if (existing) {
			/**
			 * Re-registering the same bundle is a retry of a failed run: change nothing and return the
			 * current state. The same id with different bytes is a conflict, not a retry; a published
			 * release's code never changes.
			 */
			const sameSignatures =
				JSON.stringify(Object.entries(existing.signatures).sort()) ===
				JSON.stringify(Object.entries(signaturesOf(bundle)).sort());
			if (existing.body !== bundle.body || !sameSignatures)
				throw new MobileUpdateError(
					"mobile_update_release_conflict",
					`release ${release.id} is already registered with different content — a published release doesn't change.`,
				);
			return {
				created: false,
				id: release.id,
				status: existing.status as MobileUpdateStatus,
				rolloutPercentage: existing.rollout,
			};
		}

		/**
		 * Must be newer than the stream head. An old bundle file registered late would be served to no
		 * one while newer releases stand, then surface silently the day they are paused, a moment nobody
		 * chose.
		 */
		const [head] = await tx
			.select({ createdAt: mobile_update_release.created_at })
			.from(mobile_update_release)
			.where(streamOf(release))
			.orderBy(desc(mobile_update_release.created_at))
			.limit(1);
		if (head && head.createdAt.getTime() >= validated.createdAt.getTime())
			throw new MobileUpdateError(
				"mobile_update_release_stale",
				`only releases newer than ${head.createdAt.toISOString()} can be registered on this stream — rebuild the bundle.`,
			);

		if (release.republishOf) {
			const [origin] = await tx
				.select({ id: mobile_update_release.id })
				.from(mobile_update_release)
				.where(
					and(
						eq(mobile_update_release.id, release.republishOf),
						streamOf(release),
					),
				);
			if (!origin)
				throw new MobileUpdateError(
					"mobile_update_republish_origin_missing",
					"the republish's original release is not on the same stream.",
				);
		} else if (!isDirective && !options.allowDuplicateContent) {
			const [duplicate] = await tx
				.select({
					id: mobile_update_release.id,
					status: mobile_update_release.status,
				})
				.from(mobile_update_release)
				.where(
					and(
						streamOf(release),
						eq(mobile_update_release.content_key, validated.contentKey),
						ne(mobile_update_release.status, "rolled_back"),
					),
				)
				.limit(1);
			if (duplicate)
				throw new MobileUpdateError(
					"mobile_update_duplicate_content",
					`a release with the same code, ${duplicate.id} (${duplicate.status}), already exists — ` +
						"if this reruns a failed publish, use that release.",
				);
		}

		const status: MobileUpdateStatus = rollout === null ? "draft" : "active";
		const percentage = rollout ?? 0;
		await tx.insert(mobile_update_release).values({
			id: release.id,
			kind: release.kind,
			platform: release.platform,
			channel: release.channel,
			runtime_version: release.runtimeVersion,
			created_at: validated.createdAt,
			status,
			rollout_percentage: percentage,
			body: bundle.body,
			signatures: signaturesOf(bundle),
			api_origin: release.apiOrigin,
			assets: bundle.assets.map((asset) => ({
				hash: asset.hash,
				byteSize: asset.byteSize,
			})),
			content_key: validated.contentKey,
			republish_of: release.republishOf,
			source_commit: release.sourceCommit,
		});
		await tx.insert(mobile_update_release_event).values({
			id: newId(),
			release_id: release.id,
			action: "register",
			from_status: null,
			to_status: status,
			from_rollout: null,
			to_rollout: percentage,
			actor: options.actor,
			reason: options.reason,
		});
		return {
			created: true,
			id: release.id,
			status,
			rolloutPercentage: percentage,
		};
	});
}

/* State transitions */

export type TransitionAction = "rollout" | "pause" | "resume" | "rollback";

/** Transaction executor; same shape as the `db.transaction` callback argument. */
export type MobileUpdateTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface TransitionRequest {
	action: TransitionAction;
	/** Read only for `rollout`. */
	rolloutPercentage?: number;
	actor: string;
	reason: string;
	/**
	 * The member who pressed it in the operations console; comes only from the session and is empty
	 * for CLI/CI transitions. A record, not authorization: the route gate authorized before this call.
	 */
	operatorId?: string | null;
	/**
	 * Called in the same transaction when a transition actually happened; the console writes its audit
	 * row here. Not called for same-state requests (`changed: false`): an audit row without a history
	 * row would make the two records disagree.
	 */
	onChanged?: (tx: MobileUpdateTx, change: TransitionChange) => Promise<void>;
}

export interface TransitionChange {
	eventId: string;
	fromStatus: MobileUpdateStatus;
	toStatus: MobileUpdateStatus;
	fromRollout: number;
	toRollout: number;
}

export interface TransitionResult {
	id: string;
	changed: boolean;
	status: MobileUpdateStatus;
	rolloutPercentage: number;
}

/**
 * Transition table. No cell moves an install that already has a release.
 *
 * ```text
 * rollout   draft, active -> active    percentage is 1-100 and never decreases
 * pause     active -> paused           new installs stop receiving it
 * resume    paused -> active           goes out again at the paused percentage
 * rollback  draft, active, paused -> rolled_back   terminal; never revived
 * ```
 *
 * The percentage never decreases: 25 -> 10 cannot take back the 15% who already have it (clients do
 * not delete a received update), and its only remaining effect is blocking some new installs, which
 * `pause` states exactly.
 *
 * A rolled-back release is not turned back on: a newer republish usually stands after it and
 * clients never accept an older manifest, so re-enabling would only show "active" while reaching no
 * one. Publish the same code again instead.
 *
 * A request for the state already held succeeds (`changed: false`) so someone retrying after a lost
 * response sees no failure.
 */
export async function transitionRelease(
	id: string,
	request: TransitionRequest,
): Promise<TransitionResult> {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select({
				status: mobile_update_release.status,
				rollout: mobile_update_release.rollout_percentage,
				kind: mobile_update_release.kind,
			})
			.from(mobile_update_release)
			.where(eq(mobile_update_release.id, id))
			.for("update");
		if (!row)
			throw new MobileUpdateError(
				"mobile_update_release_missing",
				`no release ${id}.`,
			);
		const status = row.status as MobileUpdateStatus;
		let nextStatus: MobileUpdateStatus = status;
		let nextRollout = row.rollout;

		switch (request.action) {
			case "rollout": {
				const percentage = request.rolloutPercentage;
				if (
					percentage === undefined ||
					!Number.isInteger(percentage) ||
					percentage < 1 ||
					percentage > 100
				)
					throw new MobileUpdateError(
						"mobile_update_rollout_invalid",
						"the rollout is an integer from 1 to 100.",
					);
				if (status !== "draft" && status !== "active")
					throw new MobileUpdateError(
						"mobile_update_transition_invalid",
						`the rollout of a ${status} release doesn't change — reopen a paused release with resume.`,
					);
				if (row.kind !== "update" && percentage !== 100)
					throw new MobileUpdateError(
						"mobile_update_rollout_invalid",
						"a rollback instruction goes out only at 100%.",
					);
				if (percentage < row.rollout)
					throw new MobileUpdateError(
						"mobile_update_rollout_decrease",
						`the rollout doesn't shrink (${row.rollout}% → ${percentage}%) — to block new installs, pause.`,
					);
				nextStatus = "active";
				nextRollout = percentage;
				break;
			}
			case "pause":
				if (status === "paused") break;
				if (status !== "active")
					throw new MobileUpdateError(
						"mobile_update_transition_invalid",
						`a ${status} release has nothing to pause.`,
					);
				nextStatus = "paused";
				break;
			case "resume":
				if (status === "active") break;
				if (status !== "paused")
					throw new MobileUpdateError(
						"mobile_update_transition_invalid",
						`a ${status} release can't be reopened.`,
					);
				nextStatus = "active";
				break;
			case "rollback":
				nextStatus = "rolled_back";
				break;
		}

		const changed = nextStatus !== status || nextRollout !== row.rollout;
		if (changed) {
			await tx
				.update(mobile_update_release)
				.set({
					status: nextStatus,
					rollout_percentage: nextRollout,
					status_changed_at: new Date(),
				})
				.where(eq(mobile_update_release.id, id));
			const eventId = newId();
			await tx.insert(mobile_update_release_event).values({
				id: eventId,
				release_id: id,
				action: request.action,
				from_status: status,
				to_status: nextStatus,
				from_rollout: row.rollout,
				to_rollout: nextRollout,
				actor: request.actor,
				operator_id: request.operatorId ?? null,
				reason: request.reason,
			});
			await request.onChanged?.(tx, {
				eventId,
				fromStatus: status,
				toStatus: nextStatus,
				fromRollout: row.rollout,
				toRollout: nextRollout,
			});
		}
		return { id, changed, status: nextStatus, rolloutPercentage: nextRollout };
	});
}

/* Reads for the publish tool and humans */

export interface ReleaseSummary {
	id: string;
	kind: MobileUpdateKind;
	platform: MobileUpdatePlatform;
	channel: MobileUpdateChannel;
	runtimeVersion: string;
	createdAt: string;
	registeredAt: string;
	status: MobileUpdateStatus;
	statusChangedAt: string;
	rolloutPercentage: number;
	keyIds: string[];
	republishOf: string | null;
	sourceCommit: string;
	apiOrigin: string;
}

/**
 * Release summary columns, read as one projection by both the CLI and the operations console. Body,
 * signatures and asset list are excluded; a separate console projection would give status two
 * vocabularies.
 */
export const summaryColumns = {
	id: mobile_update_release.id,
	kind: mobile_update_release.kind,
	platform: mobile_update_release.platform,
	channel: mobile_update_release.channel,
	runtimeVersion: mobile_update_release.runtime_version,
	createdAt: mobile_update_release.created_at,
	registeredAt: mobile_update_release.registered_at,
	status: mobile_update_release.status,
	statusChangedAt: mobile_update_release.status_changed_at,
	rolloutPercentage: mobile_update_release.rollout_percentage,
	signatures: mobile_update_release.signatures,
	republishOf: mobile_update_release.republish_of,
	sourceCommit: mobile_update_release.source_commit,
	apiOrigin: mobile_update_release.api_origin,
};

export interface SummaryRow {
	id: string;
	kind: string;
	platform: string;
	channel: string;
	runtimeVersion: string;
	createdAt: Date;
	registeredAt: Date;
	status: string;
	statusChangedAt: Date;
	rolloutPercentage: number;
	signatures: Record<string, string>;
	republishOf: string | null;
	sourceCommit: string;
	apiOrigin: string;
}

export const toSummary = (row: SummaryRow): ReleaseSummary => ({
	id: row.id,
	kind: row.kind as MobileUpdateKind,
	platform: row.platform as MobileUpdatePlatform,
	channel: row.channel as MobileUpdateChannel,
	runtimeVersion: row.runtimeVersion,
	createdAt: row.createdAt.toISOString(),
	registeredAt: row.registeredAt.toISOString(),
	status: row.status as MobileUpdateStatus,
	statusChangedAt: row.statusChangedAt.toISOString(),
	rolloutPercentage: row.rolloutPercentage,
	keyIds: Object.keys(row.signatures).sort(),
	republishOf: row.republishOf,
	sourceCommit: row.sourceCommit,
	apiOrigin: row.apiOrigin,
});

export async function listReleases(filter: {
	platform?: MobileUpdatePlatform;
	channel?: MobileUpdateChannel;
	runtimeVersion?: string;
	limit: number;
}): Promise<ReleaseSummary[]> {
	const conditions = [
		filter.platform
			? eq(mobile_update_release.platform, filter.platform)
			: undefined,
		filter.channel
			? eq(mobile_update_release.channel, filter.channel)
			: undefined,
		filter.runtimeVersion
			? eq(mobile_update_release.runtime_version, filter.runtimeVersion)
			: undefined,
	].filter((condition) => condition !== undefined);
	const rows = await db
		.select(summaryColumns)
		.from(mobile_update_release)
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(
			desc(mobile_update_release.created_at),
			desc(mobile_update_release.id),
		)
		.limit(filter.limit);
	return rows.map(toSummary);
}

export interface ReleaseDetail extends ReleaseSummary {
	body: string;
	/** Sizes of the assets a republish carries over unchanged; the body holds only hashes and addresses. */
	assets: { hash: string; byteSize: number }[];
	events: {
		action: string;
		fromStatus: string | null;
		toStatus: string;
		fromRollout: number | null;
		toRollout: number;
		actor: string;
		reason: string;
		createdAt: string;
	}[];
}

export async function getRelease(id: string): Promise<ReleaseDetail | null> {
	const [row] = await db
		.select({
			...summaryColumns,
			body: mobile_update_release.body,
			assets: mobile_update_release.assets,
		})
		.from(mobile_update_release)
		.where(eq(mobile_update_release.id, id));
	if (!row) return null;
	const events = await db
		.select()
		.from(mobile_update_release_event)
		.where(eq(mobile_update_release_event.release_id, id))
		.orderBy(
			mobile_update_release_event.created_at,
			mobile_update_release_event.id,
		);
	return {
		...toSummary(row),
		body: row.body,
		assets: row.assets,
		events: events.map((event) => ({
			action: event.action,
			fromStatus: event.from_status,
			toStatus: event.to_status,
			fromRollout: event.from_rollout,
			toRollout: event.to_rollout,
			actor: event.actor,
			reason: event.reason,
			createdAt: event.created_at.toISOString(),
		})),
	};
}

export interface RollbackPlan {
	release: ReleaseSummary;
	/** Newer releases currently going out; any entry means the rollback target is wrong. */
	newerActive: ReleaseSummary[];
	/** Where to roll back to; `null` means this runtime has no good OTA and falls back to the store bundle. */
	previousGood: ReleaseSummary | null;
}

/**
 * Rollback plan: the query that decides who receives what. Changes nothing.
 *
 * The target is the newest currently-active update older than this release. Paused releases are not
 * chosen; the pause had a reason.
 */
export async function planRollback(
	id: string,
	executor: Db | MobileUpdateTx = db,
): Promise<RollbackPlan | null> {
	const [row] = await executor
		.select(summaryColumns)
		.from(mobile_update_release)
		.where(eq(mobile_update_release.id, id));
	if (!row) return null;
	const stream = and(
		eq(mobile_update_release.platform, row.platform),
		eq(mobile_update_release.channel, row.channel),
		eq(mobile_update_release.runtime_version, row.runtimeVersion),
		eq(mobile_update_release.status, "active"),
		ne(mobile_update_release.id, row.id),
	);
	const newer = await executor
		.select(summaryColumns)
		.from(mobile_update_release)
		.where(and(stream, gt(mobile_update_release.created_at, row.createdAt)))
		.orderBy(desc(mobile_update_release.created_at));
	const [previous] = await executor
		.select(summaryColumns)
		.from(mobile_update_release)
		.where(
			and(
				stream,
				eq(mobile_update_release.kind, "update"),
				lt(mobile_update_release.created_at, row.createdAt),
			),
		)
		.orderBy(desc(mobile_update_release.created_at))
		.limit(1);
	return {
		release: toSummary(row),
		newerActive: newer.map(toSummary),
		previousGood: previous ? toSummary(previous) : null,
	};
}

/**
 * Storage reachability report. Deletes nothing.
 *
 * ```text
 * reachable   assets pointed at by draft, active or paused releases   must not be deleted
 * retired     assets pointed at only by rolled_back releases           candidates if never revived
 * ```
 *
 * Rolled-back assets are not immediate candidates because a client downloads assets after receiving
 * the manifest, so an install that got it just before rollback may still be downloading, and the
 * server cannot observe that window closing. A human reads this report and decides. Bundles
 * embedded in the store binary do not point at this store's assets.
 */
export async function reportAssetReachability(): Promise<{
	releases: number;
	reachable: { assets: number; bytes: number };
	retiredOnly: { assets: number; bytes: number; hashes: string[] };
}> {
	const rows = await db
		.select({
			status: mobile_update_release.status,
			assets: mobile_update_release.assets,
		})
		.from(mobile_update_release);
	const reachable = new Map<string, number>();
	const retired = new Map<string, number>();
	for (const row of rows) {
		const target = row.status === "rolled_back" ? retired : reachable;
		for (const asset of row.assets) target.set(asset.hash, asset.byteSize);
	}
	for (const hash of reachable.keys()) retired.delete(hash);
	const sum = (map: Map<string, number>) =>
		[...map.values()].reduce((total, size) => total + size, 0);
	return {
		releases: rows.length,
		reachable: { assets: reachable.size, bytes: sum(reachable) },
		retiredOnly: {
			assets: retired.size,
			bytes: sum(retired),
			hashes: [...retired.keys()].sort(),
		},
	};
}
