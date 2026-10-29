import { APP_NAME } from "@rowcat/domain";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogTitle,
	DialogTrigger,
} from "@rowcat/ui-web/components/dialog";
import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { ClientOnly, Link } from "@tanstack/react-router";
import { Compass, List, Menu, MessagesSquare, PenLine } from "lucide-react";
import { LayoutGroup } from "motion/react";
import { lazy, type ReactNode, Suspense, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalDataScope } from "#/lib/local-data/scope.tsx";
import { MotionActiveIndicator } from "#/lib/motion/active-indicator.tsx";
import type { AppSection } from "./shell-route.ts";

/**
 * App sidebar: **global destinations plus resume of recent conversations**. Those two are all of
 * it.
 *
 * What this file actually guards is not the list but the **boundary**. The moment a fixed column
 * appears on the left it becomes "leftover space", and leftover space fills with settings, theme,
 * sync, search, notifications and favourites in turn. The end of that path is known: the sidebar
 * becomes the app and the canvas becomes one cell inside it. So what lives here is **one fixed
 * IA**, with no slot that accepts arbitrary widgets:
 *
 * ```text
 * RowCat
 *
 * Discover · Conversations · Create
 *
 * Recent conversations
 *   room …
 * All conversations
 * ```
 *
 * Global utilities (settings, account, sign-out, theme) **belong to the header**. Putting one gear
 * here starts the drift described above.
 *
 * **Recent conversations are a switcher, not a list screen.** Each row carries only a title.
 * Renaming, deleting, pinning, archiving, searching and last-message previews all belong to
 * `/chats`. If that split blurs, the 240px column turns back into a conversation list screen, and
 * that screen already exists separately.
 *
 * **There are no recent drafts.** This is not built for symmetry. Conversation is an activity
 * resumed several times a day, so a resume shortcut earns its place; drafting is entered from its
 * own list screen (`/create`) and stayed in for a long time. That both are local-first resources is
 * not a basis for the structure.
 *
 * **No collapsing, icon rail or width resizing.** Adding any one brings persistent preferences,
 * tooltips, width animation and mobile exceptions along with it. Desktop has one size; mobile has
 * one drawer.
 *
 * ## Desktop and mobile share **the same content**
 *
 * Only the container differs (`AppSidebar` is the fixed column, `AppSidebarSheet` the left drawer).
 * Maintaining two copies silently diverges the navigation items: when a section is added only one
 * side grows, and that shows up only when a screen of the other size is opened.
 */

/**
 * Fixed width: 240px.
 *
 * Chosen between 224 and 248px. A room title of about 15 characters fits on one line (208px of text
 * after the row padding), and on a 1024px screen it leaves 784px for the canvas, which is the
 * narrowest width that still holds the conversation body column (max-w-3xl, 768px). Going wider
 * squeezes that body first, and that is the text this app is read for the longest.
 *
 * Not the 280–320px of ChatGPT-style sidebars, because the protagonist differs. This column exists
 * for quick switching, not for managing the product.
 */
const SIDEBAR_WIDTH_CLASS = "w-60";

/**
 * Fixed from `lg` (1024px) upward.
 *
 * Below that it is **not drawn at all**. The point is not to leave a hidden placeholder:
 * `invisible` with the same geometry would leave the canvas 240px narrower on tablets. At that size
 * the same navigation is opened by the header trigger.
 *
 * 1024 was chosen for conversation (see the width note above). The gallery's four columns narrow at
 * that width, so its grid breakpoint was delayed instead (`gallery-grid.ts`). Fixing the content's
 * responsiveness is preferred over shrinking the sidebar into a rail.
 */
const SIDEBAR_DESKTOP_CLASS = `hidden lg:flex ${SIDEBAR_WIDTH_CLASS}`;

