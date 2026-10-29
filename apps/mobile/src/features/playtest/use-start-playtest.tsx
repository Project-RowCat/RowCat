import { Button, Notice } from "@rowcat/ui-native";
import { useRouter } from "expo-router";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { useAuthoringScope } from "../../lib/local-data/scope.tsx";
import type { DraftAutosave } from "../create/use-draft-autosave.ts";
import {
	PLAYTEST_ENTRY_LABEL,
	PLAYTEST_ENTRY_PENDING_LABEL,
	PLAYTEST_START_FAILURE,
} from "./playtest-copy.ts";
import {
	type PlaytestStartFailureReason,
	startDraftPlaytest,
} from "./start-draft-playtest.ts";

/**
 * The **only entry** into the test from the editor.
 *
 * The order (flush pending save → store → read draft → assemble → ownership → navigate) is not
 * here. It lives in `start-draft-playtest.ts`, and this hook's job is only intent and display — the
 * same relationship the publish section has to `publishDraft`.
 *
 * Keeping that order in one place is the point. If another place (say, a draft list's row menu)
 * opens the test later, that place also uses this hook. Writing its own version means one of them
 * eventually skips the autosave flush, and that screen starts the test from a version missing the
 * sentence just typed.
 *
 * ## Trigger and notice are exported **together**
 *
 * The trigger has to sit on the same line as the save indicator (the width is narrow), and the
 * failure sentence needs the width beneath it. Grouping them in one component would fold a two-line
 * sentence inside the narrow slot. So the hook returns two nodes and the screen places each in its
 * own position (`use-block-creator.tsx` uses the same shape).
 *
 * ## Kept looking unlike publishing
 *
 * It is `outline`, with a different icon, and it sits **outside the publish section**. This
 * operation sends nothing to the server, and that fact must be readable from its appearance too. If
 * it looked like `Test → Publish`, the creator would read the test as the step before publishing, and
 * that is a procedure this product does not have.
 *
 * ## Navigation is `replace`
 *
 * The test screen **takes the editor's place**. Pushing on top would leave the editor mounted
 * behind, still holding its autosave and draft subscriptions, so two representations of the same
 * draft would live at once — one a frozen snapshot, the other a live record. The way back is the
 * test screen's own back (`To the editor`).
 */

const FAILURE_MESSAGE: Record<PlaytestStartFailureReason, string> =
	PLAYTEST_START_FAILURE;

export interface StartPlaytest {
	/** One button, on the same line as the save indicator. */
	trigger: ReactNode;
	/** One line shown on failure. `null` otherwise — placed in the slot where the screen takes the full width. */
	notice: ReactNode;
}

/**
 * Takes **only the id and the autosave handle**, not the draft object.
 *
 * The test is re-read from storage and assembled (`startDraftPlaytest`), so this hook has no reason
 * to look at the draft's fields. If it did, the hook would re-run with every record typing
 * produces. The autosave handle keeps the same identity for as long as the editor lives
 * (`use-draft-autosave.ts`).
 */
export function useStartPlaytest(
	draftId: string,
	autosave: DraftAutosave,
): StartPlaytest {
	const router = useRouter();
	const { ensureStore, ownsStore } = useAuthoringScope();
	/** Synchronous lock against two presses in the same tick. `setState` is too late for that. */
	const lock = useRef({ current: false });
	const [pending, setPending] = useState(false);
	const [failure, setFailure] = useState<PlaytestStartFailureReason | null>(
		null,
	);

	const start = useCallback(async () => {
		setPending(true);
		setFailure(null);
		try {
			const outcome = await startDraftPlaytest({
				draftId,
				lock: lock.current,
				/**
				 * Flushing pending autosave is **the first step of this order**. It is passed in rather than
				 * called here because the rule that stops the process after a failure has to live inside the
				 * same function. Split them, and each call site must restate that rule, and one of them
				 * eventually leaves it out.
				 */
				flushAutosave: autosave.flush,
				ensureStore,
				stillOwnsStore: ownsStore,
				navigate: async (id) => {
					router.replace(`/create/${encodeURIComponent(id)}/test`);
				},
			});
			if (outcome.status === "failed") setFailure(outcome.reason);
			/**
			 * `stale` and `busy` show no copy. The former is the result of the user switching accounts
			 * **themselves**, and the screen has already changed a lot by then. The latter means one is
			 * already in progress. Neither is a failure.
			 */
		} finally {
			setPending(false);
		}
	}, [draftId, autosave.flush, ensureStore, ownsStore, router]);

	return {
		trigger: (
			<Button
				label={pending ? PLAYTEST_ENTRY_PENDING_LABEL : PLAYTEST_ENTRY_LABEL}
				icon="playtest"
				variant="outline"
				size="sm"
				disabled={pending}
				onPress={() => void start()}
			/>
		),
		notice: failure ? (
			<Notice tone="destructive" message={FAILURE_MESSAGE[failure]} />
		) : null,
	};
}
