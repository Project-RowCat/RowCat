import {
	type ChatRoom,
	DEFAULT_ROOM_SORT,
	ROOM_SORTS,
	type RoomSort,
	roomLibraryView,
} from "@rowcat/chat";
import { Button, buttonVariants } from "@rowcat/ui-web/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@rowcat/ui-web/components/empty";
import { Input } from "@rowcat/ui-web/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@rowcat/ui-web/components/select";
import { Link } from "@tanstack/react-router";
import { MessagesSquare, Search, SearchX, X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RoomActionsMenu } from "#/features/chat/room/actions-menu.tsx";
import { useRoomManagement } from "#/features/chat/room/management.tsx";
import { RuntimeLibraryRow } from "#/features/conversation-library/runtime-conversation-rows.tsx";
import { useConversationLibrary } from "#/features/conversation-library/use-conversation-library.ts";
import { useRuntimeConversationRemoval } from "#/features/conversation-library/use-runtime-conversation-removal.ts";
import { formatDateTime } from "#/lib/format/date-time.ts";
import { relativeTime } from "#/lib/format/relative-time.ts";
import { formatNumber } from "#/lib/i18n/format.ts";
import { useChatScope } from "#/lib/local-chat/scope.ts";
import { useExitGuard } from "#/lib/motion/exit-guard.ts";
import { rowEnter, rowExit } from "#/lib/motion/list-motion.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { ChatLibraryShell } from "./chat-library-shell.tsx";
import { ChatLibrarySkeleton } from "./chat-library-skeleton.tsx";
import { roomSortLabel } from "./room-library-copy.ts";
import { roomRevealKey } from "./room-reveal.ts";
import {
	ROOM_LIST_CLASS,
	ROOM_ROW_CLASS,
	ROOM_ROW_MENU_CLASS,
	ROOM_ROW_TIME_CLASS,
} from "./room-row-layout.ts";
import { useRoomReveal } from "./use-room-reveal.ts";

/**
 * Conversation library: every conversation on this device, for this account.
 *
 * It does **not** overlap with the sidebar's recent conversations:
 *
 * ```text
 * sidebar recent   quick switching (last 10 + the open room). Not for management.
 * this screen      finding and managing. Search, sort, rename, delete.
 * ```
 *
 * While this screen is open, the sidebar's recent list stays put. The same room appearing in two
 * places looks like duplication but is not: the left side is the way **back** to what you were
 * doing, while this screen is where you **search** everything. If opening the list hid the resume
 * shortcut, the conversation you were just in would disappear the moment you entered this screen.
 *
 * There are no server queries. There is no room-list endpoint, none will be added, and nothing goes
 * into the query cache. The source of truth for local records is one IndexedDB. So **this file does
 * not change when sync is added**: sync writes to the same database, and `liveQuery` listens to
 * those changes.
 *
 * **Message content is not drawn.** Message bodies say far more than titles on a screen seen over
 * someone's shoulder, and drawing previews would need one message query per row (N+1). Searching
 * only titles, and not counting messages, follows the same decision.
 *
 * **Search, sort and reveal rules are not in this file.** `roomLibraryView` in `@rowcat/chat` owns
 * them, and the same screen on mobile calls **the same function**. If the rules were written per
 * app, the same rooms would be drawn in a different order on the two screens, and that difference
 * only shows when they are compared side by side. What remains here is the copy
 * (`room-library-copy.ts`) and the markup.
 *
 * ## Two kinds of rows — one library
 *
 * Runtime playthrough rows sit in the **same list** as conversation rooms, ordered by activity
 * (`useConversationLibrary` → the merge rule in `@rowcat/domain`). Search scans and counts both
 * kinds of titles together, and `Show more` runs over the merged list. If rooms were cut first and
 * runtime rows appended after, runtime rows would always land at the bottom, which is not activity
 * order. The only action on a runtime row is `Remove from list`, and it does not go
 * through the room management hook.
 *
 * ## Rows, not cards
 *
 * For a while each room was a bordered card. The values were correct then (title, activity time,
 * menu), but the question this screen must answer ("which conversation am I looking for?") required
 * reading the cards one by one. That gave someone looking for something an arrangement that cannot
 * be compared. A border per card separates the rows from each other, which for an eye scanning
 * vertically is a hindrance, not a help. On an account with 500 rooms that cost is paid 500 times.
 *
 * So this uses the **same conventions** as the workspace's draft list and performance table
 * (`create/draft-list.tsx`): a single line between rows, a fixed-width activity-time column, and a
 * manage trigger that always sits in the same place.
 *
 * ```text
 * Conversations
 *
 * [ Search by conversation name........ ] [ Recent activity ]
 * 24 conversations
 * ──────────────────────────────────────────────────
 * Library at night                    3 min ago    ⋯
 * After-work isekai                   2 hours ago  ⋯
 * Magic school                        yesterday    ⋯
 * ```
 */
