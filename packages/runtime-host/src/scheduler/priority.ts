/**
 * Work priorities use a product-neutral vocabulary that RowCat owns. React's scheduler package and
 * its constants are deliberately not used. They are tied to React's render model, and their meaning
 * is set by another project's release.
 *
 * - immediate: lifecycle (cancel, teardown, dispatcher binding). Nothing runs ahead of it.
 * - userBlocking: author event callbacks (Phase 4B). Not queued behind low-priority work.
 * - normal: state and render work, and the default for public calls.
 * - background: effects and cleanup (after Phase 4B).
 *
 * Within one priority, order is FIFO. The session-local sequence number (monotonic, not random)
 * defines execution order.
 */

export const RUNTIME_WORK_PRIORITIES = [
	"immediate",
	"userBlocking",
	"normal",
	"background",
] as const;

export type RuntimeWorkPriority = (typeof RUNTIME_WORK_PRIORITIES)[number];

/** Lower rank runs first. */
export const PRIORITY_RANK: Readonly<Record<RuntimeWorkPriority, number>> =
	Object.freeze({
		immediate: 0,
		userBlocking: 1,
		normal: 2,
		background: 3,
	});

export function compareWorkOrder(
	left: { priority: RuntimeWorkPriority; sequence: number },
	right: { priority: RuntimeWorkPriority; sequence: number },
): number {
	const rank = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
	return rank !== 0 ? rank : left.sequence - right.sequence;
}
