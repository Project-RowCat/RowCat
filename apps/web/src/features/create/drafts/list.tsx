import type { StoryDraft } from "@rowcat/authoring";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@rowcat/ui-web/components/empty";
import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { Link } from "@tanstack/react-router";
import { PenLine, Trash2 } from "lucide-react";
import { AnimatePresence, LayoutGroup } from "motion/react";
import * as m from "motion/react-m";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "#/lib/format/date-time.ts";
import { draftTitleLabel } from "#/lib/i18n/vocab.ts";
import { useAuthoringScope } from "#/lib/local-authoring/scope.ts";
import { useExitGuard } from "#/lib/motion/exit-guard.ts";
import { rowEnter, rowExit } from "#/lib/motion/list-motion.ts";
import { draftDeleteFailureMessage } from "../editor/failure.ts";
import { draftDeleteNotice } from "./delete.ts";

/**
 * The drafts list: this device's and this account's manuscripts.
 * - No server query at all. Drafts live in local storage, not PostgreSQL, so the list shows even
 *   offline. The adjacent published works tab being server-backed does not change that. Drawing two
 *   lists side by side on one screen is no reason to merge their ownership, and merging would take
 *   the whole workspace down offline.
 * - Named "draft", not "preset". The legacy preset concept combined an edit document, a
 *   conversation template, a received copy, and a DRM container. Received copies were already moved
 *   elsewhere: receiving a published work creates a room that holds a snapshot. What lives here is
 *   a draft.
 * - Rows, not cards. A card per draft made each one a bordered box. The question this list must
 *   answer, which manuscript to resume, required reading card by card. Borders separate rows from
 *   each other, which hurts the vertical scan. So the list follows the same convention as the
 *   per-work table in the analytics tab (`creator-analytics-work-list.tsx`): a line between rows,
 *   fixed-width columns, and a column header from `sm` up. The matching rhythm is why the two tabs
 *   read as one workspace.
 * - Not included: - Cover thumbnails. Drawing them needs a server cover URL for each published
 *   draft (`use-draft-cover-url.ts`), which would make the default tab hit the network. Local-first
 *   is not traded for decoration.
 * - Progress, completeness, or publish readiness. There is no source to judge; counting
 *   characters into a bar would pretend to measure something not measured.
 * - Sorting, filtering, search. Order is what local storage returns (most recently updated
 *   first). Re-sorting would re-run on every `liveQuery` update, and the list is a few manuscripts
 *   long.
 * - Selection checkboxes. No bulk action exists, so a checkbox would be a promise the UI cannot
 *   keep.
 */

