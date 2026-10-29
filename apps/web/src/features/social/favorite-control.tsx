import { canInteract, type Story, type Viewer } from "@rowcat/domain";
import { favoriteMutationOptions } from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import { cn } from "@rowcat/ui-web/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Heart } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { AnimatedCount } from "#/lib/motion/animated-count.tsx";
import {
	enterTransition,
	exitTransition,
	standardTransition,
} from "#/lib/motion/transitions.ts";

/**
 * Heart and total, shared by gallery cards and the story detail view. The total is a public
 * aggregate attached to the story. Whether the heart is filled comes from the viewer's relation in
 * `/me/state`. The two come from different places on purpose. Putting the relation on the story
 * would make the same story differ per viewer. Optimistic update rules are not here. This component
 * sends only the desired next state, and `@rowcat/query` decides which caches change. If two
 * screens each touched the cache, fixing one would leave the totals out of sync between screens.
 */
export function FavoriteControl({
	story,
	favorited,
	viewer,
	size = "sm",
	className,
}: {
	story: Story;
	/**
	 * The viewer's relation, from `/me/state`. It comes from the viewer axis, not the story object.
	 */
	favorited: boolean;
	viewer: Viewer | null;
	/** Cards use a small size and detail views use body size. The behavior is the same. */
	size?: "sm" | "md";
	className?: string;
}) {
	const { t } = useTranslation("social");
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	// The current in-app path plus query string. Used as the return location after login.
	const here = useRouterState({ select: (state) => state.location.href });
	const mutation = useMutation(
		favoriteMutationOptions(getRowCatClient(), queryClient, story.id),
	);

	/**
	 * Suspended and blocked accounts are rejected up front, since the server would reject them anyway.
	 * This is UX, not authorization. Removing this check would still leave the API blocking. The API
	 * is the final authority.
	 */
	const blocked = viewer !== null && !canInteract(viewer);
	// Locks the button while a request is in flight, so it cannot look double-pressed. The mutation
	// also queues per story, but the UI should not appear to submit twice either.
	const disabled = mutation.isPending || blocked;

	return (
		<div className={cn("flex items-center gap-1.5", className)}>
			{/*
			 * The failure notice mounts and unmounts. Animating its removal needs Motion's presence feature,
			 * because React has already removed the element from the DOM by the time CSS would run.
			 * `initial={false}` means a notice already present on first render (for example a re-render after
			 * failure) does not appear late.
			 */}
			<AnimatePresence initial={false}>
				{mutation.isError && (
					/*
					 * No toast system for this one feature. A failure shown beside the heart makes clear which
					 * story failed. The response body is not included. Keeping `<output>` matters: it is a live
					 * region, so the text is read as soon as it appears. The animation is only opacity and a 2px
					 * shift, so it does not delay reading. With reduced motion, not even the shift occurs.
					 */
					<m.output
						key="favorite-error"
						className="mr-auto text-xs text-destructive"
						initial={{ opacity: 0, y: -2 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -2, transition: exitTransition }}
						transition={enterTransition}
					>
						{t("favorite.saveFailed")}
					</m.output>
				)}
			</AnimatePresence>
			<Button
				variant="ghost"
				size={size === "md" ? "icon" : "icon-sm"}
				aria-label={favorited ? t("favorite.remove") : t("favorite.add")}
				aria-pressed={favorited}
				disabled={disabled}
				onClick={() => {
					/**
					 * A guest's click goes to login instead of sending a request. Showing the error after a 401
					 * would make the user fail once before learning the next step. The server still rejects
					 * guests. This is guidance, not defense.
					 */
					if (!viewer) {
						/**
						 * Sends the user to the login screen rather than calling a specific sign-in method (Google)
						 * directly. Which method to use is that screen's decision. Picking one here would leave
						 * someone who wants email and password with nowhere to go. The current location is carried
						 * along, so after login the user returns to the same list, with its search and filters intact
						 * (kept in the query string).
						 */
						void navigate({ to: "/login", search: { redirect: here } });
						return;
					}
					if (disabled) return;
					// Sends the desired next state, not a toggle. Retrying then does not change the outcome.
					mutation.mutate(!favorited);
				}}
			>
				{/*
				 * The icon moves, not the button. Turning `<Button>` into `m.button` would make this file
				 * re-implement variants, focus ring, disabled handling, and Base UI behavior.
				 * The trigger is `favorited` alone, not the click or the request start. The optimistic cache sets
				 * that value, so the heart reacts immediately.
				 * On failure the cache reverts and the heart follows. No reverse animation is written here, since
				 * it would create a second source of truth.
				 * `initial={false}` prevents a bounce on mount. A story already favorited would otherwise pulse
				 * when first rendered in a list, looking like a fresh press.
				 * The server render uses the same reasoning and starts at the final keyframe (scale 1).
				 * A success response only re-confirms `true`, so no second pulse occurs. Motion does not rerun when
				 * the target is unchanged.
				 * `inline-flex` is required. Transforms do not apply to inline boxes.
				 */}
				<m.span
					className="inline-flex"
					initial={false}
					animate={favorited ? { scale: [1, 1.18, 1] } : { scale: 1 }}
					transition={standardTransition}
				>
					<Heart
						className={favorited ? "fill-current text-destructive" : undefined}
					/>
				</m.span>
			</Button>
			{/*
			 * The total moves in the same action and at the same moment, as the answer to that action.
			 * Like the heart, its trigger is the value carried on the story. The optimistic cache has already
			 * raised it, so it rolls immediately, and it rolls back if the cache reverts.
			 * Nothing is counted or added here. Adding would give the cache and the screen separate truths, and
			 * they would split when another user's count arrives.
			 * The motion is smaller than the heart's on purpose: the heart says what happened, and the number
			 * follows with the new total.
			 * No thousands separator either. The number is small text beside the heart, and at four digits a
			 * comma would become the most prominent part of that line.
			 * The rolling component does not format numbers, so that decision is recorded here.
			 */}
			<AnimatedCount
				value={String(story.favorites)}
				className={cn(
					"text-muted-foreground",
					size === "md" ? "text-sm" : "text-xs",
				)}
			/>
		</div>
	);
}
