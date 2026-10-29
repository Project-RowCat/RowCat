import type { ColorName } from "@rowcat/design";
import { iconSize } from "@rowcat/design";
import type { LucideIcon } from "lucide-react-native";
import ArrowDown from "lucide-react-native/icons/arrow-down";
import ArrowUpRight from "lucide-react-native/icons/arrow-up-right";
import Asterisk from "lucide-react-native/icons/asterisk";
import Bell from "lucide-react-native/icons/bell";
import BookOpen from "lucide-react-native/icons/book-open";
import Brain from "lucide-react-native/icons/brain";
import Bug from "lucide-react-native/icons/bug";
import Check from "lucide-react-native/icons/check";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import CircleCheck from "lucide-react-native/icons/circle-check";
import Compass from "lucide-react-native/icons/compass";
import Copy from "lucide-react-native/icons/copy";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import FileQuestionMark from "lucide-react-native/icons/file-question-mark";
import Flag from "lucide-react-native/icons/flag";
import FlaskConical from "lucide-react-native/icons/flask-conical";
import Gamepad2 from "lucide-react-native/icons/gamepad-2";
import Gavel from "lucide-react-native/icons/gavel";
import Heart from "lucide-react-native/icons/heart";
import ImageOff from "lucide-react-native/icons/image-off";
import Info from "lucide-react-native/icons/info";
import LibraryBig from "lucide-react-native/icons/library-big";
import LogIn from "lucide-react-native/icons/log-in";
import LogOut from "lucide-react-native/icons/log-out";
import Menu from "lucide-react-native/icons/menu";
import MessageCircle from "lucide-react-native/icons/message-circle";
import MessageCircleOff from "lucide-react-native/icons/message-circle-off";
import MessageSquare from "lucide-react-native/icons/message-square";
import MessagesSquare from "lucide-react-native/icons/messages-square";
import PenLine from "lucide-react-native/icons/pen-line";
import Pencil from "lucide-react-native/icons/pencil";
import Pin from "lucide-react-native/icons/pin";
import PinOff from "lucide-react-native/icons/pin-off";
import Play from "lucide-react-native/icons/play";
import Plus from "lucide-react-native/icons/plus";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import Save from "lucide-react-native/icons/save";
import Scissors from "lucide-react-native/icons/scissors";
import Search from "lucide-react-native/icons/search";
import SearchX from "lucide-react-native/icons/search-x";
import Send from "lucide-react-native/icons/send";
import Settings from "lucide-react-native/icons/settings";
import Share2 from "lucide-react-native/icons/share-2";
import ShieldBan from "lucide-react-native/icons/shield-ban";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import SlidersHorizontal from "lucide-react-native/icons/sliders-horizontal";
import Sparkles from "lucide-react-native/icons/sparkles";
import Square from "lucide-react-native/icons/square";
import Trash2 from "lucide-react-native/icons/trash-2";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import UserMinus from "lucide-react-native/icons/user-minus";
import UserPlus from "lucide-react-native/icons/user-plus";
import UserRound from "lucide-react-native/icons/user-round";
import UserRoundPlus from "lucide-react-native/icons/user-round-plus";
import UserRoundX from "lucide-react-native/icons/user-round-x";
import Wrench from "lucide-react-native/icons/wrench";
import X from "lucide-react-native/icons/x";
import { useTheme } from "./theme.tsx";

/**
 * The icon. Same icon set as the web (lucide-react there, lucide-react-native here), different
 * renderer.
 * - The earlier Feather set was similar, not the same. Icons Lucide added later were folded to
 *   the nearest Feather glyph (ImageOff, FlaskConical). That folding passes compile and tests while
 *   slowly making the two apps differ.
 * - The cost is react-native-svg, a native module. This is a build pipeline change (prebuild, pod
 *   and gradle sync), listed as an exception in boundaries.test.ts. expo-font is no longer needed,
 *   since vector icons have no first frame with empty slots.
 * - Screens pass a meaning (favorite, back, send), never a glyph name or a component. A new icon
 *   means adding a name here; that friction is intended.
 * - Metro does not tree-shake. Each icon is imported from its own path, since a barrel import
 *   bundles every icon. Only the LucideIcon type comes from the package (import type is erased).
 *   Namespace imports are worse.
 * - Without a label the icon is decorative and hidden from screen readers. A label is only needed
 *   when the icon is the sole name of its control.
 */

