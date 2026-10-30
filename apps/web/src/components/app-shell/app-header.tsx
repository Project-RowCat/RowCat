import { resetViewerState, viewerQueryOptions } from "@rowcat/query";
import { Button, buttonVariants } from "@rowcat/ui-web/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@rowcat/ui-web/components/dropdown-menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { LogIn, LogOut, Settings, UserRound } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { LanguageToggle } from "#/components/app-shell/language-toggle.tsx";
import { ModeToggle } from "#/components/app-shell/mode-toggle.tsx";
import { signOutFailed } from "#/features/auth/auth-error.ts";
import { NotificationBell } from "#/features/notifications/notification-bell.tsx";
import { useSettingsReturnSearch } from "#/features/settings/settings-return.ts";
import { getRowCatClient } from "#/lib/api.ts";
import { authClient } from "#/lib/auth.ts";
import { showErrorToast } from "#/lib/toast.ts";
import { AppSidebarSheet } from "./app-sidebar.tsx";
import type { AppSection, ShellUtility } from "./shell-route.ts";

/**
 * The fixed header: **where you are, plus global utilities**.
 *
 * Global navigation is not here. Discover, Chat and Create belong to the sidebar
 * (`app-sidebar.tsx`); placing the same destinations on two surfaces leaves one of them as dead
 * decoration, and on narrow screens the duplicate takes the space that matters most (which
 * conversation this is).
 *
 * So this line holds three things only:
 *
 * ```text
 * left    narrow-screen sidebar trigger + the name of the open resource and its actions
 * right   notifications · settings · account
 * ```
 *
 * **The three right-hand slots never reorder by route.** They are muscle memory, and moving them
 * per screen would make people search for them every time.
 *
 * ## Why notifications are here, and why this is not a tool drawer
 *
 * This comment once listed notifications among things that must not enter the header. That judgment
 * changed, because notifications differ in kind from the other candidates:
 *
 * ```text
 * search, filters, sort, adult display    query axes                 the discovery screen owns them in its own URL
 * share, favourite, report                actions on what is viewed  that screen's canvas owns them
 * model settings, sync status             feature settings           each settings screen owns them
 * notifications                           things that call the user  must sit in the same place on every screen
 * ```
 *
 * The first three are tied to "this screen"; promoted into the header they become dead icons on
 * other screens. Only notifications are screen-independent: a comment notice that arrives during a
 * conversation, or an operator action while drafting, must appear in the same place. **Only items
 * that pass that test appear on this line** (the vocabulary is pinned by `ShellUtility`).
 *
 * The sidebar has no `Notifications` entry for the mirror-image reason. Its left column is fixed to the three
 * product sections (`Discover`·`Conversations`·`Create`), and notifications are a global utility, not a section.
 *
 * The context slot (`context`) is decided by the route. Screens must **not** register their title
 * and actions here through an effect (`useEffect(() => header.set(...))`): that pattern brings a
 * title one frame late, stale actions from the previous screen during navigation, double
 * registration under StrictMode, and server/client mismatch. The header instead receives a node
 * derived from the router's resolved match (`routes/(app)/route.tsx`).
 *
 * Only local-first screens fill the context slot, for the same reason: conversations and drafts
 * load from IndexedDB immediately, so there is no window in which the previous screen's context
 * could linger. Screens that wait on the server (the work detail page) keep their title and actions
 * in the canvas. If the header held the previous work's `Start conversation` while the loader was still running,
 * that button would act on something no longer on screen. On screens whose canvas already has its
 * own h1 (discovery, lists, drafts, settings, account) the slot is empty; the same title is not
 * drawn twice, 60px apart.
 */
