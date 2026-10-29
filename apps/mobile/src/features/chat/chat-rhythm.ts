import { space } from "@rowcat/design";
import { screenPadding } from "@rowcat/ui-native";

/**
 * The one horizontal rhythm of the chat screen: list, rows, failure notice and composer share an
 * axis. Web sets it in one place (`CHAT_COLUMN` in `chat-shell.tsx`). One width matters because a
 * misaligned left edge between reading text and composer makes the screen read as two columns. This
 * app once had it: list 16, failure notice 16, composer 12, which shows up when the keyboard raises
 * the composer against the list.
 *
 * ```text
 * list content padding   chatListGutter (12)
 *   + row inner padding   chatRowInset   (4)
 *   = text left edge      chatGutter     (16)   same as composer and failure notice
 * ```
 *
 * Rows always carry the inner padding for search highlighting: a highlight flush with the text
 * looks like a smudge, and adding padding only when highlighted would change the row height and
 * make the virtualizer correct the scroll, misplacing the jump target.
 */

export const chatGutter = screenPadding;

/** Padding a row always keeps around its text for the search highlight. */
export const chatRowInset = space.xs;

/** List content padding: the difference of the two above; no number is written here. */
export const chatListGutter = chatGutter - chatRowInset;
