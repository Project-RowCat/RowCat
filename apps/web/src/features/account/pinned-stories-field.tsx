import {
	PINNED_STORY_ERROR_CODE,
	PROFILE_PINNED_STORY_LIMIT,
} from "@rowcat/contracts";
import {
	type CreatorWork,
	canInteract,
	isPinnableWork,
	movePinnedItem,
	pinItem,
	samePinnedOrder,
	unpinItem,
	type Viewer,
} from "@rowcat/domain";
import {
	creatorWorks,
	creatorWorksInfiniteQueryOptions,
	ownPinnedStoriesQueryOptions,
	pinnedStoriesMutationOptions,
} from "@rowcat/query";
import { isRowCatApiError } from "@rowcat/sdk";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { pinnedWorkNoticeLabel } from "#/lib/i18n/vocab.ts";
import { feedbackEnter, feedbackExit } from "#/lib/motion/feedback.ts";
import { accountErrorMessage } from "./account-error.ts";
import { restrictionNote } from "./restriction-note.ts";
import { SaveLabel } from "./save-label.tsx";

/**
 * Featured works: up to three works pinned to the top of the public profile.
 *
 * Editing happens only here. The public profile screen does not carry a pin button, following its
 * own rule: if "what others see now" and "what I am editing now" share one screen, someone pinning
 * from it cannot tell whether they are viewing as others or editing. This field sits in the same
 * place and rhythm as the name, bio and photo fields (choose, then save).
 *
 * Line actions on the `Published` tab are not used for the same reason. That tab is for reading,
 * moving and changing visibility (see `Create` in the root AGENTS.md), while a featured work is part
 * of the profile's content, not part of the work's state.
 *
 * ## Save button
 *
 * Changes are not saved on every move. Swapping two entries takes two arrow presses, and an
 * intermediate state reaching others' screens, even briefly, would be an order nobody chose. The
 * list is therefore screen state, and the only request sent is the final list (the contract has no
 * separate add, remove or move).
 *
 * ## Pins that are not visible now
 *
 * Pins on works made private are not deleted (`profile-pins.ts` in `@rowcat/domain`). This field
 * does not hide those rows; it states why they are not on the profile, since hiding them would
 * leave the user unable to tell why a slot is occupied.
 */
