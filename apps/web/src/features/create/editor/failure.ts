import { translator } from "#/lib/i18n/current.ts";
/**
 * The sentence the user reads when editing a draft fails. This file holds no rules and no state.
 *
 * The file stands apart because the places these sentences appear differ. A failed draft delete
 * happens while its confirmation row is still expanded, so the message lives inline in that row.
 * Structure changes and draft creation have either an icon-only control that was pressed or a
 * button that was about to leave the screen, so there is no place for an inline message and it
 * appears as a toast. Both containers must share one vocabulary, so that "could not save" does not
 * become a different phrase on each screen.
 *
 * The messages never name a cause. Every failure arriving here is an IndexedDB write failure
 * (quota, a connection closed during an account switch, the browser's storage policy), and the user
 * can do the same thing in each case: press again. Showing Dexie's raw message would leave a
 * sentence that names nothing the user can do. rename-room.ts made the same call.
 */

/**
 * One sentence covers adding, deleting and reordering lore, start scenes and situation images. It
 * is not split per operation: the user already knows which control they pressed, so the split would
 * add nothing, and each new operation would add a sentence that one day gets left out. Rejected
 * alternative: per-operation text such as `Couldn't add lore`.
 */
export const draftStructureFailureMessage = (): string =>
	translator("create")("failure.structure");

/** `New draft` failed. Nothing was created and nothing navigated. */
export const draftCreateFailureMessage = (): string =>
	translator("create")("failure.create");

/**
 * Deleting a draft failed, and the row stays in place. The message does not say so because the
 * screen already shows it. Adding `It wasn't deleted` would state the same fact twice, and one copy would
 * eventually be wrong.
 */
export const draftDeleteFailureMessage = (): string =>
	translator("create")("failure.delete");
