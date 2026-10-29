import { createHash } from "node:crypto";

/**
 * Deterministic rollout: an installation always lands in the same bucket for a given release.
 *
 * ```text
 * bucket = first 4 bytes of sha256("rowcat-ota-rollout" ‖ releaseId ‖ installationId), mod 10000
 * in     <=>  bucket < percentage × 100
 * ```
 *
 * - Same answer on every request. With `Math.random()` an installation would flip between
 *   receiving and not, and "10%" would be a share of requests rather than of people.
 * - Raising the percentage never drops anyone who already has the release: 10 to 25 adds buckets
 *   [1000, 2500) to [0, 1000) without reshuffling the population.
 * - Each release has its own population because the release id is in the hash, so the same
 *   installation is not the canary every time.
 *
 * Installation id: the `EAS-Client-ID` expo-updates sends on every request, a random UUID stored
 * per install (`expo-eas-client`) and derived from no member, email or advertising id. It survives
 * restart, sign-out and account switch (so rollout never follows an account) and changes on
 * reinstall.
 *
 * The id is never stored: the decision ends inside the request and neither the hash nor the raw
 * value reaches the DB or logs, so rollout cannot become tracking.
 */

export const ROLLOUT_BUCKETS = 10_000;

const ROLLOUT_DOMAIN = "rowcat-ota-rollout";

const INSTALLATION_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Reads a header value as an installation id: only case is folded, and anything not UUID-shaped is
 * `null`.
 *
 * `null` means "not in any partial rollout" (`isInRollout`). Bucketing id-less requests would
 * collapse them into one bucket, and if that bucket fell within 10% every request that stripped its
 * id would become a canary.
 */
export const parseInstallationId = (
	value: string | undefined | null,
): string | null => {
	const normalized = value?.trim().toLowerCase() ?? "";
	return INSTALLATION_ID_PATTERN.test(normalized) ? normalized : null;
};

export const rolloutBucket = (
	releaseId: string,
	installationId: string,
): number =>
	createHash("sha256")
		.update(`${ROLLOUT_DOMAIN}\u0000${releaseId}\u0000${installationId}`)
		.digest()
		.readUInt32BE(0) % ROLLOUT_BUCKETS;

/**
 * Whether this installation is within the percentage. 0 and 100 ignore the id (nobody / everyone):
 * an id-less install missing a 100% release would be a failed deployment, not a rollout.
 */
export const isInRollout = (
	releaseId: string,
	installationId: string | null,
	percentage: number,
): boolean => {
	if (percentage >= 100) return true;
	if (percentage <= 0 || !installationId) return false;
	return rolloutBucket(releaseId, installationId) < percentage * 100;
};
