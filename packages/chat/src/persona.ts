import type { ChatSoftDelete, ChatStamp, ChatSyncMeta } from "./model.ts";
import { freshChatSyncMeta } from "./model.ts";
import { CHAT_DEFAULT_USER_NAME } from "./placeholder.ts";

/**
 * Persona: the role the user plays in a conversation, and the library used to reuse it.
 *
 * Three things in this repo are called a persona, and they differ:
 * - The work's counterpart (ChatSeedPersonaDto): suggested by the creator. Part of the playback
 *   snapshot, so immutable.
 * - The work's suggestedPersona: no longer present. v2 folded it into one prompt blob, and it is
 *   not restored.
 * - ChatPersona (this file): saved by the user and reused across conversations. Folding the first
 *   and third into one record would make renaming a persona rewrite the work snapshot of every
 *   conversation already started.
 *
 * A room's copy and the library entry are different things:
 * - ChatPersona: a library row for reuse. Editable and deletable.
 * - ChatPersonaSnapshot: the value the room copied in, for that conversation's identity. A room
 *   does not reference the library by personaId. That would break four things at once: deleting a
 *   row strips the name from old conversations; editing a row silently changes the speaker in
 *   conversations the user never touched; a sync reorder leaves a room half-broken on a device that
 *   receives it before the persona; and prompt assembly would depend on the library's current
 *   state. So values are copied at pick time. To pick up a library edit in an old conversation, the
 *   user picks again in that room.
 *
 * Not here: avatar, gender, age, pronouns, favorites, folders, tags, default model, dedicated
 * system prompt, NSFW flag. The V1 vocabulary is name and description, and those two are all that
 * reach the prompt. A schema axis that nothing reads would have a form that does nothing.
 */

/**
 * A persona copied into the room, as a value, not a reference. The library id is deliberately
 * absent. If it were carried, code would eventually follow it back to the library, and every
 * failure in the file header would return. If it cannot be followed back, no code can. The shape
 * deliberately matches ChatSeedPersonaDto. Both fill the same slot (who plays the user), so
 * priority resolution can answer with one type.
 */
export interface ChatPersonaSnapshot {
	name: string;
	description: string;
}

/**
 * A saved persona: a local-first record of the same class as rooms, messages and memories. It
 * carries all the sync fields because it is what the user wrote, not a device preference (unlike
 * generationPreferences). A persona made on a Mac and missing on a phone would make the person
 * write the same role twice, and the two copies would drift apart. It is not a child of a room:
 * there is no roomId and no cascade. Deleting a room should not remove a role that was used there.
 */
export interface ChatPersona extends ChatSyncMeta, ChatSoftDelete {
	/** Globally stable id. The device creates it, with no server round trip. */
	id: string;
	/** This role's name. It becomes {{user}} and the speaker of user utterances. */
	name: string;
	/**
	 * This role's description. It goes into the user (counterpart) block of the system prompt. May be
	 * empty.
	 */
	description: string;
	createdAt: string;
	/** Last modified time. The sort key for the library list. */
	updatedAt: string;
}

/**
 * Enough to read the role the user plays in this conversation. ChatRoom and ChatRuntimeRoom are
 * supersets of this shape, so callers pass them through. A conversation that is not saved (the work
 * test) has no persona key. Then the work's suggested counterpart stands alone. Absence is the
 * accurate representation, so no fake override is invented.
 */
export interface ChatPersonaSource {
	/**
	 * The role the user explicitly chose for this room. null, or no key at all, if none. It is
	 * optional rather than required because of migration. Rooms created before this axis have no key,
	 * and absent and null mean the same thing here (no override). Making it required would need a
	 * migration that rewrites every room already on devices, and that migration would buy only the
	 * shape of the type.
	 */
	persona?: ChatPersonaSnapshot | null;
	seed: { persona: ChatPersonaSnapshot | null };
}

