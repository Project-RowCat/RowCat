import type {
	AdminAppUpdateBroadcastResponse,
	AppPlatform,
	AppUpdateBroadcastStatusDto,
} from "@rowcat/contracts";
import { ADMIN_ERROR_CODE } from "@rowcat/contracts";
import { count, eq, sql } from "drizzle-orm";
import { type Db, db } from "../../db/client.ts";
import { member, notification } from "../../db/schema.ts";
import { ApiError } from "../../lib/errors.ts";
import { notificationSourceKey } from "../notifications.ts";
import { listAppVersionFloors } from "../ops.ts";
import { enqueuePushDeliveries } from "../push/enqueue.ts";
import { recordAudit } from "./audit.ts";

/**
 * Announces the app-version floor that currently stands to every member. Reads
 * `ops_app_version_floor` only; setting the floor belongs to `services/ops.ts`.
 *
 * - The version comes from the floor row and the request cannot supply wording; otherwise this
 *   becomes a free-form broadcast tool.
 * - The app decides blocking itself via `GET /v2/runtime-config`; this notice blocks nothing. The
 *   floor row's `message` is the blocking screen's text, not an inbox body.
 * - What is announced is end of support, not a release: a platform with no floor rejects the
 *   broadcast.
 * - No broadcast-state table: notification rows already prove it and a second record would drift.
 *   Status is counted from current members and current rows.
 */

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

type Executor = Db | Tx;

/**
 * A platform with no floor has nothing to announce; fail closed. A silent success would make the
 * operator believe they announced while no inbox row exists.
 */
function requireFloor(floor: {
	platform: AppPlatform;
	minVersion: string | null;
}): string {
	if (!floor.minVersion)
		throw new ApiError(
			409,
			ADMIN_ERROR_CODE.appVersionFloorUnset,
			"This platform has no minimum supported version set, so the announcement can't be sent.",
		);
	return floor.minVersion;
}

/**
 * Status for one platform. Not counted without a floor: there is no version to count, and rows for
 * older versions would draw "everyone already received it".
 */
async function readPlatformStatus(
	executor: Executor,
	floor: { platform: AppPlatform; minVersion: string | null },
	totalRecipients: number,
): Promise<AppUpdateBroadcastStatusDto> {
	const base = {
		platform: floor.platform,
		minVersion: floor.minVersion,
		totalRecipients,
	};

	if (!floor.minVersion)
		return {
			...base,
			notifiedRecipients: 0,
			pendingRecipients: 0,
			broadcastComplete: false,
			lastNotifiedAt: null,
		};

	const sourceKey = notificationSourceKey.appUpdate(
		floor.platform,
		floor.minVersion,
	);
	const [row] = await executor
		.select({
			value: count(),
			/** The latest row time is the last broadcast time; no separate column (see header). */
			lastAt: sql<Date | null>`max(${notification.created_at})`,
		})
		.from(notification)
		.where(eq(notification.source_key, sourceKey));

	const notifiedRecipients = row?.value ?? 0;
	const lastAt = row?.lastAt ?? null;

	return {
		...base,
		notifiedRecipients,
		/** Clamped at 0: the two counts are not one snapshot, so a deletion in between can flip it. */
		pendingRecipients: Math.max(0, totalRecipients - notifiedRecipients),
		broadcastComplete:
			totalRecipients > 0 && notifiedRecipients >= totalRecipients,
		lastNotifiedAt: lastAt ? new Date(lastAt).toISOString() : null,
	};
}

/**
 * Status for both platforms, including one with no floor row; dropping it would hide the place to
 * set a floor.
 */
export async function readAppUpdateBroadcastStatuses(
	executor: Executor = db,
): Promise<AppUpdateBroadcastStatusDto[]> {
	const [floors, totals] = await Promise.all([
		listAppVersionFloors(),
		executor.select({ value: count() }).from(member),
	]);
	const totalRecipients = totals[0]?.value ?? 0;

	return Promise.all(
		floors.map((floor) => readPlatformStatus(executor, floor, totalRecipients)),
	);
}

