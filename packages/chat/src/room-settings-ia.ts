/**
 * Information architecture of the room settings home: which rows appear, in which group, and in
 * what order.
 *
 * - Lives in this pure package because the web and mobile settings screens are the same product.
 *   Per-app lists would drift apart without any compile or test failure.
 * - Holds no copy. Each app's label table is typed as Record<RoomSettingsRowId, string>, so
 *   adding a row breaks both apps at compile time.
 * - Groups follow the nature of a setting (how output is made, what the conversation is, how the
 *   conversation is managed), not its storage location.
 * - No rows are added for features that need new product semantics (pin, archive, copy, export,
 *   share, folders). Each would add a screen to both apps.
 */

export type RoomSettingsGroupId = "generation" | "conversation" | "management";

/**
 * The row id `generation` matches its group name on purpose. That group holds only this row, so the
 * row name also names the group. Splitting the names (for example `generation-settings`) would make
 * readers work out which one the screen shows.
 */
export type RoomSettingsRowId =
	| "generation"
	/**
	 * Persona: who the user is in this conversation. It belongs to the `conversation` group, not the
	 * `Generation` group: it describes what the conversation is, while the generation settings describe how
	 * output is made. It sits before `Memory` because it is checked as soon as the conversation opens (the
	 * speaker name appears on every turn), while memory is adjusted after the conversation has grown.
	 */
	| "persona"
	/**
	 * Narration: who writes this conversation's prose. It sits right after `persona` because the two
	 * answer one question: persona is the role the user plays, and narration is who writes that role
	 * when autoplay is on. Not in the `Generation` group: model and response length describe how output is
	 * made and are device-local, while narration describes what is made and syncs with the
	 * conversation.
	 */
	| "narration"
	/**
	 * Intensity: how explicitly the conversation is depicted. It sits right after `narration` (who
	 * writes versus how much is shown), and before `characters`, because the three rows after it cover
	 * who else is present. Not in the `Generation` group, even though it sits near the rating: intensity syncs
	 * with the conversation. If it were device-local, a story softened on one device would reopen at
	 * full intensity on another, showing content the user had chosen to avoid.
	 */
	| "intensity"
	/**
	 * Characters: who else is in this conversation. It follows persona and narration because those
	 * three rows form one sequence of questions (who I am, who writes, who else is there). It sits
	 * before `Memory` because the cast is set when the conversation starts, while memory is adjusted
	 * later.
	 *
	 * This row does not edit characters that a work supplies. Playback snapshots are immutable; here
	 * the user can only add characters to this conversation (see the header of `character.ts` in
	 * `@rowcat/chat`).
	 */
	| "characters"
	| "memory"
	/**
	 * User note: free-text instructions the user writes for this conversation. It sits right after
	 * `Memory` and before `Conversation info`. These two rows are the only free text the user writes into the
	 * conversation prompt, and they appear there in the same order. Memory is what the conversation
	 * knows; the user note is the request for how to proceed now, so if they conflict, the later
	 * request wins. `Conversation info` is read-only and always ends the `Conversation` group, which is why it comes after.
	 */
	| "userNote"
	| "info"
	| "rename"
	| "delete";

export interface RoomSettingsGroupSpec {
	id: RoomSettingsGroupId;
	rows: readonly RoomSettingsRowId[];
}

/**
 * Three groups and their rows. Array position is screen position, running from frequently used
 * actions down to irreversible ones. `delete` is last so that a slipping finger lands in one place,
 * and it is the only row that requires a confirmation dialog.
 */
export const ROOM_SETTINGS_IA: readonly RoomSettingsGroupSpec[] = [
	{ id: "generation", rows: ["generation"] },
	{
		id: "conversation",
		rows: [
			"persona",
			"narration",
			"intensity",
			"characters",
			"memory",
			"userNote",
			"info",
		],
	},
	{ id: "management", rows: ["rename", "delete"] },
];

/**
 * Rows that lead to irreversible actions. Color alone cannot communicate this, so the real boundary
 * is enforced by each app's confirmation dialog. The set's only job is to make both apps agree on
 * which rows are destructive rather than navigational, which is why these rows get no navigation
 * arrow (see below).
 */
export const ROOM_SETTINGS_DESTRUCTIVE_ROWS: ReadonlySet<RoomSettingsRowId> =
	new Set(["delete"]);

/**
 * Rows that open another screen; the arrow signals that. `delete` is excluded: it opens a
 * confirmation rather than a screen, and an arrow would promise the user can choose more options
 * inside.
 */
export const ROOM_SETTINGS_NAVIGATIONAL_ROWS: ReadonlySet<RoomSettingsRowId> =
	new Set([
		"generation",
		"persona",
		"narration",
		"intensity",
		"characters",
		"memory",
		"userNote",
		"info",
		"rename",
	]);

/**
 * What the build has to carry for a row to mean something. A row that edits a value nothing reads is
 * worse than no row: the user changes it and every turn comes back the same, with no error to explain
 * why.
 *
 * Only narration has such a dependency. Its value is injected as a pack body, and the public release
 * ships none (`@rowcat/prompt-packs`, `PROMPT_PACKS_AVAILABLE`). The app passes that fact in; this
 * package does not import the bodies' package, for the same weight reason the assembler does not.
 *
 * Stored narration settings are untouched when the row is absent. They still sync, and they apply again
 * the day the build carries bodies.
 */
export interface RoomSettingsAvailability {
	narration: boolean;
}

export const roomSettingsRowAvailable = (
	row: RoomSettingsRowId,
	availability: RoomSettingsAvailability,
): boolean => row !== "narration" || availability.narration;

/**
 * The IA with the rows this build cannot honour taken out. Order and grouping stay `ROOM_SETTINGS_IA`'s;
 * a group never empties, since narration shares its group with six other rows.
 */
export const roomSettingsGroups = (
	availability: RoomSettingsAvailability,
): readonly RoomSettingsGroupSpec[] =>
	ROOM_SETTINGS_IA.map((group) => ({
		...group,
		rows: group.rows.filter((row) =>
			roomSettingsRowAvailable(row, availability),
		),
	}));
