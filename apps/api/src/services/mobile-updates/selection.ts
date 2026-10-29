import type { MobileUpdateKind, MobileUpdateStatus } from "@rowcat/contracts";
import { isInRollout } from "./rollout.ts";

/**
 * Pure decision of what to give this installation now.
 *
 * The query (`index.ts`) has already narrowed candidates by platform, channel, runtime and signing
 * key id; this layers status and rollout on top:
 *
 * ```text
 * walk candidates newest signed time first
 *   skip if not active          (draft / paused / rolled_back go to nobody)
 *   skip if outside percentage  (the next older release becomes this install's answer)
 *   first hit wins
 * none left: "no update"
 * ```
 *
 * The middle rule is the whole meaning of staged rollout: with B at 10% and A at 100%, an install
 * outside B's buckets gets A rather than nothing.
 *
 * Order is re-checked here even though the query already sorts newest first. A wrongly ordered list
 * raises no error and picks an old release as the new one, and clients ignore older manifests, so
 * the defect would only look like "updates never arrive".
 */

export interface ReleaseCandidate {
	id: string;
	kind: MobileUpdateKind;
	status: MobileUpdateStatus;
	rolloutPercentage: number;
	createdAt: Date;
}

export function selectRelease<T extends ReleaseCandidate>(
	candidates: readonly T[],
	installationId: string | null,
): T | null {
	const ordered = [...candidates].sort(
		(left, right) =>
			right.createdAt.getTime() - left.createdAt.getTime() ||
			(right.id < left.id ? -1 : right.id > left.id ? 1 : 0),
	);
	for (const candidate of ordered) {
		if (candidate.status !== "active") continue;
		if (!isInRollout(candidate.id, installationId, candidate.rolloutPercentage))
			continue;
		return candidate;
	}
	return null;
}
