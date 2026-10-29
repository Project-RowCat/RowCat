import {
	type NotificationAttention,
	notificationAttention,
} from "@rowcat/domain";
import { Button, buttonVariants } from "@rowcat/ui-web/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@rowcat/ui-web/components/popover";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@rowcat/ui-web/components/tabs";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UpdateNotesList } from "#/features/updates/update-notes-list.tsx";
import {
	UpdateNotesUnseenDot,
	useUpdateNotesUnseen,
} from "#/features/updates/update-notes-unseen-dot.tsx";
import { translator } from "#/lib/i18n/current.ts";
import { AnimatedCount } from "#/lib/motion/animated-count.tsx";
import { enterTransition, exitTransition } from "#/lib/motion/transitions.ts";
import { MarkAllReadSlot } from "./mark-all-read-slot.tsx";
import {
	NotificationRow,
	NotificationRowSkeleton,
} from "./notification-row.tsx";
import {
	DEFAULT_NOTIFICATIONS_TAB,
	NOTIFICATIONS_TABS,
	type NotificationsTab,
	notificationsSearchForTab,
} from "./notifications-search.ts";
import { notificationPanelView } from "./notifications-state.ts";
import { useNotifications } from "./use-notifications.ts";

/**
 * Global attention utility in the header: one bell. The header's right side now has three items
 * (`Notifications · Settings · Account`). That does not make the header a tool drawer. Search, filters, sharing,
 * favorites, model settings and sync status still belong to their features. The bell is the only
 * new item because it calls the user from any screen.
 *
 * The popover mirrors the full screen: same vocabulary and order (`General` then `Updates`), each tab
 * showing a preview and a link to its full screen. Before this, the bell represented two things but
 * offered no way to open the release-note part. The preview is not an inbox: each tab shows only
 * the first few rows, and `Show more` is deliberately absent because the full screen already exists.
 *
 * Opening is not reading (§99), in either domain. Opening the popover, switching to `Updates`, or
 * seeing a notice marks nothing read. A glance that cleared the marker would discard the 'read
 * later' signal, and V1 has no mark-unread. Opening only refreshes the list. Reading happens per
 * domain: a notification row when activated, a release note when its window opens (`openNote` in
 * `update-notes-provider.tsx`).
 *
 * The release-note state never calls the server. The list query still runs only while the popover
 * is open (`enabled: open`) and is not enabled early for the dot. Read state for notes is a static
 * browser value unrelated to the server. Only the badge count uses a dedicated count query (60
 * seconds).
 *
 * Count query failures are silent: the badge disappears and the bell still works (§121). The
 * failure is shown in the list when opened, so the bell does not repeat it. Toasts are not used,
 * because a failing 60-second poll would repeat the same message every minute while offline (§122).
 * A count failure must not affect the `Updates` tab, which still reads when the server is down.
 *
 * Guests never see the bell. The header decides this and renders it only with a viewer present. An
 * inactive bell that sent guests to login would be wrong: guests have no inbox concept, the same
 * rule as the settings gear.
 */
/**
 * The bell's accessible name in the render's language. The shared `notificationAttention` still
 * decides everything (the badge, its cap, the dot); only the words around its badge are assembled
 * here.
 */
function bellLabel(
	attention: NotificationAttention,
	unseenUpdate: boolean,
): string {
	const t = translator("shell");
	const base =
		attention.badge === null
			? t("bell.label")
			: t("bell.unread", { count: attention.badge });
	return unseenUpdate ? `${base}${t("bell.unseenUpdate")}` : base;
}