export function ChatLibraryPage() {
	const { t } = useTranslation("chatLibrary");
	const { status, store } = useChatScope();
	const { entries, loading } = useConversationLibrary();
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<RoomSort>(DEFAULT_ROOM_SORT);
	const management = useRoomManagement();
	/** The only action on a runtime row. This screen has no playthrough in progress to leave, so there is no departure to guard. */
	const runtimeRemoval = useRuntimeConversationRemoval();

	/**
	 * The revealed window. The rule is in `room-reveal.ts`; its lifetime belongs to
	 * `use-room-reveal.ts`.
	 *
	 * They are separate because of the account axis. The owner of the window is **the store instance
	 * plus the query condition**. Putting that rule inside this component would leave only "change the
	 * account by hand" to verify it (web tests in this repository do not render React).
	 *
	 * There is only **one** live window. If the query or sort changes, that window ends there.
	 * Returning to an old condition means opening that list again; it is not a return to the window
	 * you left. The fact that there is no `condition → revealed count` table is this screen's rule.
	 */
	const { visibleCount, showMore } = useRoomReveal(
		store,
		roomRevealKey(query, sort),
	);

	const view = roomLibraryView({ rooms: entries, query, sort, visibleCount });

	/**
	 * The scope is still opening, which is **different from zero rows**. Merging the two would make
	 * someone with many conversations see "No conversations yet" for a frame every time they open the screen.
	 * This is the same placeholder the route drew, so the screen does not change when it hands over
	 * from server rendering.
	 */
	if (loading && status !== "unavailable")
		return (
			<ChatLibraryShell>
				<ChatLibrarySkeleton />
			</ChatLibraryShell>
		);

	return (
		<ChatLibraryShell>
			<PageEnter>
				{/*
				 * One title. There used to be a path next to it to the persona library, which was wiring from
				 * when this list was a section inside the `Conversations` group. Personas are now a global settings
				 * category (`/settings/personas`), and this screen focuses on the conversation list itself.
				 *
				 * Do not put a `/settings/personas` button in the same spot: that would only change the
				 * address, and the list that moved to global settings would still read like an appendix of
				 * the conversation list. The path to global settings is the gear in the header; the path tied
				 * to this conversation is the room settings' `Manage personas`, which keeps it.
				 */}
				<h1 className="mb-5 text-2xl font-black tracking-tight sm:text-3xl">
					{t("title")}
				</h1>

				{/*
				 * Three-way switch: unavailable / not yet / list.
				 *
				 * Deleting the last conversation turns the list into the empty state, and at that moment half
				 * the screen changes wholesale. Bridge it with the incoming side's opacity alone.
				 *
				 * **The outgoing side gets no `exit`.** If it had one, `mode="wait"` would be needed (when the
				 * two overlap, the leaving one holds its place and new content is pushed down), and from then
				 * on the empty state's entrance would wait for the list's exit to finish. Deletion has already
				 * completed; here motion would start deciding when that result is displayed, so it is cut
				 * here (the same rule as the discovery screen).
				 *
				 * `initial={false}` protects the first render: the branch drawn first is already its final
				 * value, and that screen's entrance is already owned by the outer `PageEnter`.
				 */}
				<AnimatePresence initial={false}>
					{status === "unavailable" ? (
						<m.div
							key="unavailable"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							transition={rowEnter.transition}
						>
							<Empty className="border">
								<EmptyHeader>
									<EmptyMedia variant="icon">
										<MessagesSquare />
									</EmptyMedia>
									<EmptyTitle>{t("unavailableTitle")}</EmptyTitle>
									<EmptyDescription>{t("unavailableBody")}</EmptyDescription>
								</EmptyHeader>
								<EmptyContent>
									<Link
										to="/login"
										search={{ redirect: "/chats" }}
										className={buttonVariants({
											variant: "default",
											size: "sm",
										})}
									>
										{t("signIn")}
									</Link>
								</EmptyContent>
							</Empty>
						</m.div>
					) : view.total === 0 ? (
						<m.div
							key="empty"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							transition={rowEnter.transition}
						>
							<FirstTimeEmpty />
						</m.div>
					) : (
						<m.div
							key="list"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							transition={rowEnter.transition}
						>
							<LibraryToolbar
								query={query}
								onQuery={setQuery}
								sort={sort}
								onSort={setSort}
								matched={view.matched}
							/>

							{view.emptyBySearch ? (
								<Empty className="border">
									<EmptyHeader>
										{/*
										 * Same typography as the sibling empty states. Only this branch lacked
										 * an icon, so a zero-result search read as less important than the other
										 * empty states (the gallery's zero-filter-results use the same picture).
										 */}
										<EmptyMedia variant="icon">
											<SearchX />
										</EmptyMedia>
										<EmptyTitle>{t("noResultsTitle")}</EmptyTitle>
										<EmptyDescription>{t("noResultsBody")}</EmptyDescription>
									</EmptyHeader>
									<EmptyContent>
										<Button
											variant="outline"
											size="sm"
											onClick={() => setQuery("")}
										>
											{t("clearSearch")}
										</Button>
									</EmptyContent>
								</Empty>
							) : (
								<>
									{/*
									 * Rows in this list **have identity**. Whether you filter by search, change
									 * the sort, or delete one, what remains is the same rooms. If the screen
									 * does not say so, the person sees the whole list as changed and must
									 * re-read it to find which row disappeared and whether the room they were
									 * looking for survived.
									 *
									 * `layout="position"` is the point. A row's size does not change, only its
									 * position does. Interpolating size too would stretch and shrink the
									 * borders and text, a distortion with nothing to explain it.
									 *
									 * **`mode="popLayout"` is not used.** It was on for a while, with the
									 * reasoning "keep the removed row from holding its place", but that
									 * setting **never actually ran on this list**. popLayout clones the exiting
									 * child with `cloneElement(child, { ref })` to measure its DOM element
									 * (`framer-motion/.../PopChild.mjs`). This row is a plain function
									 * component (`LibraryRow`) that does not accept `ref`, so that ref stays
									 * `null` and `PopChild` returns at `!ref.current`. In React 19 `ref` is an
									 * ordinary prop, so **no warning is raised either.**
									 *
									 * So removal and the filling of the gap happened, and still happen,
									 * **in sequence** (opacity 120ms, then movement 180ms). That rhythm was
									 * accepted, and no ref wiring is placed on the rows just for it: keeping a
									 * setting that does nothing reads worse (the next person would take it as
									 * "already on"). The procedure for that judgment is in the "when touching
									 * a list" section of `docs/motion/ARCHITECTURE.md`.
									 *
									 * `layoutDependency` is not set. This list's cap is 50 rows
									 * (`ROOM_LIBRARY_PAGE_SIZE`), and what moves rows is not only search and
									 * sort: renaming a room moves it under both `Recent activity` and `Name`.
									 * Narrowing the dependency to save measurement would make that movement
									 * silently disappear.
									 */}
									<ul className={ROOM_LIST_CLASS}>
										<AnimatePresence initial={false}>
											{view.visible.map((entry) => (
												<LibraryRow key={entry.id}>
													{entry.kind === "chat" ? (
														<RoomRow
															room={entry.room}
															management={management}
														/>
													) : (
														<RuntimeLibraryRow
															conversation={entry.conversation}
															onRemove={runtimeRemoval.remove}
														/>
													)}
												</LibraryRow>
											))}
										</AnimatePresence>
									</ul>

									{/*
									 * Remaining rows open in the same size. Infinite scroll is not used because
									 * this screen is for **finding**, not browsing. If the list grew each time
									 * the bottom was reached, you could never confirm that nothing is below.
									 */}
									{view.hasMore && (
										<div className="pt-3">
											<Button
												variant="outline"
												className="w-full"
												onClick={showMore}
											>
												{t("showMore")}
											</Button>
										</div>
									)}
								</>
							)}
						</m.div>
					)}
				</AnimatePresence>
			</PageEnter>

			{/*
			 * Only **one** dialog is open at a time. Attaching one to each row would mount 500 dialogs in a
			 * 500-room list (`room-management.tsx`).
			 */}
			{management.dialogs}
		</ChatLibraryShell>
	);
}

