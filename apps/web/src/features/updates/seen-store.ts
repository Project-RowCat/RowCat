import { isReleaseDate } from "@rowcat/domain";

/**
 * The fact that an update note was read. This is per-browser device state, not account state.
 *
 * localStorage is usually the wrong answer in this repo: a member-scoped value under one origin
 * makes one user's choice another user's default on a shared browser. It is the right answer here
 * because of what the value is.
 * - Member-scoped values (the auto-sync toggle, conversations, drafts) live in per-member
 *   IndexedDB. This value answers whether this screen showed the window, and what is stored is one
 *   release date. Storing it under a member id would leave no place for a guest's dismissal, and
 *   the same note would reappear after login. On a shared browser the next person may miss the
 *   note; the browser already received that update, so this is accepted.
 * - Not on the server. A table and two endpoints would buy only 'not shown on other devices',
 *   which is a notification question, not a note question.
 * - Unrelated to the app_update read state. The minimum-supported-version notice is a
 *   server-owned row with its own read marker. Merging the two would make raising the floor re-show
 *   a note, and dismissing a note would mark a support-end notice as read
 *   (docs/updates/ARCHITECTURE.md).
 */

export const UPDATE_NOTE_SEEN_KEY = "rowcat.updates.lastSeen";

/**
 * Storage medium: a subset of `Storage`. `localStorage` is not called directly, so this rule can be
 * checked without a browser. SSR has no such global, and in private browsing both reads and writes
 * throw. The implementation below handles both.
 */
export interface UpdateNoteSeenStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export interface UpdateNoteSeenStore {
	/** The public identity (the release date) of the last dismissed note, or `null` if none. */
	lastSeenId(): string | null;
	/**
	 * Does not throw: the window has already closed, and the user cannot do anything about a failure.
	 */
	markSeen(id: string): void;
}

/**
 * Converts a stored string into a note identity. Anything that is not a date counts as never seen.
 */
export function parseSeenUpdateNoteId(
	value: string | null | undefined,
): string | null {
	if (!value) return null;
	return isReleaseDate(value) ? value : null;
}

/**
 * The browser's `localStorage`, or `null` if it is missing or access throws.
 *
 * There is no such global during server render. In practice this window sits behind `ClientOnly`,
 * so the guard never runs there. It stays so that a change in that wiring does not make the app
 * fail to start.
 */
export function browserSeenStorage(): UpdateNoteSeenStorage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

/**
 * Turns one record into the next record that does not go backward. This is a function because there
 * are two consumers: the place that writes to storage, and the place that reflects the result on
 * screen (update-notes-provider.tsx). Once history existed, opening an old note became an ordinary
 * action. If each consumer wrote its own `>=`, a change fixing only one would bring back the
 * display of a latest note the user had already read. A non-date value is never recorded, so no
 * irreversible lock is created.
 */
export function mergeSeenUpdateNoteId(
	current: string | null,
	id: string,
): string | null {
	if (!isReleaseDate(id)) return current;
	if (current !== null && current >= id) return current;
	return id;
}

export function createUpdateNoteSeenStore(
	storage: UpdateNoteSeenStorage | null,
): UpdateNoteSeenStore {
	const read = (): string | null => {
		if (!storage) return null;
		try {
			return parseSeenUpdateNoteId(storage.getItem(UPDATE_NOTE_SEEN_KEY));
		} catch {
			return null;
		}
	};

	return {
		lastSeenId: read,

		markSeen(id) {
			if (!storage) return;
			const current = read();
			if (mergeSeenUpdateNoteId(current, id) === current) return;
			try {
				storage.setItem(UPDATE_NOTE_SEEN_KEY, id);
			} catch {
				/**
				 * Swallowing the error is the rule. The user started the action, but its result (the window
				 * closing) is already on screen, and a failure leaves them nothing to act on. The note simply
				 * shows again on the next visit (docs/design/FAILURE-FEEDBACK.md, fourth line).
				 */
			}
		},
	};
}
