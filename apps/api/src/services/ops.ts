import {
	type AppPlatform,
	type AppVersionFloorDto,
	type AppVersionFloorSetRequest,
	DEFAULT_FEATURE_DISABLED_MESSAGE,
	FEATURE_FLAGS,
	type FeatureFlagDto,
	type FeatureFlagKey,
	type FeatureFlagSetRequest,
	type FeatureFlagState,
	isFeatureEnabled,
	OPS_ERROR_CODE,
	type RuntimeConfigDto,
} from "@rowcat/contracts";
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { ops_app_version_floor, ops_feature_flag } from "../db/schema.ts";
import { localOwnerEnabled, passwordResetEnabled } from "../env.ts";
import { ApiError } from "../lib/errors.ts";
import { recordAudit } from "./admin/audit.ts";
import { hasLocalOwner } from "./setup/index.ts";

/**
 * Remote operations settings: feature switches (`ops_feature_flag`) and the minimum app version
 * (`ops_app_version_floor`). Reads sit on a hot path: `POST /v2/chat/generate` and sync push check
 * a switch on every request, so a `SELECT` each time would add a round trip to every write path.
 *
 * ## Cache correctness
 *
 * A 5-second in-process cache, invalidated immediately by writes. On a single process that is
 * exact: from the moment an operator flips a switch, that process refuses. With more than one
 * replica the others lag by up to 5 seconds, the only imprecision accepted here (same axis as the
 * SSE broker spreading only within a process).
 *
 * 5 seconds because the switch is a breaker: closing every replica within 5 seconds in an incident
 * is far cheaper than every request hitting the DB. Reads that need exactness (the operations
 * screen) skip the cache.
 *
 * ## Lookup failure does not block
 *
 * If the DB wobbles and a switch cannot be read, it falls to the product default (fail-open),
 * because every default is `on`: one DB outage closing chat, publishing and sync entirely would be
 * an amplifier, not a breaker. A key outside the vocabulary is rejected fail-closed (a bad request,
 * not an outage).
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Cache
 * ══════════════════════════════════════════════════════════════════════════ */

interface FlagRow {
	state: FeatureFlagState;
	message: string;
}

const FLAG_CACHE_TTL_MS = 5_000;

let flagCache: Map<string, FlagRow> | null = null;
let flagCacheAt = 0;
/**
 * Shared as a promise, not a value: with ten requests meeting cache expiry together, a cached value
 * alone would let all ten issue their own `SELECT`, multiplying DB round trips at every load spike
 * (same shape as `middleware/viewer.ts` uses for the viewer).
 */
let inFlight: Promise<Map<string, FlagRow>> | null = null;

/** Called after a write; the next read really hits the DB. */
function invalidateFlagCache(): void {
	flagCache = null;
	inFlight = null;
	flagCacheAt = 0;
}

async function loadFlags(): Promise<Map<string, FlagRow>> {
	const rows = await db
		.select({
			key: ops_feature_flag.key,
			state: ops_feature_flag.state,
			message: ops_feature_flag.message,
		})
		.from(ops_feature_flag);
	return new Map(
		rows.map((r) => [
			r.key,
			{ state: r.state as FeatureFlagState, message: r.message },
		]),
	);
}

