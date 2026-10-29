import type { CreatorWork, StoryLifecycleAction } from "@rowcat/domain";
import { storyLifecycleActions } from "@rowcat/domain";
import { storyLifecycleMutationOptions } from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { DropdownMenuItem } from "@rowcat/ui-web/components/dropdown-menu";
import { Spinner } from "@rowcat/ui-web/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, Eye, EyeOff, Undo2 } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { feedbackEnter, feedbackExit } from "#/lib/motion/feedback.ts";
import {
	type WorkLifecycleConfirm,
	workLifecycleConfirm,
	workLifecycleErrorMessage,
	workLifecycleLabel,
	workLifecyclePendingLabel,
} from "./lifecycle.ts";

/**
 * Status transitions for a published work's card. The rules live in a hook; the rendering is split
 * into three places.
 *
 * - An earlier version was a single button group. When cards were introduced, the actions moved
 *   into the management menu. The easy path was a second mutation set for the menu items, but then
 *   the confirmation text, double-press guard, and failure wording would live in two places and
 *   drift. So the split is by presentation, not by rules.
 * - All four pieces read the same `WorkLifecycle` value. The caller calls the hook once and
 *   passes the value to each, so a card has one mutation.
 * - What is drawn is decided by the domain predicate `storyLifecycleActions`. Re-deciding it with
 *   a visibility ternary here would leave this screen on old rules when the server's transition
 *   table changes. The symptom would be an item that is pressable but returns a 409, which is easy
 *   to miss.
 * - This card does not edit the work. These actions change only the exposure state. Title,
 *   rating, and body are still edited in the draft and cross the publish boundary. Editing them on
 *   the card would make the draft title and the work title diverge, and the next publish would have
 *   no basis to decide which one the creator intended.
 * - Republish is not here. It needs a fixed order: flush pending autosave, assemble the snapshot,
 *   validate, and reconfirm ownership. `publishDraft()` owns that order. These transitions send no
 *   authoring content, so they do not need the source draft. A creator publishing from another
 *   device, or who deleted the draft, must still be able to take a work down or bring it back.
 * - No optimistic update. A false message here would read 'this work is no longer public', and
 *   someone might leave believing it. The reverse, 'it is now public', would be worse. The card
 *   changes only after the server confirms.
 */
export interface WorkLifecycle {
	actions: StoryLifecycleAction[];
	start: (action: StoryLifecycleAction) => void;
	/**
	 * The confirm button in the dialog. The dialog has already said what will happen, so this does not
	 * ask again.
	 */
	run: (action: StoryLifecycleAction) => void;
	/** Closes the confirmation dialog. Callers do not invoke it while a transition is in progress. */
	cancel: () => void;
	pending: boolean;
	/**
	 * The transition currently running, or null when none. The card uses its label to show progress.
	 */
	running: StoryLifecycleAction | null;
	failure: string | null;
	/**
	 * The transition awaiting confirmation and its wording. Both are null when the dialog is closed.
	 */
	confirming: StoryLifecycleAction | null;
	confirm: WorkLifecycleConfirm | null;
}

export function useWorkLifecycle(work: CreatorWork): WorkLifecycle {
	const queryClient = useQueryClient();
	const mutation = useMutation(
		storyLifecycleMutationOptions(getRowCatClient(), queryClient, work.id),
	);

	/**
	 * The pending confirmation is local state in this card, as with the cover dialog. If the list held
	 * an open dialog, every `Show more` would re-render the whole list as it grows.
	 */
	const [confirming, setConfirming] = useState<StoryLifecycleAction | null>(
		null,
	);
	/**
	 * The failure message is stored together with the action that caused it. Storing only the message
	 * would let an old failure stick to the card after a later action succeeds, so the user would read
	 * their latest action as failed.
	 */
	const [failure, setFailure] = useState<string | null>(null);
	/** One press is one request. A second click in the same tick would not yet see `isPending`. */
	const runningRef = useRef(false);

	const run = (action: StoryLifecycleAction): void => {
		if (runningRef.current) return;
		runningRef.current = true;
		setFailure(null);
		setConfirming(null);
		mutation.mutate(action, {
			onError: (error) => setFailure(workLifecycleErrorMessage(action, error)),
			onSettled: () => {
				runningRef.current = false;
			},
		});
	};

	/**
	 * Opens the confirmation dialog if the action needs one (`workLifecycleConfirm` in
	 * `work-lifecycle.ts`); otherwise runs it at once.
	 */
	const start = (action: StoryLifecycleAction): void => {
		if (workLifecycleConfirm(action, work.title)) setConfirming(action);
		else run(action);
	};

	const pending = mutation.isPending;
	return {
		actions: storyLifecycleActions(work),
		start,
		run,
		cancel: () => setConfirming(null),
		pending,
		running: pending ? (mutation.variables ?? null) : null,
		failure,
		confirming,
		confirm: confirming ? workLifecycleConfirm(confirming, work.title) : null,
	};
}