export function PinnedStoriesField({ viewer }: { viewer: Viewer }) {
	const { t } = useTranslation(["account", "common"]);
	const client = getRowCatClient();
	const queryClient = useQueryClient();
	const headingId = useId();
	const errorId = `${headingId}-error`;

	const own = useQuery(ownPinnedStoriesQueryOptions(client));
	const saved = own.data ?? NONE;

	/**
	 * The list being edited. `null` draws the server value (same shape as the bio field). Effects do
	 * not push the server value in for the same reason: when a refetch completes, the order being
	 * picked would be overwritten.
	 */
	const [draft, setDraft] = useState<readonly CreatorWork[] | null>(null);
	const value = draft ?? saved;
	const [result, setResult] = useState<
		{ kind: "saved" } | { kind: "error"; message: string } | null
	>(null);
	const [picking, setPicking] = useState(false);

	const policy = pinnedStoriesMutationOptions(client, queryClient, viewer.id);
	const mutation = useMutation({
		...policy,
		onError: (...args) => {
			policy.onError?.(...args);
			const [error] = args;
			/**
			 * A work that cannot be pinned was mixed in: another device made it private or archived it.
			 * Reload the list to show the current state. The order being picked is **kept**, so the user can
			 * remove just the offending row and save again.
			 */
			if (
				isRowCatApiError(error) &&
				error.code === PINNED_STORY_ERROR_CODE.unavailable
			) {
				void own.refetch();
				setResult({
					kind: "error",
					message: t("pinnedStoriesField.someStoriesCanTBe"),
				});
				return;
			}
			setResult({ kind: "error", message: accountErrorMessage(error) });
		},
		onSuccess: (...args) => {
			policy.onSuccess?.(...args);
			setDraft(null);
			setResult({ kind: "saved" });
		},
	});

	const editable = canInteract(viewer) && own.isSuccess;
	const pending = mutation.isPending;
	const unchanged = samePinnedOrder(value, saved);
	const full = value.length >= PROFILE_PINNED_STORY_LIMIT;

	/**
	 * The `Saved` indicator claims the current order is saved, so it becomes false the moment the list
	 * changes (same rule as the name field). The same array coming back (at the cap or the end arrows)
	 * means nothing changed.
	 */
	const edit = (next: readonly CreatorWork[]) => {
		if (next === value) return;
		setDraft(next);
		setResult((current) => (current?.kind === "saved" ? null : current));
	};

	const error = result?.kind === "error" ? result.message : null;

	return (
		<section aria-labelledby={headingId} className="flex flex-col gap-2">
			<div className="flex flex-col gap-0.5">
				<h3 id={headingId} className="text-sm font-medium">
					{t("pinnedStoriesField.featuredStories")}
				</h3>
				<p className="text-sm text-muted-foreground">
					{t("pinnedStoriesField.limitNote", {
						limit: PROFILE_PINNED_STORY_LIMIT,
					})}
				</p>
			</div>

			{own.isPending ? (
				<Skeleton className="h-16 w-full" />
			) : own.isError && own.data === undefined ? (
				/*
				 * A query failure is not drawn as an empty list: "no pinned works" would read as the pins
				 * having been deleted, and saving from that state would really delete them (same judgement as
				 * the bio field). Editing therefore stays closed on this branch.
				 */
				<div className="flex flex-wrap items-center gap-2 text-sm">
					<p role="alert" className="text-destructive">
						{t("pinnedStoriesField.couldnTLoadFeaturedStories")}
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void own.refetch()}
					>
						{t("pinnedStoriesField.tryAgain")}
					</Button>
				</div>
			) : value.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t("pinnedStoriesField.noPinnedStories")}
				</p>
			) : (
				<ol className="flex flex-col divide-y rounded-lg border">
					{value.map((work, index) => (
						<PinnedRow
							key={work.id}
							work={work}
							first={index === 0}
							last={index === value.length - 1}
							disabled={!editable || pending}
							onMove={(offset) => edit(movePinnedItem(value, work.id, offset))}
							onRemove={() => edit(unpinItem(value, work.id))}
						/>
					))}
				</ol>
			)}

			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					variant="outline"
					/*
					 * Lock at the cap. Opening a dialog where nothing can be picked is worse than letting the
					 * count beside the button say why it cannot be opened.
					 */
					disabled={!editable || pending || full}
					onClick={() => setPicking(true)}
				>
					<Plus aria-hidden="true" />
					{t("pinnedStoriesField.addStory")}
				</Button>
				<Button
					type="button"
					disabled={!editable || pending || unchanged}
					onClick={() => {
						setResult(null);
						mutation.mutate(value.map((work) => work.id));
					}}
					aria-describedby={error ? errorId : undefined}
					className="sm:w-24"
				>
					<SaveLabel
						state={
							pending ? "pending" : result?.kind === "saved" ? "saved" : "idle"
						}
					/>
				</Button>
				<span className="text-xs tabular-nums text-muted-foreground">
					{value.length} / {PROFILE_PINNED_STORY_LIMIT}
				</span>
			</div>

			<AnimatePresence initial={false} mode="wait">
				{error ? (
					<m.p
						key={`save:${error}`}
						id={errorId}
						role="alert"
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						exit={feedbackExit}
						transition={feedbackEnter.transition}
						className="text-sm text-destructive"
					>
						{error}
					</m.p>
				) : !canInteract(viewer) ? (
					<m.p
						key="restricted"
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						exit={feedbackExit}
						transition={feedbackEnter.transition}
						className="text-sm text-muted-foreground"
					>
						{restrictionNote(viewer.status, "pinned")}
					</m.p>
				) : null}
			</AnimatePresence>

			{picking && (
				<PinPickerDialog
					chosen={value}
					onClose={() => setPicking(false)}
					onPick={(work) => {
						edit(pinItem(value, work, PROFILE_PINNED_STORY_LIMIT));
						setPicking(false);
					}}
				/>
			)}
		</section>
	);
}

/** Empty list used until the server value arrives. A new array per render would make every comparison report a change. */
const NONE: readonly CreatorWork[] = [];

/**
 * One featured row: title, the reason it is hidden (when it is), and three actions.
 *
 * Actions get names. Three icon-only buttons per row would read as "up, down, remove" repeatedly to
 * a screen reader without saying which work each belongs to, so the title goes into each name. The
 * end arrows are locked, not hidden: hiding them changes the button count per row and breaks the
 * position the hand remembers.
 */
