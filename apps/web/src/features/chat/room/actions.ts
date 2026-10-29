import type { RoomActionId } from "@rowcat/chat";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Room action labels. The list and its order are not here: `@rowcat/chat`'s `ROOM_ACTIONS` owns
 * them and both apps read that table, so ordering cannot drift per app. The words stay in the web
 * because labels are locale-bound (the same call was made in `room-settings-ia.ts`). The
 * `Record<RoomActionId, string>` type makes a new shared action break compilation in both apps.
 * Execution lives in `useRoomManagement` (not imported here), and icons and markup live in
 * `room-context-actions.tsx`.
 */

export const roomActionLabel = (key: RoomActionId): string =>
	translator("chat")(`roomActions.action.${key}`);

/**
 * Accessible name of the overflow trigger. It names the conversation, because a generic label such
 * as `More` would repeat once per row for screen reader users. Mobile's list rows use the same
 * sentence (`apps/mobile`'s `room-library-copy.ts`).
 */
export function roomActionsLabel(title: string): string {
	return translator("chat")("roomActions.label", { title });
}
