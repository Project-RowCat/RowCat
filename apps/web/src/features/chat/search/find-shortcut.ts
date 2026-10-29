/**
 * `Cmd/Ctrl+F` replaces the browser's find, inside the conversation screen only.
 *
 * Only that screen uses this decision (`chat-page.tsx`), and it mounts only inside a room, so
 * browser find keeps working elsewhere. It is intercepted here because the message list is
 * virtualized: the browser's find would only scan the few rows currently on screen and report "not
 * found" for the rest.
 *
 * Platforms are split: on macOS `Ctrl+F` moves the caret one character right in text fields (emacs
 * bindings), so taking it would remove an editing key. macOS therefore takes `Cmd` only, and other
 * platforms take `Ctrl` only. `Shift` combinations are not taken because `Cmd/Ctrl+Shift+F` already
 * means something else in other tools.
 */

/** The key-event fields this decision needs. Not bound to DOM types so tests can call it directly. */
export interface FindShortcutEvent {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
}

export function isFindShortcut(
	event: FindShortcutEvent,
	mac: boolean,
): boolean {
	if (event.altKey || event.shiftKey) return false;
	// Fold case so CapsLock or an unshifted capital still matches.
	if (event.key.toLowerCase() !== "f") return false;
	return mac
		? event.metaKey && !event.ctrlKey
		: event.ctrlKey && !event.metaKey;
}

/**
 * Whether this device is a Mac. `navigator.platform` is deprecated but still the most accurate; it
 * falls back to the UA string. A wrong answer costs little: one shortcut stops working, while
 * search still opens from the header trigger.
 */
export const isMacPlatform = (): boolean =>
	/mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || "");