/**
 * The effective persona for this conversation: the only place that knows the priority.
 * - A role chosen for the room: that role.
 * - Otherwise, the work's suggested counterpart, if any.
 * - Neither: null. The assembler then uses CHAT_DEFAULT_USER_NAME. The reason it is one function:
 *   writing room.persona ?? room.seed.persona across the screen and runtime would spread the rule.
 *   Adding an axis later, such as an account default above the room override, would mean editing
 *   every such line. A miss shows up quietly, as the other party being addressed by a name
 *   different from the one on screen. A null override means 'use the work's default', not 'no
 *   role'. Separating the two would need a third value ('none') that no screen can express. The
 *   product asks only these three questions, and this function answers them directly.
 */
export function effectiveChatPersona(
	source: ChatPersonaSource,
): ChatPersonaSnapshot | null {
	return source.persona ?? source.seed.persona;
}

/**
 * Attaches or clears a role on the room record. With no override, the key is not created. This is
 * why the function exists: 'no override' should have one representation. undefined and null mean
 * the same to readers, but two shapes coexisting makes two records of one fact. The absent form is
 * canonical. Rooms created before this axis have no key, and leaving them unrewritten is the whole
 * migration strategy for the feature. Making null canonical would leave old and new records in
 * different shapes forever.
 */
export function applyRoomPersona<
	T extends { persona?: ChatPersonaSnapshot | null },
>(room: T, persona: ChatPersonaSnapshot | null): T {
	if (persona) return { ...room, persona };
	const { persona: _cleared, ...rest } = room;
	return rest as T;
}

/**
 * Which layer the effective persona came from:
 * - room: the user chose it for this conversation.
 * - story: the work's suggested counterpart applies.
 * - default: nothing is set, and the assembler's default name applies. The name alone does not
 *   tell these three apart, which is why the type exists. The screen must word the three states
 *   differently (chosen role, work default, no setting), and the picker must know from this value
 *   which row is selected. Re-deriving it on the screen would let the two apps draw the same room
 *   differently.
 */
export type ChatPersonaOrigin = "room" | "story" | "default";

export function chatPersonaOrigin(
	source: ChatPersonaSource,
): ChatPersonaOrigin {
	if (source.persona) return "room";
	return source.seed.persona ? "story" : "default";
}

/**
 * The name the user goes by in this conversation: both the {{user}} substitution and the speaker
 * prefix on user utterances. Both places must see the same value, which is why this function is
 * separate. If they diverged, the model would call the user one name while the scenario referred to
 * them by another, and the mismatch would show only inside the conversation (the same rule as the
 * placeholder.ts header).
 */
export function effectiveChatUserName(source: ChatPersonaSource): string {
	return effectiveChatPersona(source)?.name.trim() || CHAT_DEFAULT_USER_NAME;
}

/**
 * Converts a library row into the value the room will copy. The copy happens here. The function
 * only selects two fields, but it is named because the copy is the product decision itself (see the
 * file header). If {name, description} were written at each call site, someone would eventually
 * send the id along, and code receiving it would start following it back to the library.
 */
export const personaSnapshotOf = (
	persona: Pick<ChatPersona, "name" | "description">,
): ChatPersonaSnapshot => ({
	name: persona.name,
	description: persona.description,
});

/**
 * Do two snapshots describe the same role? This is a value comparison. The screen compares a room's
 * override with library rows, to show which row is selected. Snapshots carry no id, so they are
 * compared by value. Two rows with the same name and description both look selected. That is
 * accurate, since they cannot be told apart.
 */
export const samePersonaSnapshot = (
	a: ChatPersonaSnapshot | null,
	b: ChatPersonaSnapshot | null,
): boolean =>
	a === b ||
	(!!a && !!b && a.name === b.name && a.description === b.description);

/**
 * Name limit, in characters. 60 matches the publishing contract's value for a work's counterpart
 * name (STORY_PUBLISH_LIMITS.personaName). The two must match for a concrete reason: the work's
 * suggested counterpart and the user's saved role occupy the same slot. If the limits differed, a
 * name the work suggested could not always be copied into the user's library.
 */
export const CHAT_PERSONA_NAME_MAX_LENGTH = 60;

