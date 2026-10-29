import type {
	GenerationPreference,
	GenerationPreferenceStore,
} from "@rowcat/chat";
import {
	GLOBAL_PREFERENCE_KEY,
	isEmptyGenerationPreference,
	roomPreferenceKey,
	runtimePreferenceKey,
} from "@rowcat/chat";
import type { LocalDb } from "#/lib/local-data/db.ts";
import {
	readGenerationPreference,
	toStoredGenerationPreference,
} from "./record.ts";

/**
 * IndexedDB implementation of GenerationPreferenceStore. This store does not sync, and its rules
 * are the opposite of the chat and authoring stores.
 * - The transaction does not include syncState. Writes in the other stores issue merged revisions
 *   and must persist the clock state in the same transaction. This value has no revisions.
 *   Including syncState would make it look like a synced value, and it would eventually be used as
 *   one.
 * - No tombstones. Deleting a preference is a state change on this device, not a fact to relay to
 *   other devices, so the row is actually deleted. Soft delete is used only when propagation is
 *   needed.
 * - No updatedAt. This is not a list to sort, and a timestamp would invite merging by time.
 *   Writes are thin on purpose, and reads are lenient (record.ts). This value is read right before
 *   generation, so one corrupt row must not throw and break the conversation.
 */

export function createGenerationPreferenceStore(
	db: LocalDb,
): GenerationPreferenceStore {
	/**
	 * Reads and writes one key. Global and room preferences use the same two functions. If they were
	 * split, one side could keep a 'delete when empty' rule and the other would not. The symptom is
	 * silent: a global value reset to default leaves a row behind. When the product default later
	 * changes, only that user fails to follow it.
	 */
	const read = async (key: string): Promise<GenerationPreference> =>
		readGenerationPreference(await db.generationPreferences.get(key));

	/**
	 * Writes. A preference with nothing set deletes the row. Storing 'not chosen' as a value is this
	 * store's only product rule. If it were stored, it would be indistinguishable from 'never opened'.
	 * It would also stop following the upper layers (global, product default) when they change,
	 * pinning the user to a value they never chose.
	 */
	const write = async (
		key: string,
		preference: GenerationPreference,
	): Promise<void> => {
		if (isEmptyGenerationPreference(preference)) {
			await db.generationPreferences.delete(key);
			return;
		}
		await db.generationPreferences.put(
			toStoredGenerationPreference(key, preference),
		);
	};

	return {
		getGlobal: () => read(GLOBAL_PREFERENCE_KEY),
		setGlobal: (preference) => write(GLOBAL_PREFERENCE_KEY, preference),
		getRoom: (roomId) => read(roomPreferenceKey(roomId)),
		setRoom: (roomId, preference) =>
			write(roomPreferenceKey(roomId), preference),
		/**
		 * Deleting a missing key succeeds in Dexie (it is idempotent). Deleting the same room from two
		 * tabs really happens, and the second call has no reason to fail.
		 */
		clearRoom: async (roomId) => {
			await db.generationPreferences.delete(roomPreferenceKey(roomId));
		},
		/**
		 * Runtime story overrides use the same two functions as rooms, with a different prefix
		 * (record.ts). There is no separate clear operation. The reason is in the port header: writing an
		 * empty preference deletes the row.
		 */
		getRuntime: (storyId) => read(runtimePreferenceKey(storyId)),
		setRuntime: (storyId, preference) =>
			write(runtimePreferenceKey(storyId), preference),
	};
}