/**
 * The screen for someone with no conversations at all.
 *
 * There is no `+ New conversation` button. A room is created from a work, carrying its playback snapshot, so
 * there is no such thing as an empty room, and putting that button here would change the product
 * rule for conversations. So it points only at the one thing that can actually be done: finding a
 * work.
 */
function FirstTimeEmpty() {
	const { t } = useTranslation("chatLibrary");
	return (
		<Empty className="border">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<MessagesSquare />
				</EmptyMedia>
				<EmptyTitle>{t("emptyTitle")}</EmptyTitle>
				<EmptyDescription>{t("emptyBody")}</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Link
					to="/"
					search={{}}
					className={buttonVariants({ variant: "default", size: "sm" })}
				>
					{t("discover")}
				</Link>
			</EmptyContent>
		</Empty>
	);
}

/**
 * Search and sort.
 *
 * **Not stored in the URL.** The gallery's search text is public discovery state, so it belongs in
 * the address (sharing, back and refresh all give the same result). What is searched here is this
 * person's conversation titles. Putting that string in the query string would leave it in browser
 * history and in address-bar autocomplete, and for someone with browser sync on it would travel to
 * other devices. It is not a state worth restoring: returning to the list means searching again
 * from the start. Sort is not in the address for the same reason, and it is not stored on the
 * device either (creating a place to store it would open one more product-preference architecture).
 *
 * No debounce. The gallery's 300ms existed to slow **navigation** (routing on every character would
 * stack twenty history entries). Here the array is already in memory and is only filtered, so there
 * is no reason to delay.
 *
 * Not wrapped in a box. The canvas is already the container; if this row had its own border, the
 * screen would have two boxes (toolbar and list) and the list would read as an appendix.
 */