/**
 * Description limit, same reason: it matches the publishing contract
 * (STORY_PUBLISH_LIMITS.personaDescription). 4,000 characters is four times one memory (1,000
 * characters). It is also the point at which the prompt's counterpart block stops starving the
 * history. There is no separate budget here, unlike memories. There is one block and a single role
 * picked by the user, so trimming would silently cut in half a setting the person wrote.
 */
export const CHAT_PERSONA_DESCRIPTION_MAX_LENGTH = 4_000;

export type ChatPersonaNameRejection = "empty" | "too_long";
export type ChatPersonaDescriptionRejection = "too_long";

export type ChatPersonaNameCheck =
	| { ok: true; name: string }
	| { ok: false; reason: ChatPersonaNameRejection };

export type ChatPersonaDescriptionCheck =
	| { ok: true; description: string }
	| { ok: false; reason: ChatPersonaDescriptionRejection };

/**
 * Trims leading and trailing whitespace only, the same rule as room titles and memories. Interior
 * text is kept as the user wrote it.
 */
export const normalizePersonaName = (input: string): string => input.trim();

/**
 * Also trims only the edges. Interior newlines are not collapsed: role settings are text whose
 * items are separated by line breaks, and collapsing would erase structure the user created.
 */
export const normalizePersonaDescription = (input: string): string =>
	input.trim();

/**
 * Can this name be saved? An empty name is not folded to a default, for the same reason as renaming
 * a room. Personas are created only on the screen where the user defines their role, so an empty
 * name is an unfinished entry, not a request for the default. Silently saving it as the default name would add
 * a row the user never created. Length is counted in code points. String.length counts UTF-16 code
 * units, so one emoji counts as 2, and only people who mix in emoji would see their limit halved.
 * This matches the unit chatTextLength uses.
 */
export function checkPersonaName(input: string): ChatPersonaNameCheck {
	const name = normalizePersonaName(input);
	if (name.length === 0) return { ok: false, reason: "empty" };
	if ([...name].length > CHAT_PERSONA_NAME_MAX_LENGTH)
		return { ok: false, reason: "too_long" };
	return { ok: true, name };
}

/**
 * Can this description be saved? Empty is allowed. This is the one place where the name and
 * description rules differ. A role without a name points at nothing in the prompt. A role without a
 * description is still a complete value, 'name only'. A work's counterpart can also have an empty
 * description.
 */
export function checkPersonaDescription(
	input: string,
): ChatPersonaDescriptionCheck {
	const description = normalizePersonaDescription(input);
	if ([...description].length > CHAT_PERSONA_DESCRIPTION_MAX_LENGTH)
		return { ok: false, reason: "too_long" };
	return { ok: true, description };
}

/**
 * A write that broke the name rule. The error type records that the storage layer does not trust
 * the screen to have validated the input.
 */
export class ChatPersonaNameError extends Error {
	readonly reason: ChatPersonaNameRejection;
	constructor(reason: ChatPersonaNameRejection) {
		super(
			reason === "empty"
				? "a persona name cannot be empty"
				: `a persona name cannot exceed ${CHAT_PERSONA_NAME_MAX_LENGTH} characters`,
		);
		this.name = "ChatPersonaNameError";
		this.reason = reason;
	}
}

export class ChatPersonaDescriptionError extends Error {
	readonly reason: ChatPersonaDescriptionRejection;
	constructor(reason: ChatPersonaDescriptionRejection) {
		super(
			`a persona description cannot exceed ${CHAT_PERSONA_DESCRIPTION_MAX_LENGTH} characters`,
		);
		this.name = "ChatPersonaDescriptionError";
		this.reason = reason;
	}
}

/**
 * The final gate before saving. Returns the string to store if it passes; throws otherwise. The
 * storage implementation calls this. It is not skipped even though the screen validates, because
 * there is more than one caller (web form, mobile, tests, a future screen). A value that slipped
 * past the rules and sat locally would ship in the next sync, and the receiving device's decoder
 * would reject it with the same predicate. That persona would never arrive on that device.
 */