export function NotificationBell({ here }: { here: boolean }) {
	const { t } = useTranslation("notifications");
	const [open, setOpen] = useState(false);
	/**
	 * The selected tab is valid only while this popover is open. It is not stored in the URL or
	 * localStorage. A URL would make clicking the bell navigate, and a popover is not navigation.
	 * localStorage would make the last tab used on a shared browser the default for the next person.
	 * The full screen's tab lives in the URL instead, because it is a destination that links must
	 * point to (`notifications-search.ts`).
	 *
	 * A new release note does not change this value. The default is always `General`. Switching to `Updates`
	 * on new items would turn the dot from a signal into an interception.
	 */
	const [tab, setTab] = useState<NotificationsTab>(DEFAULT_NOTIFICATIONS_TAB);
	const { items, list, retry, unreadCount, markAllRead, activate, refresh } =
		useNotifications({ enabled: open });

	/**
	 * Whether an unseen release note exists: a single boolean (`useUpdateNotesUnseen`). Neither the
	 * history nor the read state passes through this file. The shell route (`routes/(app)/route.tsx`)
	 * owns the container, so the bell and the full screen read the same value. A note opened in the
	 * popover clears its dot on the screen's tab in the same frame.
	 */
	const unseenUpdate = useUpdateNotesUnseen();

	/**
	 * What the bell draws and says is decided by one shared pure function (`notificationAttention`).
	 * Its whole job is to keep the two axes separate. Folding unread count and new-note count into one
	 * number would leave a `1` that `Mark all read` can never clear, since the server never created that item.
	 * So there are two answers (count and dot), and the count wins: two markers beside the bell could
	 * not be explained on screen. A hidden note is still spelled out in the accessible name.
	 *
	 * The mobile shortcut calls the same function. Separate implementations would eventually draw the
	 * same state as a count on one platform and as a dot on the other.
	 */
	const attention = notificationAttention({
		unread: unreadCount,
		unseenUpdate,
	});

	/**
	 * Uses the same pure rule as the full list (`notifications-state.ts`). Copy and size are the
	 * popover's own, but not what gets drawn. While each surface had its own logic, both drew a paused
	 * query as loading, and one failed background refresh turned the whole list into an error. If
	 * correctness rules diverge, two screens reading the same cache will say different things.
	 */
	const panel = notificationPanelView({
		isPaused: list.isPaused,
		isError: list.isError,
		isPending: list.isPending,
		hasData: list.data !== undefined,
		itemCount: items.length,
	});

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				/**
				 * Refresh only on open. Calling it on close too would send one more request for a list that is
				 * no longer on screen, and nobody would see the response. This is not a mark-as-read: neither
				 * domain marks anything read here (see header).
				 */
				if (next) refresh();
			}}
		>
			<PopoverTrigger
				render={
					<Button
						variant="ghost"
						size="icon-sm"
						/**
						 * The name states both conditions (§93). The badge and dot convey information only through
						 * color and shape, which screen readers cannot use. While the count is unknown, the name
						 * states no count. Saying `0 unread` first would already be wrong when the real
						 * value arrives. A note hidden behind the count still appears in the name.
						 */
						aria-label={bellLabel(attention, unseenUpdate)}
						/**
						 * Being on `/notifications` comes from the shell's decision (`utility === "notifications"`),
						 * not from this component. The path is not re-read here, because route-to-shell decisions
						 * must live in one place (§114).
						 */
						aria-current={here ? "page" : undefined}
						/*
						 * One step larger on narrow screens, per the rule for other header icon buttons. On wide
						 * screens it stays at the declared `icon-sm` (32px). The five cells of the utility row must
						 * share one height, or the active background would show up as a different pill on each row.
						 * The settings gear in `app-header.tsx` has the same rationale.
						 */
						className={`relative size-10 sm:size-8 ${
							here || open ? "bg-accent text-accent-foreground" : ""
						}`}
					/>
				}
			>
				<Bell aria-hidden="true" />
				{/*
				 * Attaching and detaching is all this badge does, so presence animates it. The two directions
				 * mean different things. A 60-second refresh bringing a new notification is an attention cue,
				 * while disappearing after `Mark all read` is a cause-and-effect result. If both popped in one frame,
				 * the bell would seem to flicker for no clear reason.
				 *
				 * When only the count changes, this presence does nothing. `key` is deliberately not tied to
				 * the count: re-animating on `3 → 4` would make the bell pulse every 60 seconds. The number
				 * inside rolls in place (`AnimatedCount`). Appearing, disappearing and value changes are
				 * separate events, so `0 → 3` is one appearance, `3 → 4` one roll, and `4 → 0` one exit.
				 * Two motions never overlap.
				 *
				 * Pointer-events on exit need no care. The badge is decoration inside the trigger, the target
				 * is always the button, and the badge is `aria-hidden`.
				 */}
				<AnimatePresence initial={false}>
					{attention.badge && (
						/*
						 * The badge is decoration; the count is spoken by the `aria-label` above. It overlays the
						 * icon rather than sitting beside it, for layout reasons. A side-by-side badge would take a
						 * second slot and push the context label (where you are) by that width at 390px. Absolute
						 * placement keeps appearance and exit from touching the bell's geometry.
						 */
						<m.span
							aria-hidden="true"
							initial={{ opacity: 0, scale: 0.6 }}
							animate={{ opacity: 1, scale: 1 }}
							exit={{ opacity: 0, scale: 0.6, transition: exitTransition }}
							transition={enterTransition}
							className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] leading-none font-medium text-primary-foreground tabular-nums"
						>
							{/*
							 * A count with the same meaning stays mounted in the same place; only its value changes, which
							 * is what allows rolling. Motion strength is the default: this number moves only on the 60-second
							 * refresh, so the next change is not immediate.
							 *
							 * Nothing rolls inside the `99+` cap, since 100 and 120 render the same characters and the digits
							 * would not show the change. Crossing the boundary changes the whole value, so the changed slot
							 * rolls. The direction on the way down comes from `countRollDirection`, which reads a decrease
							 * from the `+` sign. Comparing digits alone would show `99+ → 99` rolling up as if it were equal.
							 *
							 * The box is `aria-hidden`, so the inner `sr-only` text is hidden too. The button's `aria-label`
							 * is the only spoken count, and this wiring does not change that.
							 */}
							<AnimatedCount value={attention.badge} />
						</m.span>
					)}
				</AnimatePresence>

				{/*
				 * Dot shown only when there is no count. The two presences never overlap because
				 * `notificationAttention` already guarantees exclusivity (`dot` is true only when
				 * `badge === null`). Re-checking the condition on screen would let them diverge eventually.
				 *
				 * The dot is smaller than the badge and has no number. A `1` would be a lie: three backlogged
				 * notes still produce one marked line, and unread count is the inbox's vocabulary. There is no
				 * pulse either. The dot says only 'something new is here', which gives no reason to hurry.
				 */}
				<AnimatePresence initial={false}>
					{attention.dot && (
						<m.span
							aria-hidden="true"
							initial={{ opacity: 0, scale: 0.6 }}
							animate={{ opacity: 1, scale: 1 }}
							exit={{ opacity: 0, scale: 0.6, transition: exitTransition }}
							transition={enterTransition}
							className="absolute top-0.5 right-0.5 size-2 rounded-full bg-primary"
						/>
					)}
				</AnimatePresence>
			</PopoverTrigger>

			<PopoverContent
				align="end"
				// Wider than the default width (w-72) because it is a list, and capped so it does not exceed
				// narrow screens.
				className="w-[min(22rem,calc(100vw-2rem))] gap-0 p-0"
			>
				{/*
				 * Tabs are not hand-built. Active state, arrow-key movement and `role` all come from the
				 * primitive. The full screen uses the same primitive, so tabs on both surfaces move with the
				 * same rhythm.
				 */}
				<Tabs
					value={tab}
					onValueChange={(next) => setTab(next as NotificationsTab)}
					className="gap-0"
				>
					{/*
					 * The header holds only the name and the tabs. `Mark all read` is not here: it acts on server
					 * notifications, so in the header it would stay visible while the `Updates` tab is open,
					 * describing a list the user is not viewing.
					 */}
					<div className="flex flex-col gap-2 border-b px-3 py-2">
						<PopoverTitle className="text-sm font-semibold">
							{t("title")}
						</PopoverTitle>
						<TabsList variant="line" aria-label={t("tabsLabel")}>
							<TabsTrigger value={NOTIFICATIONS_TABS[0]}>
								{t("general")}
							</TabsTrigger>
							{/*
							 * The dot is decorative. The fact that something is new is carried as text in the button's
							 * name (`sr-only`). It is the same component as the full-screen tab and reads the same value.
							 */}
							<TabsTrigger value={NOTIFICATIONS_TABS[1]}>
								{t("updates")}
								<UpdateNotesUnseenDot />
							</TabsTrigger>
						</TabsList>
					</div>

					{/*
					 * The `General` tab stays mounted while switching tabs. Unmounting on each switch would lose scroll
					 * position and accumulated values, and any round trip longer than 30 seconds would refetch.
					 * Switching tabs must not call the server.
					 */}
					<TabsContent value={NOTIFICATIONS_TABS[0]} keepMounted>
						{/*
						 * `Mark all read` lives inside this tab. Its row reserves space in advance for geometry: if the row
						 * left the flow the moment the last notification was read, the list below would jump up in the
						 * same frame as the press. The full screen makes the same decision in the same place.
						 */}
						<div className="flex min-h-9 items-center justify-end px-2 pt-1">
							{/*
							 * The timing of the disappearance and the press protection during exit belong to the slot
							 * (`mark-all-read-slot.tsx`).
							 */}
							<MarkAllReadSlot visible={!!unreadCount}>
								<Button
									variant="ghost"
									size="sm"
									className="h-7 px-2 text-xs"
									disabled={markAllRead.isPending}
									onClick={() => markAllRead.mutate()}
								>
									{t("markAllRead")}
								</Button>
							</MarkAllReadSlot>
						</div>

						<div className="max-h-[min(24rem,60vh)] overflow-y-auto p-1">
							{panel.state === "offline" && (
								/*
								 * Separates paused from error. While this box looked only at `isPending`, a query paused
								 * offline drew a placeholder that would not end until the connection returned. A state the
								 * user can simply wait out must not render as loading, or users wait without knowing what
								 * for.
								 */
								<PopoverNotice
									tone="offline"
									title={t("offlineTitle")}
									isRetrying={list.isFetching}
									onRetry={retry}
								/>
							)}

							{panel.state === "error" && (
								/*
								 * Errors stay in place; no toast. If failures of the 60-second background refresh also
								 * toasted, the same message would repeat every minute while Wi-Fi is off (§121, §122).
								 *
								 * The error also does not cover the whole box. The release-note tab beside it does not
								 * depend on the server and stays open.
								 */
								<PopoverNotice
									tone="error"
									title={t("loadFailedTitle")}
									isRetrying={list.isFetching}
									onRetry={retry}
								/>
							)}

							{panel.state === "loading" && <NotificationPopoverSkeleton />}

							{panel.state === "empty" && (
								<>
									{/*
									 * States the same fact as the full list (`general-notifications.tsx`). If a refresh after a
									 * server 0 failed or was interrupted, that 0 may not be current. If only one of two surfaces
									 * reading the same cache hid that, the bell and the list would contradict each other. There is
									 * no room, so it still draws a single line.
									 */}
									{panel.retryable && (
										<PopoverStaleRetry
											isRetrying={list.isFetching}
											onRetry={retry}
										/>
									)}

									<p className="px-3 py-6 text-sm text-muted-foreground">
										{t("empty")}
									</p>
								</>
							)}

							{panel.state === "ready" && (
								<>
									{/*
									 * A failure with rows already held does not clear them (§92). This is the same decision as the
									 * full list; here, short on space, it is reduced to one sentence. Covering this box with an
									 * error would leave someone who opened the bell to see newly arrived notifications with nothing
									 * to read.
									 */}
									{panel.retryable && (
										<PopoverStaleRetry
											isRetrying={list.isFetching}
											onRetry={retry}
										/>
									)}

									<ul>
										{/*
										 * The list ends here. The popover is not an infinite-scroll inbox (§97); to see more, go to the
										 * full screen. Adding `Show more` here would make this small box a second list screen, and that
										 * screen already exists.
										 */}
										{items
											.slice(0, GENERAL_POPOVER_LIMIT)
											.map((notification) => (
												<NotificationRow
													key={notification.id}
													notification={notification}
													surface="popover"
													onActivate={() => {
														activate(notification);
														// Navigation happens, so the popover must close. It also closes on rows with no
														// destination, so that pressing gives feedback.
														setOpen(false);
													}}
												/>
											))}
									</ul>
								</>
							)}
						</div>

						<PopoverFooterLink tab={NOTIFICATIONS_TABS[0]} onLeave={setOpen}>
							{t("viewAll")}
						</PopoverFooterLink>
					</TabsContent>

					<TabsContent value={NOTIFICATIONS_TABS[1]}>
						{/*
						 * A preview, not history. The number of rows is decided by the list via `surface`
						 * (`update-notes-list.tsx`) and is not trimmed here. Order and surface filtering are already
						 * done by the shared pure function.
						 *
						 * Tapping a row opens the window, and that moment counts as read. The window belongs to the
						 * shell container, not this box: the popover closes on open, so a window inside it would vanish
						 * too. This tab has no query branches at all, so it still reads when the server is down.
						 */}
						<div className="max-h-[min(24rem,60vh)] overflow-y-auto p-1">
							<UpdateNotesList surface="popover" />
						</div>

						<PopoverFooterLink tab={NOTIFICATIONS_TABS[1]} onLeave={setOpen}>
							{t("viewAllUpdates")}
						</PopoverFooterLink>
					</TabsContent>
				</Tabs>
			</PopoverContent>
		</Popover>
	);
}

