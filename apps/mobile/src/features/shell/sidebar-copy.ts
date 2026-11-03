import { deferredGroup } from "../../lib/i18n/instance.ts";
import type { MobileAppSection } from "./shell-route.ts";

/**
 * The drawer's **copy** — the rules are not here.
 *
 * Which rows are drawn is decided by `recentSidebarRooms` in `@rowcat/chat`, and **web calls the
 * same function.** The words do not go into that package because the rules would be tied to a
 * locale; they live in the dictionaries (`shell.section`, `shell.sidebar`) and these tables read
 * them in the current language. That boundary is the one this repository has recorded several times
 * (`room-library-copy.ts`, `room-settings-ia.ts`).
 *
 * **`Record<MobileAppSection, string>` is what this file actually enforces.** When a destination is
 * added (the day the create screen arrived), this table breaks at compile time first, so a
 * vocabulary value with no copy cannot exist.
 *
 * The words below are the same as web's sidebar (`app-sidebar.tsx`). If the same place said
 * different words in the two apps, users would read them as different features.
 */

/**
 * The drawer's names: its accessible name and trigger (the trigger says **what opens**, not `Menu`,
 * matching the web's), the quiet `Recent conversations` heading, `All conversations` as the line
 * between quick resume and management (finding, sorting, renaming and deleting happen in `/chats`),
 * and the two single lines for no rooms and a store that could not open — neither carries a
 * `+ New conversation` button or a retry: a room is created from a work, and recovery belongs to
 * `/chats`.
 */
export const SIDEBAR_COPY = deferredGroup("shell", "sidebar");

export const SIDEBAR_SECTION_LABEL: Record<MobileAppSection, string> =
	deferredGroup("shell", "section");