function PinnedRow({
	work,
	first,
	last,
	disabled,
	onMove,
	onRemove,
}: {
	work: CreatorWork;
	first: boolean;
	last: boolean;
	disabled: boolean;
	onMove: (offset: -1 | 1) => void;
	onRemove: () => void;
}) {
	const { t } = useTranslation(["account", "common"]);
	const title = work.title.trim() || t("pinnedStoriesField.untitled");
	const notice = pinnedWorkNoticeLabel(work);
	return (
		<li className="flex items-center gap-3 px-3 py-2">
			<div className="min-w-0 flex-1">
				<p className="text-sm font-medium break-words">{title}</p>
				{notice && <p className="text-xs text-muted-foreground">{notice}</p>}
			</div>
			<div className="flex shrink-0 items-center gap-1">
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					disabled={disabled || first}
					onClick={() => onMove(-1)}
					aria-label={t("pinnedStoriesField.moveEarlier", { title })}
				>
					<ArrowUp aria-hidden="true" />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					disabled={disabled || last}
					onClick={() => onMove(1)}
					aria-label={t("pinnedStoriesField.moveLater", { title })}
				>
					<ArrowDown aria-hidden="true" />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					disabled={disabled}
					onClick={onRemove}
					aria-label={t("pinnedStoriesField.unpin", { title })}
				>
					<X aria-hidden="true" />
				</Button>
			</div>
		</li>
	);
}

/**
 * Works to pick: only those **that appear on the public profile now**, minus ones already chosen.
 *
 * The candidates come from the `Published` list (`/me/stories`). The public profile grid is not used
 * because of the adult display setting: for an adult-verified member who has display turned off,
 * that grid omits their adult works, so those works could never be picked. Whether a work is
 * pinnable is decided by `isPinnableWork` alone, and the server re-checks with the same two lines.
 *
 * Loaded only while this dialog is mounted. The list appends with `Show more`, since a creator with many
 * works may have no candidates on the first page (if they are all private).
 */
function PinPickerDialog({
	chosen,
	onClose,
	onPick,
}: {
	chosen: readonly CreatorWork[];
	onClose: () => void;
	onPick: (work: CreatorWork) => void;
}) {
	const { t } = useTranslation(["account", "common"]);
	const client = getRowCatClient();
	const works = useInfiniteQuery(creatorWorksInfiniteQueryOptions(client));
	const candidates = useMemo(() => {
		const taken = new Set(chosen.map((work) => work.id));
		return works.data
			? creatorWorks(works.data).filter(
					(work) => isPinnableWork(work) && !taken.has(work.id),
				)
			: [];
	}, [works.data, chosen]);

	return (
		<Dialog
			open
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogContent className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-md`}>
				<DialogHeader>
					<DialogTitle>{t("pinnedStoriesField.addFeaturedStory")}</DialogTitle>
					<DialogDescription>
						{t("pinnedStoriesField.onlyStoriesVisibleOnYour")}
					</DialogDescription>
				</DialogHeader>

				<div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
					{works.isPending ? (
						<Skeleton className="h-24 w-full" />
					) : works.isError && works.data === undefined ? (
						<div className="flex flex-wrap items-center gap-2 text-sm">
							<p role="alert" className="text-destructive">
								{t("pinnedStoriesField.couldnTLoadTheStory")}
							</p>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => void works.refetch()}
							>
								{t("pinnedStoriesField.tryAgain")}
							</Button>
						</div>
					) : candidates.length === 0 && !works.hasNextPage ? (
						<p className="text-sm text-muted-foreground">
							{t("pinnedStoriesField.noMorePublicStoriesTo")}
						</p>
					) : (
						<ul className="flex flex-col divide-y rounded-lg border">
							{candidates.map((work) => (
								<li key={work.id}>
									<button
										type="button"
										onClick={() => onPick(work)}
										className="flex w-full items-center px-3 py-2 text-left text-sm break-words hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
									>
										{work.title.trim() || t("pinnedStoriesField.untitled")}
									</button>
								</li>
							))}
						</ul>
					)}
				</div>

				<DialogFooter>
					{works.hasNextPage && (
						<Button
							type="button"
							variant="outline"
							disabled={works.isFetchingNextPage}
							onClick={() => void works.fetchNextPage()}
						>
							{t("pinnedStoriesField.showMore")}
						</Button>
					)}
					<Button type="button" variant="ghost" onClick={onClose}>
						{t("pinnedStoriesField.close")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