/**
 * The desktop fixed sidebar.
 *
 * `sticky top-0 h-dvh self-start` is all of the geometry. Left at the default `stretch` alignment
 * inside the shell's horizontal flex, the element grows to the full document height and sticky does
 * nothing: on a long screen such as discovery the sidebar would scroll up out of view.
 *
 * It is not re-mounted on navigation. The `(app)` layout route draws it once and only the outlet
 * below changes, so it gets no entrance motion on route change. Staying still is its purpose.
 */
export function AppSidebar({
	section,
	activeRoomId,
	activeRuntimeStoryId,
}: {
	section: AppSection | null;
	/** The open room. **The route parameter is the source of truth**; the sidebar holds no selection state. */
	activeRoomId: string | null;
	/** The runtime work being played; the second value on the same axis (`shell-route.ts`). */
	activeRuntimeStoryId: string | null;
}) {
	const { t } = useTranslation("shell");
	return (
		<nav
			aria-label={t("nav.label")}
			className={`sticky top-0 h-dvh shrink-0 flex-col self-start overflow-y-auto border-r border-border/60 px-3 py-4 ${SIDEBAR_DESKTOP_CLASS}`}
		>
			{/*
			 * The active-indicator namespace. The fixed sidebar and the drawer draw **the same
			 * component**, and on narrow screens the fixed one stays in the tree as
			 * `display: none`. If both used the same `layoutId`, the indicator would fly between
			 * the invisible sidebar and the drawer every time the drawer opened. The container
			 * names it, so the content need not know about this.
			 */}
			<LayoutGroup id="sidebar-fixed">
				<AppSidebarContent
					section={section}
					activeRoomId={activeRoomId}
					activeRuntimeStoryId={activeRuntimeStoryId}
				/>
			</LayoutGroup>
		</nav>
	);
}

/**
 * The same sidebar for narrow screens: the header trigger and the left drawer.
 *
 * The trigger and the content are one component because of the open state. Splitting them across
 * the header and the body would lift that state to the shell, and then "is the drawer open" would
 * have no clear owner. Kept together, the state's lifetime is this element's lifetime.
 *
 * **Navigation also closes it.** The router does not change the document, so pressing a row would
 * otherwise leave the drawer open and covering the screen just selected. Wrapping the rows in
 * `DialogClose` is possible, but that overlays one more layer on the link's accessibility meaning
 * (new tab, copy address). The rows stay links; only the close is passed down.
 *
 * The content mounts only while the drawer is open (Base UI's default). So normally the only local
 * subscription is the fixed sidebar's.
 */
export function AppSidebarSheet({
	section,
	activeRoomId,
	activeRuntimeStoryId,
}: {
	section: AppSection | null;
	activeRoomId: string | null;
	activeRuntimeStoryId: string | null;
}) {
	const { t } = useTranslation("shell");
	const [open, setOpen] = useState(false);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger
				render={
					<Button
						variant="ghost"
						size="icon-sm"
						/*
						 * Names the destination rather than "menu". For a user who cannot see the screen, "menu" does
						 * not say what will open.
						 */
						aria-label={t("nav.open")}
						/*
						 * Not needed at widths where the fixed sidebar is shown; it would open the same thing twice.
						 *
						 * On wide screens the declared `icon-sm` (32px) is kept, for the same reason as the header's
						 * right-hand utilities: if controls on one line have different heights, the line looks
						 * crooked.
						 */
						className="-ml-1.5 size-10 shrink-0 sm:size-8 lg:hidden"
					/>
				}
			>
				<Menu aria-hidden="true" />
			</DialogTrigger>
			<DialogContent
				showCloseButton={false}
				/**
				 * Replaces the default centred geometry with a full-height left edge.
				 *
				 * The entrance is set by this placement too. A centred box grows in from the middle, but on a
				 * full-height face pinned to the left edge, growing reads as "got bigger". This face **came in
				 * from the left**, and that fact says where to return to (the top-left, where the trigger is).
				 * So a short horizontal slide is used instead of a scale.
				 *
				 * It is received as `placement` rather than set by a class because the geometry is now Motion's
				 * `transform`. Turning off the centred box's `-50%` reset with a class would be overwritten by
				 * the inline transform, and the box would jump to a corner.
				 *
				 * Applied to **this one surface only**; other dialogs use the primitive's default.
				 */
				placement="left"
				className="top-0 left-0 flex h-dvh w-72 max-w-[85vw] flex-col gap-0 rounded-none rounded-r-xl p-0 sm:max-w-[20rem]"
			>
				{/*
				 * The drawer's name is only read out. The inside already draws the brand and the
				 * section names, so drawing the title visibly as well would repeat the same words on
				 * two lines.
				 */}
				<DialogTitle className="sr-only">{t("nav.label")}</DialogTitle>
				<nav
					aria-label={t("nav.label")}
					className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4"
				>
					{/* A different namespace from the fixed sidebar; see the `AppSidebar` comment above. */}
					<LayoutGroup id="sidebar-sheet">
						<AppSidebarContent
							section={section}
							activeRoomId={activeRoomId}
							activeRuntimeStoryId={activeRuntimeStoryId}
							onNavigate={() => setOpen(false)}
						/>
					</LayoutGroup>
				</nav>
			</DialogContent>
		</Dialog>
	);
}

