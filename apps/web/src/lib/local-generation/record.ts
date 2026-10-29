import {
	EMPTY_GENERATION_PREFERENCE,
	GENERATION_PREFERENCE_VERSION,
	type GenerationPreference,
	isReasoningEffort,
	isResponseLength,
	readGenerationTarget,
} from "@rowcat/chat";

/**
 * The physical shape of a stored generation preference, and the reader that does not trust the row.
 * It is kept separate from GenerationPreference (@rowcat/chat) because lifetimes differ. That type
 * is what current code handles. This is a row that will be opened months later, after the
 * response-length vocabulary may have grown or shrunk and fields may have been added. Merging the
 * two would give a compiler that says a field exists while real rows lack it. Code built on that
 * lie fails only on user devices. Migration code has the same constraint (UpgradableRow in
 * local-data/db.ts). The file contains only the row shape and a reader that does not trust the row.
 * It has no dirty, rev, serverVersion or deletedAt, because a device preference does not sync
 * (local-data/db.ts v5). Their absence in the schema is intentional: if the fields existed, someone
 * would eventually fill them in.
 */

/**
 * The key determines the meaning of the value: one global row, plus one row per room. The value is
 * not free-form JSON. Fields are named and typed, and new preferences add fields. A Record<string,
 * unknown> or a settingsJson string is avoided, because that shape cannot be migrated or merged.
 */
export interface StoredGenerationPreference {
	key: string;
	version: number;
	/** null if not chosen. That value and 'no row' mean the same thing. */
	responseLength: string | null;
	/**
	 * The chosen generation target. The field is optional by schema. Rows saved before the target axis
	 * existed have no such field at all. If it were required, the compiler would assume a value that
	 * real rows lack, and code built on that would fail only on user devices. The type is unknown for
	 * the same reason. What the field holds is decided by the version that saved it, and the reader
	 * below judges whether it belongs to the current vocabulary. A type assertion would remove that
	 * check.
	 */
	target?: unknown;
	/**
	 * The chosen reasoning effort. Optional and unknown, for the same reason as the target axis. Rows
	 * saved before this axis existed have no key at all. The reader below judges whether the value
	 * belongs to the current vocabulary.
	 */
	reasoningEffort?: unknown;
}

/**
 * Row to preference. This never throws. The reader is lenient because of when it is called.
 * Preferences are read right before generation. If one corrupt row threw, the user would see the
 * conversation break rather than the settings. Unknown values fall back to 'not chosen', so the
 * product default applies. The worst outcome is 'same as before'. Rows of another version are
 * handled the same way. A future version (a larger version number) is silently ignored for now.
 * That is better than an old tab half-understanding a newer tab's values and overwriting them. When
 * v2 exists, a branch that reads v1 will be added here.
 */
export function readGenerationPreference(
	row: StoredGenerationPreference | undefined,
): GenerationPreference {
	if (!row || row.version !== GENERATION_PREFERENCE_VERSION)
		return EMPTY_GENERATION_PREFERENCE;
	return {
		responseLength: isResponseLength(row.responseLength)
			? row.responseLength
			: null,
		/**
		 * Old rows without the field become null here, because the reader treats undefined as an unknown
		 * shape. That is why an axis can be added without a destructive migration. It also means an
		 * invalid target (an unknown provider, an empty model) does not block generation for that room.
		 */
		target: readGenerationTarget(row.target),
		/**
		 * Old rows without the key, and steps that have dropped out of the vocabulary, both become null
		 * here. The layer above then applies, and the result matches the time before this axis existed.
		 * The contract of this reader: a corrupted value must not block generation for that room.
		 */
		reasoningEffort: isReasoningEffort(row.reasoningEffort)
			? row.reasoningEffort
			: null,
	};
}

/** Preference to row. Writers always save the current version. */
export function toStoredGenerationPreference(
	key: string,
	preference: GenerationPreference,
): StoredGenerationPreference {
	return {
		key,
		version: GENERATION_PREFERENCE_VERSION,
		responseLength: preference.responseLength,
		target: preference.target,
		reasoningEffort: preference.reasoningEffort,
	};
}