export function AppHeader({
	section,
	utility,
	activeRoomId,
	activeRuntimeStoryId,
	context,
}: {
	section: AppSection | null;
	utility: ShellUtility | null;
	/** Room row that the narrow-screen drawer opens. Reads the **same value** as the sidebar. */
	activeRoomId: string | null;
	/** Runtime row that the drawer opens; the second value on the same axis. */
	activeRuntimeStoryId: string | null;
	/** Name and actions of the open resource, or null. */
	context: ReactNode;
}) {
	/*
	 * `account-background` is on the header because this strip stands in for the page background
	 * rather than being a card. When the account gradient is on, the class is needed: without it the
	 * background colour fills this strip alone and a solid band cuts the page off at the top.
	 *
	 * The coordinate system is the viewport (`background-attachment: fixed`), so what is drawn here is
	 * **the pixels the page would have painted at that spot**: a continuation of the same gradient,
	 * not a second one, so there is no visible seam. Without a gradient the class does nothing and
	 * only the translucency and blur remain.
	 */
	return (
		<header className="sticky top-0 z-30 h-(--shell-header) shrink-0 border-b bg-background/85 account-background backdrop-blur">
			<div className="flex h-full w-full items-center gap-2 px-4 md:px-6">
				{/*
				 * Narrow-screen navigation is this one trigger. The old section dropdown and the
				 * list sheet both folded into it: with two navigation menus on mobile, nobody
				 * remembers where anything is, and both were doing part of the job the desktop
				 * sidebar does alone.
				 *
				 * The brand is not here. It moved into the sidebar, which also means that on
				 * narrow screens the brand does not take space from the room title.
				 */}
				<AppSidebarSheet
					section={section}
					activeRoomId={activeRoomId}
					activeRuntimeStoryId={activeRuntimeStoryId}
				/>

				{/* With no context the slot only holds its width, so the right-hand utilities stay in place. */}
				<div className="flex min-w-0 flex-1 items-center gap-1">{context}</div>

				<div className="ml-auto flex shrink-0 items-center gap-1">
					<HeaderUtilities utility={utility} />
				</div>
			</div>
		</header>
	);
}

/**
 * The right-hand three: notifications, settings and account.
 *
 * Guests get none of them. `/settings` is only for signed-in members (it reads values from the
 * member-scoped local database), so a gear for a guest would be a button that sends them to login.
 * Notifications have no meaning for a guest either; a dimmed bell that bounces to login when
 * pressed would be a lie (§91). The only thing a guest gets is `Sign in`.
 *
 * **The theme switch stays for guests only, and that is why.** Members have the settings screen's
 * `Display` section, which covers the same values, so the header shortcut is a duplicate for them. A
 * guest cannot enter that screen, so removing the switch here would leave no way to change the
 * theme inside the app (the login screen is outside the shell too). This difference follows
 * **identity, not route**, so it does not conflict with "the slots never move". The language switch
 * stands beside it for the same reason (`Display` holds the language row too).
 */
function HeaderUtilities({ utility }: { utility: ShellUtility | null }) {
	const { t } = useTranslation("shell");
	const { data: viewer } = useQuery(viewerQueryOptions(getRowCatClient()));
	const here = useRouterState({ select: (state) => state.location.href });

	if (!viewer)
		return (
			<>
				<LanguageToggle />
				<ModeToggle />
				<Link
					to="/login"
					// Sends the current screen along as the destination: after signing in the user comes back to
					// where they were (gallery filters, search and page live in the query string, so they are kept
					// too). The router supplies this value, so it is already an internal app path, and the
					// receiving side validates it again.
					search={{ redirect: here }}
					// One size up on narrow screens; this is the only button a guest can press here.
					className={buttonVariants({
						variant: "outline",
						size: "sm",
						className: "h-9 sm:h-8",
					})}
				>
					<LogIn />
					{t("header.signIn")}
				</Link>
			</>
		);

	return (
		<>
			{/*
			 * Order is fixed: notifications, settings, account. Account is last because it is
			 * "me" on this line. Notifications come first because they are the only item here
			 * with state: where a read count sits, the eye should reach it first.
			 */}
			<NotificationBell here={utility === "notifications"} />
			<SettingsAction utility={utility} />
			<ViewerMenu nickname={viewer.nickname} utility={utility} />
		</>
	);
}

/**
 * The route to global settings.
 *
 * A plain link with no `replace`, so Back returns to the screen the user came from. Settings is a
 * short detour, and that history is exactly what the user expects.
 *
 * Pressing it on `/settings` does nothing (navigation to the same address is absorbed by the
 * router). It is not disabled: a disabled button does not say why it cannot be pressed, and all
 * that needs to be conveyed is "you are here", which `aria-current` and the background already do.
 *
 * On conversation screens a room-settings trigger also appears on the left. The two are told apart
 * by place and name: room actions sit beside the title and speak about that room, while this gear
 * is always at the far right and speaks about the whole app. The icons differ too
 * (`SlidersHorizontal` / `Settings`).
 */