/**
 * **One copy of the content**, shared by desktop and mobile.
 *
 * Hierarchy between sections comes from whitespace and type, not dividers. A border on every row
 * would turn the 240px column into a stack of cards, and then this column becomes noisier than the
 * canvas.
 */
function AppSidebarContent({
	section,
	activeRoomId,
	activeRuntimeStoryId,
	onNavigate,
}: {
	section: AppSection | null;
	activeRoomId: string | null;
	activeRuntimeStoryId: string | null;
	/** Closes the drawer when pressed there. Does nothing in the fixed sidebar. */
	onNavigate?: () => void;
}) {
	return (
		<>
			<SidebarBrand onNavigate={onNavigate} />
			<SidebarPrimaryNav section={section} onNavigate={onNavigate} />
			<RecentChatSection
				activeRoomId={activeRoomId}
				activeRuntimeStoryId={activeRuntimeStoryId}
				onNavigate={onNavigate}
			/>
		</>
	);
}

/**
 * The brand, which also serves as the path to discovery.
 *
 * It is deliberately styled **differently** from the navigation items. In the same shape it would
 * read as a fourth item beside `Discover`, even though both go to the same place. It is not enlarged into
 * a logo block either: the vertical space at the top belongs to recent conversations.
 *
 * On the discovery screen this link also gets `aria-current="page"`. The router overwrites
 * `aria-current` on every active link after `activeProps` is applied, so it cannot be turned off
 * with props; this is app-wide behaviour (the header brand used to behave the same way). No
 * per-link workaround is added here: turning this into a plain `<a>` would make only the home link
 * a full page reload.
 */
function SidebarBrand({ onNavigate }: { onNavigate?: () => void }) {
	return (
		<Link
			to="/"
			search={{}}
			onClick={onNavigate}
			className="mb-4 rounded-md px-2 text-lg font-black tracking-tight no-underline outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
		>
			{APP_NAME}
		</Link>
	);
}

/** Global destinations. List only what exists; an item with nowhere to go is decoration, not navigation. */
const SECTIONS: {
	section: AppSection;
	icon: typeof Compass;
	to: "/" | "/chats" | "/create";
}[] = [
	{ section: "discover", icon: Compass, to: "/" },
	{ section: "chat", icon: MessagesSquare, to: "/chats" },
	{ section: "create", icon: PenLine, to: "/create" },
];

/**
 * Global navigation: three items.
 *
 * Settings and account are deliberately absent; that is the definition of this list. This line says
 * "where am I going", and those two are destinations needed from any of the three, so the header's
 * utilities hold them.
 *
 * On the settings and account screens **no item is lit** (`shell-route.ts` gives `section: null`).
 * Forcing the nearest section on would make the user read themselves as being inside discovery or
 * conversation.
 */
