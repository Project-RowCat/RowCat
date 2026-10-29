import type { MobileAppSection } from "./shell-route.ts";

/**
 * The drawer's **copy** — the rules are not here.
 *
 * Which rows are drawn is decided by `recentSidebarRooms` in `@rowcat/chat`, and **web calls the
 * same function.** The Korean text does not go into that package because the rules would be tied to
 * a locale. That boundary is the one this repository has recorded several times
 * (`room-library-copy.ts`, `room-settings-ia.ts`).
 *
 * **`Record<MobileAppSection, string>` is what this file actually enforces.** When a destination is
 * added (the day the create screen arrived), this table breaks at compile time first, so a
 * vocabulary value with no copy cannot exist.
 *
 * The words below are the same as web's sidebar (`app-sidebar.tsx`). If the same place said
 * different words in the two apps, users would read them as different features.
 */

/** The drawer's accessible name. Same word as web's `nav aria-label`. */
export const SIDEBAR_TITLE = "Main navigation";

/**
 * The trigger's name — it says **what opens**, not `Menu`.
 *
 * To a user who cannot see the screen, "menu" does not say what will open. Web's same trigger uses
 * the same sentence.
 */
export const SIDEBAR_TRIGGER_LABEL = "Open main navigation";

export const SIDEBAR_SECTION_LABEL: Record<MobileAppSection, string> = {
	discover: "Discover",
	chat: "Conversations",
	create: "Create",
};

/** A quiet label. It must look like it is not something to press. */
export const SIDEBAR_RECENT_HEADING = "Recent conversations";

/**
 * The line between quick resume and **management**.
 *
 * The list above is cut to the most recent few, and its rows show only titles. Finding, sorting,
 * renaming and deleting all happen in `/chats`; this row says so. Without it the drawer would
 * pretend to be "all my conversations", and every row would start pressuring for a menu.
 */
export const SIDEBAR_ALL_CHATS = "All conversations";

/**
 * The single line for when there really are none.
 *
 * No `+ New conversation` button: a room is created from a work with its playback snapshot, so an empty room
 * does not exist, and putting that button here would change the product rule for conversations. No
 * onboarding card either — the drawer is not an empty-state screen.
 */
export const SIDEBAR_RECENT_EMPTY = "No conversations yet";

/**
 * The store could not be opened — **a quiet single line.**
 *
 * No retry button here. A failure in this section must not block the drawer's global navigation
 * (that navigation does not touch SQLite), and recovery belongs to the screen that uses that store
 * (`/chats`'s `Try again`). If the drawer started acting as a recovery screen, this cell would soon
 * hold its own state.
 */
export const SIDEBAR_RECENT_ERROR = "Couldn't load conversations";
