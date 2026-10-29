import { iconSize, radiusScale, space } from "@rowcat/design";
import { APP_NAME } from "@rowcat/domain";
import {
	controlHeight,
	Icon,
	type IconName,
	NavigationDrawer,
	Spinner,
	Text,
	useTheme,
} from "@rowcat/ui-native";
import { usePathname, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import {
	MotionIndicatorGroup,
	MotionIndicatorItem,
} from "../../lib/motion/active-indicator.tsx";
import { runtimeConversationTitle } from "../chat-library/runtime-conversation-copy.ts";
import { type MobileAppSection, mobileShellRouteFor } from "./shell-route.ts";
import {
	SIDEBAR_ALL_CHATS,
	SIDEBAR_RECENT_EMPTY,
	SIDEBAR_RECENT_ERROR,
	SIDEBAR_RECENT_HEADING,
	SIDEBAR_SECTION_LABEL,
	SIDEBAR_TITLE,
	SIDEBAR_TRIGGER_LABEL,
} from "./sidebar-copy.ts";
import { useRecentRooms } from "./use-recent-rooms.ts";
import { Wordmark } from "./wordmark.tsx";

/**
 * App sidebar: **global destinations plus resuming recent conversations. Only those two.**
 *
 * Same placement, IA, and boundary as the web `app-sidebar.tsx`. Only the container differs: on the
 * web it is a fixed column on wide screens, and here it is always a panel that opens from the left.
 *
 * ```text
 * RowCat
 *
 * `Discover` · `Conversations` · `Create`
 *
 * `Recent conversations`
 *   room …
 * `All conversations`
 * ```
 *
 * ## Destinations are now three, as on the web
 *
 * `Create` was absent for a while not because it differs from the web, but because **this app had no
 * such screen.** That premise is gone: `/create` exists and opens without a network. The vocabulary
 * (`MobileAppSection`), the labels (`SIDEBAR_SECTION_LABEL`), and the table below grew
 * **together**. The type ties them, so adding to only one of them breaks compilation.
 *
 * **There are still no recent drafts.** Not added to mirror the other axis: conversation is an
 * activity resumed several times a day, so a resume shortcut earns its place; drafting is entered
 * from its own workspace and stayed in for a long time. The web made the same call.
 *
 * ## What this file actually defends is the boundary, not the list
 *
 * Once a panel exists on the left it becomes "leftover space", and leftover space fills with
 * settings, theme, notifications, account, sign-out, and diagnostics in turn. The web already
 * documented where that ends: the sidebar becomes the app, and the canvas becomes one cell inside
 * it. So what lives here is **one fixed IA**, with no slot that accepts arbitrary widgets.
 *
 * Identity utilities (login, nickname, sign-out, session check, device-data notices) **stay in the
 * header** (`app-header.tsx`). They do not move just because space appears. The web separated them
 * too, on the basis of their nature: navigation is "where can I go", and those are "who am I now".
 *
 * ## Recent conversations are a switcher, not a list screen
 *
 * Each row draws only a title. Rename, delete, settings, pin, archive, search, sort, and preview
 * all belong to `/chats`, and `All conversations` is that boundary. If the boundary blurs, a 280pt panel gets
 * rebuilt as a conversation list screen, and that screen already exists separately.
 *
 * **There are no recent drafts.** Not made to mirror: the web made the same call, and the app has
 * no draft concept at all.
 */

/**
 * The trigger that sits in the header, and the panel it opens: **one component.**
 *
 * Two reasons not to split the trigger from the panel, with the screen drawing the button and this
 * file taking only `open`. First, state lifetime: open state should live only as long as this
 * element; lifted to a shell-wide scope, nothing clearly closes it. Second, **accessibility focus
 * restore**: the primitive's trigger returns focus to itself on close, and that wiring is attached
 * only when the trigger sits in the same tree as the drawer (see `NavigationDrawer`'s header).
 *
 * **Current location is answered by the route.** There is no shadow state such as
 * `selectedSection`, and the screen does not pass it down: passing it would force every new screen
 * to repeat that wiring, and missing one would silently turn off the highlight on that screen
 * alone. The decision belongs to one pure function (`shell-route.ts`).
 */
export function AppSidebarTrigger() {
	const pathname = usePathname();
	const [open, setOpen] = useState(false);
	const route = useMemo(() => mobileShellRouteFor(pathname), [pathname]);
	const close = useCallback(() => setOpen(false), []);

	return (
		<NavigationDrawer
			title={SIDEBAR_TITLE}
			triggerLabel={SIDEBAR_TRIGGER_LABEL}
			open={open}
			onOpenChange={setOpen}
		>
			{/**
			 * The content is a **component**, and that is the point. While the drawer is closed, the primitive does
			 * not mount this tree, so local store subscriptions live only while it is open. Expanding the hook
			 * directly here would make every screen that draws the trigger subscribe to the room list.
			 */}
			<AppSidebarContent
				section={route.section}
				activeRoomId={route.activeRoomId}
				activeRuntimeStoryId={route.activeRuntimeStoryId}
				onNavigate={close}
			/>
		</NavigationDrawer>
	);
}

function AppSidebarContent({
	section,
	activeRoomId,
	activeRuntimeStoryId,
	onNavigate,
}: {
	section: MobileAppSection | null;
	activeRoomId: string | null;
	activeRuntimeStoryId: string | null;
	onNavigate: () => void;
}) {
	return (
		<View style={sidebar.root}>
			<SidebarBrand onNavigate={onNavigate} />
			<SidebarPrimaryNav section={section} onNavigate={onNavigate} />
			<RecentChatSection
				activeRoomId={activeRoomId}
				activeRuntimeStoryId={activeRuntimeStoryId}
				onNavigate={onNavigate}
			/>
		</View>
	);
}

/**
 * Brand, which also leads to discover.
 *
 * Deliberately **shaped differently** from the navigation rows. In the same form it would read as a
 * third row beside `Discover`, although the two go to the same place. The web sidebar made the same call.
 *
 * The target is 44pt: a line of text is shorter, and that shortfall is invisible.
 */
function SidebarBrand({ onNavigate }: { onNavigate: () => void }) {
	const router = useRouter();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={APP_NAME}
			accessibilityHint="Goes to Discover"
			onPress={() => {
				onNavigate();
				router.navigate("/");
			}}
			style={sidebar.brand}
		>
			<Wordmark />
		</Pressable>
	);
}