export function requirePersonaName(input: string): string {
	const checked = checkPersonaName(input);
	if (!checked.ok) throw new ChatPersonaNameError(checked.reason);
	return checked.name;
}

export function requirePersonaDescription(input: string): string {
	const checked = checkPersonaDescription(input);
	if (!checked.ok) throw new ChatPersonaDescriptionError(checked.reason);
	return checked.description;
}

export interface CreatePersonaInput {
	name: string;
	/** Omitted means an empty string. A role with only a name is a complete value. */
	description?: string;
}

/** The part of a saved persona that may be overlaid. Identity and creation time do not change. */
export type UpdatePersonaPatch = Partial<
	Pick<ChatPersona, "name" | "description">
>;

/**
 * Creates the persona record. It does not save. The rules are checked again here. What the factory
 * passes is the value that gets stored. The storage layer checking once more is not a reason to
 * drop either check. A path that calls this directly (tests, migration) and skips validation would
 * store the value unchecked.
 */
export function createPersonaRecord(
	input: CreatePersonaInput,
	stamp: ChatStamp,
): ChatPersona {
	return {
		id: stamp.id,
		name: requirePersonaName(input.name),
		description: requirePersonaDescription(input.description ?? ""),
		createdAt: stamp.now,
		updatedAt: stamp.now,
		deletedAt: null,
		...freshChatSyncMeta(stamp.rev),
	};
}

/**
 * Order of the library list: most recently modified first. Ties are broken by id, so the order is
 * deterministic. Not sorted by name. People open the library to find the role they just created or
 * to recheck the one they just edited, and in name order they would have to locate that row each
 * time. The other local-first lists in this repo (rooms, drafts) use the same axis. Different rules
 * per list would make the user remember which list sorts how. The id tie-break matters: without it,
 * two rows created in the same millisecond would swap order on every run.
 */
export const sortPersonas = (personas: readonly ChatPersona[]): ChatPersona[] =>
	[...personas].sort((a, b) => {
		if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
		return a.id < b.id ? 1 : -1;
	});

/**
 * What the create and edit form gets from its save button. The shape and reasoning match
 * planRoomRename for rooms. What counts as a valid value is decided in one place. Each app has one
 * table that translates the reason into words. Pure functions can be checked without rendering.
 * Putting conditions inside the dialog would leave 'try it by hand' as the only way to verify the
 * rule.
 */
export type ChatPersonaSavePlan =
	| { kind: "invalid"; field: "name"; reason: ChatPersonaNameRejection }
	| {
			kind: "invalid";
			field: "description";
			reason: ChatPersonaDescriptionRejection;
	  }
	/**
	 * Nothing changed: close without writing. Writing would be wrong because an edit counts as
	 * activity (the same axis as room renaming). If a user opens the dialog and saves unchanged, the
	 * persona rising to the top of the library would look like something they did not do. The create
	 * flow never produces this branch, since there is nothing to compare against.
	 */
	| { kind: "unchanged" }
	| { kind: "save"; name: string; description: string };

/**
 * Validates the two fields and checks whether anything changed. If current is absent, this is a new
 * persona, and 'unchanged' cannot occur. Name is checked first. When both fields are invalid, this
 * fixes which field gets focus, so the screen does not decide again. Two decisions would eventually
 * diverge.
 */
export function planPersonaSave(
	input: { name: string; description: string },
	current?: Pick<ChatPersona, "name" | "description"> | null,
): ChatPersonaSavePlan {
	const name = checkPersonaName(input.name);
	if (!name.ok) return { kind: "invalid", field: "name", reason: name.reason };
	const description = checkPersonaDescription(input.description);
	if (!description.ok)
		return {
			kind: "invalid",
			field: "description",
			reason: description.reason,
		};
	if (
		current &&
		current.name === name.name &&
		current.description === description.description
	)
		return { kind: "unchanged" };
	return {
		kind: "save",
		name: name.name,
		description: description.description,
	};
}
