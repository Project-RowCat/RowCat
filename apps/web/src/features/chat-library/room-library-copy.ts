import type { RoomSort } from "@rowcat/chat";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Copy for the chat library. The rules are not here.
 *
 * Search, sort and reveal rules live in `room-library.ts` in `@rowcat/chat`, and mobile calls the
 * same functions. The copy stays out of that package because the copy is locale-specific
 * while the rules are not. This boundary is one the repository has recorded several times
 * (`room-settings-ia.ts`, `generation-availability.ts`).
 *
 * Typing the key by `RoomSort` is what this file actually enforces: the dictionary's `sort` keys must match it. Adding a value to the shared
 * vocabulary breaks compilation in both web and mobile, so a state where only one of them draws the
 * new sort cannot be represented.
 */
export const roomSortLabel = (sort: RoomSort): string =>
	translator("chatLibrary")(`sort.${sort}`);
