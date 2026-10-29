/**
 * The list of actions for one room, the same wherever it opens. Lives in the pure package because
 * there are four containers: the web sidebar's recent-conversation row via right-click
 * (ContextMenu) and overflow button (DropdownMenu), the conversation list route (/chats), and the
 * mobile list row. Per-container lists diverge silently: delete remains on one side only, `Conversation settings`
 * drops out on another, or the order flips. That drift only shows when the screens are compared
 * side by side.
 *
 * Only vocabulary lives here. The app's room-management hook decides what runs (this file knows no
 * store or React); icons and markup belong to the renderers; copy belongs to the app. Korean text
 * in this package would tie the rules to one locale (`room-settings-ia.ts` made the same call).
 * Types catch omissions instead: each app's copy table is `Record<RoomActionId, string>`, so adding
 * a line here breaks both apps' compilation until they label it.
 *
 * Items are not added. Pin, archive, copy, export, share and folders each need new product meaning
 * (stored fields and sync rules), and are not added just because common chat apps have them.
 */

/**
 * The vocabulary of actions this menu knows. Adding to it is a product decision, not a markup
 * decision.
 */
export type RoomActionId = "rename" | "settings" | "delete";

export interface RoomActionSpec {
	id: RoomActionId;
	/**
	 * Marks an irreversible action, with color and emphasis applied together, since color alone does
	 * not convey it. The real safeguard is each app's confirmation dialog. This flag only makes both
	 * apps agree on which rows are distinct.
	 */
	destructive?: true;
	/**
	 * Draws a separator above this row, pushing the dangerous group out of the distance a finger is
	 * likely to slip across.
	 */
	separatorBefore?: true;
}

/**
 * Order is the screen order, from frequent to irreversible: rename, settings, then (separator)
 * delete.
 */
export const ROOM_ACTIONS: readonly RoomActionSpec[] = [
	{ id: "rename" },
	{ id: "settings" },
	{ id: "delete", destructive: true, separatorBefore: true },
];