export function DraftList({
	items,
	onCreate,
	creating,
}: {
	items: StoryDraft[];
	onCreate: () => void;
	creating: boolean;
}) {
	const { t } = useTranslation(["create", "common"]);
	/**
	 * The open confirmation. Only one is open at a time, and the list holds it, not the row. It used
	 * to be local state in `DraftRow`, which was right for the product at the time. It moved because
	 * motion is tied to render: Motion re-measures only the nodes that re-rendered (`willUpdate` →
	 * `updateLayout`), and other nodes skip measurement entirely, even with `layout="position"`. If
	 * the confirmation lived inside a row, only that row would re-render, and the rows below would
	 * drop down without knowing they had moved. This is the same situation as the editor sections,
	 * which share one `LayoutGroup`; see the test 'sections form one group' in
	 * `editor-layout.test.ts`. Holding the value here also keeps the confirmation to one at a time,
	 * which is right: confirmations for an irreversible action should not be open on many rows at
	 * once.
	 */
	const [confirmingId, setConfirmingId] = useState<string | null>(null);

	/*
	 * Switching between the list and the empty state. When the last draft is deleted, this area swaps
	 * entirely. The incoming side is joined by opacity alone. An `exit` on the outgoing side would
	 * make the empty state's entrance wait for the list's exit animation (the same rule as the chat
	 * list and discovery).
	 */
	return (
		<AnimatePresence initial={false}>
			{items.length === 0 ? (
				<m.div
					key="empty"
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={rowEnter.transition}
				>
					<Empty className="border">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<PenLine />
							</EmptyMedia>
							<EmptyTitle>{t("list.noDraftsYet")}</EmptyTitle>
							<EmptyDescription>
								{t("list.draftsAreSavedOnThis")}
							</EmptyDescription>
						</EmptyHeader>
						{/*
						 * The empty state must also let the user start a draft. It calls **the same action** as the header
						 * button. A second creation path would split the lock that prevents duplicate creation, so the lock
						 * would apply to only one of the two.
						 */}
						<Button variant="outline" disabled={creating} onClick={onCreate}>
							{creating
								? t("createHomePage.creating")
								: t("list.createANewStory")}
						</Button>
					</Empty>
				</m.div>
			) : (
				<m.div
					key="list"
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={rowEnter.transition}
				>
					<DraftListHeader />

					{/*
					 * The same convention as the chat list (`lib/motion/list-motion.ts`). Drafts are also local records
					 * with identity. When one is deleted, the remaining row finding its place is a very different
					 * experience from the whole list redrawing. Order also changes: autosave bumps `updatedAt`, so
					 * editing another draft and coming back moves that row to the top.
					 * Rows are not boxed individually, so the list supplies its own top and bottom lines. From `sm` the
					 * column header's bottom line already exists above, so it is removed here.
					 * **Not `mode="popLayout"`.** It was on for a while but never actually ran on this list. popLayout
					 * clones the exiting child with a `ref` to measure its DOM element. This row is a function
					 * component
					 * that does not accept `ref`, so that ref stays `null` (React 19 treats `ref` as a plain prop, so
					 * there is no warning). Exits and slot filling happen in order either way: the same decision as the
					 * chat list, see the section on editing lists in `docs/motion/ARCHITECTURE.md`.
					 */}
					{/*
					 * **One group.** When the confirmation collapses, the slot is filled by sibling rows. But the
					 * render
					 * that ends the presence happens inside that row, so the siblings do not know they moved.
					 * `LayoutGroup` re-renders the whole group once the exit finishes (`forceRender`) to establish that
					 * measurement. Expanding has its counterpart in `confirmingId` above. Both are needed so that
					 * opening
					 * and closing both flow.
					 */}
					<LayoutGroup>
						<ul className="divide-y border-y sm:border-t-0">
							<AnimatePresence initial={false}>
								{items.map((draft) => (
									<DraftLibraryRow key={draft.id}>
										<DraftRow
											draft={draft}
											confirming={confirmingId === draft.id}
											onToggleConfirm={() =>
												setConfirmingId((open) =>
													open === draft.id ? null : draft.id,
												)
											}
											onCloseConfirm={() => setConfirmingId(null)}
										/>
									</DraftLibraryRow>
								))}
							</AnimatePresence>
						</ul>
					</LayoutGroup>
				</m.div>
			)}
		</AnimatePresence>
	);
}

/**
 * The column widths. The header, rows, and placeholder all use this one constant. If written
 * separately in three places, one would change alone someday, and the symptom would not be an error
 * but a different column's value sitting under a header label. The analytics tab's metric table
 * uses the same device for the same reason (`METRIC_COLUMNS`). One grid serves both layouts. The
 * DOM order is single and the flow folds by itself. The point is not to keep separate markup for
 * narrow screens: two versions would eventually drop a link from one of them, and that difference
 * shows only at that width. The last column at `sm` is pinned to `2rem`, the width of the delete
 * trigger (`icon-sm`, 32px). On wide screens the column boundaries must match across rows. With
 * `auto`, the width would be recomputed from each row's content and the earlier columns would drift
 * apart. On narrow screens the second column is `auto` instead, because that cell stacks the status
 * word and the trigger, and the wider of the two should set the width.
 */
const DRAFT_COLUMNS =
	"grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_4rem_11rem_2rem] sm:gap-x-4 sm:gap-y-0";