function SidebarPrimaryNav({
	section,
	onNavigate,
}: {
	section: AppSection | null;
	onNavigate?: () => void;
}) {
	const { t } = useTranslation("shell");
	return (
		<ul className="flex flex-col gap-0.5">
			{SECTIONS.map((item) => {
				const active = item.section === section;
				return (
					<li key={item.to} className="min-w-0">
						<Link
							to={item.to}
							{...(item.to === "/" ? { search: {} } : {})}
							// This attribute, not colour, says "this is the current section".
							aria-current={active ? "page" : undefined}
							onClick={onNavigate}
							className={sidebarRowClass(active)}
						>
							{/*
							 * The highlight background **moves between items**. If the active item
							 * turned its background on and the previous one turned it off, that is
							 * two state changes: one thing seems to vanish and another appears, and
							 * the relationship between sections (moving from `Discover` **down** to
							 * `Conversations`) is lost.
							 *
							 * It uses a **different namespace** from the recent-conversation rows.
							 * Sharing one name would make the indicator fly from the global
							 * navigation to the recent list when a room opens. They are not
							 * siblings; each lit independently is the normal state.
							 */}
							{active && (
								<MotionActiveIndicator
									group="app-sidebar-primary"
									className={SIDEBAR_ROW_INDICATOR_CLASS}
								/>
							)}
							<item.icon
								className="relative size-4 shrink-0"
								aria-hidden="true"
							/>
							<span className="relative truncate">
								{t(`nav.${item.section}`)}
							</span>
						</Link>
					</li>
				);
			})}
		</ul>
	);
}

/**
 * The recent-conversations section. Its list comes only from the browser.
 *
 * `lazy` defers loading and `ClientOnly` blocks rendering. Both are needed: the sidebar is also
 * rendered on the server, so calling the local hook directly here would pull Dexie into the server
 * bundle's static graph and, worse, **room titles would be serialized into the server HTML**.
 * Titles should be known only to the user and should not appear in server logs either.
 *
 * **Guests get no section at all.** There is no scope to open, so the list would stay undetermined
 * forever and a placeholder would remain indefinitely. `All conversations` disappears with it: its destination
 * bounces to the login screen, and the way into conversations is already the global navigation
 * above.
 */
function RecentChatSection({
	activeRoomId,
	activeRuntimeStoryId,
	onNavigate,
}: {
	activeRoomId: string | null;
	activeRuntimeStoryId: string | null;
	onNavigate?: () => void;
}) {
	const { t } = useTranslation("shell");
	const { status } = useLocalDataScope();
	const headingId = useId();

	if (status === "unavailable") return null;

	return (
		<section aria-labelledby={headingId} className="mt-6 flex min-w-0 flex-col">
			{/* A quiet label, not a button. It must look like something that cannot be pressed. */}
			<p
				id={headingId}
				className="px-2 pb-1.5 text-xs font-medium text-muted-foreground"
			>
				{t("nav.recent")}
			</p>
			<ClientOnly fallback={<SidebarRecentSkeleton />}>
				<Suspense fallback={<SidebarRecentSkeleton />}>
					<RecentChats
						activeRoomId={activeRoomId}
						activeRuntimeStoryId={activeRuntimeStoryId}
						onNavigate={onNavigate}
					/>
				</Suspense>
			</ClientOnly>
			<AllChatsLink onNavigate={onNavigate} />
		</section>
	);
}

const RecentChats = lazy(() =>
	import("#/features/chat/room/recent-chats.tsx").then((module) => ({
		default: module.RecentChats,
	})),
);

/**
 * The boundary between quick resume and **management**.
 *
 * The list above is cut to the latest few, and each row carries only a title. Searching, sorting,
 * renaming and deleting all happen in `/chats`; this link says so. Without it the sidebar would
 * pretend to be "all my conversations", and per-row menus would be demanded from then on.
 *
 * It has the same destination as `Conversations` in global navigation. The difference is rank: that one is the
 * entrance to a product section, while this one is "see all" at the end of this list. No separate
 * route such as `/chat-home` is created to tell them apart.
 *
 * Because the destinations match, on `/chats` both `Conversations` and this link read as the current location
 * (the router puts `aria-current` on every active link, and `activeProps` cannot turn that off).
 * The fact is not wrong, so it stays; the hierarchy between the two is carried by text size and
 * position.
 */
