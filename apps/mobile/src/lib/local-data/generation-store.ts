import type {
	GenerationPreference,
	GenerationPreferenceStore,
} from "@rowcat/chat";
import {
	EMPTY_GENERATION_PREFERENCE,
	GENERATION_PREFERENCE_VERSION,
	GLOBAL_PREFERENCE_KEY,
	isEmptyGenerationPreference,
	isReasoningEffort,
	isResponseLength,
	readGenerationTarget,
	roomPreferenceKey,
	runtimePreferenceKey,
} from "@rowcat/chat";
import type { MobileDatabase } from "./sqlite.ts";

/**
 * SQLite implementation of `GenerationPreferenceStore`. This store is not synced. Its rules are the
 * opposite of the chat and authoring stores', so the differences are spelled out here. The web's
 * `apps/web/src/lib/local-generation/store.ts` implements the same port on Dexie; both fill the
 * same contract, so the screen and the generation runtime don't know which one they're using.
 *
 * - Not in a sync transaction. Writes in the synced stores issue merge revisions and persist the
 *   clock state in the same transaction (`chat-store.ts`). This value has no revision, so placing
 *   it there would make it look synced, and it would eventually be written as if it were.
 * - No tombstones. Clearing a preference is a local state change, not a fact to propagate to
 *   other devices, so the row is actually deleted. Soft deletes are only worth it when propagation
 *   is needed.
 * - No `updated_at`. This is not a list that gets sorted, and a timestamp invites merging by it.
 * - Not registered in `tableOf`. The sync store doesn't know this type, so neither `applyPull`
 *   nor outbound collection touches this table; the protocol is unaware of the value.
 *
 * Reads are lenient, writes are thin. This value is read right before generation, so throwing on
 * one corrupt row would show the user a broken conversation rather than a broken setting. Unknown
 * values fall back to "unset", and the layers above (global, then product default) take over, so
 * the worst outcome is "same as before".
 *
 * No explicit transaction. Each statement is a single autocommit, and they share the same
 * connection queue (`sqlite.ts`). Wrapping them would suggest this store shares atomicity with
 * other domains, which it has no reason to. Room deletion and clearing that room's overrides
 * deliberately are *not* one transaction (`use-room-management.tsx` explains why).
 */

/** A stored row. The key determines what the value means (one global, one per room, one per runtime story). */
interface PreferenceRow {
	version: number;
	response_length: string | null;
	/** JSON holding one target. `null` when this layer does not set a target. */
	target: string | null;
	/**
	 * Chosen reasoning effort. `null` when this layer does not set it.
	 *
	 * Rows written before v9 have no such column, and SQLite reads it as `NULL`. That matches exactly
	 * how things behaved before this axis existed, so no backfill is needed.
	 */
	reasoning_effort: string | null;
}

/**
 * Row to preference. **Never throws on any input.**
 *
 * Rows with a different version are treated the same way. When v2 arrives, a v1 branch will be
 * added here; until then, a newer version (larger number) is silently ignored, which is better than
 * an older app half-understanding and overwriting a newer app's value.
 */
function readPreference(row: PreferenceRow | null): GenerationPreference {
	if (!row || row.version !== GENERATION_PREFERENCE_VERSION)
		return EMPTY_GENERATION_PREFERENCE;
	return {
		responseLength: isResponseLength(row.response_length)
			? row.response_length
			: null,
		/**
		 * Corrupt JSON and unknown providers both become `null` here. The reader treats any shape it
		 * doesn't recognize as "unset", which is why one bad setting never blocks a conversation.
		 */
		target: readGenerationTarget(parseTarget(row.target)),
		/**
		 * A step that has been removed from the vocabulary also becomes `null` here, so the upper layers
		 * take over and the result matches a world without this axis. One corrupt value must never block
		 * a room's generation; that is this reader's contract.
		 */
		reasoningEffort: isReasoningEffort(row.reasoning_effort)
			? row.reasoning_effort
			: null,
	};
}

const parseTarget = (value: string | null): unknown => {
	if (!value) return null;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return null;
	}
};

export function createGenerationPreferenceStore(
	db: MobileDatabase,
): GenerationPreferenceStore {
	/**
	 * Reads and writes one key. Global and room preferences share **these same two functions**.
	 *
	 * If they were split, the "delete when empty" rule could end up on only one side. The symptom is
	 * quiet: a global reset to default leaves its row behind, so that user doesn't follow a later
	 * change to the product default.
	 */
	const read = async (key: string): Promise<GenerationPreference> =>
		readPreference(
			await db.first<PreferenceRow>(
				`SELECT version, response_length, target, reasoning_effort
				 FROM generation_preference WHERE key = ?`,
				[key],
			),
		);

	/**
	 * Writes. **A preference that sets nothing deletes its row.**
	 *
	 * Not storing "unset" as a value is this store's one product rule. Storing it would make it
	 * indistinguishable from "never opened", and the upper layers (global, product default) could no
	 * longer follow when they change. The user would be stuck with a value they never chose.
	 */
	const write = async (
		key: string,
		preference: GenerationPreference,
	): Promise<void> => {
		if (isEmptyGenerationPreference(preference)) {
			await db.run("DELETE FROM generation_preference WHERE key = ?", [key]);
			return;
		}
		await db.run(
			`INSERT INTO generation_preference
			   (key, version, response_length, target, reasoning_effort)
			 VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(key) DO UPDATE SET
			   version = excluded.version,
			   response_length = excluded.response_length,
			   target = excluded.target,
			   reasoning_effort = excluded.reasoning_effort`,
			[
				key,
				GENERATION_PREFERENCE_VERSION,
				preference.responseLength,
				preference.target ? JSON.stringify(preference.target) : null,
				preference.reasoningEffort,
			],
		);
	};

	return {
		getGlobal: () => read(GLOBAL_PREFERENCE_KEY),
		setGlobal: (preference) => write(GLOBAL_PREFERENCE_KEY, preference),
		getRoom: (roomId) => read(roomPreferenceKey(roomId)),
		setRoom: (roomId, preference) =>
			write(roomPreferenceKey(roomId), preference),
		/**
		 * Deleting a missing key succeeds (idempotent). Room deletion can run in two places at once, and
		 * the second call has no reason to fail.
		 */
		clearRoom: async (roomId) => {
			await db.run("DELETE FROM generation_preference WHERE key = ?", [
				roomPreferenceKey(roomId),
			]);
		},
		/**
		 * Runtime-story overrides. Uses **the same two functions** as rooms, with a different prefix.
		 * There is no separate clear operation; see the port header (writing an empty preference deletes
		 * the row).
		 */
		getRuntime: (storyId) => read(runtimePreferenceKey(storyId)),
		setRuntime: (storyId, preference) =>
			write(runtimePreferenceKey(storyId), preference),
	};
}