/**
 * The column header is decorative. It is `aria-hidden` because each row's labels already reach
 * assistive technology. The `Updated` word in the modified column is `sr-only` from `sm` up (hidden, not
 * removed), and status words describe themselves. Exposing both would make screen readers read the
 * same words twice. Not drawn on narrow screens at all. There the columns fold into two, so the
 * header row has no place to sit and no reason to.
 */
function DraftListHeader() {
	const { t } = useTranslation(["create", "common"]);
	return (
		<div
			aria-hidden="true"
			className={`hidden border-b pb-2 text-xs font-medium text-muted-foreground sm:grid ${DRAFT_COLUMNS}`}
		>
			<span>{t("list.story")}</span>
			<span>{t("list.status")}</span>
			<span>{t("list.modified")}</span>
			{/* The delete trigger's column. It has no label because each row's action labels itself. */}
			<span />
		</div>
	);
}

function DraftRow({
	draft,
	confirming,
	onToggleConfirm,
	onCloseConfirm,
}: {
	draft: StoryDraft;
	/**
	 * Deletion takes two steps. Deleting a manuscript cannot be undone: the soft delete keeps the row,
	 * but the screen has no way to restore it. A single small icon in the list could also be hit by
	 * accident while scrolling. There is no separate modal. Confirmation stays **inside the row**, so
	 * the user keeps context and the draft being deleted stays visible throughout. The value lives in
	 * the list (`confirmingId`, above). It must sit there so that the rows below flow when the
	 * confirmation opens.
	 */
	confirming: boolean;
	onToggleConfirm: () => void;
	onCloseConfirm: () => void;
}) {
	const { t } = useTranslation(["create", "common"]);
	/**
	 * When the draft has been published, say beside the delete button that the server work remains.
	 * The copy is not written here but comes from a pure function, for the reason given in that file's
	 * header: it is a sentence in front of an irreversible action and must be checkable without
	 * rendering.
	 */
	const notice = draftDeleteNotice(draft.publishedStoryId);
	const title = draftTitleLabel(draft);

	return (
		<div className="py-2.5">
			<div className={`grid ${DRAFT_COLUMNS}`}>
				{/*
				 * The title is the link to the editor. There is no separate edit button at the end of the row,
				 * since
				 * the same destination would appear twice in one row. The whole row is not made clickable either:
				 * then
				 * text could not be selected, it would be unclear where the link is, and the normal link behavior
				 * (such as opening in a new tab) would be lost.
				 * The fallback text for an empty title comes from `@rowcat/authoring` (`draftDisplayTitle`).
				 * Writing
				 * `Untitled` here again would create that vocabulary in two places.
				 */}
				<Link
					to="/create/$draftId"
					params={{ draftId: draft.id }}
					className="min-w-0 truncate rounded-sm text-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
				>
					{title}
				</Link>

				{/*
				 * Publication status comes from **one** fact the draft knows (`publishedStoryId`). Values such as
				 * `Update available` or `Republish needed` are not derived, because there is
				 * no basis to judge them. Imitating them with timestamp comparisons would be wrong across devices,
				 * since clock differences and sync delays would skew the judgment.
				 * This is where the badge was removed. A bordered pill on every row would make status the most
				 * prominent thing in the list, but the eye should land on the title first. Nothing is hidden: the
				 * words stay, and the words, not color, state the status. The emphasized one of the two is `Published`
				 * because that state is rarer. Most drafts are unpublished, so emphasizing that too would emphasize
				 * nothing.
				 */}
				{draft.publishedStoryId ? (
					<span className="justify-self-end whitespace-nowrap text-xs font-medium text-foreground sm:justify-self-start">
						{t("list.published")}
					</span>
				) : (
					<span className="justify-self-end whitespace-nowrap text-xs text-muted-foreground sm:justify-self-start">
						{t("list.unpublished")}
					</span>
				)}

				{/*
				 * The modified time stays quiet. It is context for reading the row, not identity. The eye should
				 * land
				 * on the title, and this value matters only when checking which item was touched most recently.
				 * `Updated` is visible on narrow screens and becomes `sr-only` from `sm` (hidden, not removed). On wide
				 * screens the column header draws that word, but the row is `aria-hidden`, so the word does not
				 * exist
				 * for assistive technology. A date without its label does not say what it is a date of.
				 */}
				<span className="min-w-0 truncate text-xs tabular-nums text-muted-foreground">
					{formatDateTime(draft.updatedAt)}
					<span className="sm:sr-only"> {t("list.modifiedSuffix")}</span>
				</span>

				{/*
				 * **Always visible.** Hiding it behind hover would make drafts impossible to delete by finger, and
				 * it
				 * would make the row's only destructive action undiscoverable.
				 * It is not folded into a `⋯` menu with a single item. That would take two steps for the same thing
				 * (open the menu, pick the item, then confirm) and would gain only one hidden icon.
				 * The trigger carries its open/closed state (`aria-expanded`). If it disappeared during the
				 * confirmation, the last column would collapse, the earlier columns would jump, and keyboard users
				 * would lose the place to return to. So it lives **outside** the presence and stays in place while
				 * the
				 * confirmation exits.
				 */}
				<Button
					size="icon-sm"
					variant="ghost"
					aria-label={t("list.deleteDraft", { title })}
					aria-expanded={confirming}
					className="justify-self-end"
					onClick={onToggleConfirm}
				>
					<Trash2 aria-hidden="true" />
				</Button>
			</div>

			{/*
			 * The confirmation expands **below** the row. Squeezing `[Delete]`, `[Cancel]`, and the explanation into
			 * the fixed-width column would leave only two characters of the title on narrow screens. What the
			 * user
			 * must read here is what is being deleted (the row above) and what remains (the sentence below), so
			 * using the full row is right.
			 * It is not shown permanently either. If every published row carried the same sentence, the list
			 * would
			 * stop being read, and by the time the sentence was needed it would already be background.
			 * `role="alert"` then reads it once.
			 * **Height is not interpolated.** The row takes its final geometry immediately, and only the
			 * contents
			 * arrive, with opacity and a 4px move. `docs/motion/ARCHITECTURE.md` excludes `height: 0 → auto`
			 * from
			 * every position, because that value makes the surrounding layout recompute for the whole
			 * animation.
			 * The rows below flow alongside it through `m.li`'s `layout="position"`.
			 */}
			<AnimatePresence initial={false}>
				{confirming && (
					<DraftDeleteConfirm
						draftId={draft.id}
						notice={notice}
						onCancel={onCloseConfirm}
					/>
				)}
			</AnimatePresence>
		</div>
	);
}