function cachedFlags(): Promise<Map<string, FlagRow>> {
	const now = Date.now();
	if (flagCache && now - flagCacheAt < FLAG_CACHE_TTL_MS)
		return Promise.resolve(flagCache);
	/**
	 * Failures are not cached: `finally` clears the in-flight marker so the next request retries. A
	 * kept rejected promise would keep serving the same error for the TTL after the DB returns.
	 */
	inFlight ??= loadFlags()
		.then((map) => {
			flagCache = map;
			flagCacheAt = Date.now();
			return map;
		})
		.finally(() => {
			inFlight = null;
		});
	return inFlight;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Reads called by gates
 * ══════════════════════════════════════════════════════════════════════════ */

export interface FeatureState {
	enabled: boolean;
	message: string;
}

/**
 * Whether a feature is on now; the one function server gates call. The decision is the contract's
 * `isFeatureEnabled`; rewriting `state === "on"` here would give `default` two meanings, and only
 * one would move when the product default changes.
 */
export async function readFeatureState(
	key: FeatureFlagKey,
): Promise<FeatureState> {
	let row: FlagRow | undefined;
	try {
		row = (await cachedFlags()).get(key);
	} catch (err) {
		/**
		 * Failing to read a switch and the switch being off are different facts. Closing the feature here
		 * would make the whole product draw "unavailable by policy" while the DB wobbles, which is false.
		 */
		console.error(
			"[ops] couldn't read feature switches — proceeding with product defaults",
			err,
		);
		row = undefined;
	}
	const state = row?.state ?? "default";
	return {
		enabled: isFeatureEnabled(key, state),
		message: row?.message || DEFAULT_FEATURE_DISABLED_MESSAGE,
	};
}

/**
 * Throws if off; the one line routes call. The code is fixed at `feature_disabled`, and the status
 * is 403 rather than 503 or 500: this is policy, not an outage, and clients must not retry through
 * it. "We do not accept this" rather than "not right now".
 */
export async function requireFeatureEnabled(
	key: FeatureFlagKey,
): Promise<void> {
	const state = await readFeatureState(key);
	if (state.enabled) return;
	throw new ApiError(403, OPS_ERROR_CODE.featureDisabled, state.message);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Reads and writes called by the operations screen
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Every switch in registry order, including keys with no row. Returning only DB rows would hide a
 * switch nobody has touched from the operations screen, exactly when someone needs to turn it off.
 * Reads the DB directly, skipping the cache, since this screen must see the value it just changed.
 */
export async function listFeatureFlags(): Promise<FeatureFlagDto[]> {
	const rows = await db
		.select({
			key: ops_feature_flag.key,
			state: ops_feature_flag.state,
			message: ops_feature_flag.message,
			updatedAt: ops_feature_flag.updated_at,
			updatedBy: ops_feature_flag.updated_by,
		})
		.from(ops_feature_flag);
	const byKey = new Map(rows.map((r) => [r.key, r]));

	return FEATURE_FLAGS.map((definition) => {
		const row = byKey.get(definition.key);
		const state = (row?.state as FeatureFlagState) ?? "default";
		return {
			key: definition.key,
			state,
			enabled: isFeatureEnabled(definition.key, state),
			message: row?.message ?? "",
			updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
			updatedBy: row?.updatedBy ?? null,
		};
	});
}

/**
 * Changes one switch; the setting write and its audit record are one transaction. Split, "feature
 * off, nobody recorded as turning it off" would stay committed. Same judgment that moved the
 * notification ledger into the comment transaction, and for the same reason no outbound call (e.g.
 * a Slack notice) may enter here.
 *
 * The previous state goes into the audit metadata because without it the log only says "someone set
 * it off", and what it was is exactly what the next incident response needs.
 */
export async function setFeatureFlag(options: {
	key: FeatureFlagKey;
	actorId: string;
	request: FeatureFlagSetRequest;
}): Promise<FeatureFlagDto> {
	const { key, actorId, request } = options;

	const result = await db.transaction(async (tx) => {
		const [before] = await tx
			.select({
				state: ops_feature_flag.state,
				message: ops_feature_flag.message,
			})
			.from(ops_feature_flag)
			.where(eq(ops_feature_flag.key, key))
			.limit(1);

		const now = new Date();
		const [row] = await tx
			.insert(ops_feature_flag)
			.values({
				key,
				state: request.state,
				message: request.message,
				updated_at: now,
				updated_by: actorId,
			})
			.onConflictDoUpdate({
				target: ops_feature_flag.key,
				set: {
					state: request.state,
					message: request.message,
					updated_at: now,
					updated_by: actorId,
				},
			})
			.returning();
		if (!row) throw new Error("the feature switch was not saved");

		await recordAudit(tx, {
			operatorId: actorId,
			action: "ops.feature_flag.set",
			targetType: "feature_flag",
			targetId: key,
			metadata: {
				/** The contract requires a reason, so a change with an empty one is not expressible. */
				reason: request.reason,
				previousState: before?.state ?? "default",
				nextState: request.state,
				/** The message is shown to users, so it is not secret. */
				messageChanged: (before?.message ?? "") !== request.message,
			},
		});

		return row;
	});

	invalidateFlagCache();

	const state = result.state as FeatureFlagState;
	return {
		key,
		state,
		enabled: isFeatureEnabled(key, state),
		message: result.message,
		updatedAt: result.updated_at.toISOString(),
		updatedBy: result.updated_by,
	};
}

/* ══════════════════════════════════════════════════════════════════════════
 * Minimum app version
 * ══════════════════════════════════════════════════════════════════════════ */

const PLATFORMS: readonly AppPlatform[] = ["ios", "android"];

/** Every floor; like switches, platforms with no row are returned too. */
export async function listAppVersionFloors(): Promise<AppVersionFloorDto[]> {
	const rows = await db
		.select({
			platform: ops_app_version_floor.platform,
			minVersion: ops_app_version_floor.min_version,
			message: ops_app_version_floor.message,
			updatedAt: ops_app_version_floor.updated_at,
			updatedBy: ops_app_version_floor.updated_by,
		})
		.from(ops_app_version_floor);
	const byPlatform = new Map(rows.map((r) => [r.platform, r]));

	return PLATFORMS.map((platform) => {
		const row = byPlatform.get(platform);
		return {
			platform,
			minVersion: row?.minVersion ?? null,
			message: row?.message ?? "",
			updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
			updatedBy: row?.updatedBy ?? null,
		};
	});
}

/**
 * Changes a floor, under the same transaction rule as switches.
 *
 * This is the most dangerous operation in the file. A floor set to a version not in the store locks
 * every mobile user out of the app, and we cannot undo that until store review completes (the app
 * is already locked, so nothing can be announced through it). The server cannot know whether the
 * version is in the store and so cannot block it; the block is the operations screen's explicit
 * confirmation, and what remains is this audit record.
 */
export async function setAppVersionFloor(options: {
	platform: AppPlatform;
	actorId: string;
	request: AppVersionFloorSetRequest;
}): Promise<AppVersionFloorDto> {
	const { platform, actorId, request } = options;

	const result = await db.transaction(async (tx) => {
		const [before] = await tx
			.select({ minVersion: ops_app_version_floor.min_version })
			.from(ops_app_version_floor)
			.where(eq(ops_app_version_floor.platform, platform))
			.limit(1);

		const now = new Date();
		const [row] = await tx
			.insert(ops_app_version_floor)
			.values({
				platform,
				min_version: request.minVersion,
				message: request.message,
				updated_at: now,
				updated_by: actorId,
			})
			.onConflictDoUpdate({
				target: ops_app_version_floor.platform,
				set: {
					min_version: request.minVersion,
					message: request.message,
					updated_at: now,
					updated_by: actorId,
				},
			})
			.returning();
		if (!row) throw new Error("the minimum version was not saved");

		await recordAudit(tx, {
			operatorId: actorId,
			action: "ops.version_floor.set",
			targetType: "app_version_floor",
			targetId: platform,
			metadata: {
				reason: request.reason,
				previousMinVersion: before?.minVersion ?? null,
				nextMinVersion: request.minVersion,
			},
		});

		return row;
	});

	return {
		platform,
		minVersion: result.min_version,
		message: result.message,
		updatedAt: result.updated_at.toISOString(),
		updatedBy: result.updated_by,
	};
}

/* ══════════════════════════════════════════════════════════════════════════
 * Public runtime config
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The values clients read at boot; only what is off is included. It uses the cache as-is (a point
 * where it differs from the operations screen): this response needs no second-level exactness, and
 * being public, without the cache every booting app would hit the DB.
 *
 * The operator axis (who changed it, when) does not appear. That is not field picking; the response
 * type has no slot for it, and `updatedBy` here would be a public leak of member ids.
 */
export async function readRuntimeConfig(): Promise<RuntimeConfigDto> {
	let flags: Map<string, FlagRow>;
	try {
		flags = await cachedFlags();
	} catch {
		/** Unreadable answers "nothing is off", the same judgment as the gate's fail-open above. */
		flags = new Map();
	}

	const disabledFeatures = FEATURE_FLAGS.flatMap((definition) => {
		const row = flags.get(definition.key);
		const state = row?.state ?? "default";
		return isFeatureEnabled(definition.key, state)
			? []
			: [
					{
						key: definition.key,
						message: row?.message || DEFAULT_FEATURE_DISABLED_MESSAGE,
					},
				];
	});

	const floors = await listAppVersionFloors().catch(() => []);
	const floorOf = (platform: AppPlatform) =>
		floors.find((f) => f.platform === platform)?.minVersion ?? null;
	const message = floors.find((f) => f.minVersion && f.message)?.message ?? "";

	return {
		disabledFeatures,
		minAppVersion: { ios: floorOf("ios"), android: floorOf("android") },
		updateMessage: message,
		passwordReset: passwordResetEnabled,
		/**
		 * Unreadable answers "no local owner": the login form stays, which is never wrong. A deployment
		 * that has not turned the local owner on says no even if a setup row still names one — its
		 * sign-in door answers 404, and a screen that tried it would only draw a failure.
		 */
		localSignIn:
			localOwnerEnabled && (await hasLocalOwner().catch(() => false)),
	};
}

/**
 * Lets tests clear the cache so one process can play several states. It clears every cache in this
 * file; add a line here when one is added. Missed, the next test sees the previous test's state for
 * 5 seconds after the DB is wiped, a dependency that breaks only in CI where run order changes.
 */
export function resetOpsCacheForTest(): void {
	invalidateFlagCache();
}
