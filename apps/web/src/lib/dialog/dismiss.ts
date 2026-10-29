/**
 * When a management dialog may close.
 *
 * Keeping the default (close on outside press) breaks two things.
 *
 * First, data loss. A user who has typed names and brushes the outside edge silently loses the
 * edit. A delete confirmation asks about an irreversible action, so it must not drift toward either
 * accidental closing or accidental confirmation. These dialogs end only through explicit choices:
 * cancel, close, or Esc.
 *
 * Second, these dialogs open from dropdown menu items. When the menu closes it returns focus to its
 * trigger button, which is now outside the newly opened dialog. If that return, or the last event
 * of the same pointer sequence, is read as 'the user pressed outside', the dialog closes right
 * after opening and the menu appears to do nothing. Blocking that path makes the dialog's lifetime
 * follow only the user's choice, whatever the menu's timing.
 *
 * So the reason for closing is checked. Esc, cancel, and the close button are things the user said
 * to this dialog; outside presses and focus loss are not.
 */

/** Reasons that do not close the dialog. The user did not say these things to this dialog. */
const KEEP_OPEN: ReadonlySet<string> = new Set(["outside-press", "focus-out"]);

/**
 * Whether closing is allowed for this reason. While `pending` is true the dialog never closes,
 * whatever the reason, because a running save or delete needs somewhere to show its result and any
 * failure message.
 */
export function shouldCloseDialog(reason: string, pending: boolean): boolean {
	if (pending) return false;
	return !KEEP_OPEN.has(reason);
}
