import { canInteract, type Viewer } from "@rowcat/domain";
import { followMutationOptions } from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import { cn } from "@rowcat/ui-web/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { UserMinus, UserPlus } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { AnimatedIconSwap } from "#/lib/motion/animated-icon-swap.tsx";
import { labelSwapIn, labelSwapOut } from "#/lib/motion/label-swap.ts";
import { enterTransition, exitTransition } from "#/lib/motion/transitions.ts";
import { followErrorMessage } from "./social-error.ts";

/**
 * The follow button uses the same pattern as the favorite (heart) control: the screen sends only
 * the desired next state, and `@rowcat/query` decides which caches change.
 *
 * The follower count is intentionally not drawn here. It is an aggregate on the public profile
 * header, so the button holds only the relationship. Otherwise one value would update in two
 * places.
 *
 * On a state flip the container stays put. Only the icon and label change, while the background and
 * border interpolate through Button's transition-all.
 *
 * It is deliberately quieter than the heart, whose own pulse would compete for attention on the
 * same screen.
 *
 * The transition is driven by the `following` value, not by the click. On a failed mutation the
 * cache rolls back and this transition plays once more in reverse, so no separate failure motion is
 * needed.
 */
export function FollowButton({
	creatorId,
	following,
	viewer,
	className,
}: {
	creatorId: string;
	/** Relationship from `/me/state`. It comes from the viewer's side, not from the profile object. */
	following: boolean;
	viewer: Viewer | null;
	className?: string;
}) {
	const { t } = useTranslation("social");
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	// Current in-app path. Used as the return target for the login screen, same flow as the heart.
	const here = useRouterState({ select: (state) => state.location.href });
	const mutation = useMutation(
		followMutationOptions(getRowCatClient(), queryClient, creatorId),
	);

	/**
	 * Suspended or blocked accounts are disabled up front because the server rejects them anyway. This
	 * is UX, not authorization. The API still blocks them via `requireActiveViewer`, which is the
	 * final authority.
	 */
	const restricted = viewer !== null && !canInteract(viewer);
	const disabled = mutation.isPending || restricted;
	/**
	 * The visible label doubles as the button's accessible name. Building it in one place keeps the
	 * two from drifting apart.
	 */
	const label = following ? t("follow.following") : t("follow.follow");

	return (
		<div className={cn("flex flex-col items-start gap-1", className)}>
			<Button
				variant={following ? "outline" : "default"}
				size="sm"
				/**
				 * On narrow screens one step taller: it is a thumb target, and the adjacent overflow trigger
				 * (`block-menu.tsx`, `size-9 sm:size-8`) makes the same call. Mismatched heights would look
				 * crooked in the row.
				 *
				 * Width is not set here. Whether this button takes the full row is a layout decision of the
				 * caller, passed in through the outer className.
				 */
				className="h-9 sm:h-8"
				/**
				 * `aria-pressed` conveys the state and the visible text repeats it. An icon-only change would
				 * leave screen reader users with no feedback on the result.
				 */
				aria-pressed={following}
				/**
				 * The accessible name lives in `aria-label` and uses the same word as the visible text, so the
				 * two cannot drift apart. The label swap does not overlap, so the single empty frame during the
				 * swap does not clear the button's name.
				 */
				aria-label={label}
				disabled={disabled}
				onClick={() => {
					/**
					 * Guest clicks go to login instead of sending a request. Waiting for a 401 would make the user
					 * fail first and only then learn the next step. The current path is sent along, so login
					 * returns to this profile. Same flow as the heart; no new auth path.
					 */
					if (!viewer) {
						void navigate({ to: "/login", search: { redirect: here } });
						return;
					}
					if (disabled) return;
					// Sends the desired next state rather than a toggle, so retrying does not change the result.
					mutation.mutate(!following);
				}}
			>
				{/*
				 * The icon swap overlaps the two icons using the same primitive as the `Copy ↔ Copied` and
				 * `Send ↔ Stop generating` swaps in the chat UI. Rotation angle and scale are set once in
				 * `icon-swap.ts`, not here.
				 */}
				<AnimatedIconSwap stateKey={following ? "following" : "idle"}>
					{following ? (
						<UserMinus aria-hidden="true" />
					) : (
						<UserPlus aria-hidden="true" />
					)}
				</AnimatedIconSwap>

				{/*
				 * Labels never overlap: if they shared a slot, assistive tech would read both. Non-overlap alone
				 * makes the button width jitter during the swap, so both words are stacked invisibly to reserve
				 * the widest width. The width is not hard-coded, since a font change would make the number stale.
				 * The rule is documented in `label-swap.ts`, and a static scan pins the `wait` mode.
				 */}
				<span className="grid">
					{[t("follow.follow"), t("follow.following")].map((word) => (
						<span
							key={word}
							aria-hidden="true"
							className="invisible col-start-1 row-start-1"
						>
							{word}
						</span>
					))}
					<AnimatePresence initial={false} mode="wait">
						<m.span
							key={following ? "following" : "idle"}
							className="col-start-1 row-start-1"
							initial={labelSwapIn.initial}
							animate={labelSwapIn.animate}
							exit={labelSwapOut}
							transition={labelSwapIn.transition}
						>
							{label}
						</m.span>
					</AnimatePresence>
				</span>
			</Button>

			{/*
			 * The failure message sits next to the button. A toast system is not built for this one feature,
			 * the same call as the heart. The reason matters: `You can't follow a creator you've blocked` has a next
			 * step (unblock), so the message says why.
			 *
			 * `<output>` is a live region, so the text is read as soon as it appears. The motion is only
			 * opacity and 2px, so it does not delay the reading.
			 */}
			<AnimatePresence initial={false}>
				{mutation.isError && (
					<m.output
						key="follow-error"
						className="text-xs text-destructive"
						initial={{ opacity: 0, y: -2 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -2, transition: exitTransition }}
						transition={enterTransition}
					>
						{followErrorMessage(mutation.error)}
					</m.output>
				)}
			</AnimatePresence>
		</div>
	);
}