/**
 * Number of rows drawn by the popover's `General` tab. Not a full page of 20: this box is for skimming
 * what just happened, and twenty rows would need long scrolling, when the full screen is the right
 * place.
 *
 * The release-note cap is smaller (three). Each note takes two lines and releases are rare, so six
 * would make the preview the whole history for most users. That cap is owned by the list on its own
 * surface axis (`update-notes-list.tsx`).
 */
const GENERAL_POPOVER_LIMIT = 6;

/**
 * The footer link at the bottom of each tab goes to that tab's full screen. Both target
 * `/notifications` with different tabs. The link builds its search parameter through a shared
 * function instead of hand-writing it, because the default tab is left out of the URL. Writing
 * `?tab=general` by hand would give the same screen two addresses.
 *
 * Closing the popover also lives here: if each link decided it separately, one could leave the
 * popover open after navigating.
 */
function PopoverFooterLink({
	tab,
	onLeave,
	children,
}: {
	tab: NotificationsTab;
	onLeave: (open: boolean) => void;
	children: string;
}) {
	return (
		<div className="border-t p-1">
			<Link
				to="/notifications"
				search={notificationsSearchForTab(tab)}
				onClick={() => onLeave(false)}
				className={buttonVariants({
					variant: "ghost",
					size: "sm",
					className: "w-full justify-center text-sm",
				})}
			>
				{children}
			</Link>
		</div>
	);
}

