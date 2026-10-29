import { blockMutationOptions } from "@rowcat/query";
import { AlertDialog, MenuItem, Notice } from "@rowcat/ui-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { getRowCatClient } from "../../lib/api.ts";
import type { ViewerAction } from "../../lib/viewer-action.ts";
import { blockErrorMessage } from "./social-error.ts";

/**
 * Block and unblock: **one menu row and one confirmation dialog.**
 *
 * ## No longer owns the menu
 *
 * This hook once exported the trigger and the whole menu. That was right while block was the only
 * item in the profile header's overflow. Reporting broke that shape: the quickest answer would have
 * been a second `⋯` beside follow, leaving two overflow triggers 20pt apart for the same person,
 * and nobody would remember what was in each.
 *
 * So this hook exports **one row**, and `use-profile-menu.tsx` builds the single menu. The split is
 * kept because block's rules (confirmation, failure placement, locking) still belong to this file.
 * Merging them would make the menu file know about mutations and confirmation copy.
 *
 * ## Why not a red button beside follow
 *
 * The two actions carry different weight. Follow is a cheap, reversible taste marker; block removes
 * that person's works from your screen and cuts the follow. Side by side they invite mis-taps, and
 * the destructive accent would become the most conspicuous element of the profile header. The web's
 * `block-menu.tsx` made the same call, and the container matches: an anchored menu on the trigger
 * plus an irreversible confirmation.
 *
 * ## The cache policy does not live here
 *
 * `blockMutationOptions` decides it, the same function the web uses. In particular it does **not
 * remove optimistically**: block changes everything this viewer can see, so the target to roll back
 * on failure is not deterministic. Instead it removes on success, immediately. The absence of any
 * line here that touches the gallery, detail or comments is the boundary's expression.
 *
 * ## Why all three are returned together
 *
 * The dialog is returned with the row because the menu **closes when an item is pressed** (the
 * primitive's `closeOnPress`). A dialog living inside that menu would vanish as soon as it opened.
 * The notice is returned separately for placement: the trigger is a 44pt icon with no width beneath
 * it for a sentence, and a failure must be readable across the full header width.
 *
 * **Unblock failures need a place to show.** Block's confirmation dialog holds its own failure (it
 * stays open). Unblock has no dialog and the menu closes on press, so without a notice the user
 * would leave believing they had unblocked, and the creator would stay hidden on their screen.
 */
export interface BlockCreatorControls {
	/** One row placed in the menu as-is: either block or unblock. */
	item: ReactNode;
	/** Unblock failure line. `null` when there is no failure, so it takes no space. */
	notice: ReactNode;
	/** Block confirmation dialog. The primitive draws nothing while it is closed. */
	dialog: ReactNode;
}

export function useBlockCreator({
	creatorId,
	creatorName,
	blocked,
	action,
}: {
	creatorId: string;
	/** Name the confirmation copy calls. A display name, so the caller passes the value it has already folded. */
	creatorName: string;
	/** Whether `/me/state` reports the creator as blocked. */
	blocked: boolean;
	action: ViewerAction;
}): BlockCreatorControls {
	const queryClient = useQueryClient();
	const [confirming, setConfirming] = useState(false);
	/**
	 * Only the unblock failure is held here. The mutation's `isError` is not drawn directly, because
	 * it is **also true for a block failure**. In that case the confirmation dialog already draws the
	 * same sentence, and two places showing the same text make a screen reader read it twice.
	 */
	const [unblockFailure, setUnblockFailure] = useState<string | null>(null);

	const mutation = useMutation(
		blockMutationOptions(getRowCatClient(), queryClient, creatorId),
	);

	/**
	 * Suspended and blocked accounts are refused by the server anyway, so they are blocked here in
	 * advance. This is guidance, not authorization: remove this check and the API still refuses
	 * (`requireActiveViewer`), and that is the final authority. `unverified` is in the same bucket: do
	 * not send an authenticated write before even knowing the viewer is a member.
	 *
	 * **This value passes straight to the menu row's `disabled`.** It used to be checked only by an
	 * `if (disabled) return;` inside the callback. In that shape the row looked ordinary, assistive
	 * technology read it as a plain `menuitem`, and pressing it **closed the menu and did nothing**,
	 * so a restricted user had no way to learn why. The guard line in the callback stays (the value
	 * can change between renders), but the locking is done by the primitive.
	 */
	const disabled = mutation.isPending || action !== "allowed";

	return {
		item: blocked ? (
			/**
			 * Unblock asks no confirmation. It is reversible (block again), and nothing is lost: **the
			 * follow does not come back** (the block confirmation's copy says so beforehand).
			 */
			<MenuItem
				icon="unblock"
				label="Unblock"
				disabled={disabled}
				onSelect={() => {
					if (disabled) return;
					setUnblockFailure(null);
					mutation.mutate(false, {
						onError: (failure) => setUnblockFailure(blockErrorMessage(failure)),
					});
				}}
			/>
		) : (
			<MenuItem
				icon="block"
				label="Block"
				destructive
				disabled={disabled}
				onSelect={() => {
					if (disabled) return;
					/**
					 * **A new confirmation starts clean.**
					 *
					 * A failed block leaves the dialog open with its sentence (the `error` below), and the
					 * mutation's failure state persists even after the user closes the dialog. If nothing clears
					 * it, someone who presses this item days later gets a confirmation dialog with the old failure
					 * sentence **before trying anything**; that sentence says nothing about this attempt.
					 *
					 * Clearing on open is the point. Clearing on close (`onCancel`) would add another path where
					 * the failure disappears with the dialog, possibly before the user has read it.
					 *
					 * It does not cut an in-flight request. The `disabled` above already includes `isPending`, so
					 * this line cannot be reached in that state.
					 */
					mutation.reset();
					setUnblockFailure(null);
					setConfirming(true);
				}}
			/>
		),

		notice: unblockFailure ? (
			<Notice tone="destructive" message={unblockFailure} />
		) : null,

		dialog: (
			<AlertDialog
				open={confirming}
				title="Block this creator?"
				/**
				 * State only what actually happens: the works disappear, their comments disappear, and the
				 * follow is cut. The last sentence matters most. It must say, before the press, that unblocking
				 * does not restore the follow, or the person later asks "why was I unfollowed?"
				 *
				 * Sentences such as "this user cannot see you" are not used, because the server does not do
				 * that. Blocking is a personal setting that **removes things from my own screen**; it neither
				 * stops the other person from viewing nor notifies them. Promising more privacy than exists
				 * puts people who act on that promise at risk.
				 */
				description={`${creatorName}'s stories and comments won't show on your screen, and if you follow them, you'll unfollow. Unblocking doesn't restore the follow.`}
				confirmLabel="Block"
				destructive
				busy={mutation.isPending}
				/** Failure is reported **inside the dialog**. Reporting after it closes would leave the user leaving without knowing the outcome. */
				error={mutation.isError ? blockErrorMessage(mutation.error) : null}
				onConfirm={() => {
					if (disabled) return;
					mutation.mutate(true, {
						/** Close only on success. Failure is drawn inside this dialog by the `error` above. */
						onSuccess: () => setConfirming(false),
					});
				}}
				onCancel={() => setConfirming(false)}
			/>
		),
	};
}