/**
 * Transition menu items. The container is chosen by the caller.
 *
 * Only items are exported, as with the conversation management menu
 * (`chat/room-context-actions.tsx`). Choosing the container here would mean a new variant of this
 * component for each surface, and the items would drift apart.
 */
export function WorkLifecycleMenuItems({
	lifecycle,
}: {
	lifecycle: WorkLifecycle;
}) {
	return (
		<>
			{lifecycle.actions.map((action) => (
				<DropdownMenuItem
					key={action}
					disabled={lifecycle.pending}
					onClick={() => lifecycle.start(action)}
				>
					<ActionIcon action={action} />
					{workLifecycleLabel(action)}
				</DropdownMenuItem>
			))}
		</>
	);
}

/**
 * One line in the card that reports progress or failure.
 *
 * Menu items vanish the moment they are pressed, so the result needs a place in the card. The
 * earlier button group showed progress in its label (`Making public…`). This line keeps that information.
 *
 * Failure ends here, inside the card. A toast would lose which work failed, and an error covering
 * the list would block working on other works. `role="alert"` is used because the message answers
 * the user's own action.
 *
 * There is no optimistic update, so there is a real wait between pressing and the card changing.
 * This line is the only bridge across that wait. Progress and failure are alternatives for one
 * slot, so `mode="wait"` swaps them rather than stacking, which would briefly grow the card by two
 * lines. The `key` makes the swap: a different answer arriving needs a new node, not just new text.
 *
 * Success has no line of its own. The changed card already is the result; adding a `Made public` line
 * would state the same fact twice. The line uses the same enter-and-exit rhythm as the feedback
 * sentences (`feedback.ts`), since it is a single `<p>` with no control to press and sits as the
 * container's last flow child, so its exit delays no one's layout.
 */
export function WorkLifecycleStatus({
	lifecycle,
}: {
	lifecycle: WorkLifecycle;
}) {
	return (
		<AnimatePresence initial={false} mode="wait">
			{lifecycle.running ? (
				<m.p
					key="pending"
					initial={feedbackEnter.initial}
					animate={feedbackEnter.animate}
					exit={feedbackExit}
					transition={feedbackEnter.transition}
					className="flex items-center gap-1.5 text-xs text-muted-foreground"
				>
					{/*
					 * Only the icon rotates. Scaling this line as well would report progress two ways, and one of those
					 * ways
					 * would shift the card's layout.
					 */}
					<Spinner className="size-3" />
					{workLifecyclePendingLabel(lifecycle.running)}
				</m.p>
			) : lifecycle.failure ? (
				<m.p
					key="failure"
					role="alert"
					initial={feedbackEnter.initial}
					animate={feedbackEnter.animate}
					exit={feedbackExit}
					transition={feedbackEnter.transition}
					className="text-xs text-destructive"
				>
					{lifecycle.failure}
				</m.p>
			) : null}
		</AnimatePresence>
	);
}

export function WorkLifecycleConfirmDialog({
	lifecycle,
}: {
	lifecycle: WorkLifecycle;
}) {
	const { t } = useTranslation(["create", "common"]);
	const { confirm, confirming, pending } = lifecycle;
	if (!confirm || !confirming) return null;

	return (
		<Dialog
			open
			onOpenChange={(next, details) => {
				/**
				 * While `pending`, the dialog never closes for any reason (`shouldCloseDialog`). If it
				 * disappeared, the user would think the action was cancelled even though the request is already
				 * sent.
				 */
				if (!next && shouldCloseDialog(details.reason, pending))
					lifecycle.cancel();
			}}
		>
			<DialogContent
				closeButtonDisabled={pending}
				className={DIALOG_VIEWPORT_BOUND}
			>
				<DialogHeader>
					<DialogTitle>{confirm.title}</DialogTitle>
					{/*
					 * Multiple lines because the dialog must also say what will not happen. For `Archived` (archive), the
					 * most
					 * important sentence is that nothing is deleted.
					 */}
					<DialogDescription>
						<span className="flex flex-col gap-1.5">
							{confirm.lines.map((line) => (
								<span key={line}>{line}</span>
							))}
						</span>
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button
						variant="outline"
						disabled={pending}
						onClick={() => lifecycle.cancel()}
					>
						{t("common:actions.cancel")}
					</Button>
					<Button
						variant={confirm.destructive ? "destructive" : "default"}
						disabled={pending}
						onClick={() => lifecycle.run(confirming)}
					>
						{pending ? <Spinner /> : null}
						{pending
							? workLifecyclePendingLabel(confirming)
							: confirm.confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Icons support the label; there are no icon-only items. */
function ActionIcon({ action }: { action: StoryLifecycleAction }) {
	switch (action) {
		case "publish":
			return <Eye aria-hidden="true" />;
		case "unpublish":
			return <EyeOff aria-hidden="true" />;
		case "archive":
			return <Archive aria-hidden="true" />;
		case "restore":
			return <Undo2 aria-hidden="true" />;
	}
}