/**
 * Two states that cannot draw any rows: paused and error. The copy is shorter than the full list's.
 * In a 22rem box a second line leaves no room for the list, and all that is needed is 'couldn't
 * load right now' and one way to retry. Details are on the screen opened by `See all notifications` below.
 *
 * As on the full list, the two carry different weight: only the error gets role="alert" and
 * destructive color. Paused is a wait, not a fault. Coloring it like a server error would make real
 * failures harder to spot.
 */
function PopoverNotice({
	tone,
	title,
	isRetrying,
	onRetry,
}: {
	tone: "offline" | "error";
	title: string;
	isRetrying: boolean;
	onRetry: () => void;
}) {
	const { t } = useTranslation(["notifications", "common"]);
	const failed = tone === "error";
	return (
		<div className="flex flex-col items-start gap-2 p-3">
			<p
				{...(failed ? { role: "alert" } : {})}
				className={
					failed ? "text-sm text-destructive" : "text-sm text-muted-foreground"
				}
			>
				{title}
			</p>
			<Button
				variant="outline"
				size="sm"
				disabled={isRetrying}
				onClick={onRetry}
			>
				{isRetrying ? t("loading") : t("common:actions.retry")}
			</Button>
		</div>
	);
}

/**
 * Held values exist but the last refresh failed. This applies both when rows exist and when the
 * inbox is empty. It states the same fact as `NotificationsStaleNotice` on the full list, in one
 * line. Like the full list, it does not cover the box with an error: someone who opened the bell to
 * see new items would see nothing.
 *
 * It shows even for an empty inbox, because a 0 is also a held value: server-confirmed, but not
 * known to be current. It has no role="alert", for the same reason: readable values already exist
 * below, and this news should not interrupt the screen reader.
 */