export interface BroadcastAppUpdateInput {
	platform: AppPlatform;
	/** From the session only; the request body has no slot for it. */
	operatorId: string;
	reason: string;
}

/**
 * Notifies every member of the platform's current floor with one set-oriented INSERT.
 *
 * - No version argument: a caller passing a request value would let an operator announce any
 *   version.
 * - `not exists` is an optimization; `on conflict` is the authority (`unique(recipient,
 *   source_key)`), since two concurrent runs could both read an empty result.
 * - Audience is every member regardless of status or age: a sanctioned member must learn why the
 *   app will not open (`/me/notifications` is already `requireViewer`).
 * - The server does not know which members use the app, so web-only members receive the row too;
 *   tracking last-seen platform/version would be new data collection.
 * - `recordAudit` requires the `Tx`, so a failed audit rolls the broadcast back.
 */
export async function broadcastAppUpdate(
	input: BroadcastAppUpdateInput,
): Promise<AdminAppUpdateBroadcastResponse> {
	const floors = await listAppVersionFloors();
	const floor = floors.find((f) => f.platform === input.platform);
	if (!floor)
		throw new ApiError(
			409,
			ADMIN_ERROR_CODE.appVersionFloorUnset,
			"This platform has no minimum supported version set, so the announcement can't be sent.",
		);

	const minVersion = requireFloor(floor);
	const sourceKey = notificationSourceKey.appUpdate(input.platform, minVersion);

	const inserted = await db.transaction(async (tx) => {
		const result = await tx.execute(sql`
			insert into ${notification} (
				"id", "recipient", "kind", "source_key",
				"app_platform", "app_version"
			)
			select
				/*
				 * The DB makes the id: if the application made one UUID per member and passed them in,
				 * that whole array would become a query parameter. The shape matches lib/id.ts.
				 */
				replace(gen_random_uuid()::text, '-', ''),
				${member.id},
				'app_update',
				${sourceKey},
				${input.platform},
				/*
				 * The version is **frozen onto the row.** Re-reading the floor row at read time would let the
				 * next floor change rewrite the meaning of every notification already sent.
				 */
				${minVersion}
			from ${member}
			where not exists (
				select 1 from ${notification}
				where ${notification.recipient} = ${member.id}
					and ${notification.source_key} = ${sourceKey}
			)
			on conflict ("recipient", "source_key") do nothing
			returning "id"
		`);

		/**
		 * Push deliveries are a set INSERT too, from the ids just created, in the same transaction so
		 * notification and delivery commit or roll back together. No outbound calls here.
		 */
		await enqueuePushDeliveries(
			tx,
			result.rows.map((row) => String(row.id)),
		);

		/** Rows actually created. 0 on a re-run is not an error: everyone already has it. */
		const notified = result.rowCount ?? 0;

		await recordAudit(tx, {
			operatorId: input.operatorId,
			action: "admin.app-update.broadcast",
			/** Same target vocabulary as the floor-change audit. */
			targetType: "app_version_floor",
			targetId: input.platform,
			/**
			 * Counts and reason only; no recipient list, emails or notification ids, since operators read
			 * audit records and a roster would be a leak path.
			 */
			metadata: {
				reason: input.reason,
				platform: input.platform,
				appVersion: minVersion,
				notified,
			},
		});

		return notified;
	});

	/** Counted after commit; a snapshot inside the transaction misses concurrent signups and deletions. */
	const statuses = await readAppUpdateBroadcastStatuses();
	const status = statuses.find((s) => s.platform === input.platform) /**
	 * Unreachable (the platform list is a constant). Throwing here would report an already-committed
	 * broadcast as failed, and the second run returns 0.
	 */ ?? {
		platform: input.platform,
		minVersion,
		totalRecipients: 0,
		notifiedRecipients: inserted,
		pendingRecipients: 0,
		broadcastComplete: false,
		lastNotifiedAt: null,
	};

	return {
		status,
		notified: inserted,
		/** Added to `notified` this is everyone holding this version; "0 sent" alone reads as failure. */
		alreadyNotified: Math.max(0, status.notifiedRecipients - inserted),
	};
}
