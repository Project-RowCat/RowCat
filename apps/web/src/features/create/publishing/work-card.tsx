import type { CreatorWork, StoryVisibility } from "@rowcat/domain";
import { isOwnWorkViewable } from "@rowcat/domain";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Button } from "@rowcat/ui-web/components/button";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@rowcat/ui-web/components/dropdown-menu";
import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { Link } from "@tanstack/react-router";
import {
	EyeOff,
	ImageIcon,
	PencilLine,
	SquareArrowOutUpRight,
} from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { type ReactNode, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { formatDateTime } from "#/lib/format/date-time.ts";
import { visibilityLabel } from "#/lib/i18n/vocab.ts";
import { useExitGuard } from "#/lib/motion/exit-guard.ts";
import { labelSwapIn, labelSwapOut } from "#/lib/motion/label-swap.ts";
import { rowEnter, rowExit } from "#/lib/motion/list-motion.ts";
import { CoverManageDialog } from "../cover/manage-dialog.tsx";
import { CoverPreview } from "../cover/preview.tsx";
import { CardActionsMenu } from "./card-parts.tsx";
import {
	useWorkLifecycle,
	WorkLifecycleConfirmDialog,
	WorkLifecycleMenuItems,
	WorkLifecycleStatus,
} from "./lifecycle-controls.tsx";

/**
 * The management card for one published work.
 *
 * This row used to show four badges and five buttons at equal weight. The rules were correct (the
 * domain predicates decided what to draw), but nothing said what mattered. An operator-hidden work
 * and an adult marker were the same size, and `Manage cover` and `Archived` were the same size button. This card
 * only splits those elements into layers; the action rules did not change.
 *
 * - identity: cover and title, i.e. what it is
 * - state: visibility, `Hidden by operators`, `Adult`, updated time, i.e. what it is now
 * - actions: `View story`, `Edit draft`, manage menu, i.e. what can be done
 *
 * Badges do not share one weight. Color never carries the difference alone; all four states stay as
 * words. `Hidden by operators` is the strongest warning, so it gets a destructive badge and a note below the
 * title. Visibility is the main lifecycle state, so it gets one badge beside the title. `Adult` and
 * `Protected prompt` are supplementary and drop to small text on the metadata line. Four equal badges would
 * make none of them stand out.
 *
 * Actions split in two. Frequent navigation (`View story`, `Edit draft`) stays visible; management operations
 * (cover, lifecycle) go into one menu. The menu is always visible, because hiding it behind hover
 * would leave touch users unable to archive or change a cover. Lifecycle confirmations,
 * double-press guards, and failure messages are unchanged; `useWorkLifecycle` owns them, and this
 * card draws them in three places.
 */

/**
 * Emphasis by visibility state. Color is secondary; the words are always present.
 *
 * Four states use three badge variants on purpose. This axis answers 'where does it sit?' rather
 * than 'what is it now?'. `default` means in the catalog, `outline` means alive but not in the
 * catalog (`Link only`, `Private`), and `secondary` means taken down. The words tell the two outline states
 * apart. The remaining variant, `destructive`, means 'cannot be undone', so it is not applied to
 * works the list deliberately does not show; coloring them with it would read as a warning.
 *
 * The mobile app has the same table. Its test locks the equivalence
 * (`apps/mobile/src/features/create/work-visibility-badge.test.ts`).
 */
const VISIBILITY_BADGE: Record<
	StoryVisibility,
	"default" | "outline" | "secondary"
> = {
	public: "default",
	unlisted: "outline",
	private: "outline",
	archived: "secondary",
};

export function CreatorWorkCard({
	work,
	editableDraftId,
}: {
	work: CreatorWork;
	/**
	 * The original draft that can be opened on this device. Null if there is none (`creator-work.ts`).
	 */
	editableDraftId: string | null;
}) {
	const { t } = useTranslation(["create", "common"]);
	/**
	 * Whether the work can be opened is answered by the domain predicate (`isOwnWorkViewable`).
	 * Rewriting `!work.hidden && work.visibility !== 'archived'` here would leave this screen on the
	 * old rule when the detail view's boundary changes, and it would draw dead links.
	 */
	const viewable = isOwnWorkViewable(work);

	/**
	 * The cover dialog is local state, one per card.
	 *
	 * The list does not hold the open work's id, because that value should be identity, not position.
	 * Holding it in the list would re-render the whole list each time `Show more` grows it. When the dialog
	 * changes server state, the query cache carries that fact, so this state only needs to answer one
	 * question: is it open?
	 */
	const [managingCover, setManagingCover] = useState(false);
	const lifecycle = useWorkLifecycle(work);

	/**
	 * One line of supplementary info. Absent axes take no space: a blank left for a non-adult work
	 * would make the slot's meaning unclear.
	 */
	const meta = [
		work.adult ? t("workCard.adult") : null,
		work.promptProtected ? t("workCard.protectedPrompt") : null,
		t("workCard.updated", { at: formatDateTime(work.updatedAt) }),
	].filter((part): part is string => part !== null);

	return (
		<div className="rounded-lg border bg-card p-3 sm:p-4">
			<div className="flex gap-3 sm:gap-4">
				{/*
				 * The thumbnail is 3:4, the same as the gallery card. The crop the creator sees here must
				 * match the crop others see on cards, so a cover judged here is not reversed there.
				 *
				 * `self-start` is required to keep the ratio. Flex items default to stretch; without it the
				 * box grows to the card's height, `aspect-3/4` is ignored, and `object-cover` crops
				 * differently from the gallery card.
				 */}
				<div className="aspect-3/4 w-14 shrink-0 self-start overflow-hidden rounded-md border bg-muted sm:w-16">
					{/*
					 * A cover that fails to load collapses into the same placeholder as having no cover.
					 * This matters because the list includes archived and operator-hidden works, whose cover URLs
					 * return 404 even to the owner (reads pass the same predicate as the detail view). A
					 * broken-image icon would make the creator read the work as broken in exactly the state they
					 * most want to fix.
					 */}
					<CoverPreview src={work.coverUrl} loading="lazy" />
				</div>

				<div className="flex min-w-0 flex-1 flex-col gap-2">
					<div className="flex items-start justify-between gap-2">
						<div className="min-w-0 flex-1">
							<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
								<span className="min-w-0 truncate font-medium">
									{work.title}
								</span>
								{/*
								 * The status is stated in words, not color. The badge variant is secondary. A person who
								 * cannot tell colors apart must still get the same fact.
								 */}
								{/*
								 * When a lifecycle action is confirmed on the server, this badge swaps its words in place
								 * (`Private → Public`). This card has no optimistic update, so the change arrives well after the
								 * press. If it switched abruptly, the eye could not connect it to the cause.
								 *
								 * The rhythm comes from `label-swap.ts`; the login-method badge and the my-reports badge use
								 * it too. `mode='wait'` is required: the words differ in length, so overlapping would make the
								 * box jump, and assistive tech would read both words together.
								 *
								 * The whole card does not move. Becoming public is not a reward, and this list is a surface
								 * for scanning.
								 */}
								<AnimatePresence initial={false} mode="wait">
									<m.span
										key={work.visibility}
										initial={labelSwapIn.initial}
										animate={labelSwapIn.animate}
										exit={labelSwapOut}
										transition={labelSwapIn.transition}
										className="inline-flex"
									>
										<Badge variant={VISIBILITY_BADGE[work.visibility]}>
											{visibilityLabel(work.visibility)}
										</Badge>
									</m.span>
								</AnimatePresence>
								{work.hidden && (
									<Badge variant="destructive">
										<EyeOff aria-hidden="true" />
										{t("workCard.hiddenByOperators")}
									</Badge>
								)}
							</div>
							<p className="mt-1 text-xs text-muted-foreground">
								{meta.join(" · ")}
							</p>
						</div>

						{/*
						 * The management menu is pinned to the card's top right. If its position moved with the
						 * number of actions, the eye would have to find it again on every card.
						 */}
						<CardActionsMenu
							label={t("workCard.manage", { title: work.title })}
						>
							{/*
							 * Drawn always, regardless of `editableDraftId`. Covers belong to the server-published work,
							 * not to the local draft. A work published from another device, or one whose draft was
							 * deleted, still has the right to change its cover. Gating on draft existence would leave the
							 * creator unable to ever change their work's image.
							 */}
							<DropdownMenuItem onClick={() => setManagingCover(true)}>
								<ImageIcon aria-hidden="true" />
								{t("workCard.manageCover")}
							</DropdownMenuItem>
							{lifecycle.actions.length > 0 && <DropdownMenuSeparator />}
							{/*
							 * Also does not check `editableDraftId`, for the same reason as cover management. These
							 * actions do not send authoring content, so they need no source draft. Gating on the draft
							 * would leave a creator who published from another device unable to take their public work
							 * down.
							 */}
							<WorkLifecycleMenuItems lifecycle={lifecycle} />
						</CardActionsMenu>
					</div>

					{/*
					 * Hidden reasons and the appeal procedure are not here. That data belongs to another
					 * authority (`/v2/me/moderation`). If this screen started drawing it, the creator workspace
					 * would grow a second moderation screen. This screen only provides the way there.
					 */}
					{work.hidden && (
						<p className="text-xs text-muted-foreground">
							<Trans
								t={t}
								i18nKey="workCard.hiddenNote"
								components={{
									link: (
										<Link
											to="/account"
											className="font-medium text-foreground underline underline-offset-4"
										/>
									),
								}}
							/>
						</p>
					)}

					{/*
					 * States that there is no draft. Silently removing the button would leave the user searching
					 * for what they did wrong. When sync has not yet arrived, waiting is the fix, and the user has
					 * no way to know that.
					 */}
					{/*
					 * This line really does disappear at runtime. The draft list is a `liveQuery` subscription,
					 * so when sync brings in an original created on another device, this notice goes away and a
					 * `Edit draft` action appears in the row below. Those are one event and must arrive on the same
					 * rhythm.
					 *
					 * It only enters. The action row below takes over this slot, so an exit would make the shift
					 * wait until the exit finished.
					 */}
					<AnimatePresence initial={false}>
						{!editableDraftId && (
							<m.p
								key="missing-draft"
								initial={rowEnter.initial}
								animate={rowEnter.animate}
								transition={rowEnter.transition}
								className="text-xs text-muted-foreground"
							>
								{t("workCard.theOriginalDraftIsnT")}
							</m.p>
						)}
					</AnimatePresence>

					{/*
					 * On narrow screens the actions stack below the title. Forcing them onto one line would push
					 * a long title out or leave only two characters of it.
					 */}
					{/*
					 * Each of the two actions appears and disappears on its own. `View story` attaches or detaches
					 * the moment a lifecycle change is confirmed (after archiving, the detail page returns 404).
					 * `Edit draft` appears when sync brings in the original. If they popped in abruptly, they would
					 * not connect to the action just taken.
					 *
					 * There is no reflow motion. This card does not use `layout` (`editor-layout.test.ts` locks
					 * that absence). The list appends with `Show more`, so if cards already present animated their
					 * reflow, the whole list would look rebuilt. When an earlier slot leaves, later slots take the
					 * space directly.
					 */}
					{(viewable || editableDraftId) && (
						<div className="flex flex-wrap items-center gap-2">
							<AnimatePresence initial={false}>
								{/*
								 * No link is drawn for a work the viewer cannot see. The detail view applies the same
								 * visibility boundary as the list (operator-hidden and archived works return 404 even to the
								 * owner). Such a link would always end at 'not found', which is indistinguishable from a
								 * broken product.
								 */}
								{viewable && (
									<CardActionSlot key="view">
										<Button
											size="sm"
											variant="outline"
											render={
												<Link
													to="/stories/$storyId"
													params={{ storyId: work.id }}
												/>
											}
										>
											<SquareArrowOutUpRight aria-hidden="true" />
											{t("workCard.viewStory")}
										</Button>
									</CardActionSlot>
								)}
								{editableDraftId && (
									<CardActionSlot key="edit">
										<Button
											size="sm"
											variant="ghost"
											render={
												<Link
													to="/create/$draftId"
													params={{ draftId: editableDraftId }}
												/>
											}
										>
											<PencilLine aria-hidden="true" />
											{t("workCard.editDraft")}
										</Button>
									</CardActionSlot>
								)}
							</AnimatePresence>
						</div>
					)}

					<WorkLifecycleStatus lifecycle={lifecycle} />
				</div>
			</div>

			{/*
			 * The dialog mounts only while open. A closed dialog kept per card would mean drawing a list
			 * of N works creates N mutation hooks.
			 */}
			{managingCover && (
				<CoverManageDialog
					work={work}
					onClose={() => setManagingCover(false)}
				/>
			)}
			<WorkLifecycleConfirmDialog lifecycle={lifecycle} />
		</div>
	);
}

/**
 * The placeholder for one card, with the same geometry as the card that will arrive.
 *
 * It lives in this file because this is where the geometry is decided (the same rule as
 * `DraftListSkeleton` in the draft list). Redrawing it on the list side would leave this file in
 * its old shape when the card changes, and the mismatch would appear only as the whole list
 * re-laying out when values arrive. For a while the placeholder was two gray `h-28` boxes, and that
 * is what actually happened: border, cover column, and action row first appeared with the data.
 *
 * The border and cover column are drawn for real. Filling them gray would make them appear along
 * with the values, yet those two are exactly what this placeholder must fix in place (§37: fill the
 * inside, not the boundary). The cover's ratio (`aspect-3/4`) and width (`w-14 sm:w-16`) reuse the
 * card body's values, which guarantee the same crop as the gallery card; do not estimate them.
 *
 * Conditional parts are not drawn: the operator-hidden badge and note, `Edit draft`, and `View story` exist
 * only for some works, and reserving space would assert facts not yet known. Only what is always
 * present is reserved (title, visibility badge, metadata line, manage trigger). The rest accepts a
 * small motion as it arrives.
 */
export function CreatorWorkCardSkeleton() {
	return (
		<div className="rounded-lg border bg-card p-3 sm:p-4">
			<div className="flex gap-3 sm:gap-4">
				<div className="aspect-3/4 w-14 shrink-0 self-start overflow-hidden rounded-md border bg-muted sm:w-16" />

				<div className="flex min-w-0 flex-1 flex-col gap-2">
					<div className="flex items-start justify-between gap-2">
						<div className="min-w-0 flex-1">
							<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
								<Skeleton className="h-6 w-40 max-w-full" />
								{/* The badge height and corner radius come from `Badge` itself, not from this placeholder. */}
								<Skeleton className="h-5 w-14 rounded-md" />
							</div>
							{/*
							 * The metadata line (`mt-1 text-xs`). The updated time is always present, so its slot is
							 * always reserved.
							 */}
							<Skeleton className="mt-1 h-4 w-44 max-w-full" />
						</div>

						{/*
						 * Slot for the manage trigger. Its dimensions must match the `CardActionsMenu` button
						 * (`icon-sm` = `size-8`). That value is owned there; this is the only other place it is
						 * written down.
						 */}
						<Skeleton className="size-8 shrink-0 rounded-md" />
					</div>
				</div>
			</div>
		</div>
	);
}

/**
 * One slot in the action row. It does not respond to presses while it is exiting.
 *
 * It is a component because of one hook: `useExitGuard()` cannot be called inside an inline
 * `m.div`, and that hook blocks presses on an exiting slot. This slot holds a link. Without the
 * guard, the `View story` link of an already-archived work stays clickable in a tab that does not
 * deliver frames, and leads to a 404. Putting `pointerEvents` on the animation target would tie
 * that protection to frames (see `lib/motion/exit-guard.ts`).
 *
 * `layout` is not applied. This screen does not use layout motion (`editor-layout.test.ts`).
 * Opening it for one slot would make this file a 'screen that uses layout', and the next person
 * would cite it as grounds for putting layout on the card itself. When an earlier slot leaves,
 * later slots take its place immediately.
 */
function CardActionSlot({ children }: { children: ReactNode }) {
	return (
		<m.div
			initial={rowEnter.initial}
			animate={rowEnter.animate}
			exit={rowExit}
			transition={rowEnter.transition}
			style={useExitGuard()}
		>
			{children}
		</m.div>
	);
}
