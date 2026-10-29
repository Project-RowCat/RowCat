import type {
	ChatPersonaDescriptionRejection,
	ChatPersonaNameRejection,
	ChatPersonaSavePlan,
	ChatPersonaSnapshot,
	ChatPersonaSource,
} from "@rowcat/chat";
import {
	CHAT_PERSONA_DESCRIPTION_MAX_LENGTH,
	CHAT_PERSONA_NAME_MAX_LENGTH,
	chatPersonaOrigin,
	chatTextLength,
	effectiveChatPersona,
	planPersonaSave as planPersonaSaveRule,
} from "@rowcat/chat";

/**
 * The **copy** of the persona form. The rules live in `@rowcat/chat`.
 *
 * The rule side (`planPersonaSave`, `checkPersonaName`, `chatTextLength`) sits in the pure package
 * for the same reason as memory and rename: it has two consumers (the web dialog and the mobile
 * settings surface), and when any of the three is wrong the failure is silent. The save button does
 * nothing, or a role the user did not change is saved and sent to other devices, or the two apps
 * disagree on what "a name that is too long" means.
 *
 * This file moved out of `features/chat/` as the first change of the settings slice. While room
 * settings' picker was the only consumer, that location was right. Once the library's home became
 * `/settings/personas`, the settings screen imported a file from the conversation folder. That
 * import direction says "the library is a child of conversation", but this value is the opposite
 * (`@rowcat/chat`'s `persona.ts`: the library is an **account asset**, not a child of any
 * conversation). That is why it moved to a neutral folder instead of being copied twice; web has a
 * folder with the same name too.
 *
 * Web has **a file with the same name and the same sentences** (`apps/web/src/features/persona/`).
 * The copy is intentional: the apps do not import each other, and moving the copy into a shared
 * package would tie pure rules to a locale. Only the sentences can diverge; the rules stay in one
 * place.
 *
 * What stays here is the Korean text and **which field is wrong**. The field comes with the copy
 * because of focus: if the form recomputed that answer, the judgement would exist in two places and
 * drift apart.
 */

export type PersonaFormField = "name" | "description";

export type PersonaPlan =
	/** A value that cannot be saved: attach the reason to that field and move focus there. */
	| { kind: "invalid"; field: PersonaFormField; message: string }
	/** Nothing changed: **close without writing** (an edit issues a revision). */
	| { kind: "unchanged" }
	| { kind: "save"; name: string; description: string };

const NAME_COPY: Record<ChatPersonaNameRejection, string> = {
	empty: "Please enter a name.",
	too_long: `Names can be up to ${CHAT_PERSONA_NAME_MAX_LENGTH} characters.`,
};

const DESCRIPTION_COPY: Record<ChatPersonaDescriptionRejection, string> = {
	too_long: `Descriptions can be up to ${CHAT_PERSONA_DESCRIPTION_MAX_LENGTH} characters.`,
};

/** With no `current`, this is **a create**, so `unchanged` is never returned. */
export function planPersonaSave(
	input: { name: string; description: string },
	current?: ChatPersonaSnapshot | null,
): PersonaPlan {
	const plan: ChatPersonaSavePlan = planPersonaSaveRule(input, current);
	if (plan.kind !== "invalid") return plan;
	return plan.field === "name"
		? { kind: "invalid", field: "name", message: NAME_COPY[plan.reason] }
		: {
				kind: "invalid",
				field: "description",
				message: DESCRIPTION_COPY[plan.reason],
			};
}

/**
 * A failure as one sentence a person can read.
 *
 * The raw Dexie message is not shown: it does not say what the user can do, and it carries internal
 * structure. Not splitting the cases is intentional too: quota exceeded and a connection closed
 * during an account switch both leave the user with the same next step.
 */
export const PERSONA_SAVE_FAILURE_MESSAGE =
	"Couldn't save the persona. Please try again.";

export const PERSONA_DELETE_FAILURE_MESSAGE =
	"Couldn't delete the persona. Please try again.";

/** Failure on the side that applies to the room; deleting also counts as applying, so there is one sentence. */
export const PERSONA_APPLY_FAILURE_MESSAGE =
	"Couldn't change this conversation's persona. Please try again.";

/**
 * States what the delete confirmation does **not** do.
 *
 * Deleting from the library does nothing to conversations already started (a room carries its own
 * copy of the value). If that is not written, the user will not delete for fear that the speaker of
 * their conversation disappears, and a user who deletes and sees the conversation intact will read
 * the deletion as having failed.
 */
export const PERSONA_DELETE_NOTICE =
	"Conversations already started with this persona stay as they are.";

/**
 * Whether to **show** the character count: only when the limit is near.
 *
 * If it were always visible, the number would follow the user while they type, and in most cases it
 * says nothing (the same rule as rename and memory).
 */
export const PERSONA_NAME_COUNTER_THRESHOLD = CHAT_PERSONA_NAME_MAX_LENGTH - 20;
export const PERSONA_DESCRIPTION_COUNTER_THRESHOLD =
	CHAT_PERSONA_DESCRIPTION_MAX_LENGTH - 400;

/** Length the screen counts; must use the same unit as the store (code points). */
export const personaTextLength = chatTextLength;

/* Copy for the three states: the name alone does not tell them apart. */

/**
 * The name of the row that points at the counterpart the work proposed.
 *
 * The point is that it says **work default**, not a plain "default". A bare "default" would be read
 * as RowCat's default setting, while the role is actually set by this work's creator; another work
 * shows a different name in that place.
 */
export const PERSONA_STORY_DEFAULT_LABEL = "Story's default persona";

/** The work did not propose a role either: this is a state, not something to pick. */
export const PERSONA_NONE_LABEL = "Not set";

/**
 * One line for when the name is not yet known.
 *
 * Used by the dialog that is picked **before** starting a conversation. The name of the role the
 * work proposed lives in the playback snapshot, which is only received after start is pressed, so
 * the name cannot be shown there. Writing `Not set` instead would say there is no role when the work
 * did propose one (**a wrong value is worse than no value**). So this describes what will happen.
 */
export const PERSONA_STORY_DEFAULT_HINT = "Uses the role the story suggests";

/**
 * **One line** drawn by the persona row on the settings home.
 *
 * The three cases are not folded into one sentence. A role the user chose and a role the work
 * proposed cannot be told apart by name alone, and without that distinction the user cannot answer
 * "did I pick this?". The judgement belongs to the shared predicate (`chatPersonaOrigin`); this
 * function only picks the sentence.
 */
export function personaRowSummary(source: ChatPersonaSource): string {
	const origin = chatPersonaOrigin(source);
	if (origin === "default") return PERSONA_NONE_LABEL;
	const name = effectiveChatPersona(source)?.name ?? "";
	return origin === "story" ? `${name} · ${PERSONA_STORY_DEFAULT_LABEL}` : name;
}

/** Empty library, nothing saved yet: say first what this feature is for. */
export const PERSONA_EMPTY_TITLE = "No saved personas";
export const PERSONA_EMPTY_BODY =
	"A persona is the role you play in a conversation. Save the names and settings you use often to pick them again in any conversation.";
