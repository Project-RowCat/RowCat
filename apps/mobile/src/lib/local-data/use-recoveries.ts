import type { DraftConflictRecovery } from "@rowcat/authoring";
import { useMemo } from "react";
import { type LocalLive, useLocalLiveOn } from "./live.ts";
import { useDraftRecoveryScope } from "./scope.tsx";

/**
 * Subscribes to the **local copies** of drafts whose merge discarded a revision. Same place and
 * same reason as the draft subscription.
 *
 * The point of this file is that the signal is `recoveries`, not `mutations` (`stores.ts`).
 * Discarding a copy is not an event that creates anything to upload; putting it on that signal
 * would create a spinning sync out of closing the notice.
 *
 * **A new copy reaches this subscription on the next local write or a remount.** `applyPull` emits
 * no signal (feedback would loop forever, see the header of `stores.ts`), and for this screen that
 * delay is acceptable: the lost value is not gone, it stays in the store. Adding polling here to
 * shorten the delay would break, per screen, the promise that a quiet app makes no requests.
 */

const EMPTY: DraftConflictRecovery[] = [];

/** The copies of that draft. */
export function useDraftRecoveries(
	draftId: string,
): LocalLive<DraftConflictRecovery[]> {
	const { store, signal } = useDraftRecoveryScope();
	const load = useMemo(
		() => (store ? () => store.listForDraft(draftId) : null),
		[store, draftId],
	);
	return useLocalLiveOn(signal, load, EMPTY);
}

/**
 * Every copy left on this account, **all of them**: the way for someone who has forgotten which
 * draft each one came from.
 *
 * Places that only need a count use the same hook. A separate count-only query would carry its own
 * predicate, and then the screen could say "2 items" while drawing only one row.
 */
export function useAllDraftRecoveries(): LocalLive<DraftConflictRecovery[]> {
	const { store, signal } = useDraftRecoveryScope();
	const load = useMemo(() => (store ? () => store.list() : null), [store]);
	return useLocalLiveOn(signal, load, EMPTY);
}