/**
 * The size vocabulary. It re-exports the keys of iconSize, so adding a size widens this type too.
 * Screens can pass a size name instead of numbers (the same axis as ControlSize).
 */
export type IconSize = keyof typeof iconSize;

/**
 * The semantic vocabulary is written separately from the table, so the satisfies check below
 * catches both missing and extra entries.
 */
export type IconName =
	| "account"
	| "add"
	| "back"
	| "block"
	| "chat"
	| "chat-missing"
	| "chats"
	| "check"
	| "chevron-down"
	| "chevron-up"
	| "chevron-right"
	| "close"
	| "comment"
	| "copy"
	| "create"
	| "delete"
	| "delete-from"
	| "debugger"
	| "diagnostics"
	| "discover"
	| "edit"
	| "emphasis"
	| "leave"
	| "favorite"
	| "filter"
	| "follow"
	| "follow-add"
	| "follow-remove"
	| "image"
	| "info"
	| "jump-latest"
	| "library"
	| "memory"
	| "missing"
	| "moderation"
	| "moderation-reversed"
	| "more"
	| "navigation"
	| "no-results"
	| "notifications"
	| "pin"
	| "play"
	| "playtest"
	| "playtest-settings"
	| "profile-missing"
	| "regenerate"
	| "report"
	| "retry"
	| "room-settings"
	| "runtime-conversation"
	| "runtime-settings"
	| "unblock"
	| "unpin"
	| "save"
	| "search"
	| "settings"
	| "share"
	| "sparkle"
	| "story-detail"
	| "send"
	| "sign-in"
	| "sign-out"
	| "stop"
	| "update-addition"
	| "update-improvement"
	| "update-fix"
	| "update-notice"
	| "warning";

/**
 * Maps meaning to a Lucide component. It must match the picture the web uses for the same action
 * (the usage sites are noted in the comments). If it does not, the same action looks different in
 * the two apps, and users read that as a different feature.
 */