/**
 * The expanded delete confirmation is a component for two reasons. First, `useExitGuard()` is a
 * hook (`lib/motion/exit-guard.ts`). This surface has two buttons and one is irreversible. While a
 * presence is attached, a confirmation already closed in product state stays on screen during its
 * exit, and `Delete` is still a real button during that time. In a background tab where frames are not
 * delivered, that window is unbounded rather than 120ms, so the protection attaches to **presence
 * state**, not to the animation target. `inert` is the counterpart: `pointer-events` blocks finger
 * and mouse but leaves tab order alone, and tabbing into an already-closed confirmation's `Delete` is
 * the same bug. Second, the failure's lifetime. The failure message mounts together with this
 * surface, so closing the confirmation also clears the last failure. No effect and no
 * `setFailure(null)` on each toggle are needed. If the value stayed on the row, the next time the
 * user opened the confirmation, an old failure would show up first, before they had done anything.
 * The rhythm is inherited from the row (`rowEnter` / `rowExit`), not from `feedback.ts`, for the
 * reason that file's header records: that rhythm targets a sentence with nothing to press. Once
 * buttons arrive, `rowExit` plus `useExitGuard()` is the answer. The gallery's filter token sits in
 * the same place.
 */
function DraftDeleteConfirm({
	draftId,
	notice,
	onCancel,
}: {
	draftId: string;
	notice: string | null;
	onCancel: () => void;
}) {
	const { t } = useTranslation(["create", "common"]);
	const { store } = useAuthoringScope();
	/**
	 * A delete failure **ends inside this row**. It is not a toast, because the row has a place for
	 * it: after a failure the confirmation stays expanded, with the draft's title right above and the
	 * retry button still there. With twenty rows in the list, a message in a corner would lose track
	 * of **which draft** it was about.
	 */
	const [failure, setFailure] = useState<string | null>(null);
	const exiting = useExitGuard();

	const onDelete = async () => {
		if (!store) return;
		setFailure(null);
		try {
			await store.deleteDraft(draftId);
		} catch (error) {
			// Logs the raw Dexie error. It is not shown to the user, because it says nothing they can act
			// on.
			console.error("[create] couldn't delete the draft", error);
			setFailure(draftDeleteFailureMessage());
		}
	};

	return (
		<m.div
			initial={rowEnter.initial}
			animate={rowEnter.animate}
			exit={rowExit}
			transition={rowEnter.transition}
			style={exiting}
			inert={exiting !== undefined}
			className="mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-2"
		>
			{/*
			 * The failure **replaces** the guidance. Showing both would have the irreversible-action warning
			 * and
			 * the new failure fight for one line, and on narrow screens they would push the buttons down. What
			 * the
			 * user needs to read now is the failure.
			 * **The swap is immediate.** Adding another presence would either overlap the two sentences in the
			 * same
			 * flex slot (briefly empty) or shift the buttons left and right in between. What must be read here
			 * is
			 * the failure that just arrived. `role="alert"` reads it at that moment, so the animation has no
			 * reason
			 * to delay it.
			 */}
			{failure ? (
				<p role="alert" className="min-w-0 flex-1 text-xs text-destructive">
					{failure}
				</p>
			) : (
				notice && (
					<p
						role="alert"
						className="min-w-0 flex-1 text-xs text-muted-foreground"
					>
						{notice}
					</p>
				)
			)}
			<div className="flex shrink-0 items-center gap-1">
				<Button
					size="sm"
					variant="destructive"
					onClick={() => {
						void onDelete();
					}}
				>
					{t("common:actions.delete")}
				</Button>
				<Button size="sm" variant="ghost" onClick={onCancel}>
					{t("common:actions.cancel")}
				</Button>
			</div>
		</m.div>
	);
}