/**
 * Global destinations: **list only what can actually be reached now.**
 *
 * `router.navigate` is the point. `push` would stack a layer on every `Discover` press in the drawer, so
 * Back would pass the same screen many times. `replace` would leave nothing to return to after
 * moving from a work detail to discover via the drawer. `navigate` returns to that destination if
 * it is already on the stack, which is what global navigation actually does.
 */
const SECTIONS: { section: MobileAppSection; icon: IconName; to: string }[] = [
	{ section: "discover", icon: "discover", to: "/" },
	{ section: "chat", icon: "chats", to: "/chats" },
	{ section: "create", icon: "create", to: "/create" },
];

function SidebarPrimaryNav({
	section,
	onNavigate,
}: {
	section: MobileAppSection | null;
	onNavigate: () => void;
}) {
	const router = useRouter();
	const { colors } = useTheme();
	return (
		/**
		 * The active background is **one indicator that moves between siblings**
		 * (`lib/motion/active-indicator.tsx`). If each row turned its own background on and off, the same
		 * change (moving to another section) would appear to fade out in one place and fade in in
		 * another. The web's same sidebar already moves a single marker.
		 *
		 * **The name space is separated by structure.** On the web, `layoutId` strings are needed so that
		 * the global-navigation marker and the recent-chat marker do not fly across the sidebar. Those
		 * two are supposed to be lit at the same time, so here the two containers simply hold different
		 * markers.
		 */
		<MotionIndicatorGroup
			activeKey={section}
			indicatorStyle={[sidebar.marker, { backgroundColor: colors.accent }]}
			style={sidebar.group}
		>
			{SECTIONS.map((item) => (
				<MotionIndicatorItem key={item.to} itemKey={item.section}>
					<SidebarRow
						label={SIDEBAR_SECTION_LABEL[item.section]}
						icon={item.icon}
						active={item.section === section}
						onPress={() => {
							onNavigate();
							router.navigate(item.to);
						}}
					/>
				</MotionIndicatorItem>
			))}
		</MotionIndicatorGroup>
	);
}