function AllChatsLink({ onNavigate }: { onNavigate?: () => void }) {
	const { t } = useTranslation("shell");
	return (
		<Link
			to="/chats"
			onClick={onNavigate}
			className="mt-1 flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground no-underline outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
		>
			<List className="size-3.5 shrink-0" aria-hidden="true" />
			<span className="truncate">{t("nav.allChats")}</span>
		</Link>
	);
}

/**
 * One row's appearance, shared by global navigation and recent conversations.
 *
 * The current location is marked **quietly**. A background layer and heavier type are enough;
 * making it a card would turn the switcher into a list.
 *
 * The background layer is drawn not by this class but by `MotionActiveIndicator`
 * (`SIDEBAR_ROW_INDICATOR_CLASS` below). What remains here is weight and colour, and that is the
 * point: even without the background (reduced motion, dropped frames) it is still clear which row
 * is lit.
 */
export function sidebarRowClass(active: boolean): string {
	return [
		"relative flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm no-underline outline-none",
		"focus-visible:ring-3 focus-visible:ring-ring/50",
		active
			? "font-medium text-accent-foreground"
			: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
	].join(" ");
}

/** The look of the moving active background: same corners as the row, covering the whole row. */
export const SIDEBAR_ROW_INDICATOR_CLASS =
	"absolute inset-0 rounded-md bg-accent";

/** The container for the recent-conversation list. The conversation feature builds the rows. */
export function SidebarList({ children }: { children: ReactNode }) {
	return <ul className="flex min-w-0 flex-col gap-0.5">{children}</ul>;
}

/**
 * The local store has not opened yet. This is **different from empty**.
 *
 * Merging the two would flash "no conversations" for a few tens of milliseconds right after
 * sign-in. The placeholder is kept small: a full-screen skeleton in a 240px column would make the
 * sidebar louder than the canvas.
 *
 * **The container and row geometry reuse the real list's** (`SidebarList` · `sidebarRowClass`).
 * Being quiet does not mean the placement may be off. An earlier version used its own margins: the
 * section was 62px tall while the three arrived rows were 100px. The sidebar is a shell present on
 * every screen, so those 38px showed up as the `All conversations` link being pushed down every time a screen
 * opened. The grey bar's height (`h-5`) comes from the row's text height (`text-sm`).
 *
 * Only the width is a guess. The room title is a value the server does not know, so it cannot be
 * invented, and a wrong width does not move the row's placement.
 */
const SIDEBAR_SKELETON_WIDTHS = ["w-full", "w-4/5", "w-2/3"];

export function SidebarRecentSkeleton() {
	return (
		<div aria-hidden="true">
			<SidebarList>
				{SIDEBAR_SKELETON_WIDTHS.map((width) => (
					<li key={width}>
						{/*
						 * The row's padding comes from `sidebarRowClass`, but that function is not
						 * called as-is: it is an **interaction** class carrying hover, focus and
						 * active states, and attaching those to a grey bar that cannot be pressed
						 * would make the placeholder look responsive. Only the two values that set
						 * placement are taken.
						 */}
						<div className="flex min-w-0 items-center px-2 py-1.5">
							<Skeleton className={`h-5 ${width}`} />
						</div>
					</li>
				))}
			</SidebarList>
		</div>
	);
}

/**
 * A single line for when the list is genuinely empty.
 *
 * No onboarding copy and no `+ New conversation` button. Rooms are acquired from works (they are created
 * carrying the playback snapshot). Adding a way to create an empty room from the sidebar would
 * change the conversation's product rules, and this pass changes only the shell.
 */
export function SidebarEmpty({ children }: { children: ReactNode }) {
	return <p className="px-2 py-1 text-xs text-muted-foreground">{children}</p>;
}