const ICON = {
	/**
	 * The current account: the trigger of the account menu and the item that leads to the account.
	 * Web: UserRound in app-shell/app-header.tsx. It deliberately shares a body with follow
	 * (UserRoundPlus). A person-directed action and the person share one body, and the plus sign tells
	 * them apart.
	 */
	account: UserRound,
	/** Adds one more of something. Web: Plus in memory-dialog.tsx. */
	add: Plus,
	/** Removes this creator from my screen. Web: ShieldBan in block-menu.tsx. */
	block: ShieldBan,
	/**
	 * Web: ChevronLeft in story-return.tsx. Not ArrowLeft: this is going back, not a directional
	 * arrow.
	 */
	back: ChevronLeft,
	/** Starts a conversation for this work. Web: MessageCircle in story-start-control.tsx. */
	chat: MessageCircle,
	/** A conversation that does not exist. Web: MessageCircleOff in chat-page.tsx. */
	"chat-missing": MessageCircleOff,
	/**
	 * The conversation list destination: the `Chats` item in app-sidebar.tsx and the empty state of
	 * chat-library-page.tsx. Web: MessagesSquare. Different from chat (one speech bubble), because the
	 * meanings differ: chat means start a conversation with this work, chats means all my
	 * conversations. With the same picture, the `Start conversation` control on discovery and the route to the list
	 * would read as one path.
	 */
	chats: MessagesSquare,
	/** Web: Check in message-action-bar.tsx and playtest-page.tsx. */
	check: Check,
	/**
	 * A closed control that holds a list. Web: ChevronDownIcon of the ui-web SelectTrigger. Different
	 * from chevron-right (goes in), because direction is the meaning here. Right means going to
	 * another pane; down means the list opens right here.
	 */
	"chevron-down": ChevronDown,
	/**
	 * Move one row up in a list. Web: ChevronUp in lore-editor-card.tsx and
	 * start-scene-editor-card.tsx. The downward partner is chevron-down above. Different from
	 * jump-latest (ArrowDown). That is a directional cue to the end of a list, so it is an arrow; this
	 * swaps an item with its neighbor, so it is a chevron.
	 */
	"chevron-up": ChevronUp,
	/**
	 * A row that goes to another pane. Web: ChevronRight in room-settings-parts.tsx. It is the partner
	 * of back (ChevronLeft), the same chevron pointing the opposite way. Entering and leaving should
	 * be two poses of one picture, so the list and the header read as one story.
	 */
	"chevron-right": ChevronRight,
	/** Closes the window. Web: XIcon in dialog.tsx. */
	close: X,
	/**
	 * A row that leaves the current section. Web: ArrowUpRight in settings-navigation.tsx, which goes
	 * out of settings to account management. Different from chevron-right (goes into a child).
	 * Direction is the meaning: the chevron moves down into the list's children, and the diagonal
	 * arrow moves out of the list. With the same picture, the settings categories and the account
	 * screen would look like one level, and the reason this row sits outside the list would disappear.
	 */
	leave: ArrowUpRight,
	/**
	 * A comment event: someone commented on my work. Web: MessageSquare in notification-row.tsx.
	 * Different from chat and chats, because the meaning differs. This marks that someone wrote on my
	 * work.
	 */
	comment: MessageSquare,
	/** Web: Copy in message-action-bar.tsx. */
	copy: Copy,
	/**
	 * Creation: the `Create` destination in the drawer. Web: PenLine in app-sidebar.tsx. Different from
	 * edit (Pencil), on purpose. edit changes something that already exists, so it attaches to rows
	 * and windows (editing a message, renaming). create is the destination for writing something new.
	 * With the same picture, the drawer's third row would look like the edit button on a conversation
	 * row, and both can appear on the same screen.
	 */
	create: PenLine,
	/** Web: Trash2 in draft-list.tsx and lore-list.tsx. */
	delete: Trash2,
	/**
	 * Delete from here: cuts the tail off. Web: Scissors in message-action-bar.tsx. Different from
	 * delete (trash), because delete discards one target while this cuts off everything from here on.
	 * With the same picture, users would think only the chosen message disappears.
	 */
	"delete-from": Scissors,
	/**
	 * Development diagnostics entry. The web uses the same picture for playtest
	 * (start-playtest-button.tsx), with the same meaning of 'lab'. Feather had a wrench (tool) here.
	 * The app now also has playtest, the entry below. One glyph under two names is intentional,
	 * because this table records meanings: merging the names would change the creator's playtest
	 * button whenever the diagnostics entry changes. The two places do not know about each other, and
	 * this one renders only in __DEV__.
	 */
	/**
	 * Opens the debugger for playtests. The web's same button uses this glyph (Bug). Different from
	 * playtest-settings, which asks how the next response is generated; this asks why the response
	 * just generated came out that way. With one picture, people who opened the conditions to change
	 * them would page through records every time. Different from diagnostics as well: that is this
	 * app's development entry (rendered only in __DEV__), while this one is the creator's tool.
	 */
	debugger: Bug,
	diagnostics: FlaskConical,
	/** Discover destination. Web: the `Discover` item in app-sidebar.tsx. */
	discover: Compass,
	/**
	 * Edit. The web uses the same picture in three places: editing a message (message-action-bar.tsx),
	 * renaming (room-context-actions.tsx) and memory-dialog.tsx's Pencil.
	 */
	edit: Pencil,
	/**
	 * A mark that wraps non-speech (action, description, aside). Web: Asterisk in chat-composer.tsx.
	 * The name is not 'asterisk' on purpose. The asterisk is the character that writes this mark, and
	 * its value belongs to @rowcat/chat. This package knows only the meaning of the action.
	 */
	emphasis: Asterisk,
	/** Favorite. Web: Heart in favorite-control.tsx. The on state is filled by `filled` below. */
	favorite: Heart,
	/** Web: SlidersHorizontal in chat-header-context.tsx. */
	filter: SlidersHorizontal,
	/** Empty state with no creators to follow. Web: UserRoundPlus in gallery-empty.tsx. */
	follow: UserRoundPlus,
	/**
	 * The follow action (not the empty state). Web: UserPlus in follow-button.tsx. Different from
	 * follow above, on purpose. The web uses different glyphs in the two spots: a rounded head for the
	 * empty state and an angular head for the button. Folding them to the nearest match would make the
	 * same screen differ slightly between the apps, which is why there are two names.
	 */
	"follow-add": UserPlus,
	/** Unfollow. Web: UserMinus in follow-button.tsx. */
	"follow-remove": UserMinus,
	/**
	 * Placeholder for a missing cover. Web: ImageOff in story-card-body.tsx. Feather had no 'off'
	 * variant, so this used to fold to a normal-looking picture. Fixing that folding is what this
	 * migration did.
	 */
	image: ImageOff,
	/** Web: Info in playtest-page.tsx. */
	info: Info,
	/**
	 * Jump back to the latest message. Web: ArrowDown in message-list.tsx. This is the case where back
	 * (ChevronLeft) differs. back is movement, so it is a chevron; this is a directional cue to the
	 * end of the current list, so it is an arrow.
	 */
	"jump-latest": ArrowDown,
	/**
	 * Empty state for a library with no works yet. Web: LibraryBig in gallery-empty.tsx and
	 * profile-empty.tsx.
	 */
	library: LibraryBig,
	/**
	 * Conversation memory. The web has no counterpart: it uses a text button in the settings window,
	 * with no picture. It is needed here because each row of the sheet is a picture plus a label; with
	 * an empty picture this row would read as a different kind of row. When the web gains a picture
	 * for this action, the web follows this value, not the reverse. The first chosen value is the
	 * baseline.
	 */
	memory: Brain,
	/**
	 * A work that cannot be found. Web: FileQuestion in story-detail-error.tsx. Only the name differs.
	 * Lucide 1.x made FileQuestionMark the official name; the web's FileQuestion is an alias of it, so
	 * it is the same picture (like more and MoreHorizontal). When the web's lucide-react moves to 1.x,
	 * its name will follow this one.
	 */
	missing: FileQuestionMark,
	/** An operational action applied to an account. Web: Gavel in notification-row.tsx. */
	moderation: Gavel,
	/**
	 * Lifting an operational action. Web: ShieldCheck in notification-row.tsx. It is the same picture
	 * as unblock, which is allowed: two meanings get two names, as filter and room-settings do. With
	 * one name, changing the unblock picture would also change the moderation-lift notification's
	 * picture.
	 */
	"moderation-reversed": ShieldCheck,
	/**
	 * The overflow menu. The web calls it MoreHorizontal, an alias of this component (Ellipsis in
	 * Lucide 1.x), so it is the same picture.
	 */
	more: Ellipsis,
	/**
	 * The trigger that opens global navigation. Web: Menu, used by the drawer trigger in
	 * app-sidebar.tsx. The name is `navigation`, not `menu`, on purpose. The table holds meanings, not
	 * pictures, and the meaning here is 'where you can go opens', not 'a menu opens'. With the name
	 * menu, a trigger for a dropdown of actions (DropdownMenu) could later claim the same name, and
	 * two meanings would share one name.
	 */
	navigation: Menu,
	/**
	 * An empty state for no matches. Web: SearchX in gallery-empty.tsx. Different from search
	 * (magnifier), because the meanings are opposite: search says look; no-results says the search was
	 * done and found nothing.
	 */
	"no-results": SearchX,
	/**
	 * Received notifications, shown as a bell. Web: Bell in notification-bell.tsx; the default marker
	 * in notification-row.tsx is the same picture.
	 */
	notifications: Bell,
	/** A pinned memory. Web: Pin in memory-dialog.tsx. */
	pin: Pin,
	/**
	 * Runs a published runtime work; this is the main action on the work detail. Web: Play in
	 * story-start-control.tsx. Different from playtest below: that runs an unpublished draft, while
	 * this is where a player opens a published work. Without this value the mobile button showed chat
	 * there. For a runtime work, a speech bubble promises something different from what pressing it
	 * opens. The web had already separated them, and no test caught the mismatch between the apps.
	 */
	play: Play,
	/**
	 * Playtest of a work: runs a draft without publishing. Web: FlaskConical in
	 * start-playtest-button.tsx. Same glyph as diagnostics, different meaning.
	 */
	playtest: FlaskConical,
	/**
	 * Opens the playtest conditions. Same picture as room-settings, on purpose: the two answer the
	 * same question, which is how this conversation is generated. The gear is not used because it
	 * means app-wide settings.
	 */
	"playtest-settings": SlidersHorizontal,
	/**
	 * A person who cannot be seen. Web: UserRoundX in profile-error.tsx. Kept apart from missing (a
	 * work) because nothing else shares this picture; a missing document and a missing person cannot
	 * share one picture.
	 */
	"profile-missing": UserRoundX,
	/** Regenerate starting from this answer. Web: RefreshCw in message-action-bar.tsx. */
	regenerate: RefreshCw,
	/** Report an AI response. Web: Flag in message-action-bar.tsx and report-menu.tsx. */
	report: Flag,
	/** Web: RotateCcw in gallery-toolbar.tsx. */
	retry: RotateCcw,
	/**
	 * This conversation's settings. Web: SlidersHorizontal in chat-header-context.tsx and
	 * room-context-actions.tsx, the same picture. Same component as filter, but the names are separate
	 * because of what the table answers: it records which picture a meaning gets, and when meanings
	 * differ their names must differ. With one name, changing the discovery filter icon would also
	 * change the conversation-settings icon, and that coupling is invisible in code. The web picked
	 * this glyph to avoid the gear, which means app-wide settings. Two gears on one line is the
	 * pattern to avoid, and this app inherits that choice.
	 */
	"room-settings": SlidersHorizontal,
	/**
	 * The runtime row marker in the library: `/chats` and the recent conversations in the drawer. Web:
	 * Gamepad2 in runtime-conversation-rows.tsx. Before this name existed, the row borrowed playtest
	 * (the flask). That picture belongs to the draft editor's `Story test`, so a playthrough of a
	 * published work looked like a pre-publish test room. Web and mobile also drew the same row
	 * differently.
	 */
	"runtime-conversation": Gamepad2,
	/**
	 * Opens the generation settings for a runtime playthrough. Same picture as room-settings and
	 * playtest-settings, because the three answer the same question: how this is generated. The web's
	 * runtime-chat-header-context.tsx uses the same glyph. The name is still separate, because three
	 * meanings need three names. Using room-settings here would make a screen that is not a room take
	 * the room's vocabulary, and the slice's rule is exactly that a runtime playthrough is not a
	 * conversation.
	 */
	"runtime-settings": SlidersHorizontal,
	/**
	 * Explicit save: the nickname and bio on the account screen have this action. Web: the SaveLabel
	 * in profile-section.tsx uses the same glyph, and on success it becomes check. Not merged with
	 * check, since they mean different things: save is an action to take, check is the fact that it is
	 * done.
	 */
	save: Save,
	/** Web: Search in gallery-toolbar.tsx. */
	search: Search,
	/**
	 * App-wide settings: the gear in the header's utility row. Web: Settings, used by SettingsAction
	 * in app-shell/app-header.tsx. Deliberately different from room-settings (SlidersHorizontal). In a
	 * conversation both sit on the same row (room settings beside the title, global settings at the
	 * far right), and two identical gears side by side would make it unclear which one belongs to this
	 * room. The web separates the two glyphs at the same spot for the same reason.
	 */
	settings: Settings,
	/**
	 * Share this work's address outward. The web has no counterpart: browsers have an address bar,
	 * which is already the shared surface. Native apps have no such bar, so the app must open the OS
	 * share sheet, and this picture came with an action that did not exist before
	 * (apps/mobile/src/features/story/share-story.ts). Share2 (dots joined by lines) was chosen
	 * because it reads as 'share' on both platforms. Share (an arrow leaving a box) is nearly the iOS
	 * system glyph, so our icon would look like the OS's.
	 */
	share: Share2,
	/** Web: Send in chat-composer.tsx. */
	send: Send,
	/** The marker for an automatically created memory. Web: Sparkles in memory-dialog.tsx. */
	sparkle: Sparkles,
	/**
	 * Goes to the work detail; first line of the runtime playthrough's header overflow. Web: BookOpen
	 * in runtime-chat-header-context.tsx. Not info (the circled i), because that picture means expand
	 * an explanation. Here the action moves to another screen, and folding the two into one picture
	 * would make the user expect an explanation and leave the screen instead.
	 */
	"story-detail": BookOpen,
	/** Web: LogIn in app-header.tsx. */
	"sign-in": LogIn,
	/** Web: LogOut in app-header.tsx. */
	"sign-out": LogOut,
	/**
	 * Stop generation. Web: Square in chat-composer.tsx. It has the same shape as a media stop symbol.
	 */
	stop: Square,
	/** Unblock. Web: ShieldCheck in block-menu.tsx. */
	unblock: ShieldCheck,
	/** Unpin. Web: PinOff in memory-dialog.tsx. */
	unpin: PinOff,
	/*
	 * The four sections of the update note. The count is the point.
	 * - The order is the note's section order, not alphabetical. The four are one family, and their
	 *   order comes from UPDATE_NOTE_SECTION_ORDER in @rowcat/domain. The screen does not decide the
	 *   order; this table only decides which picture each meaning gets.
	 * - Two reuse existing pictures (sparkle, warning), which is allowed for the same reason as
	 *   above.
	 * - Emoji are not put back into the section labels. The labels once contained emoji, and the
	 *   device's emoji font drew them, so the same release looked different on each platform. Emoji
	 *   now appear only in text sent to Discord.
	 */
	/** Something new the user can now do. Web: Sparkles in update-note-dialog.tsx. */
	"update-addition": Sparkles,
	/** Something that already existed and got better. Web: CircleCheck in update-note-dialog.tsx. */
	"update-improvement": CircleCheck,
	/** A broken thing was fixed. Web: Wrench in update-note-dialog.tsx. */
	"update-fix": Wrench,
	/** A fact the reader must know. Web: TriangleAlert in update-note-dialog.tsx. */
	"update-notice": TriangleAlert,
	/** Web: TriangleAlert in gallery-error.tsx. */
	warning: TriangleAlert,
} satisfies Record<IconName, LucideIcon>;