/**
 * The recent-conversations section.
 *
 * **Guests have no section at all** (`sidebar-state.ts`). A placeholder would have no storage to
 * open and would never finish loading, and the path to conversations is already the global
 * navigation above.
 */
function RecentChatSection({
	activeRoomId,
	activeRuntimeStoryId,
	onNavigate,
}: {
	activeRoomId: string | null;
	activeRuntimeStoryId: string | null;
	onNavigate: () => void;
}) {
	const router = useRouter();
	const { colors } = useTheme();
	const { entries, activeEntryId, state } = useRecentRooms({
		activeRoomId,
		activeRuntimeStoryId,
	});

	if (state.kind === "hidden") return null;

	return (
		<MotionIndicatorGroup
			activeKey={activeEntryId}
			indicatorStyle={[sidebar.marker, { backgroundColor: colors.accent }]}
			style={sidebar.group}
		>
			{/* A quiet label rather than a navigation item: the look itself says it is not pressable. */}
			<Text
				accessibilityRole="header"
				variant="caption"
				tone="muted-foreground"
				style={sidebar.heading}
			>
				{SIDEBAR_RECENT_HEADING}
			</Text>

			{state.kind === "loading" ? (
				<View style={sidebar.quiet}>
					<Spinner />
				</View>
			) : null}

			{/**
			 * Failure and empty are **different facts**, and both are a single quiet line. The reason this does not
			 * place an error box or a retry button here is that this section failing must leave the global
			 * navigation above usable. Recovery belongs to the screen that actually uses that store (`/chats`).
			 */}
			{state.kind === "error" || state.kind === "empty" ? (
				<Text variant="caption" tone="muted-foreground" style={sidebar.quiet}>
					{state.kind === "error" ? SIDEBAR_RECENT_ERROR : SIDEBAR_RECENT_EMPTY}
				</Text>
			) : null}

			{/**
			 * The two kinds form **one list** (merged in `@rowcat/domain`, which the web also calls). A runtime row
			 * is not a room: its destination is `/chat/runtime/:storyId`, and a small marker says so. Drawer rows
			 * carry no actions of either kind. Management belongs to `/chats` (including `Remove from list` for
			 * runtime rows).
			 */}
			{state.kind === "rooms"
				? entries.map((entry) => (
						<MotionIndicatorItem key={entry.id} itemKey={entry.id}>
							{entry.kind === "chat" ? (
								<SidebarRow
									label={entry.title}
									active={entry.id === activeEntryId}
									onPress={() => {
										onNavigate();
										router.navigate(`/chat/${encodeURIComponent(entry.id)}`);
									}}
								/>
							) : (
								<SidebarRow
									label={runtimeConversationTitle(entry.title)}
									icon="runtime-conversation"
									active={entry.id === activeEntryId}
									onPress={() => {
										onNavigate();
										router.navigate(
											`/chat/runtime/${encodeURIComponent(entry.storyId)}`,
										);
									}}
								/>
							)}
						</MotionIndicatorItem>
					))
				: null}

			{/**
			 * The boundary between quick resume and **management**. The list above is cut to a few recent items,
			 * with titles only, and this row says where finding, sorting, renaming, and deleting live. Without it,
			 * the drawer would pretend to be "all my conversations", and from then on there would be pressure to
			 * attach a menu to every row.
			 *
			 * It has the same destination as the global `Conversations` item. The difference is hierarchy: that one is the
			 * entrance to a product section, while this one is the "all" link at the end of this list. So it does
			 * not turn the highlight on (the section's active state is already stated by the row above).
			 */}
			<SidebarRow
				label={SIDEBAR_ALL_CHATS}
				icon="library"
				muted
				active={false}
				onPress={() => {
					onNavigate();
					router.navigate("/chats");
				}}
			/>
		</MotionIndicatorGroup>
	);
}

