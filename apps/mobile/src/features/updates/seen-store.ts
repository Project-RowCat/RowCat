/**
 * The seen fact for update notes. It is per device, not per account.
 *
 * ## Why not the server
 *
 * The question this value answers is whether the window was shown on this screen, and the subject
 * of that question is the screen, not the person. Storing it on the account would add a table and
 * two endpoints for one benefit, "it does not reappear on other devices" — which is a question for
 * notifications, not for an announcement.
 *
 * A shared browser or shared device can show the next person a window the previous person already
 * closed. That is accepted because only a release date is stored, and that device has already
 * received the update.
 *
 * ## Not mixed with `app_update`'s state
 *
 * The minimum-version notice is a server-owned notification row with its own read state. This value
 * has no relation to it: different key, storage and lifetime. Merging them would make raising the
 * floor show the announcement again, and closing the announcement would mark the end-of-support
 * notice as read.
 *
 * ## The key carries no member id
 *
 * Guests use the app and read announcements too. Mixing identity in would leave nowhere to keep a
 * guest's dismissal, and the same announcement would reappear on sign-in (the device appearance
 * preference reached the same decision).
 *
 * ## Reads are lenient, writes are monotonic
 *
 * Corrupt values, unknown values and read failures all count as "never seen". The worst outcome
 * must be showing the announcement one more time; throwing here would show the user that the app
 * does not open. Writes never go backwards: however an old announcement was reopened, closing it
 * must not overwrite a newer recorded one, or that newer one shows again.
 */

import { isReleaseDate } from "@rowcat/domain";

/**
 * Storage key. The `rowcat.updates.` prefix matters: the device store also holds the appearance
 * preference, and a shared name would let one overwrite the other.
 */
export const UPDATE_NOTE_SEEN_KEY = "rowcat.updates.lastSeen";

/**
 * Storage medium: synchronous reads, asynchronous writes.
 *
 * Reads are synchronous because the value is needed before the first frame. Reading in an effect
 * would flash an announcement the user already closed for one frame. Writes are not urgent: the
 * window is already closed, and the write only serves the next launch.
 *
 * Same shape as `DeviceValueStorage` in `lib/device-storage.ts`, but not imported from it: that
 * module pulls in `expo-sqlite` and does not load under Node. This file holds the rules and the
 * medium lives elsewhere, as in `appearance/preference.ts`.
 */
export interface UpdateNoteSeenStorage {
	/** Must not throw — failure is `null` (the implementation folds it). */
	read(): string | null;
	write(value: string): Promise<void>;
}

export interface UpdateNoteSeenStore {
	/** Public identity (the release date) of the last closed announcement, or `null`. */
	lastSeenId(): string | null;
	/** Never throws on failure: the window has already closed and the user has no recourse. */
	markSeen(id: string): Promise<void>;
}

/**
 * Stored string → announcement identity. Anything that is not a date counts as "never seen".
 *
 * Trusting an arbitrary string would let it sort lexically above the newest announcement date
 * (`zzz`), and then no announcement would ever show on that device.
 */
export function parseSeenUpdateNoteId(
	value: string | null | undefined,
): string | null {
	if (!value) return null;
	return isReleaseDate(value) ? value : null;
}

/**
 * Current record + opened identity → the next record, which never goes backwards.
 *
 * This is a function because there are two consumers: the place that writes to the medium, and the
 * place that reflects the result on screen (`update-notes-provider.tsx`). Here there is one more
 * reason — writes are asynchronous. Reading back right after writing can return the old value, so
 * the screen moves its own value with the same rule instead of re-reading storage.
 *
 * ```text
 * record 2026-08-30 · opened 2026-08-02   →   2026-08-30 (unchanged)
 * record 2026-08-02 · opened 2026-08-30   →   2026-08-30
 * record none       · opened 2026-08-02   →   2026-08-02
 * ```
 *
 * A non-date value is not recorded, so no irreversible lock is created.
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
	storage: UpdateNoteSeenStorage,
): UpdateNoteSeenStore {
	const read = (): string | null => {
		try {
			return parseSeenUpdateNoteId(storage.read());
		} catch {
			return null;
		}
	};

	return {
		lastSeenId: read,

		async markSeen(id) {
			/**
			 * The monotonicity rule lives in one function (`mergeSeenUpdateNoteId`), because the screen
			 * repeats the same check in places.
			 */
			const current = read();
			if (mergeSeenUpdateNoteId(current, id) === current) return;
			try {
				await storage.write(id);
			} catch {
				/**
				 * Swallowing is the rule. The user started this action, but its result (the window closing) is
				 * already on screen, and there is nothing to do about a failure. The next launch shows the
				 * announcement again (`docs/design/FAILURE-FEEDBACK.md`, the fourth line).
				 */
			}
		},
	};
}