function PopoverStaleRetry({
	isRetrying,
	onRetry,
}: {
	isRetrying: boolean;
	onRetry: () => void;
}) {
	const { t } = useTranslation("notifications");
	return (
		<button
			type="button"
			disabled={isRetrying}
			onClick={onRetry}
			className="w-full rounded-md px-3 py-1.5 text-left text-xs text-muted-foreground underline-offset-2 outline-none transition-colors hover:bg-accent/60 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-70"
		>
			{isRetrying ? t("staleRetrying") : t("staleRetry")}
		</button>
	);
}

/**
 * Three placeholder rows. Drawing the full cap would make the box jump on arrival. Row geometry
 * belongs to `NotificationRowSkeleton`. When this was drawn separately, the placeholder lacked the
 * dot column that real rows have, so text shifted sideways once values arrived.
 */
function NotificationPopoverSkeleton() {
	const { t } = useTranslation("notifications");
	return (
		<>
			{/*
			 * Follows the same pattern as placeholders in other sections: loading is announced by one
			 * sr-only status line.
			 */}
			<output className="sr-only">{t("loadingNotifications")}</output>
			<ul aria-hidden="true">
				{[0, 1, 2].map((index) => (
					<NotificationRowSkeleton key={index} surface="popover" />
				))}
			</ul>
		</>
	);
}