/**
 * One row, shared by global destinations and recent conversations.
 *
 * The current location is marked **quietly**: a background layer and a font weight. Color does not
 * carry the meaning. `accessibilityState.selected` does, and for people who cannot tell colors
 * apart, the weight does.
 *
 * The **title is included in the name.** Truncation is the screen's concern; to a user who does not
 * see the screen, this list must not become ten unlabeled buttons.
 */
function SidebarRow({
	label,
	icon,
	active,
	muted,
	onPress,
}: {
	label: string;
	icon?: IconName;
	active: boolean;
	/** The "all" link at the end of the list; one step quieter than the rows above it. */
	muted?: boolean;
	onPress: () => void;
}) {
	const { colors } = useTheme();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{ selected: active }}
			onPress={onPress}
			/**
			 * **The active background is not here.** It is one indicator that moves between siblings
			 * (`MotionIndicatorGroup`). What stays in this row is a signal that survives if motion fails:
			 * `accessibilityState.selected`, plus the font weight and color. The web's same row has the same
			 * boundary.
			 */
			style={({ pressed }) => [
				sidebar.row,
				pressed && !active && { backgroundColor: colors.muted },
			]}
		>
			{icon ? (
				<Icon
					name={icon}
					size="md"
					tone={active ? "accent-foreground" : "muted-foreground"}
				/>
			) : (
				/** Rows without an icon start at the same position, so recent chats do not look ragged. */
				<View style={sidebar.iconSlot} />
			)}
			<Text
				variant="label"
				weight={active ? "semibold" : "regular"}
				tone={
					active
						? "accent-foreground"
						: muted
							? "muted-foreground"
							: "foreground"
				}
				numberOfLines={1}
				style={sidebar.rowLabel}
			>
				{label}
			</Text>
		</Pressable>
	);
}

const sidebar = StyleSheet.create({
	root: { gap: space.lg },
	/** Same place as the web's brand line (`px-2 text-lg font-black`). Height is set by the text. */
	brand: {
		justifyContent: "center",
		minHeight: controlHeight.sm,
		paddingHorizontal: space.sm,
	},
	/** Hierarchy between sections comes from spacing, not dividers. A border on each row would turn it into a stack of cards. */
	group: { gap: space.px },
	heading: { paddingBottom: space.xs, paddingHorizontal: space.sm },
	/**
	 * Same 32·8·8 as the web's row (`px-2 py-1.5 text-sm gap-2 rounded-md`).
	 *
	 * ⚠️ It was 44 for a while, and that value was the floor for targets. The fact that rows touch
	 * with 1pt gaps, so `hitSlop` cannot widen them, still holds (hence no slack here). But **being
	 * unable to widen them is not a reason to make them taller than the web**: the same list on the
	 * app alone at 37% taller would take half the screen for one drawer, while the product itself
	 * renders 32-tall rows in a browser of the same width. Horizontally the row spans the full drawer
	 * width, so what is lost is one vertical axis, not area.
	 */
	row: {
		alignItems: "center",
		borderRadius: radiusScale.md,
		flexDirection: "row",
		gap: space.sm,
		minHeight: controlHeight.sm,
		paddingHorizontal: space.sm,
	},
	/**
	 * Rows with and without an icon start at the **same position**.
	 *
	 * Recent-chat rows have no icon, since a title is all of that list. Leaving the space empty would
	 * offset the global row text and the recent-chat text by 16pt, and that offset would make the two
	 * sections read as different lists. The value is the icon box's own size, not a hand-written
	 * number.
	 */
	iconSlot: { width: iconSize.md },
	/** Look of the moving active background. Its position and size come from measured values. */
	marker: { borderRadius: radiusScale.md },
	rowLabel: { flex: 1, minWidth: 0 },
	quiet: { paddingHorizontal: space.sm, paddingVertical: space.sm },
});
