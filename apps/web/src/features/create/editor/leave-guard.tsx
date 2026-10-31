import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Spinner } from "@rowcat/ui-web/components/spinner";
import { useBlocker } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { useHoldBuildSwitch } from "#/lib/build-freshness/hold.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { draftLeaveCopy, shouldBlockLeave } from "./leave.ts";
import type { DraftAutosave } from "./use-autosave.ts";

/**
 * Dialog shown when the user tries to leave the editor after a save has definitively failed.
 *
 * - The failure it prevents: the screen has already shown the failure, the automatic retry also
 *   fails, the edits exist only in this hook's queue, the user navigates away, and the final flush
 *   fails too. The hook and queue are then unmounted and the edits vanish.
 * - beforeunload is not used for writes, since asynchronous writes started in that event are not
 *   guaranteed to finish. enableBeforeUnload only shows the browser's synchronous confirmation
 *   prompt, and only while the blocking condition holds (the function form asks the current fact
 *   each time).
 * - History is not intercepted by hand. The router's useBlocker covers back navigation, links,
 *   navigate() and replace. A popstate listener would cover only the back button, and links are the
 *   most common way out of this screen.
 * - The decision is not made here. shouldBlockLeave in draft-leave.ts owns it. Comparing status
 *   labels inside this component would make the condition impossible to test without rendering.
 */
export function DraftLeaveGuard({ autosave }: { autosave: DraftAutosave }) {
	/**
	 * The editor's last edits are flushed when it unmounts, in a document that stays alive; a document
	 * load would leave only the `pagehide` flush, which the browser need not finish. So a stale tab
	 * leaves the editor as a client navigation (lib/build-freshness/). It lives here because this
	 * guard is the one piece of the editor that exists for leaving.
	 */
	useHoldBuildSwitch(true);
	const [retrying, setRetrying] = useState(false);
	const [retryFailed, setRetryFailed] = useState(false);

	/**
	 * Asks the current fact rather than reading subscribed state. This runs at the moment of
	 * navigation, when the render state may be one frame stale. It must also be stable: useBlocker's
	 * effect depends on its identity, and without useCallback the blocker would be re-registered on
	 * every render.
	 */
	const shouldBlockFn = useCallback(
		() => shouldBlockLeave(autosave.state.get()),
		[autosave],
	);

	const blocker = useBlocker({
		shouldBlockFn,
		enableBeforeUnload: shouldBlockFn,
		withResolver: true,
	});

	if (blocker.status !== "blocked") return null;

	const retry = async () => {
		if (retrying) return;
		setRetrying(true);
		setRetryFailed(false);
		/**
		 * Uses the existing autosave machinery rather than a second write path. A second path would
		 * duplicate the ownership check and queue restore, and any mismatch would only surface when a
		 * save fails.
		 */
		const saved = await autosave.flush();
		setRetrying(false);
		/**
		 * On success, continue to the original destination. On failure, keep the dialog open: closing it
		 * would let the navigation that just failed go through.
		 */
		if (saved) blocker.proceed();
		else setRetryFailed(true);
	};

	const discard = () => {
		/**
		 * Discard comes first. Once navigation starts, the editor unmounts and its cleanup runs a final
		 * flush. If the queue is still non-empty, the edits the user chose to discard could be written at
		 * that point.
		 */
		autosave.discard();
		blocker.proceed();
	};

	return (
		<Dialog
			open
			onOpenChange={(next) => {
				/**
				 * Closing the dialog means staying (Escape, an outside click, the close button). The default is
				 * the safe one, so no reason is distinguished. Closing is ignored while a retry is running.
				 */
				if (!next && !retrying) blocker.reset();
			}}
		>
			<DialogContent className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-md`}>
				<DialogHeader>
					<DialogTitle>{draftLeaveCopy().title}</DialogTitle>
					<DialogDescription>{draftLeaveCopy().description}</DialogDescription>
				</DialogHeader>
				{/*
				 * A repeated retry failure is shown inside the dialog. A toast would announce the same failure
				 * twice, since the dialog already states it, and the information is not needed after the dialog
				 * closes.
				 */}
				{retryFailed ? (
					<p role="alert" className="text-sm text-destructive">
						{draftLeaveCopy().retryFailed}
					</p>
				) : null}
				<DialogFooter>
					<Button
						variant="outline"
						disabled={retrying}
						onClick={() => blocker.reset()}
					>
						{draftLeaveCopy().stay}
					</Button>
					{/*
					 * The destructive option is not emphasized. Retrying is the most likely thing the user wants, and
					 * discarding is possible but not placed where the hand goes first.
					 */}
					<Button
						variant="ghost"
						disabled={retrying}
						onClick={discard}
						className="text-destructive hover:text-destructive"
					>
						{draftLeaveCopy().discard}
					</Button>
					<Button disabled={retrying} onClick={() => void retry()}>
						{retrying ? (
							<>
								<Spinner className="size-4" />
								{draftLeaveCopy().retrying}
							</>
						) : (
							draftLeaveCopy().retry
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
