import { Button } from "@rowcat/ui-web/components/button";
import { useNavigate } from "@tanstack/react-router";
import { FlaskConical } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { memo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DraftAutosave } from "#/features/create/editor/use-autosave.ts";
import { translator } from "#/lib/i18n/current.ts";
import { useAuthoringScope } from "#/lib/local-authoring/scope.ts";
import { feedbackEnter, feedbackExit } from "#/lib/motion/feedback.ts";
import {
	type PlaytestStartFailureReason,
	startDraftPlaytest,
} from "./start-draft-playtest.ts";

/**
 * The only entry point into a playtest from the editor.
 *
 * The sequence (flush pending saves, storage, read draft, assemble, ownership, navigate) is not
 * here; it lives in `start-draft-playtest.ts`. This component only expresses intent and display,
 * the same relation the publish section has to `publishDraft`.
 *
 * Keeping the sequence in one place is the point. If a later entry (a draft list row menu, a
 * command palette) opens playtests, it uses this component too. A separate copy there would
 * eventually skip the autosave flush, and that screen would start a test on a revision missing the
 * sentence just typed.
 *
 * It is deliberately not styled like publishing: it is `outline`, uses a different icon, and sits
 * away from the publish settings. This action sends nothing to the server, and that should be
 * readable from its appearance.
 */

const failureMessage = (key: PlaytestStartFailureReason): string =>
	translator("playtest")(`startButton.failure.${key}`);

/**
 * Receives only the id and the autosave handle, not the draft object.
 *
 * The test reloads from storage and assembles there (`startDraftPlaytest`), so the button has no
 * reason to read the draft's fields. Reading them would re-render this button with every record
 * produced while typing. For `memo` to actually skip renders, props must change rarely (the same
 * judgment as the publish section).
 */
export const StartPlaytestButton = memo(function StartPlaytestButton({
	draftId,
	autosave,
}: {
	draftId: string;
	autosave: DraftAutosave;
}) {
	const { t } = useTranslation(["playtest", "common"]);
	const navigate = useNavigate();
	const { ensureStore, ownsStore } = useAuthoringScope();
	/** A synchronous lock against same-tick double clicks. setState is too late for this. */
	const startingRef = useRef(false);
	const [pending, setPending] = useState(false);
	const [failure, setFailure] = useState<PlaytestStartFailureReason | null>(
		null,
	);

	const start = async () => {
		if (startingRef.current) return;
		setPending(true);
		setFailure(null);
		try {
			const outcome = await startDraftPlaytest({
				draftId,
				lock: startingRef,
				/**
				 * Flushing pending autosave is the first step of this order. It is passed in rather than called
				 * here in advance, because the rule 'do not continue after a failed flush' must live inside one
				 * function. If the two were split, every call site would have to restate that rule, and one
				 * would forget it.
				 */
				flushAutosave: autosave.flush,
				ensureStore,
				stillOwnsStore: ownsStore,
				navigate: (id) =>
					navigate({
						to: "/create/$draftId/test",
						params: { draftId: id },
					}),
			});
			if (outcome.status === "failed") setFailure(outcome.reason);
			/**
			 * `stale` and `busy` show no message. `stale` is the result of the user switching accounts
			 * themselves, and the screen has already changed a lot by then. `busy` means it is already
			 * running, which is not a failure.
			 */
		} finally {
			setPending(false);
		}
	};

	return (
		<div className="flex flex-col items-end gap-1">
			<Button
				variant="outline"
				size="sm"
				disabled={pending}
				onClick={() => void start()}
			>
				<FlaskConical aria-hidden="true" />
				{pending
					? t("startPlaytestButton.opening")
					: t("startPlaytestButton.storyTest")}
			</Button>
			{/*
			 * This is the answer to the action just taken and the last flow child of this group, so it
			 * uses the full appear-and-fade rhythm of a sentence (`feedback.ts`). Because `key` carries
			 * the reason, a change to a different failure also reads as a new message.
			 */}
			<AnimatePresence initial={false} mode="wait">
				{failure && (
					<m.p
						key={failure}
						role="alert"
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						exit={feedbackExit}
						transition={feedbackEnter.transition}
						className="text-xs text-destructive"
					>
						{failureMessage(failure)}
					</m.p>
				)}
			</AnimatePresence>
		</div>
	);
});
