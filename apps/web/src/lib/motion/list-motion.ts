import { ROW_ENTER_Y } from "@rowcat/design";
import type { Transition } from "motion/react";
import {
	enterTransition,
	exitTransition,
	layoutTransition,
} from "./transitions.ts";

/**
 * Only the rhythm for rows with identity is collected here. Choreography belongs to each list.
 *
 * This file holds three values: how a new row enters, how a removed row exits, and how the
 * remaining rows glide to their new place. There is no shared AnimatedEntityLibrary component on
 * purpose. Such a component would also take rendering, empty states, sorting, movement and
 * management menus. Chats and drafts look alike but follow different product rules, so they should
 * not share one component.
 *
 * The values are shared by the conversation, draft, editor child, comment and recent-chat sidebar
 * lists, and now also sessions, passkeys, personas, memory, gallery filter tokens and
 * published-work operations. Each list choosing its own y (6 or 4) would make the same action move
 * by a different distance.
 *
 * The sidebar was the test. A conversation can be deleted from three places (the /chats row menu,
 * the header's conversation settings, the sidebar row), all using one operation
 * (useRoomManagement). If the sidebar row vanished silently, the same action would look different
 * depending on where it was pressed.
 */

/**
 * Vertical offset (px) for a row entering. The value comes from @rowcat/design (same place as
 * page-enter.ts). Re-exported, so this file's public shape is unchanged.
 */
export { ROW_ENTER_Y };

/**
 * One transition for entering and re-layout. Motion applies a transition to every animation on an
 * element, so setting only the enter curve would make layout moves use it too. The two are
 * different axes with different curves. Entering starts fast and settles slowly, because the eye
 * has to follow it. Moving to a new place has soft ends on both sides, because the user was already
 * watching it.
 */
const rowTransition: Transition = {
	...enterTransition,
	layout: layoutTransition,
};

/**
 * New row.
 *
 * The list's AnimatePresence initial={false} skips initial on the first render, so rows that exist
 * when the list opens do not animate in. Only rows created later, brought in by sync, or revealed
 * by `Show more` (load more) animate in. Used by the conversation list, draft list and recent-chat
 * sidebar.
 *
 * Editor child cards (characters, lore, opening scene) do not use this entrance. In that presence,
 * a card moving down during a reorder hits initial again, so a card that only changed position
 * looks as if it reappeared. That screen chose object permanence because reordering is a real
 * operation there (see features/create/editor/sections/lore-list.tsx).
 */
export const rowEnter = {
	initial: { opacity: 0, y: ROW_ENTER_Y },
	animate: { opacity: 1, y: 0 },
	transition: rowTransition,
} as const;

/**
 * Removed row. Shared by all lists, editor cards included.
 *
 * No movement. A leaving row that moves would flow with the siblings that refill its place, and the
 * directions would mix, blurring what disappeared and what moved. The exit fades; the gap filler
 * moves.
 *
 * Press blocking is not here. pointerEvents: "none" once sat on this target, but that value applies
 * only when the animation starts. In a tab where frames do not arrive it never applies, and that is
 * exactly when a leaving row stays longest. The guard must sit on presence state, via
 * useExitGuard() in exit-guard.ts.
 */
export const rowExit = {
	opacity: 0,
	transition: exitTransition,
} as const;