/**
 * The motion shell for one row. It is a component for the same reason as `LibraryRow` in the chat
 * list. `useExitGuard()` is a hook and cannot be called inside `map`. The hook blocks presses on a
 * row that is exiting (`lib/motion/exit-guard.ts`). The two lists deliberately do **not** share
 * this shell. What they share is the rhythm (`list-motion.ts`), not the component.
 */
function DraftLibraryRow({ children }: { children: ReactNode }) {
	return (
		<m.li
			layout="position"
			initial={rowEnter.initial}
			animate={rowEnter.animate}
			exit={rowExit}
			transition={rowEnter.transition}
			style={useExitGuard()}
		>
			{children}
		</m.li>
	);
}

/**
 * The placeholder for the drafts list, with the **same geometry** as the rows that arrive. This
 * function lives here rather than in `create-skeleton.tsx`, as with the analytics metric table: the
 * geometry is decided here. Drawing it elsewhere would leave that file in the old shape the day the
 * real list changed, and the mismatch would only appear as the whole screen re-laying out when
 * values arrive. That is exactly what happened when a three-card placeholder turned into a row
 * list.
 */
export function DraftListSkeleton() {
	return (
		<div aria-hidden="true">
			<DraftListHeader />
			<ul className="divide-y border-y sm:border-t-0">
				{[0, 1, 2].map((row) => (
					<li key={row}>
						<div className="py-2.5">
							<div className={`grid ${DRAFT_COLUMNS}`}>
								<Skeleton className="h-5 w-48" />
								<Skeleton className="h-4 w-10 justify-self-end sm:justify-self-start" />
								<Skeleton className="h-4 w-32" />
								<Skeleton className="size-8 justify-self-end rounded-md" />
							</div>
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}