function SettingsAction({ utility }: { utility: ShellUtility | null }) {
	const { t } = useTranslation("shell");
	const here = utility === "settings";
	/**
	 * From a conversation, the press **carries the return location** (`settings-return.ts`).
	 *
	 * This gear is a global destination on every screen and its vocabulary is unchanged; only the
	 * destination now knows where the user came from. Outside conversations the value is empty, so the
	 * settings screen gains nothing.
	 */
	const returnSearch = useSettingsReturnSearch();
	return (
		<Link
			to="/settings"
			search={returnSearch}
			aria-label={t("header.settings")}
			aria-current={here ? "page" : undefined}
			className={buttonVariants({
				variant: "ghost",
				size: "icon-sm",
				/*
				 * One size up on narrow screens, the same rule as the other icon buttons in the header.
				 *
				 * On wide screens it stays at the declared size (`icon-sm` = 32px). For a while this slot was
				 * `sm:size-9`, so the gear and bell alone stood 4px larger in the utility row. The account slot
				 * is `sm` (32px), so when the active background turned on, two pill heights sat side by side on
				 * the same row.
				 */
				className: `size-10 sm:size-8 ${here ? "bg-accent text-accent-foreground" : ""}`,
			})}
		>
			<Settings aria-hidden="true" />
		</Link>
	);
}

/**
 * Account: the nickname is the menu trigger.
 *
 * `Settings` is no longer in this menu. Settings is now a standalone header action, and a second entry
 * here would give two settings items 20px apart, both going to the same place, which one only
 * learns by pressing each.
 *
 * It reads its value from `/me`, not from Better Auth's session hook. The session only answers
 * "signed in?", while product identity comes from the server after it resolves the member. Treating
 * both as truth at once makes the screen split in states such as "session exists, member missing".
 * The auth client is used only to sign in and out.
 *
 * ## On narrow screens only the icon remains
 *
 * This is forced by the third right-hand slot. Of the three, only the nickname changes width, so at
 * 390px a 20-character nickname takes 80px, and that 80px comes out of the context slot. Measured:
 * the conversation title shrank to three characters, so "which conversation is this" disappeared
 * first. That undoes the reason this header exists (§95).
 *
 * So below `sm` a person icon replaces the name. What is lost is a name visible at a glance, which
 * the menu shows as soon as it opens. **The accessible name still carries the nickname**, so
 * screen-reader users lose nothing; only pixels go.
 *
 * On wide screens the name stays, because there the context slot has room and the compromise is
 * unnecessary.
 */
function ViewerMenu({
	nickname,
	utility,
}: {
	nickname: string;
	utility: ShellUtility | null;
}) {
	const { t } = useTranslation("shell");
	const queryClient = useQueryClient();
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const here = utility === "account";

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						size="sm"
						/** The name stays here even when only the icon is visible. */
						aria-label={t("header.accountMenu", { name: nickname })}
						className={`size-10 px-0 sm:h-8 sm:w-auto sm:max-w-32 sm:px-3 ${
							here ? "bg-accent font-medium text-accent-foreground" : ""
						}`}
					/>
				}
			>
				{/* Narrow: fixed-width icon. Wide: the name, truncated when it overflows. */}
				<UserRound aria-hidden="true" className="sm:hidden" />
				<span className="hidden truncate text-sm sm:inline">{nickname}</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem
					render={
						<Link to="/account" aria-current={here ? "page" : undefined} />
					}
				>
					<UserRound aria-hidden="true" />
					{t("header.account")}
				</DropdownMenuItem>
				<DropdownMenuItem
					disabled={pending}
					onClick={async () => {
						setPending(true);
						try {
							// Do not clear the cookie by hand. It is HttpOnly and cannot be read, and expiry has to be
							// handled by whoever issued the session (Better Auth).
							await authClient.signOut();
							/**
							 * Clear the server-held state explicitly. Gallery results depend on the viewer (their own
							 * private works, adult display, blocks), so without this the logged-out screen would keep a
							 * list fetched while signed in.
							 *
							 * **Local data and device preferences are not cleared.** Signing out means "stop viewing
							 * this on this browser", not "discard my conversations and settings". Signing in again to
							 * the same account brings them back. Recent conversations disappear from the sidebar because
							 * the scope closes, not because they were deleted (`local-data/scope.tsx`).
							 */
							await resetViewerState(queryClient);
							// Also re-sync the route loader data to the new session, so the user is never left needing a
							// refresh.
							await router.invalidate();
						} catch {
							/**
							 * **This failure has no place to show.** The menu has already closed and there is no screen
							 * to return to, so if sign-out fails while nothing is displayed, nothing appears to have
							 * happened, and the person leaves believing they signed out. On a shared browser that
							 * misunderstanding is expensive.
							 */
							showErrorToast(signOutFailed());
						} finally {
							setPending(false);
						}
					}}
				>
					<LogOut aria-hidden="true" />
					{t("header.signOut")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