function LibraryToolbar({
	query,
	onQuery,
	sort,
	onSort,
	matched,
}: {
	query: string;
	onQuery: (query: string) => void;
	sort: RoomSort;
	onSort: (sort: RoomSort) => void;
	matched: number;
}) {
	const { t } = useTranslation("chatLibrary");
	const inputRef = useRef<HTMLInputElement>(null);
	const sortOptions = ROOM_SORTS.map((value) => ({
		value,
		label: roomSortLabel(value),
	}));

	return (
		// The rhythm matches the discovery screen's toolbar: 12px between the query axis and the total,
		// then 16px down to the list. When the same relationship (controls → current count → results) is
		// drawn at different densities on two list screens, someone moving between them via the sidebar
		// reads one of them as the more cramped screen.
		<div className="mb-4 flex flex-col gap-3">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
				<div className="relative min-w-0 flex-1">
					<Search
						className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
						aria-hidden="true"
					/>
					<Input
						ref={inputRef}
						type="search"
						value={query}
						onChange={(event) => onQuery(event.target.value)}
						aria-label={t("searchLabel")}
						// States exactly what is searched, so nobody assumes message bodies are included.
						placeholder={t("searchPlaceholder")}
						className="h-10 pr-10 pl-9 sm:h-9"
					/>
					{query && (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label={t("clearSearch")}
							className="absolute inset-y-0 right-1 my-auto text-muted-foreground"
							onClick={() => {
								onQuery("");
								inputRef.current?.focus();
							}}
						>
							<X aria-hidden="true" />
						</Button>
					)}
				</div>

				<Select
					value={sort}
					onValueChange={(next) =>
						next !== null && next !== sort && onSort(next as RoomSort)
					}
					items={sortOptions}
				>
					<SelectTrigger
						aria-label={t("sortLabel")}
						className="h-10 w-full shrink-0 sm:h-9 sm:w-40"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{sortOptions.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{/*
			 * The count this search matches, **not the number of rows drawn.** If 240 matched and 50 are
			 * revealed, writing `50 conversations` makes it look as if the count grows each time `Show more` is pressed
			 * (the per-work performance table made the same call).
			 *
			 * A quiet single line. This value is context for the current query, not a metric; a badge or card
			 * would make the number the first thing read on the screen.
			 */}
			<p
				aria-live="polite"
				className="text-xs tabular-nums text-muted-foreground"
			>
				{t("count", { count: matched, formatted: formatNumber(matched) })}
			</p>
		</div>
	);
}

/**
 * One row's **motion shell**.
 *
 * Extracted as a component because of one hook. A `m.li` expanded inline inside `map` cannot call
 * `useExitGuard()`, and that hook blocks presses on the exiting row. Placed on the animation
 * target, that protection would vanish entirely in a tab that receives no frames (`exit-guard.ts`).
 *
 * It only receives content. If this shell began to know about rooms, the draft list would have to
 * duplicate the same thing, and both would then share one set of product rules under the single
 * word "list row".
 *
 * `relative` is here because the row's manage trigger floats over the link (below).
 */
function LibraryRow({ children }: { children: ReactNode }) {
	return (
		<m.li
			layout="position"
			initial={rowEnter.initial}
			animate={rowEnter.animate}
			exit={rowExit}
			transition={rowEnter.transition}
			style={useExitGuard()}
			className="relative"
		>
			{children}
		</m.li>
	);
}

/**
 * One row of the list.
 *
 * The opening target (link) and the managing target (menu) are **siblings**. Putting the menu
 * inside the link would make a nested control, so keyboard movement and screen readers would not
 * know what gets pressed (it is invalid markup, which the browser repairs, causing a hydration
 * mismatch). Conversely, making the whole row a `div onClick` would remove the new-tab,
 * copy-address and status-bar destinations. A static scan enforces this rule
 * (`features/chat/room/row-markup.test.ts`).
 *
 * So the link covers the whole row and the menu floats above it. The hover background then lands
 * exactly on one row (a row that reacts only partially does not say where to press), while the two
 * controls remain siblings. The sidebar's recent-conversation row has the same shape for the same
 * reason.
 *
 * The trigger is not hidden behind hover. The sidebar does that because its 240px column must stay
 * quiet; this is the **screen for managing**, and an operation that is hidden away is effectively
 * absent.
 *
 * ## The row draws only three things
 *
 * Title, activity time, and management. There is no last-message preview: the reason is privacy
 * (what is visible over a shoulder becomes the conversation, not the title), and cost (a message
 * query per row, N+1). There are no cover thumbnails or creator avatars either. The room record
 * does not carry those values, so they would have to be fetched **from the server**, which would
 * make this screen network-dependent, and a conversation whose original work has since been made
 * private would show a broken picture. A room holds its snapshot from the moment it was acquired
 * and must be self-complete.
 */
function RoomRow({
	room,
	management,
}: {
	room: ChatRoom;
	management: ReturnType<typeof useRoomManagement>;
}) {
	return (
		<>
			<Link
				to="/chat/$roomId"
				params={{ roomId: room.id }}
				/*
				 * The focus ring sits **inside**. On a row with no corners, a ring drawn outward gets clipped
				 * by the adjacent sibling rows and the divider, leaving only three sides (the notification list
				 * made the same call).
				 */
				className={`${ROOM_ROW_CLASS} outline-none transition-colors hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset`}
			>
				{/*
				 * Single-line truncation. If an 80-character title took two lines, the list's rhythm would depend
				 * on one title, and the full title is given by `title`. **The stored value is not touched**:
				 * truncation is CSS's job, and the value goes unchanged to the rename dialog and to sync.
				 *
				 * A renamed room's name is its identity. Reverting it to `seed.title` (the work's title) would make
				 * only the list lose the name the person gave.
				 */}
				<span className="truncate text-sm font-medium" title={room.title}>
					{room.title}
				</span>
				{/*
				 * Activity time. Not labelled `Last message`: this value also moves on renames and
				 * on remote changes applied by sync, so that label would become false the moment one happened.
				 *
				 * `<time>` carries the machine-readable value alongside. The absolute human-readable time comes from
				 * a formatter pinned to the product timezone (`format/date-time.ts`). Drawing it in the device's
				 * timezone would make the same conversation's time differ by a day between web and app.
				 */}
				<time
					dateTime={room.updatedAt}
					title={formatDateTime(room.updatedAt)}
					className={ROOM_ROW_TIME_CLASS}
				>
					{relativeTime(room.updatedAt)}
				</time>
			</Link>

			<RoomActionsMenu
				room={room}
				management={management}
				className={ROOM_ROW_MENU_CLASS}
			/>
		</>
	);
}