/**
 * The stroke width: Lucide's default, one value. Screens do not choose it. If it varied by spot,
 * same-size icons would read at different weights, and that difference would be read as a
 * difference in importance. Feather also used 2, so the migration did not change the weight.
 */
const STROKE_WIDTH = 2;

/**
 * Icons that can be filled. Not every icon can be filled: a filled Search or ChevronLeft is a
 * blotch with no meaning, and if every icon could be filled, someone would eventually use fill for
 * emphasis. Only the heart's fill has a meaning right now: saved versus not saved, the same as the
 * web's fill-current.
 */
const FILLABLE = new Set<IconName>(["favorite"]);

export function Icon({
	name,
	size = "md",
	tone = "foreground",
	filled = false,
	label,
}: {
	name: IconName;
	size?: keyof typeof iconSize;
	tone?: ColorName;
	/**
	 * Fills the inside. For icons not in FILLABLE this is ignored, because those pictures have no
	 * meaning for a fill. This is visual feedback, not a representation of state. On/off state is
	 * stated by the enclosing control's accessibilityState.selected, and that axis must hold
	 * regardless of this value.
	 */
	filled?: boolean;
	/**
	 * Makes the icon a named image when a label is given. Without a label it is hidden from screen
	 * readers as decoration.
	 */
	label?: string;
}) {
	const { colors } = useTheme();
	const Glyph = ICON[name];
	const ink = colors[tone];

	return (
		<Glyph
			size={iconSize[size]}
			color={ink}
			strokeWidth={STROKE_WIDTH}
			fill={filled && FILLABLE.has(name) ? ink : "none"}
			accessible={label !== undefined}
			accessibilityRole={label === undefined ? undefined : "image"}
			accessibilityLabel={label}
			accessibilityElementsHidden={label === undefined}
			importantForAccessibility={
				label === undefined ? "no-hide-descendants" : "yes"
			}
		/>
	);
}
