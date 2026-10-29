import type { RoomSettingsGroupId, RoomSettingsRowId } from "@rowcat/chat";

/**
 * Room-settings vocabulary: which pane is showing, and the copy those panes use.
 *
 * The structure (three groups, five rows, their order) is not here: `ROOM_SETTINGS_IA` in
 * `@rowcat/chat` owns it and web reads the same table, since per-app lists would let `Conversation info` move
 * to `Manage` in one app only. Only Korean copy remains, so the pure package's rules are not tied to a
 * locale. The `Record<...Id, string>` tables below are the link: a new shared row breaks this
 * file's compilation.
 */

/**
 * The pane currently shown in the settings window; UI state only, persisted nowhere. Not a route
 * because room settings are not a resource (the room has an address, its settings screen does not),
 * and not in storage because it is where the user is looking, not a chosen value.
 *
 * Opening always lands on `home`: remembering the last pane would drop anyone who once edited the
 * model into generation detail every time, never seeing what else exists. Web's
 * `room-settings-view.ts` made the same call.
 */
export type RoomSettingsView =
	| "home"
	| "generation"
	| "info"
	| "persona"
	/**
	 * Pane for creating or editing a persona. Not a sibling window because a role just created must be
	 * pickable in place, and closing then reopening would restart settings from scratch. With one
	 * window there is no nesting: Android back and screen-reader escape still have one owner.
	 */
	| "personaForm"
	/** Who writes this conversation; same pane as web, right after `persona` (`ROOM_SETTINGS_IA`): two halves of one question, autoplay being the AI playing the chosen role. */
	| "narration"
	/** How much the description shows; same pane as web, right after `narration` (`ROOM_SETTINGS_IA`): who writes vs how explicit, two axes of one question. */
	| "intensity"
	/** Who else is in this conversation; same pane as web. */
	| "characters"
	/** The user's own instruction for how the conversation proceeds; same pane as web, right after `Memory` (`ROOM_SETTINGS_IA`): together the two rows are all the text the user puts into this prompt. */
	| "userNote";

export const ROOM_SETTINGS_VIEW_TITLE: Record<RoomSettingsView, string> = {
	home: "Conversation settings",
	generation: "Generation settings",
	info: "Conversation info",
	persona: "Persona",
	personaForm: "Edit persona",
	narration: "Narration",
	intensity: "Intensity",
	characters: "Characters",
	userNote: "User note",
};

/**
 * Where back goes from each pane. Back used to always be home, which broke once a pane went one
 * level deeper: cancelling persona creation must return to the picking list, not bounce to the list
 * of lists. `home` is `null` because a disabled arrow going nowhere is worse than none, so the
 * window draws no back there.
 */
export const ROOM_SETTINGS_VIEW_PARENT: Record<
	RoomSettingsView,
	RoomSettingsView | null
> = {
	home: null,
	generation: "home",
	info: "home",
	persona: "home",
	personaForm: "persona",
	narration: "home",
	intensity: "home",
	characters: "home",
	userNote: "home",
};

/** Accessible name of the back control; an unnamed icon button reads only as `button`, indistinguishable from the window's close button. */
export const backLabelFor = (parent: RoomSettingsView): string =>
	`Back to ${ROOM_SETTINGS_VIEW_TITLE[parent]}`;

export const ROOM_SETTINGS_BACK_LABEL = backLabelFor("home");

/** Header trigger name; omits the room title because it sits right beside the trigger and would be read twice. Same sentence as web's `chat-header-context.tsx`. */
export const ROOM_SETTINGS_TRIGGER_LABEL = ROOM_SETTINGS_VIEW_TITLE.home;

/** Same words as web's settings home. */
export const ROOM_SETTINGS_GROUP_TITLE: Record<RoomSettingsGroupId, string> = {
	generation: "Generation",
	conversation: "Conversations",
	management: "Manage",
};

/** Same words as web's settings home. */
export const ROOM_SETTINGS_ROW_TITLE: Record<RoomSettingsRowId, string> = {
	generation: "Generation settings",
	persona: "Persona",
	narration: "Narration",
	intensity: "Intensity",
	characters: "Characters",
	memory: "Memory",
	userNote: "User note",
	info: "Conversation info",
	rename: "Rename",
	delete: "Delete conversation",
};

/**
 * The line under a row: what currently applies, or what the pane covers. Rows whose summary is
 * built from stored values are `null` here, since a placeholder would flash before the value
 * arrives and be read as the user's setting. `rename` and `delete` are `null` too: the title is
 * already the action.
 */
export const ROOM_SETTINGS_ROW_SUMMARY: Record<
	RoomSettingsRowId,
	string | null
> = {
	generation: null,
	/** `null`: the summary is the applied role's name from the room record (`personaRowSummary`). */
	persona: null,
	/** `null`: built from the room record's applied scope. */
	narration: null,
	/** `null`: built from the room record and the turn's effective rating. */
	intensity: null,
	/** `null`: built from the added count and the work's count (`characterRowSummary`). */
	characters: null,
	memory: "Manage what this conversation remembers",
	/** `null`: the summary is how much is written, from the room record (`userNoteRowSummary`). */
	userNote: null,
	info: "Original story and conversation details",
	rename: null,
	delete: null,
};

/**
 * Warning line the home row draws when the applied target is unusable on this device. It gives no
 * reason on purpose: home only says to look inside, and the detail pane states the reason per case
 * (`model-options.ts`); a reason here would duplicate guidance and one copy would go stale. Same
 * sentence as web's settings home.
 */
export const ROOM_SETTINGS_BLOCKED_WARNING = "Not available on this device";
